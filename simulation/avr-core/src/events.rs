//! События симуляции. Время события — номер такта MCU (детерминированные часы симуляции).

/// Состояние вывода с точки зрения MCU.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PinMode {
    /// Выход, логическая 1 (DDxn = 1, PORTxn = 1).
    OutputHigh,
    /// Выход, логический 0.
    OutputLow,
    /// Вход без подтяжки (Hi-Z).
    Input,
    /// Вход с внутренним pull-up.
    InputPullup,
    /// Вывод управляется блоком сравнения таймера в PWM-режиме.
    Pwm,
}

impl PinMode {
    pub fn as_str(self) -> &'static str {
        match self {
            PinMode::OutputHigh => "output-high",
            PinMode::OutputLow => "output-low",
            PinMode::Input => "input",
            PinMode::InputPullup => "input-pullup",
            PinMode::Pwm => "pwm",
        }
    }
}

/// Уровень значимости диагностического события.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Severity {
    /// Симуляция остановлена (CPU halted).
    Error,
    /// Симуляция продолжается, но поведение может отличаться от реального MCU.
    Warning,
}

impl Severity {
    pub fn as_str(self) -> &'static str {
        match self {
            Severity::Error => "error",
            Severity::Warning => "warning",
        }
    }
}

/// Стабильные коды диагностик.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ErrorCode {
    InvalidOpcode,
    UnsupportedInstruction,
    UnsupportedPeripheral,
    DataAddressOutOfRange,
    EventBufferOverflow,
}

impl ErrorCode {
    pub fn as_str(self) -> &'static str {
        match self {
            ErrorCode::InvalidOpcode => "INVALID_OPCODE",
            ErrorCode::UnsupportedInstruction => "UNSUPPORTED_INSTRUCTION",
            ErrorCode::UnsupportedPeripheral => "UNSUPPORTED_PERIPHERAL",
            ErrorCode::DataAddressOutOfRange => "DATA_ADDRESS_OUT_OF_RANGE",
            ErrorCode::EventBufferOverflow => "EVENT_BUFFER_OVERFLOW",
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum EventKind {
    /// Изменилось состояние вывода (режим или логический уровень, читаемый MCU).
    DigitalPinChanged {
        pin: &'static str,
        mode: PinMode,
        value: bool,
    },
    /// Измеренные параметры PWM на выводе за последний период таймера.
    PwmChanged {
        pin: &'static str,
        high_ticks: u32,
        period_ticks: u32,
        frequency_hz: f64,
    },
    /// USART0 завершил передачу кадра (время — конец стоп-бита).
    SerialOutput { byte: u8 },
    SimulationError {
        code: ErrorCode,
        severity: Severity,
        message: String,
        /// Адрес инструкции (в байтах flash), на которой возникла проблема.
        pc_byte: u32,
    },
}

#[derive(Debug, Clone, PartialEq)]
pub struct Event {
    pub cycle: u64,
    pub kind: EventKind,
}
