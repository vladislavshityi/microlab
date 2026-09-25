//! Выводы Arduino UNO R3, подключённые к GPIO ATmega328P.
//! Таблица генерируется из общего определения платы (см. build.rs).

/// Порт ввода-вывода ATmega328P.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Port {
    B = 0,
    C = 1,
    D = 2,
}

/// Вывод платы: имя (D0…D13, A0…A5), Arduino-номер и бит порта MCU.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BoardPin {
    pub name: &'static str,
    pub arduino: u8,
    pub port: Port,
    pub bit: u8,
}

include!(concat!(env!("OUT_DIR"), "/board_pins.rs"));

/// Ищет вывод по имени платы (`D13`, `A0`).
pub fn pin_by_name(name: &str) -> Option<&'static BoardPin> {
    BOARD_PINS.iter().find(|p| p.name == name)
}

/// Ищет вывод по порту и биту MCU.
pub fn pin_by_port_bit(port: Port, bit: u8) -> Option<&'static BoardPin> {
    BOARD_PINS.iter().find(|p| p.port == port && p.bit == bit)
}

/// Число тактов MCU в одной миллисекунде.
pub const CYCLES_PER_MS: u64 = CLOCK_HZ / 1000;
