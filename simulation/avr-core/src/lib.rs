//! Эмулятор микроконтроллера ATmega328P платы Arduino UNO R3.
//!
//! Время симуляции — счётчик тактов MCU; выполнение полностью детерминировано:
//! одинаковые прошивка, входные воздействия и их моменты дают одинаковую последовательность событий.

pub mod adc;
pub mod board;
pub mod decode;
pub mod events;
pub mod hex;
pub mod mcu;
pub mod regs;
pub mod timer;
pub mod usart;

pub use board::{pin_by_name, BoardPin, Port, BOARD_PINS, CLOCK_HZ, CYCLES_PER_MS};
pub use events::{ErrorCode, Event, EventKind, PinMode, Severity};
pub use hex::{parse as parse_hex, FlashImage, HexError};
pub use mcu::{Mcu, PinState};
