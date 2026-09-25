//! Ядро ATmega328P: CPU, пространство данных, GPIO, прерывания и связь с периферией.
//!
//! Источники: AVR Instruction Set Manual DS40002198B (семантика, флаги, такты — колонка AVRe,
//! 16-битный PC); ATmega328P datasheet 7810D (память, reset, прерывания, порты).
//!
//! Явные приближения:
//! * регистровый файл и SRAM после reset обнуляются (в реальном MCU их содержимое не определено);
//! * загрузчик (optiboot) не эмулируется: выполнение начинается с 0x0000 сразу после reset;
//! * порядок байтов адреса возврата в стеке: младший байт кладётся первым (по старшему адресу);
//! * синхронизатор входа порта (задержка 0,5–1,5 такта) не моделируется;
//! * плавающий вход (Hi-Z без внешнего источника и pull-up) читается как 0 и помечается `floating`;
//! * TXD при включённом передатчике отображается как выход в состоянии покоя (HIGH), отдельные биты
//!   кадра на выводе не моделируются;
//! * SLEEP не переводит CPU в сон (выполняется как NOP с предупреждением, если SE = 1).

use crate::board::{pin_by_port_bit, Port, BOARD_PINS};
use crate::decode::{decode, Op, PtrMode};
use crate::events::{ErrorCode, Event, EventKind, PinMode, Severity};
use crate::hex::{FlashImage, FLASH_BYTES};
use crate::regs::*;
use crate::timer::{Timer, TimerId, OCFA, OCFB, TOV};
use crate::usart::{self, Usart};

/// Размер flash в словах.
pub const FLASH_WORDS: usize = FLASH_BYTES / 2;
/// Размер пространства данных: регистры, I/O, extended I/O, SRAM 0x0100–0x08FF.
pub const DATA_SIZE: usize = 0x900;
/// Последний адрес SRAM; начальное значение SP (datasheet стр. 13).
pub const RAMEND: u16 = 0x08FF;
/// Время реакции на прерывание, такты (datasheet, раздел 6.7.1, стр. 16).
pub const IRQ_RESPONSE_CYCLES: u64 = 4;
/// Предел числа неотобранных событий (ограничение памяти).
pub const MAX_PENDING_EVENTS: usize = 1 << 20;

const C: u8 = 1 << 0;
const Z: u8 = 1 << 1;
const N: u8 = 1 << 2;
const V: u8 = 1 << 3;
const S: u8 = 1 << 4;
const H: u8 = 1 << 5;
const T: u8 = 1 << 6;
const I: u8 = 1 << 7;

/// MCUSR: флаги источника reset (datasheet стр. 46–47).
const PORF: u8 = 1 << 0;
const EXTRF: u8 = 1 << 1;
/// MCUCR.PUD (datasheet стр. 72).
const PUD: u8 = 1 << 4;
/// SMCR.SE.
const SE: u8 = 1 << 0;

/// Выводы блоков сравнения: (таймер, канал, порт, бит) — core 1.8.8 `pins_arduino.h`, datasheet Tables 13-3, 13-9.
const OC_PINS: [(usize, usize, Port, u8); 6] = [
    (0, 0, Port::D, 6),
    (0, 1, Port::D, 5),
    (1, 0, Port::B, 1),
    (1, 1, Port::B, 2),
    (2, 0, Port::B, 3),
    (2, 1, Port::D, 3),
];

/// Состояние вывода платы.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PinState {
    pub mode: PinMode,
    /// Логический уровень, который MCU прочитает из PINx.
    pub value: bool,
    /// Вход не подключён ни к источнику, ни к pull-up — уровень не определён.
    pub floating: bool,
}

pub struct Mcu {
    flash: Box<[u8; FLASH_BYTES]>,
    prog: Box<[Op]>,
    data: Box<[u8; DATA_SIZE]>,
    pc: u32,
    sp: u16,
    sreg: u8,
    cycles: u64,
    /// Такт последнего reset: от него отсчитывается свободно бегущий предделитель.
    epoch: u64,
    next_event: u64,
    irq_dirty: bool,
    irq_inhibit: bool,
    halted: bool,

    ddr: [u8; 3],
    port: [u8; 3],
    ext_level: [u8; 3],
    ext_driven: [u8; 3],
    last_levels: [u8; 3],
    last_pins: Vec<(PinMode, bool)>,

    mcucr: u8,
    mcusr: u8,
    smcr: u8,
    gpior: [u8; 3],
    eicra: u8,
    eimsk: u8,
    eifr: u8,
    pcicr: u8,
    pcifr: u8,
    pcmsk: [u8; 3],
    timers: [Timer; 3],
    usart: Usart,

    events: Vec<Event>,
    events_overflowed: bool,
    reported_io: Box<[bool; 256]>,
    reported_misc: u32,
}

impl Default for Mcu {
    fn default() -> Self {
        Self::new()
    }
}

#[inline]
fn add_flags(rd: u8, rr: u8, r: u8) -> u8 {
    let c = (rd & rr) | (rr & !r) | (!r & rd);
    let v = (rd & rr & !r) | (!rd & !rr & r);
    nzvs(r, v & 0x80 != 0) | if c & 0x80 != 0 { C } else { 0 } | if c & 0x08 != 0 { H } else { 0 }
}

#[inline]
fn sub_flags(rd: u8, rr: u8, r: u8) -> u8 {
    let c = (!rd & rr) | (rr & r) | (r & !rd);
    let v = (rd & !rr & !r) | (!rd & rr & r);
    nzvs(r, v & 0x80 != 0) | if c & 0x80 != 0 { C } else { 0 } | if c & 0x08 != 0 { H } else { 0 }
}

/// Флаги N, Z, V, S для результата `r` и признака переполнения `v`.
#[inline]
fn nzvs(r: u8, v: bool) -> u8 {
    let n = r & 0x80 != 0;
    let mut f = 0;
    if n {
        f |= N;
    }
    if v {
        f |= V;
    }
    if n ^ v {
        f |= S;
    }
    if r == 0 {
        f |= Z;
    }
    f
}

fn port_index(p: Port) -> usize {
    p as usize
}

impl Mcu {
    /// MCU после подачи питания с пустой (стёртой) flash.
    pub fn new() -> Self {
        let mut m = Mcu {
            flash: Box::new([0xFF; FLASH_BYTES]),
            prog: vec![Op::Invalid { opcode: 0xFFFF }; FLASH_WORDS].into_boxed_slice(),
            data: Box::new([0; DATA_SIZE]),
            pc: 0,
            sp: RAMEND,
            sreg: 0,
            cycles: 0,
            epoch: 0,
            next_event: u64::MAX,
            irq_dirty: false,
            irq_inhibit: false,
            halted: false,
            ddr: [0; 3],
            port: [0; 3],
            ext_level: [0; 3],
            ext_driven: [0; 3],
            last_levels: [0; 3],
            last_pins: Vec::new(),
            mcucr: 0,
            mcusr: 0,
            smcr: 0,
            gpior: [0; 3],
            eicra: 0,
            eimsk: 0,
            eifr: 0,
            pcicr: 0,
            pcifr: 0,
            pcmsk: [0; 3],
            timers: [
                Timer::new(TimerId::T0),
                Timer::new(TimerId::T1),
                Timer::new(TimerId::T2),
            ],
            usart: Usart::new(),
            events: Vec::new(),
            events_overflowed: false,
            reported_io: Box::new([false; 256]),
            reported_misc: 0,
        };
        m.reset_state();
        m.mcusr = PORF;
        m.last_pins = m.compute_pins();
        m.last_levels = [m.port_levels(0), m.port_levels(1), m.port_levels(2)];
        m
    }

    /// Загружает образ flash и выполняет power-on reset. Время симуляции продолжает идти.
    pub fn load_firmware(&mut self, image: &FlashImage) {
        self.flash.copy_from_slice(&image.bytes[..]);
        self.decode_all();
        *self.reported_io = [false; 256];
        self.reported_misc = 0;
        self.reset_state();
        self.mcusr = PORF;
        self.refresh_pins();
    }

    /// Загружает программу из слов (для тестов инструкций).
    pub fn load_words(&mut self, words: &[u16]) {
        let mut image = FlashImage {
            bytes: Box::new([0xFF; FLASH_BYTES]),
            used: words.len() * 2,
        };
        for (i, w) in words.iter().enumerate() {
            image.bytes[2 * i] = *w as u8;
            image.bytes[2 * i + 1] = (*w >> 8) as u8;
        }
        self.load_firmware(&image);
    }

    fn decode_all(&mut self) {
        for i in 0..FLASH_WORDS {
            let w = self.word(i);
            let next = self.word((i + 1) % FLASH_WORDS);
            self.prog[i] = decode(w, next);
        }
    }

    #[inline]
    fn word(&self, i: usize) -> u16 {
        u16::from_le_bytes([self.flash[2 * i], self.flash[2 * i + 1]])
    }

    /// Внешний reset (вывод RESET): регистры периферии и CPU в начальное состояние.
    pub fn reset(&mut self) {
        self.reset_state();
        self.mcusr |= EXTRF;
        self.refresh_pins();
    }

    fn reset_state(&mut self) {
        *self.data = [0; DATA_SIZE];
        self.pc = 0;
        self.sp = RAMEND;
        self.sreg = 0;
        self.epoch = self.cycles;
        self.irq_dirty = false;
        self.irq_inhibit = false;
        self.halted = false;
        self.ddr = [0; 3];
        self.port = [0; 3];
        self.mcucr = 0;
        self.smcr = 0;
        self.gpior = [0; 3];
        self.eicra = 0;
        self.eimsk = 0;
        self.eifr = 0;
        self.pcicr = 0;
        self.pcifr = 0;
        self.pcmsk = [0; 3];
        self.timers = [
            Timer::new(TimerId::T0),
            Timer::new(TimerId::T1),
            Timer::new(TimerId::T2),
        ];
        self.usart = Usart::new();
        self.schedule();
    }

    // ---------------------------------------------------------------- публичное API

    pub fn cycles(&self) -> u64 {
        self.cycles
    }

    pub fn pc_bytes(&self) -> u32 {
        self.pc * 2
    }

    pub fn sp(&self) -> u16 {
        self.sp
    }

    pub fn sreg(&self) -> u8 {
        self.sreg
    }

    pub fn set_sreg(&mut self, v: u8) {
        self.sreg = v;
        self.irq_dirty = true;
    }

    pub fn reg(&self, r: usize) -> u8 {
        self.data[r]
    }

    pub fn set_reg(&mut self, r: usize, v: u8) {
        self.data[r] = v;
    }

    pub fn halted(&self) -> bool {
        self.halted
    }

    /// Чтение пространства данных без побочных эффектов (для тестов и отладки).
    pub fn peek(&self, addr: u16) -> u8 {
        match addr {
            SREG => self.sreg,
            SPL => self.sp as u8,
            SPH => (self.sp >> 8) as u8,
            a if (a as usize) < DATA_SIZE => self.data[a as usize],
            _ => 0,
        }
    }

    /// Запись в SRAM/регистры без побочных эффектов (для тестов).
    pub fn poke(&mut self, addr: u16, v: u8) {
        if (addr as usize) < DATA_SIZE {
            self.data[addr as usize] = v;
        }
    }

    /// Задаёт внешний логический уровень на выводе (`None` — вывод не подключён).
    pub fn set_input(&mut self, pin: &str, level: Option<bool>) -> Result<(), String> {
        let p = crate::board::pin_by_name(pin).ok_or_else(|| format!("unknown pin {pin}"))?;
        let i = port_index(p.port);
        let m = 1u8 << p.bit;
        match level {
            Some(l) => {
                self.ext_driven[i] |= m;
                if l {
                    self.ext_level[i] |= m;
                } else {
                    self.ext_level[i] &= !m;
                }
            }
            None => {
                self.ext_driven[i] &= !m;
                self.ext_level[i] &= !m;
            }
        }
        self.refresh_pins();
        Ok(())
    }

    /// Передаёт байты на вход RX USART0 (как будто их отправил Serial Monitor).
    pub fn serial_input(&mut self, bytes: &[u8]) -> usize {
        let n = self.usart.inject(bytes, self.cycles);
        self.schedule();
        n
    }

    pub fn pin_state(&self, name: &str) -> Option<PinState> {
        let p = crate::board::pin_by_name(name)?;
        Some(self.pin_state_at(port_index(p.port), p.bit))
    }

    /// Забирает накопленные события.
    pub fn drain_events(&mut self) -> Vec<Event> {
        self.events_overflowed = false;
        std::mem::take(&mut self.events)
    }

    pub fn pending_events(&self) -> usize {
        self.events.len()
    }

    /// Выполняет инструкции, пока такт не достигнет `target` (или CPU не остановлен).
    pub fn run_until(&mut self, target: u64) {
        while self.cycles < target && !self.halted {
            self.step();
        }
    }

    pub fn run_for(&mut self, cycles: u64) {
        let target = self.cycles.saturating_add(cycles);
        self.run_until(target);
    }

    /// Одна инструкция (с предварительной проверкой прерываний).
    #[inline]
    pub fn step(&mut self) {
        if self.halted {
            return;
        }
        if self.irq_inhibit {
            self.irq_inhibit = false;
        } else if self.irq_dirty && self.sreg & I != 0 {
            match self.find_irq() {
                Some(v) => self.service_irq(v),
                None => self.irq_dirty = false,
            }
        }
        let c = self.exec();
        self.cycles += c;
        if self.cycles >= self.next_event {
            self.sync_peripherals();
        }
    }

    // ---------------------------------------------------------------- события

    fn emit(&mut self, kind: EventKind) {
        self.emit_at(self.cycles, kind);
    }

    fn emit_at(&mut self, cycle: u64, kind: EventKind) {
        if self.events.len() >= MAX_PENDING_EVENTS {
            if !self.events_overflowed {
                self.events_overflowed = true;
                let e = Event {
                    cycle,
                    kind: EventKind::SimulationError {
                        code: ErrorCode::EventBufferOverflow,
                        severity: Severity::Warning,
                        message: "event buffer is full; events are dropped until drained".into(),
                        pc_byte: self.pc * 2,
                    },
                };
                self.events.push(e);
            }
            return;
        }
        self.events.push(Event { cycle, kind });
    }

    fn diag(&mut self, code: ErrorCode, severity: Severity, message: String) {
        let pc_byte = self.pc * 2;
        self.emit(EventKind::SimulationError {
            code,
            severity,
            message,
            pc_byte,
        });
    }

    fn report_io(&mut self, addr: u16) {
        let a = addr as usize & 0xFF;
        if !self.reported_io[a] {
            self.reported_io[a] = true;
            self.diag(
                ErrorCode::UnsupportedPeripheral,
                Severity::Warning,
                format!(
                    "access to {} ({:#04x}) is not simulated; value is stored only",
                    name(addr),
                    addr
                ),
            );
        }
    }

    fn report_once(&mut self, bit: u32, code: ErrorCode, message: &str) {
        if self.reported_misc & (1 << bit) == 0 {
            self.reported_misc |= 1 << bit;
            self.diag(code, Severity::Warning, message.to_string());
        }
    }

    fn halt(&mut self, code: ErrorCode, message: String) {
        self.halted = true;
        self.diag(code, Severity::Error, message);
    }

    // ---------------------------------------------------------------- периферия

    fn schedule(&mut self) {
        let t = self.timers[0]
            .next_tick
            .min(self.timers[1].next_tick)
            .min(self.timers[2].next_tick)
            .min(self.usart.next_event());
        self.next_event = t;
    }

    fn sync_peripherals(&mut self) {
        let now = self.cycles;
        let mut pins_dirty = false;
        for i in 0..3 {
            if self.timers[i].next_tick <= now {
                self.timers[i].advance(now);
                self.irq_dirty = true;
                if self.timers[i].oc_changed {
                    self.timers[i].oc_changed = false;
                    pins_dirty = true;
                }
                self.collect_timer_reports(i);
            }
        }
        if self.usart.next_event() <= now {
            if self.usart.advance(now) {
                self.irq_dirty = true;
            }
            for (t, b) in std::mem::take(&mut self.usart.sent) {
                self.emit_at(t, EventKind::SerialOutput { byte: b });
            }
        }
        if pins_dirty {
            self.refresh_pins();
        }
        self.schedule();
    }

    fn collect_timer_reports(&mut self, i: usize) {
        for ch in 0..2 {
            if let Some((high, total)) = self.timers[i].pwm_report[ch].take() {
                let (_, _, port, bit) = OC_PINS[i * 2 + ch];
                if self.ddr[port_index(port)] & (1 << bit) == 0 {
                    continue;
                }
                if let Some(p) = pin_by_port_bit(port, bit) {
                    let frequency_hz = self.timers[i].frequency_hz(total);
                    self.emit(EventKind::PwmChanged {
                        pin: p.name,
                        high_ticks: high,
                        period_ticks: total,
                        frequency_hz,
                    });
                }
            }
        }
        if let Some(msg) = self.timers[i].unsupported.take() {
            let bit = 8 + i as u32;
            self.report_once(
                bit,
                ErrorCode::UnsupportedPeripheral,
                &format!("Timer{i}: {msg} is not simulated"),
            );
        }
    }

    fn oc_for(&self, p: usize, bit: u8) -> Option<(usize, usize)> {
        OC_PINS
            .iter()
            .find(|(_, _, port, b)| port_index(*port) == p && *b == bit)
            .map(|(t, ch, _, _)| (*t, *ch))
    }

    fn pin_state_at(&self, p: usize, bit: u8) -> PinState {
        let m = 1u8 << bit;
        let pullup = self.port[p] & m != 0 && self.mcucr & PUD == 0;
        // USART переопределяет выводы D0 (RXD) и D1 (TXD).
        if p == Port::D as usize && bit == 1 && self.usart.tx_enabled() {
            return PinState {
                mode: PinMode::OutputHigh,
                value: true,
                floating: false,
            };
        }
        let rx_override = p == Port::D as usize && bit == 0 && self.usart.rx_enabled();
        if self.ddr[p] & m != 0 && !rx_override {
            if let Some((t, ch)) = self.oc_for(p, bit) {
                let tm = &self.timers[t];
                if tm.oc_connected(ch) {
                    let v = tm.oc[ch];
                    let mode = if tm.oc_is_pwm(ch) {
                        PinMode::Pwm
                    } else if v {
                        PinMode::OutputHigh
                    } else {
                        PinMode::OutputLow
                    };
                    return PinState {
                        mode,
                        value: v,
                        floating: false,
                    };
                }
            }
            let v = self.port[p] & m != 0;
            let mode = if v {
                PinMode::OutputHigh
            } else {
                PinMode::OutputLow
            };
            return PinState {
                mode,
                value: v,
                floating: false,
            };
        }
        let mode = if pullup {
            PinMode::InputPullup
        } else {
            PinMode::Input
        };
        if self.ext_driven[p] & m != 0 {
            PinState {
                mode,
                value: self.ext_level[p] & m != 0,
                floating: false,
            }
        } else if pullup {
            PinState {
                mode,
                value: true,
                floating: false,
            }
        } else {
            PinState {
                mode,
                value: false,
                floating: true,
            }
        }
    }

    fn port_levels(&self, p: usize) -> u8 {
        let mut v = 0;
        for bit in 0..8 {
            if self.pin_state_at(p, bit).value {
                v |= 1 << bit;
            }
        }
        v
    }

    fn compute_pins(&self) -> Vec<(PinMode, bool)> {
        BOARD_PINS
            .iter()
            .map(|bp| {
                let s = self.pin_state_at(port_index(bp.port), bp.bit);
                // В PWM-режиме отдельные фронты не публикуются: их описывает pwm_changed.
                (
                    s.mode,
                    if s.mode == PinMode::Pwm {
                        false
                    } else {
                        s.value
                    },
                )
            })
            .collect()
    }

    /// Пересчитывает уровни выводов: события digital_pin_changed, фронты INT0/INT1 и PCINT.
    fn refresh_pins(&mut self) {
        let levels = [
            self.port_levels(0),
            self.port_levels(1),
            self.port_levels(2),
        ];
        for (p, &level) in levels.iter().enumerate() {
            let changed = level ^ self.last_levels[p];
            if changed == 0 {
                continue;
            }
            if p == Port::D as usize {
                for (n, bit) in [(0usize, 2u8), (1, 3)] {
                    if changed & (1 << bit) != 0 {
                        let isc = (self.eicra >> (2 * n)) & 0x03;
                        let rising = level & (1 << bit) != 0;
                        let hit = match isc {
                            1 => true,
                            2 => !rising,
                            3 => rising,
                            _ => false,
                        };
                        if hit {
                            self.eifr |= 1 << n;
                        }
                    }
                }
            }
            if changed & self.pcmsk[p] != 0 {
                self.pcifr |= 1 << pcint_group(p);
            }
            self.irq_dirty = true;
        }
        self.last_levels = levels;

        let pins = self.compute_pins();
        for (i, st) in pins.iter().enumerate() {
            if self.last_pins.get(i) != Some(st) {
                let bp = &BOARD_PINS[i];
                if self.last_pins.get(i).map(|s| s.0) == Some(PinMode::Pwm) && st.0 != PinMode::Pwm
                {
                    if let Some((t, ch)) = self.oc_for(port_index(bp.port), bp.bit) {
                        self.timers[t].forget_pwm(ch);
                    }
                }
                self.emit(EventKind::DigitalPinChanged {
                    pin: bp.name,
                    mode: st.0,
                    value: st.1,
                });
            }
        }
        self.last_pins = pins;
    }

    // ---------------------------------------------------------------- прерывания

    /// Номер вектора (0 — RESET) с наивысшим приоритетом среди ожидающих (datasheet Table 11-1).
    fn find_irq(&self) -> Option<u32> {
        // INT0/INT1: фронты — через EIFR, низкий уровень — пока вывод в 0 (без флага).
        for n in 0..2u32 {
            if self.eimsk & (1 << n) != 0 {
                let isc = (self.eicra >> (2 * n)) & 0x03;
                let low = self.last_levels[Port::D as usize] & (1 << (2 + n)) == 0;
                if (isc == 0 && low) || (isc != 0 && self.eifr & (1 << n) != 0) {
                    return Some(1 + n);
                }
            }
        }
        for g in 0..3u32 {
            if self.pcicr & self.pcifr & (1 << g) != 0 {
                return Some(3 + g);
            }
        }
        // Timer2 (векторы 7–9), Timer1 (11–13), Timer0 (14–16).
        for (t, base) in [(2usize, 7u32), (1, 11), (0, 14)] {
            let pending = self.timers[t].tifr & self.timers[t].timsk;
            if pending & OCFA != 0 {
                return Some(base);
            }
            if pending & OCFB != 0 {
                return Some(base + 1);
            }
            if pending & TOV != 0 {
                return Some(base + 2);
            }
        }
        let a = self.usart.ucsra;
        let b = self.usart.ucsrb;
        if a & usart::RXC != 0 && b & usart::RXCIE != 0 {
            return Some(18);
        }
        if a & usart::UDRE != 0 && b & usart::UDRIE != 0 {
            return Some(19);
        }
        if a & usart::TXC != 0 && b & usart::TXCIE != 0 {
            return Some(20);
        }
        None
    }

    fn service_irq(&mut self, vector: u32) {
        match vector {
            1 | 2 => self.eifr &= !(1 << (vector - 1)),
            3..=5 => self.pcifr &= !(1 << (vector - 3)),
            7..=9 => self.timers[2].tifr &= !flag_for(vector - 7),
            11..=13 => self.timers[1].tifr &= !flag_for(vector - 11),
            14..=16 => self.timers[0].tifr &= !flag_for(vector - 14),
            20 => self.usart.ucsra &= !usart::TXC,
            _ => {} // RXC и UDRE — флаги-состояния, аппаратно не сбрасываются
        }
        let ret = self.pc;
        self.push_pc(ret);
        self.sreg &= !I;
        self.pc = vector * 2;
        self.cycles += IRQ_RESPONSE_CYCLES;
        if self.cycles >= self.next_event {
            self.sync_peripherals();
        }
    }

    // ---------------------------------------------------------------- память данных

    #[inline]
    fn read(&mut self, addr: u16) -> u8 {
        let a = addr as usize;
        if a >= 0x100 {
            if a < DATA_SIZE {
                self.data[a]
            } else {
                self.out_of_range(addr);
                0
            }
        } else if a < 0x20 {
            self.data[a]
        } else {
            self.io_read(addr)
        }
    }

    #[inline]
    fn write(&mut self, addr: u16, v: u8) {
        let a = addr as usize;
        if a >= 0x100 {
            if a < DATA_SIZE {
                self.data[a] = v;
            } else {
                self.out_of_range(addr);
            }
        } else if a < 0x20 {
            self.data[a] = v;
        } else {
            self.io_write(addr, v);
        }
    }

    fn out_of_range(&mut self, addr: u16) {
        self.report_once(
            0,
            ErrorCode::DataAddressOutOfRange,
            &format!("data access at {addr:#06x} is outside SRAM (0x0100–0x08FF); read as 0, write ignored"),
        );
    }

    fn io_read(&mut self, addr: u16) -> u8 {
        match addr {
            PINB | PINC | PIND => self.port_levels(((addr - PINB) / 3) as usize),
            DDRB | DDRC | DDRD => self.ddr[((addr - DDRB) / 3) as usize],
            PORTB | PORTC | PORTD => self.port[((addr - PORTB) / 3) as usize],
            TIFR0 => self.timers[0].tifr,
            TIFR1 => self.timers[1].tifr,
            TIFR2 => self.timers[2].tifr,
            PCIFR => self.pcifr,
            EIFR => self.eifr,
            EIMSK => self.eimsk,
            GPIOR0 => self.gpior[0],
            GPIOR1 => self.gpior[1],
            GPIOR2 => self.gpior[2],
            TCCR0A => self.timers[0].tccra,
            TCCR0B => self.timers[0].tccrb,
            TCNT0 => self.timers[0].tcnt as u8,
            OCR0A => self.timers[0].read_ocr(0) as u8,
            OCR0B => self.timers[0].read_ocr(1) as u8,
            MCUSR => self.mcusr,
            MCUCR => self.mcucr,
            0x53 => {
                // SMCR: хранится, сон не моделируется.
                self.smcr
            }
            SPL => self.sp as u8,
            SPH => (self.sp >> 8) as u8,
            SREG => self.sreg,
            PCICR => self.pcicr,
            EICRA => self.eicra,
            PCMSK0 => self.pcmsk[0],
            PCMSK1 => self.pcmsk[1],
            PCMSK2 => self.pcmsk[2],
            TIMSK0 => self.timers[0].timsk,
            TIMSK1 => self.timers[1].timsk,
            TIMSK2 => self.timers[2].timsk,
            TCCR1A => self.timers[1].tccra,
            TCCR1B => self.timers[1].tccrb,
            TCCR1C => 0,
            TCNT1L => {
                let t = &mut self.timers[1];
                t.temp = (t.tcnt >> 8) as u8;
                t.tcnt as u8
            }
            ICR1L => {
                let t = &mut self.timers[1];
                t.temp = (t.icr >> 8) as u8;
                t.icr as u8
            }
            TCNT1H | ICR1H => self.timers[1].temp,
            OCR1AL => self.timers[1].read_ocr(0) as u8,
            OCR1AH => (self.timers[1].read_ocr(0) >> 8) as u8,
            OCR1BL => self.timers[1].read_ocr(1) as u8,
            OCR1BH => (self.timers[1].read_ocr(1) >> 8) as u8,
            TCCR2A => self.timers[2].tccra,
            TCCR2B => self.timers[2].tccrb,
            TCNT2 => self.timers[2].tcnt as u8,
            OCR2A => self.timers[2].read_ocr(0) as u8,
            OCR2B => self.timers[2].read_ocr(1) as u8,
            UCSR0A => self.usart.ucsra,
            UCSR0B => self.usart.ucsrb,
            UCSR0C => self.usart.ucsrc,
            UBRR0L => self.usart.ubrr as u8,
            UBRR0H => (self.usart.ubrr >> 8) as u8,
            UDR0 => {
                self.irq_dirty = true;
                self.usart.read_udr()
            }
            _ => {
                self.report_io(addr);
                self.data[addr as usize]
            }
        }
    }

    fn io_write(&mut self, addr: u16, v: u8) {
        self.irq_dirty = true;
        let now = self.cycles;
        match addr {
            PINB | PINC | PIND => {
                // Запись 1 в PINxn переключает PORTxn (datasheet раздел 13.2.2, стр. 60).
                self.port[((addr - PINB) / 3) as usize] ^= v;
                self.refresh_pins();
            }
            DDRB | DDRC | DDRD => {
                self.ddr[((addr - DDRB) / 3) as usize] = v;
                self.refresh_pins();
            }
            PORTB | PORTC | PORTD => {
                self.port[((addr - PORTB) / 3) as usize] = v;
                self.refresh_pins();
            }
            TIFR0 => self.timers[0].tifr &= !v,
            TIFR1 => self.timers[1].tifr &= !v,
            TIFR2 => self.timers[2].tifr &= !v,
            PCIFR => self.pcifr &= !v,
            EIFR => self.eifr &= !v,
            EIMSK => self.eimsk = v & 0x03,
            GPIOR0 => self.gpior[0] = v,
            GPIOR1 => self.gpior[1] = v,
            GPIOR2 => self.gpior[2] = v,
            TCCR0A | TCCR2A | TCCR1A => {
                let t = timer_of(addr);
                if self.timers[t].tccra == v {
                    return;
                }
                self.timers[t].tccra = v;
                self.timers[t].check_config();
                self.collect_timer_reports(t);
                self.refresh_pins();
            }
            TCCR0B | TCCR2B | TCCR1B => {
                let t = timer_of(addr);
                // FOCnA/FOCnB (биты 7:6) не моделируются и читаются как 0.
                let v = if t == 1 { v & 0xDF } else { v & 0x0F };
                if self.timers[t].tccrb == v {
                    return;
                }
                self.timers[t].tccrb = v;
                self.timers[t].reschedule_from(now, self.epoch);
                self.timers[t].check_config();
                self.collect_timer_reports(t);
                self.refresh_pins();
                self.schedule();
            }
            TCCR1C => {}
            TCNT0 => self.timers[0].tcnt = v as u16,
            TCNT2 => self.timers[2].tcnt = v as u16,
            OCR0A => self.timers[0].write_ocr(0, v as u16),
            OCR0B => self.timers[0].write_ocr(1, v as u16),
            OCR2A => self.timers[2].write_ocr(0, v as u16),
            OCR2B => self.timers[2].write_ocr(1, v as u16),
            TCNT1H | ICR1H | OCR1AH | OCR1BH => self.timers[1].temp = v,
            TCNT1L => {
                let t = &mut self.timers[1];
                t.tcnt = (t.temp as u16) << 8 | v as u16;
            }
            ICR1L => {
                let t = &mut self.timers[1];
                t.icr = (t.temp as u16) << 8 | v as u16;
            }
            OCR1AL | OCR1BL => {
                let t = &mut self.timers[1];
                let val = (t.temp as u16) << 8 | v as u16;
                t.write_ocr(((addr - OCR1AL) / 2) as usize, val);
            }
            MCUSR => self.mcusr = v & 0x0F,
            MCUCR => {
                if v & 0x03 != 0 {
                    self.report_once(
                        1,
                        ErrorCode::UnsupportedPeripheral,
                        "MCUCR.IVSEL/IVCE (moving interrupt vectors) is not simulated",
                    );
                }
                self.mcucr = v;
                self.refresh_pins();
            }
            0x53 => self.smcr = v & 0x0F,
            SPL => self.sp = (self.sp & 0xFF00) | v as u16,
            SPH => self.sp = (self.sp & 0x00FF) | (v as u16) << 8,
            SREG => self.sreg = v,
            PCICR => self.pcicr = v & 0x07,
            EICRA => self.eicra = v & 0x0F,
            PCMSK0 => self.pcmsk[0] = v,
            PCMSK1 => self.pcmsk[1] = v & 0x7F,
            PCMSK2 => self.pcmsk[2] = v,
            TIMSK0 => self.timers[0].timsk = v & 0x07,
            TIMSK1 => self.timers[1].timsk = v & 0x27,
            TIMSK2 => self.timers[2].timsk = v & 0x07,
            UCSR0A => self.usart.write_ucsra(v),
            UCSR0B => {
                self.usart.write_ucsrb(v, now);
                self.refresh_pins();
                self.schedule();
            }
            UCSR0C => {
                self.usart.ucsrc = v;
                if !self.usart.is_async() {
                    self.report_once(
                        2,
                        ErrorCode::UnsupportedPeripheral,
                        "USART0 synchronous/MSPIM mode is not simulated",
                    );
                }
            }
            UBRR0L => self.usart.ubrr = (self.usart.ubrr & 0x0F00) | v as u16,
            UBRR0H => self.usart.ubrr = (self.usart.ubrr & 0x00FF) | ((v as u16 & 0x0F) << 8),
            UDR0 => {
                self.usart.write_udr(v, now);
                self.schedule();
            }
            _ => {
                self.report_io(addr);
                self.data[addr as usize] = v;
            }
        }
    }

    // ---------------------------------------------------------------- стек

    #[inline]
    fn push(&mut self, v: u8) {
        let sp = self.sp;
        self.write(sp, v);
        self.sp = sp.wrapping_sub(1);
    }

    #[inline]
    fn pop(&mut self) -> u8 {
        self.sp = self.sp.wrapping_add(1);
        let sp = self.sp;
        self.read(sp)
    }

    #[inline]
    fn push_pc(&mut self, pc: u32) {
        self.push(pc as u8);
        self.push((pc >> 8) as u8);
    }

    #[inline]
    fn pop_pc(&mut self) -> u32 {
        let hi = self.pop() as u32;
        let lo = self.pop() as u32;
        ((hi << 8) | lo) & (FLASH_WORDS as u32 - 1)
    }

    // ---------------------------------------------------------------- исполнение

    #[inline]
    fn r(&self, i: u8) -> u8 {
        self.data[i as usize]
    }

    #[inline]
    fn set_r(&mut self, i: u8, v: u8) {
        self.data[i as usize] = v;
    }

    #[inline]
    fn r16(&self, i: u8) -> u16 {
        u16::from_le_bytes([self.data[i as usize], self.data[i as usize + 1]])
    }

    #[inline]
    fn set_r16(&mut self, i: u8, v: u16) {
        let [lo, hi] = v.to_le_bytes();
        self.data[i as usize] = lo;
        self.data[i as usize + 1] = hi;
    }

    #[inline]
    fn flags(&mut self, mask: u8, bits: u8) {
        self.sreg = (self.sreg & !mask) | (bits & mask);
    }

    #[inline]
    fn next_is_two_word(&self) -> bool {
        let next = (self.pc as usize + 1) & (FLASH_WORDS - 1);
        matches!(
            self.prog[next],
            Op::Lds { .. } | Op::Sts { .. } | Op::Jmp { .. } | Op::Call { .. }
        )
    }

    /// Регистровая пара-указатель после пре/пост-модификации; возвращает эффективный адрес.
    #[inline]
    fn ptr_addr(&mut self, ptr: u8, mode: PtrMode) -> u16 {
        let p = self.r16(ptr);
        match mode {
            PtrMode::Disp(q) => p.wrapping_add(q as u16),
            PtrMode::PostInc => {
                self.set_r16(ptr, p.wrapping_add(1));
                p
            }
            PtrMode::PreDec => {
                let n = p.wrapping_sub(1);
                self.set_r16(ptr, n);
                n
            }
        }
    }

    fn mul_result(&mut self, product: u16, carry: bool) {
        self.set_r16(0, product);
        let mut f = 0;
        if carry {
            f |= C;
        }
        if product == 0 {
            f |= Z;
        }
        self.flags(C | Z, f);
    }

    /// Выполняет инструкцию по адресу PC и возвращает число тактов (колонка AVRe).
    fn exec(&mut self) -> u64 {
        let op = self.prog[self.pc as usize];
        let mut next = self.pc + 1;
        let cycles: u64 = match op {
            Op::Nop => 1,
            Op::Movw { d, r } => {
                let v = self.r16(r);
                self.set_r16(d, v);
                1
            }
            Op::Mul { d, r } => {
                let p = self.r(d) as u16 * self.r(r) as u16;
                self.mul_result(p, p & 0x8000 != 0);
                2
            }
            Op::Muls { d, r } => {
                let p = (self.r(d) as i8 as i16 * self.r(r) as i8 as i16) as u16;
                self.mul_result(p, p & 0x8000 != 0);
                2
            }
            Op::Mulsu { d, r } => {
                let p = (self.r(d) as i8 as i16).wrapping_mul(self.r(r) as i16) as u16;
                self.mul_result(p, p & 0x8000 != 0);
                2
            }
            Op::Fmul { d, r } => {
                let p = self.r(d) as u16 * self.r(r) as u16;
                self.mul_result(p << 1, p & 0x8000 != 0);
                2
            }
            Op::Fmuls { d, r } => {
                let p = (self.r(d) as i8 as i16 * self.r(r) as i8 as i16) as u16;
                self.mul_result(p << 1, p & 0x8000 != 0);
                2
            }
            Op::Fmulsu { d, r } => {
                let p = (self.r(d) as i8 as i16).wrapping_mul(self.r(r) as i16) as u16;
                self.mul_result(p << 1, p & 0x8000 != 0);
                2
            }
            Op::Add { d, r } => {
                let (a, b) = (self.r(d), self.r(r));
                let res = a.wrapping_add(b);
                self.set_r(d, res);
                self.flags(C | Z | N | V | S | H, add_flags(a, b, res));
                1
            }
            Op::Adc { d, r } => {
                let (a, b) = (self.r(d), self.r(r));
                let res = a.wrapping_add(b).wrapping_add(self.sreg & C);
                self.set_r(d, res);
                self.flags(C | Z | N | V | S | H, add_flags(a, b, res));
                1
            }
            Op::Sub { d, r } => {
                let (a, b) = (self.r(d), self.r(r));
                let res = a.wrapping_sub(b);
                self.set_r(d, res);
                self.flags(C | Z | N | V | S | H, sub_flags(a, b, res));
                1
            }
            Op::Subi { d, k } => {
                let a = self.r(d);
                let res = a.wrapping_sub(k);
                self.set_r(d, res);
                self.flags(C | Z | N | V | S | H, sub_flags(a, k, res));
                1
            }
            Op::Sbc { d, r } => {
                let b = self.r(r);
                self.sbc(d, b, true);
                1
            }
            Op::Sbci { d, k } => {
                self.sbc(d, k, true);
                1
            }
            Op::Cp { d, r } => {
                let (a, b) = (self.r(d), self.r(r));
                self.flags(C | Z | N | V | S | H, sub_flags(a, b, a.wrapping_sub(b)));
                1
            }
            Op::Cpi { d, k } => {
                let a = self.r(d);
                self.flags(C | Z | N | V | S | H, sub_flags(a, k, a.wrapping_sub(k)));
                1
            }
            Op::Cpc { d, r } => {
                let b = self.r(r);
                self.sbc(d, b, false);
                1
            }
            Op::Cpse { d, r } => {
                if self.r(d) == self.r(r) {
                    self.skip_to(&mut next)
                } else {
                    1
                }
            }
            Op::And { d, r } => {
                let res = self.r(d) & self.r(r);
                self.logic(d, res);
                1
            }
            Op::Andi { d, k } => {
                let res = self.r(d) & k;
                self.logic(d, res);
                1
            }
            Op::Or { d, r } => {
                let res = self.r(d) | self.r(r);
                self.logic(d, res);
                1
            }
            Op::Ori { d, k } => {
                let res = self.r(d) | k;
                self.logic(d, res);
                1
            }
            Op::Eor { d, r } => {
                let res = self.r(d) ^ self.r(r);
                self.logic(d, res);
                1
            }
            Op::Mov { d, r } => {
                let v = self.r(r);
                self.set_r(d, v);
                1
            }
            Op::Ldi { d, k } => {
                self.set_r(d, k);
                1
            }
            Op::Ld { d, ptr, mode } => {
                let a = self.ptr_addr(ptr, mode);
                let v = self.read(a);
                self.set_r(d, v);
                2
            }
            Op::St { r, ptr, mode } => {
                let v = self.r(r);
                let a = self.ptr_addr(ptr, mode);
                self.write(a, v);
                2
            }
            Op::Lds { d, k } => {
                let v = self.read(k);
                self.set_r(d, v);
                next = self.pc + 2;
                2
            }
            Op::Sts { k, r } => {
                let v = self.r(r);
                self.write(k, v);
                next = self.pc + 2;
                2
            }
            Op::Lpm { d, inc } => {
                let z = self.r16(30);
                let v = self.flash[z as usize & (FLASH_BYTES - 1)];
                self.set_r(d, v);
                if inc {
                    self.set_r16(30, z.wrapping_add(1));
                }
                3
            }
            Op::Spm => {
                self.halt(
                    ErrorCode::UnsupportedInstruction,
                    "SPM (self-programming) is not simulated".into(),
                );
                return 0;
            }
            Op::Push { r } => {
                let v = self.r(r);
                self.push(v);
                2
            }
            Op::Pop { d } => {
                let v = self.pop();
                self.set_r(d, v);
                2
            }
            Op::Com { d } => {
                let res = !self.r(d);
                self.set_r(d, res);
                self.flags(C | Z | N | V | S, nzvs(res, false) | C);
                1
            }
            Op::Neg { d } => {
                let a = self.r(d);
                let res = 0u8.wrapping_sub(a);
                self.set_r(d, res);
                self.flags(C | Z | N | V | S | H, sub_flags(0, a, res));
                1
            }
            Op::Swap { d } => {
                let v = self.r(d);
                self.set_r(d, v.rotate_left(4));
                1
            }
            Op::Inc { d } => {
                let res = self.r(d).wrapping_add(1);
                self.set_r(d, res);
                self.flags(Z | N | V | S, nzvs(res, res == 0x80));
                1
            }
            Op::Dec { d } => {
                let res = self.r(d).wrapping_sub(1);
                self.set_r(d, res);
                self.flags(Z | N | V | S, nzvs(res, res == 0x7F));
                1
            }
            Op::Asr { d } => {
                let a = self.r(d);
                self.shift_right(d, (a >> 1) | (a & 0x80), a & 1 != 0);
                1
            }
            Op::Lsr { d } => {
                let a = self.r(d);
                self.shift_right(d, a >> 1, a & 1 != 0);
                1
            }
            Op::Ror { d } => {
                let a = self.r(d);
                self.shift_right(d, (a >> 1) | ((self.sreg & C) << 7), a & 1 != 0);
                1
            }
            Op::Bset { s } => {
                self.sreg |= 1 << s;
                if s == 7 {
                    // Инструкция после SEI выполняется до обработки прерываний (datasheet стр. 16).
                    self.irq_inhibit = true;
                    self.irq_dirty = true;
                }
                1
            }
            Op::Bclr { s } => {
                self.sreg &= !(1 << s);
                1
            }
            Op::Ret => {
                next = self.pop_pc();
                4
            }
            Op::Reti => {
                next = self.pop_pc();
                self.sreg |= I;
                // После RETI выполняется ещё одна инструкция до следующего прерывания (стр. 15).
                self.irq_inhibit = true;
                self.irq_dirty = true;
                4
            }
            Op::Sleep => {
                if self.smcr & SE != 0 {
                    self.report_once(
                        3,
                        ErrorCode::UnsupportedInstruction,
                        "SLEEP modes are not simulated; SLEEP is executed as NOP",
                    );
                }
                1
            }
            Op::Break | Op::Wdr => 1,
            Op::Ijmp => {
                next = self.r16(30) as u32;
                2
            }
            Op::Icall => {
                self.push_pc(self.pc + 1);
                next = self.r16(30) as u32;
                3
            }
            Op::Jmp { k } => {
                next = k;
                3
            }
            Op::Call { k } => {
                self.push_pc(self.pc + 2);
                next = k;
                4
            }
            Op::Rjmp { k } => {
                next = (self.pc as i32 + 1 + k as i32) as u32;
                2
            }
            Op::Rcall { k } => {
                self.push_pc(self.pc + 1);
                next = (self.pc as i32 + 1 + k as i32) as u32;
                3
            }
            Op::Adiw { d, k } => {
                let a = self.r16(d);
                let res = a.wrapping_add(k as u16);
                self.set_r16(d, res);
                let rdh7 = a & 0x8000 != 0;
                let r15 = res & 0x8000 != 0;
                self.word_flags(res, !rdh7 && r15, !r15 && rdh7);
                2
            }
            Op::Sbiw { d, k } => {
                let a = self.r16(d);
                let res = a.wrapping_sub(k as u16);
                self.set_r16(d, res);
                let rdh7 = a & 0x8000 != 0;
                let r15 = res & 0x8000 != 0;
                self.word_flags(res, rdh7 && !r15, r15 && !rdh7);
                2
            }
            Op::Sbi { a, b } => {
                self.bit_io(a, b, true);
                2
            }
            Op::Cbi { a, b } => {
                self.bit_io(a, b, false);
                2
            }
            Op::Sbic { a, b } => {
                let v = self.io_read(a as u16 + 0x20);
                if v & (1 << b) == 0 {
                    self.skip_to(&mut next)
                } else {
                    1
                }
            }
            Op::Sbis { a, b } => {
                let v = self.io_read(a as u16 + 0x20);
                if v & (1 << b) != 0 {
                    self.skip_to(&mut next)
                } else {
                    1
                }
            }
            Op::Sbrc { r, b } => {
                if self.r(r) & (1 << b) == 0 {
                    self.skip_to(&mut next)
                } else {
                    1
                }
            }
            Op::Sbrs { r, b } => {
                if self.r(r) & (1 << b) != 0 {
                    self.skip_to(&mut next)
                } else {
                    1
                }
            }
            Op::In { d, a } => {
                let v = self.io_read(a as u16 + 0x20);
                self.set_r(d, v);
                1
            }
            Op::Out { a, r } => {
                let v = self.r(r);
                self.io_write(a as u16 + 0x20, v);
                1
            }
            Op::Brbs { s, k } => {
                if self.sreg & (1 << s) != 0 {
                    next = (self.pc as i32 + 1 + k as i32) as u32;
                    2
                } else {
                    1
                }
            }
            Op::Brbc { s, k } => {
                if self.sreg & (1 << s) == 0 {
                    next = (self.pc as i32 + 1 + k as i32) as u32;
                    2
                } else {
                    1
                }
            }
            Op::Bld { d, b } => {
                let v = self.r(d);
                let v = if self.sreg & T != 0 {
                    v | (1 << b)
                } else {
                    v & !(1 << b)
                };
                self.set_r(d, v);
                1
            }
            Op::Bst { d, b } => {
                if self.r(d) & (1 << b) != 0 {
                    self.sreg |= T;
                } else {
                    self.sreg &= !T;
                }
                1
            }
            Op::Invalid { opcode } => {
                self.halt(
                    ErrorCode::InvalidOpcode,
                    format!(
                        "invalid or unsupported opcode {opcode:#06x} at {:#06x}",
                        self.pc * 2
                    ),
                );
                return 0;
            }
        };
        self.pc = next & (FLASH_WORDS as u32 - 1);
        cycles
    }

    /// Пропуск для SBRC/SBRS/SBIC/SBIS/CPSE: вычисляет новый PC и такты.
    #[inline]
    fn skip_to(&mut self, next: &mut u32) -> u64 {
        let words = if self.next_is_two_word() { 2 } else { 1 };
        *next = self.pc + 1 + words;
        1 + words as u64
    }

    #[inline]
    fn sbc(&mut self, d: u8, b: u8, store: bool) {
        let a = self.r(d);
        let res = a.wrapping_sub(b).wrapping_sub(self.sreg & C);
        let mut f = sub_flags(a, b, res);
        // Z сохраняется, если результат 0, и сбрасывается иначе (SBC/SBCI/CPC).
        if self.sreg & Z == 0 {
            f &= !Z;
        }
        self.flags(C | Z | N | V | S | H, f);
        if store {
            self.set_r(d, res);
        }
    }

    #[inline]
    fn logic(&mut self, d: u8, res: u8) {
        self.set_r(d, res);
        self.flags(Z | N | V | S, nzvs(res, false));
    }

    #[inline]
    fn shift_right(&mut self, d: u8, res: u8, carry: bool) {
        self.set_r(d, res);
        let n = res & 0x80 != 0;
        let v = n ^ carry;
        let mut f = nzvs(res, v);
        if carry {
            f |= C;
        }
        self.flags(C | Z | N | V | S, f);
    }

    #[inline]
    fn word_flags(&mut self, res: u16, v: bool, c: bool) {
        let n = res & 0x8000 != 0;
        let mut f = 0;
        if n {
            f |= N;
        }
        if v {
            f |= V;
        }
        if n ^ v {
            f |= S;
        }
        if res == 0 {
            f |= Z;
        }
        if c {
            f |= C;
        }
        self.flags(C | Z | N | V | S, f);
    }

    /// SBI/CBI. На ATmega328P они затрагивают только указанный бит (datasheet стр. 275, прим. 3):
    /// для регистров «запись 1 — действие» (PINx, флаги прерываний) пишется только маска бита.
    fn bit_io(&mut self, a: u8, b: u8, set: bool) {
        let addr = a as u16 + 0x20;
        let mask = 1u8 << b;
        let write_one_to_act = matches!(
            addr,
            PINB | PINC | PIND | TIFR0 | TIFR1 | TIFR2 | PCIFR | EIFR
        );
        if write_one_to_act {
            if set {
                self.io_write(addr, mask);
            }
        } else {
            let v = self.io_read(addr);
            self.io_write(addr, if set { v | mask } else { v & !mask });
        }
    }
}

#[inline]
fn flag_for(i: u32) -> u8 {
    [OCFA, OCFB, TOV][i as usize]
}

fn timer_of(addr: u16) -> usize {
    match addr {
        TCCR0A | TCCR0B => 0,
        TCCR1A | TCCR1B => 1,
        _ => 2,
    }
}

fn pcint_group(port: usize) -> u8 {
    // PCMSK0 — порт B, PCMSK1 — порт C, PCMSK2 — порт D (datasheet стр. 57).
    port as u8
}
