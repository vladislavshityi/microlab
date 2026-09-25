//! USART0 в асинхронном режиме (ATmega328P datasheet 7810D, раздел 19).
//!
//! Моделируется на уровне кадров, без отдельных битов на выводе TXD:
//! * скорость — по Table 19-1 (стр. 146): такт бита = 16·(UBRR+1), при U2X0 = 1 — 8·(UBRR+1);
//! * кадр = старт-бит + 5…9 бит данных + бит чётности (если UPM0 ≠ 0) + 1/2 стоп-бита;
//! * UDRE0/TXC0 — по разделу 19.6.3 (стр. 151), UDRE0 = 1 после reset (стр. 159);
//! * запись в UDR0 при UDRE0 = 0 игнорируется (стр. 159);
//! * буфер приёма — двухуровневый FIFO (стр. 159), переполнение выставляет DOR0.
//!
//! Приближения: загрузка сдвигового регистра не выравнивается по такту генератора скорости;
//! ошибки кадра и чётности на приёме не моделируются (входные байты считаются корректными
//! и переданными с той же скоростью, что настроена в UBRR0); синхронный режим и MSPIM не поддерживаются.

use std::collections::VecDeque;

pub const RXC: u8 = 1 << 7;
pub const TXC: u8 = 1 << 6;
pub const UDRE: u8 = 1 << 5;
pub const DOR: u8 = 1 << 3;
pub const U2X: u8 = 1 << 1;
pub const MPCM: u8 = 1 << 0;

pub const RXCIE: u8 = 1 << 7;
pub const TXCIE: u8 = 1 << 6;
pub const UDRIE: u8 = 1 << 5;
pub const RXEN: u8 = 1 << 4;
pub const TXEN: u8 = 1 << 3;
pub const UCSZ2: u8 = 1 << 2;

/// Предел очереди внешних входных байтов (ограничение памяти worker).
pub const MAX_RX_QUEUE: usize = 4096;

#[derive(Debug, Clone)]
pub struct Usart {
    pub ucsra: u8,
    pub ucsrb: u8,
    pub ucsrc: u8,
    pub ubrr: u16,
    tx_buffer: Option<u8>,
    /// Байт в сдвиговом регистре и такт окончания его кадра.
    tx_shift: Option<(u8, u64)>,
    rx_fifo: VecDeque<u8>,
    rx_queue: VecDeque<u8>,
    /// Такт, когда очередной входной байт будет принят полностью.
    rx_next: u64,
    /// Переданные байты (такт окончания кадра, байт), ещё не забранные MCU.
    pub sent: Vec<(u64, u8)>,
}

impl Usart {
    pub fn new() -> Self {
        Usart {
            ucsra: UDRE,
            ucsrb: 0,
            ucsrc: 0x06,
            ubrr: 0,
            tx_buffer: None,
            tx_shift: None,
            rx_fifo: VecDeque::with_capacity(2),
            rx_queue: VecDeque::new(),
            rx_next: u64::MAX,
            sent: Vec::new(),
        }
    }

    /// Синхронный режим/MSPIM (UMSEL0 ≠ 0) не поддерживается.
    pub fn is_async(&self) -> bool {
        self.ucsrc & 0xC0 == 0
    }

    pub fn frame_cycles(&self) -> u64 {
        let per_bit = (self.ubrr as u64 + 1) * if self.ucsra & U2X != 0 { 8 } else { 16 };
        let ucsz = ((self.ucsrc >> 1) & 0x03) | (self.ucsrb & UCSZ2);
        let data_bits = match ucsz {
            0 => 5,
            1 => 6,
            2 => 7,
            7 => 9,
            _ => 8, // 3 — 8 бит; 4–6 reserved
        };
        let parity = if self.ucsrc & 0x30 != 0 { 1 } else { 0 };
        let stop = if self.ucsrc & 0x08 != 0 { 2 } else { 1 };
        per_bit * (1 + data_bits + parity + stop)
    }

    /// Ближайший такт, на котором USART должен что-то сделать.
    pub fn next_event(&self) -> u64 {
        let tx = self.tx_shift.map_or(u64::MAX, |(_, t)| t);
        tx.min(self.rx_next)
    }

    pub fn write_ucsra(&mut self, v: u8) {
        // TXC0 сбрасывается записью 1; U2X0 и MPCM0 — обычные биты; остальные только для чтения.
        if v & TXC != 0 {
            self.ucsra &= !TXC;
        }
        self.ucsra = (self.ucsra & !(U2X | MPCM)) | (v & (U2X | MPCM));
    }

    pub fn write_ucsrb(&mut self, v: u8, now: u64) {
        let was_rx = self.ucsrb & RXEN != 0;
        // RXB80 (бит 1) только для чтения.
        self.ucsrb = (self.ucsrb & 0x02) | (v & !0x02);
        if was_rx && v & RXEN == 0 {
            // Выключение приёмника очищает буфер (стр. 159, описание RXC0).
            self.rx_fifo.clear();
            self.ucsra &= !RXC;
        }
        if !was_rx && v & RXEN != 0 {
            self.schedule_rx(now);
        }
    }

    pub fn write_udr(&mut self, v: u8, now: u64) {
        if self.ucsra & UDRE == 0 || self.ucsrb & TXEN == 0 {
            return;
        }
        self.tx_buffer = Some(v);
        self.ucsra &= !UDRE;
        self.load_shift(now);
    }

    fn load_shift(&mut self, now: u64) {
        if self.tx_shift.is_none() {
            if let Some(b) = self.tx_buffer.take() {
                self.tx_shift = Some((b, now + self.frame_cycles()));
                self.ucsra |= UDRE;
            }
        }
    }

    pub fn read_udr(&mut self) -> u8 {
        let v = self.rx_fifo.pop_front().unwrap_or(0);
        if self.rx_fifo.is_empty() {
            self.ucsra &= !RXC;
        }
        self.ucsra &= !DOR;
        v
    }

    /// Добавляет входные байты (линия RX). Возвращает число принятых в очередь байтов.
    pub fn inject(&mut self, data: &[u8], now: u64) -> usize {
        let room = MAX_RX_QUEUE.saturating_sub(self.rx_queue.len());
        let n = data.len().min(room);
        self.rx_queue.extend(&data[..n]);
        if self.rx_next == u64::MAX {
            self.schedule_rx(now);
        }
        n
    }

    fn schedule_rx(&mut self, now: u64) {
        self.rx_next = if self.rx_queue.is_empty() {
            u64::MAX
        } else {
            now + self.frame_cycles()
        };
    }

    /// Обрабатывает события с моментом не позже `now`. Возвращает true, если изменились флаги.
    pub fn advance(&mut self, now: u64) -> bool {
        let mut changed = false;
        while let Some((b, t)) = self.tx_shift {
            if t > now {
                break;
            }
            self.sent.push((t, b));
            self.tx_shift = None;
            if let Some(nb) = self.tx_buffer.take() {
                self.tx_shift = Some((nb, t + self.frame_cycles()));
                self.ucsra |= UDRE;
            } else {
                self.ucsra |= TXC;
            }
            changed = true;
        }
        while self.rx_next <= now {
            let t = self.rx_next;
            if let Some(b) = self.rx_queue.pop_front() {
                if self.ucsrb & RXEN != 0 {
                    if self.rx_fifo.len() < 2 {
                        self.rx_fifo.push_back(b);
                        self.ucsra |= RXC;
                    } else {
                        self.ucsra |= DOR;
                    }
                }
                changed = true;
            }
            self.schedule_rx(t);
        }
        changed
    }

    pub fn tx_enabled(&self) -> bool {
        self.ucsrb & TXEN != 0
    }

    pub fn rx_enabled(&self) -> bool {
        self.ucsrb & RXEN != 0
    }
}

impl Default for Usart {
    fn default() -> Self {
        Self::new()
    }
}
