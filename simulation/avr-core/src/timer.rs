//! Таймеры/счётчики Timer0, Timer1 (16 бит), Timer2.
//!
//! Модель — по ATmega328P datasheet 7810D: режимы WGM (Table 14-8 стр. 86, Table 15-5 стр. 109,
//! Table 17-8 стр. 130), делители (Table 14-9 стр. 87, Table 15-6 стр. 110, Table 17-9 стр. 131),
//! предделитель общий и свободно бегущий (раздел 16.2, стр. 114), доступ к 16-битным регистрам через
//! TEMP (стр. 91, 95).
//!
//! Приближения (явно):
//! * счёт моделируется на уровне тактов таймера; предделитель — счётчик тактов с момента reset,
//!   поэтому первый отсчёт после включения наступает через 1…N тактов (в пределах 1…N+1 по разделу 16.2);
//! * совпадение сравнения обрабатывается на такте таймера, когда счётчик покидает значение OCR;
//! * блокировка совпадения после записи TCNT, FOC, внешний тактовый вход T0/T1, асинхронный режим
//!   Timer2 и input capture не моделируются;
//! * COM = 01 в PWM-режимах (toggle) не моделируется — вывод считается отключённым от таймера.

use crate::board::CLOCK_HZ;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TimerId {
    T0,
    T1,
    T2,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    Normal,
    Ctc,
    Fast,
    PhaseCorrect,
    PhaseFreq,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Update {
    Immediate,
    Top,
    Bottom,
}

pub const TOV: u8 = 1 << 0;
pub const OCFA: u8 = 1 << 1;
pub const OCFB: u8 = 1 << 2;

#[derive(Debug, Clone, Copy, Default)]
struct Meas {
    high: u32,
    total: u32,
    valid: bool,
}

/// Результат измерения PWM за период: (такты таймера в «1», такты периода).
pub type PwmSample = (u32, u32);

#[derive(Debug, Clone)]
pub struct Timer {
    pub id: TimerId,
    pub tccra: u8,
    pub tccrb: u8,
    pub tccrc: u8,
    pub tcnt: u16,
    ocr: [u16; 2],
    ocr_buf: [u16; 2],
    pub icr: u16,
    pub tifr: u8,
    pub timsk: u8,
    /// Регистр TEMP для 16-битного доступа (только Timer1).
    pub temp: u8,
    /// Номер такта MCU следующего отсчёта; `u64::MAX` — таймер остановлен.
    pub next_tick: u64,
    prescaler: u64,
    down: bool,
    /// Текущий уровень выходов OCxA/OCxB.
    pub oc: [bool; 2],
    meas: [Meas; 2],
    last_report: [Option<PwmSample>; 2],
    /// Новые измерения PWM, ещё не забранные MCU.
    pub pwm_report: [Option<PwmSample>; 2],
    /// Уровень OC изменился на последнем отсчёте.
    pub oc_changed: bool,
    /// Запрошена неподдерживаемая конфигурация (внешний такт, COM=01 в PWM, reserved WGM).
    pub unsupported: Option<&'static str>,
}

impl Timer {
    pub fn new(id: TimerId) -> Self {
        Timer {
            id,
            tccra: 0,
            tccrb: 0,
            tccrc: 0,
            tcnt: 0,
            ocr: [0; 2],
            ocr_buf: [0; 2],
            icr: 0,
            tifr: 0,
            timsk: 0,
            temp: 0,
            next_tick: u64::MAX,
            prescaler: 0,
            down: false,
            oc: [false; 2],
            meas: [Meas::default(); 2],
            last_report: [None; 2],
            pwm_report: [None; 2],
            oc_changed: false,
            unsupported: None,
        }
    }

    fn max(&self) -> u16 {
        if self.id == TimerId::T1 {
            0xFFFF
        } else {
            0xFF
        }
    }

    fn wgm(&self) -> u8 {
        match self.id {
            TimerId::T1 => (self.tccra & 0x03) | ((self.tccrb >> 1) & 0x0C),
            _ => (self.tccra & 0x03) | ((self.tccrb >> 1) & 0x04),
        }
    }

    /// Режим, TOP и момент обновления OCR.
    fn mode(&self) -> (Kind, u16, Update) {
        use Kind::*;
        use Update::*;
        let wgm = self.wgm();
        if self.id == TimerId::T1 {
            match wgm {
                0 => (Normal, 0xFFFF, Immediate),
                1 => (PhaseCorrect, 0x00FF, Top),
                2 => (PhaseCorrect, 0x01FF, Top),
                3 => (PhaseCorrect, 0x03FF, Top),
                4 => (Ctc, self.ocr[0], Immediate),
                5 => (Fast, 0x00FF, Bottom),
                6 => (Fast, 0x01FF, Bottom),
                7 => (Fast, 0x03FF, Bottom),
                8 => (PhaseFreq, self.icr, Bottom),
                9 => (PhaseFreq, self.ocr[0], Bottom),
                10 => (PhaseCorrect, self.icr, Top),
                11 => (PhaseCorrect, self.ocr[0], Top),
                12 => (Ctc, self.icr, Immediate),
                14 => (Fast, self.icr, Bottom),
                15 => (Fast, self.ocr[0], Bottom),
                _ => (Normal, 0xFFFF, Immediate), // 13 — reserved
            }
        } else {
            match wgm {
                1 => (PhaseCorrect, 0xFF, Top),
                2 => (Ctc, self.ocr[0], Immediate),
                3 => (Fast, 0xFF, Bottom),
                5 => (PhaseCorrect, self.ocr[0], Top),
                7 => (Fast, self.ocr[0], Bottom),
                _ => (Normal, 0xFF, Immediate), // 0; 4 и 6 — reserved
            }
        }
    }

    fn com(&self, ch: usize) -> u8 {
        (self.tccra >> (6 - 2 * ch)) & 0x03
    }

    fn is_pwm_kind(kind: Kind) -> bool {
        matches!(kind, Kind::Fast | Kind::PhaseCorrect | Kind::PhaseFreq)
    }

    /// Управляет ли блок сравнения выводом канала `ch` (без учёта DDR).
    pub fn oc_connected(&self, ch: usize) -> bool {
        let com = self.com(ch);
        if com == 0 {
            return false;
        }
        let (kind, _, _) = self.mode();
        !(com == 1 && Self::is_pwm_kind(kind))
    }

    /// Выход канала в PWM-режиме (для отчёта о состоянии вывода).
    pub fn oc_is_pwm(&self, ch: usize) -> bool {
        let (kind, _, _) = self.mode();
        self.oc_connected(ch) && Self::is_pwm_kind(kind)
    }

    /// Делитель частоты по CSn2:0; 0 — таймер остановлен.
    fn divider(&mut self) -> u64 {
        let cs = self.tccrb & 0x07;
        match self.id {
            TimerId::T2 => [0, 1, 8, 32, 64, 128, 256, 1024][cs as usize],
            _ => match cs {
                6 | 7 => {
                    self.unsupported = Some("external clock source on T0/T1 pin");
                    0
                }
                _ => [0, 1, 8, 64, 256, 1024, 0, 0][cs as usize],
            },
        }
    }

    /// Пересчитывает момент следующего отсчёта после изменения делителя.
    /// `epoch` — такт последнего reset, от которого считает свободно бегущий предделитель.
    pub fn reschedule_from(&mut self, now: u64, epoch: u64) {
        let p = self.divider();
        if p != self.prescaler {
            self.prescaler = p;
            self.meas = [Meas::default(); 2];
            self.next_tick = match (now - epoch).checked_div(p) {
                Some(periods) => epoch + (periods + 1) * p,
                None => u64::MAX, // делитель 0 — таймер остановлен
            };
        }
    }

    /// Проверка конфигурации, которую модель не поддерживает.
    pub fn check_config(&mut self) {
        let (kind, _, _) = self.mode();
        let wgm = self.wgm();
        let reserved = match self.id {
            TimerId::T1 => wgm == 13,
            _ => wgm == 4 || wgm == 6,
        };
        if reserved {
            self.unsupported = Some("reserved waveform generation mode");
        }
        if Self::is_pwm_kind(kind) && (self.com(0) == 1 || self.com(1) == 1) {
            self.unsupported = Some("COM=01 (toggle) in PWM mode");
        }
        self.meas = [Meas::default(); 2];
    }

    pub fn read_ocr(&self, ch: usize) -> u16 {
        let (_, _, upd) = self.mode();
        if upd == Update::Immediate {
            self.ocr[ch]
        } else {
            self.ocr_buf[ch]
        }
    }

    pub fn write_ocr(&mut self, ch: usize, v: u16) {
        let (_, _, upd) = self.mode();
        self.ocr_buf[ch] = v;
        if upd == Update::Immediate {
            self.ocr[ch] = v;
        }
    }

    /// Частота PWM для измеренного периода.
    pub fn frequency_hz(&self, period_ticks: u32) -> f64 {
        if self.prescaler == 0 || period_ticks == 0 {
            return 0.0;
        }
        CLOCK_HZ as f64 / (self.prescaler as f64 * period_ticks as f64)
    }

    fn set_oc(&mut self, ch: usize, v: bool) {
        if self.oc[ch] != v {
            self.oc[ch] = v;
            self.oc_changed = true;
        }
    }

    fn compare_action(&mut self, ch: usize, kind: Kind) {
        let com = self.com(ch);
        match (kind, com) {
            (_, 0) => {}
            (Kind::Normal | Kind::Ctc, 1) => {
                let v = !self.oc[ch];
                self.set_oc(ch, v);
            }
            (Kind::Normal | Kind::Ctc, 2) => self.set_oc(ch, false),
            (Kind::Normal | Kind::Ctc, _) => self.set_oc(ch, true),
            (Kind::Fast, 2) => self.set_oc(ch, false),
            (Kind::Fast, 3) => self.set_oc(ch, true),
            (Kind::PhaseCorrect | Kind::PhaseFreq, 2) => self.set_oc(ch, self.down),
            (Kind::PhaseCorrect | Kind::PhaseFreq, 3) => self.set_oc(ch, !self.down),
            _ => {}
        }
    }

    fn period_end(&mut self) {
        for ch in 0..2 {
            let m = self.meas[ch];
            if m.valid && self.oc_is_pwm(ch) {
                let sample = (m.high, m.total);
                if self.last_report[ch] != Some(sample) {
                    self.last_report[ch] = Some(sample);
                    self.pwm_report[ch] = Some(sample);
                }
            }
            self.meas[ch] = Meas {
                high: 0,
                total: 0,
                valid: true,
            };
        }
    }

    /// Сбрасывает запомненный отчёт PWM канала (вывод вышел из PWM-режима).
    pub fn forget_pwm(&mut self, ch: usize) {
        self.last_report[ch] = None;
    }

    /// Один отсчёт таймера.
    pub fn tick(&mut self) {
        let (kind, top, upd) = self.mode();
        let v = self.tcnt;
        let max = self.max();

        for ch in 0..2 {
            self.meas[ch].high += self.oc[ch] as u32;
            self.meas[ch].total += 1;
        }

        // 1. Совпадение сравнения для значения, которое счётчик покидает.
        for ch in 0..2 {
            if v == self.ocr[ch] {
                self.tifr |= if ch == 0 { OCFA } else { OCFB };
                self.compare_action(ch, kind);
            }
        }

        // 2. Счёт.
        match kind {
            Kind::Normal | Kind::Ctc | Kind::Fast => {
                if v == top {
                    self.tcnt = 0;
                    if kind == Kind::Fast {
                        self.tifr |= TOV;
                        for ch in 0..2 {
                            match self.com(ch) {
                                2 => self.set_oc(ch, true),
                                3 => self.set_oc(ch, false),
                                _ => {}
                            }
                        }
                    } else if top == max {
                        self.tifr |= TOV;
                    }
                    if upd == Update::Bottom {
                        self.ocr = self.ocr_buf;
                    }
                    self.period_end();
                } else if v == max {
                    self.tcnt = 0;
                    self.tifr |= TOV;
                } else {
                    self.tcnt = v.wrapping_add(1);
                }
            }
            Kind::PhaseCorrect | Kind::PhaseFreq => {
                if !self.down {
                    if v >= top {
                        self.down = true;
                        self.tcnt = v.saturating_sub(1);
                        if upd == Update::Top {
                            self.ocr = self.ocr_buf;
                        }
                    } else {
                        self.tcnt = v + 1;
                    }
                } else if v == 0 {
                    self.down = false;
                    self.tcnt = if top == 0 { 0 } else { 1 };
                    self.tifr |= TOV;
                    if upd == Update::Bottom {
                        self.ocr = self.ocr_buf;
                    }
                    self.period_end();
                } else {
                    self.tcnt = v - 1;
                }
                // Граничные случаи: OCR = BOTTOM — постоянный LOW, OCR = TOP — постоянный HIGH
                // (для неинвертирующего режима; datasheet стр. 82, 104).
                let (_, top, _) = self.mode();
                for ch in 0..2 {
                    let com = self.com(ch);
                    if com >= 2 {
                        let inverting = com == 3;
                        if self.ocr[ch] == 0 {
                            self.set_oc(ch, inverting);
                        } else if self.ocr[ch] >= top {
                            self.set_oc(ch, !inverting);
                        }
                    }
                }
            }
        }
    }

    /// Выполняет все отсчёты с моментом не позже `now`.
    #[inline]
    pub fn advance(&mut self, now: u64) {
        while self.next_tick <= now {
            self.tick();
            self.next_tick += self.prescaler;
        }
    }
}
