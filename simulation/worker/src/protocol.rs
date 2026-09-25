//! Протокол worker, версия 1.
//!
//! Команда: `{"id": <любое JSON-значение, необязательно>, "cmd": "<имя>", ...}`.
//! Ответ: `{"version":1,"type":"response","id":…,"ok":true,"result":{…}}`
//! или `{"version":1,"type":"response","id":…,"ok":false,"error":{"code":"…","message":"…"}}`.
//! Событие: `{"version":1,"type":"<тип>","timestamp":<такт MCU>,"payload":{…}}`.
//! `timestamp` — номер такта MCU (16 MHz) с момента запуска worker; время в мс = timestamp / 16000.

use avr_core::{parse_hex, Event, EventKind, Mcu, BOARD_PINS, CLOCK_HZ, CYCLES_PER_MS};
use serde_json::{json, Value};
use std::io::Write;

pub const PROTOCOL_VERSION: u32 = 1;
/// Предел одного `run_for`: 60 с симулированного времени.
const MAX_RUN_CYCLES: u64 = 60 * CLOCK_HZ;
/// Размер среза выполнения, после которого события выгружаются в stdout (1 мс).
const CHUNK_CYCLES: u64 = CYCLES_PER_MS;
/// Предел байтов в одной команде serial_input.
const MAX_SERIAL_INPUT: usize = 4096;

pub struct Session {
    mcu: Mcu,
    loaded: bool,
}

pub fn write_line(out: &mut impl Write, v: &Value) {
    // Ошибка записи в stdout означает, что оркестратор ушёл; её обработает цикл main.
    let _ = serde_json::to_writer(&mut *out, v);
    let _ = out.write_all(b"\n");
}

pub fn error_response(id: Option<&Value>, code: &str, message: &str) -> Value {
    json!({
        "version": PROTOCOL_VERSION,
        "type": "response",
        "id": id.cloned().unwrap_or(Value::Null),
        "ok": false,
        "error": {"code": code, "message": message},
    })
}

fn ok_response(id: Option<&Value>, result: Value) -> Value {
    json!({
        "version": PROTOCOL_VERSION,
        "type": "response",
        "id": id.cloned().unwrap_or(Value::Null),
        "ok": true,
        "result": result,
    })
}

pub fn event_json(e: &Event) -> Value {
    let (kind, payload) = match &e.kind {
        EventKind::DigitalPinChanged { pin, mode, value } => (
            "digital_pin_changed",
            json!({"pin": pin, "value": *value as u8, "mode": mode.as_str()}),
        ),
        EventKind::PwmChanged {
            pin,
            high_ticks,
            period_ticks,
            frequency_hz,
        } => (
            "pwm_changed",
            json!({
                "pin": pin,
                "dutyCycle": *high_ticks as f64 / *period_ticks as f64,
                "highTicks": high_ticks,
                "periodTicks": period_ticks,
                "frequencyHz": frequency_hz,
            }),
        ),
        EventKind::SerialOutput { byte } => {
            ("serial_output", json!({"port": "Serial", "byte": byte}))
        }
        EventKind::SimulationError {
            code,
            severity,
            message,
            pc_byte,
        } => (
            "simulation_error",
            json!({"code": code.as_str(), "severity": severity.as_str(), "message": message, "pc": pc_byte}),
        ),
    };
    json!({"version": PROTOCOL_VERSION, "type": kind, "timestamp": e.cycle, "payload": payload})
}

impl Session {
    pub fn new() -> Self {
        Session {
            mcu: Mcu::new(),
            loaded: false,
        }
    }

    fn flush_events(&mut self, out: &mut impl Write) {
        for e in self.mcu.drain_events() {
            write_line(out, &event_json(&e));
        }
    }

    /// Обрабатывает одну строку. Возвращает false, если worker должен завершиться.
    pub fn handle_line(&mut self, line: &[u8], out: &mut impl Write) -> bool {
        let cmd: Value = match serde_json::from_slice(line) {
            Ok(v) => v,
            Err(_) => {
                write_line(
                    out,
                    &error_response(None, "INVALID_JSON", "command is not valid JSON"),
                );
                return true;
            }
        };
        let id = cmd.get("id");
        let name = cmd.get("cmd").and_then(Value::as_str).unwrap_or("");
        let result = match name {
            "load_firmware" => self.load_firmware(&cmd),
            "reset" => self.reset(out),
            "run_for" => self.run_for(&cmd, out),
            "set_input" => self.set_input(&cmd),
            "serial_input" => self.serial_input(&cmd),
            "get_state" => Ok(self.state()),
            "stop" => {
                self.flush_events(out);
                write_line(out, &ok_response(id, json!({"cycle": self.mcu.cycles()})));
                return false;
            }
            _ => Err(("UNKNOWN_COMMAND", format!("unknown command {name:?}"))),
        };
        self.flush_events(out);
        match result {
            Ok(v) => write_line(out, &ok_response(id, v)),
            Err((code, msg)) => write_line(out, &error_response(id, code, &msg)),
        }
        true
    }

    fn load_firmware(&mut self, cmd: &Value) -> Result<Value, (&'static str, String)> {
        let hex = cmd
            .get("hex")
            .and_then(Value::as_str)
            .ok_or(("INVALID_ARGUMENT", "hex is required".to_string()))?;
        let image = parse_hex(hex).map_err(|e| ("INVALID_FIRMWARE", e.to_string()))?;
        self.mcu.load_firmware(&image);
        self.loaded = true;
        Ok(json!({"flashBytes": image.used, "cycle": self.mcu.cycles()}))
    }

    fn reset(&mut self, out: &mut impl Write) -> Result<Value, (&'static str, String)> {
        self.mcu.reset();
        write_line(
            out,
            &json!({"version": PROTOCOL_VERSION, "type": "simulation_reset", "timestamp": self.mcu.cycles(), "payload": {}}),
        );
        Ok(json!({"cycle": self.mcu.cycles()}))
    }

    fn run_for(
        &mut self,
        cmd: &Value,
        out: &mut impl Write,
    ) -> Result<Value, (&'static str, String)> {
        if !self.loaded {
            return Err(("NO_FIRMWARE", "load_firmware must be called first".into()));
        }
        let cycles = match (
            cmd.get("cycles").and_then(Value::as_u64),
            cmd.get("ms").and_then(Value::as_f64),
        ) {
            (Some(c), _) => c,
            (None, Some(ms)) if ms.is_finite() && ms >= 0.0 => {
                (ms * CYCLES_PER_MS as f64).round() as u64
            }
            _ => {
                return Err((
                    "INVALID_ARGUMENT",
                    "cycles (integer) or ms (number >= 0) is required".into(),
                ))
            }
        };
        if cycles > MAX_RUN_CYCLES {
            return Err((
                "INVALID_ARGUMENT",
                format!("run_for is limited to {MAX_RUN_CYCLES} cycles"),
            ));
        }
        let target = self.mcu.cycles() + cycles;
        while self.mcu.cycles() < target && !self.mcu.halted() {
            let chunk_end = (self.mcu.cycles() + CHUNK_CYCLES).min(target);
            self.mcu.run_until(chunk_end);
            if self.mcu.pending_events() > 0 {
                self.flush_events(out);
            }
        }
        Ok(json!({"cycle": self.mcu.cycles(), "halted": self.mcu.halted()}))
    }

    fn set_input(&mut self, cmd: &Value) -> Result<Value, (&'static str, String)> {
        let pin = cmd
            .get("pin")
            .and_then(Value::as_str)
            .ok_or(("INVALID_ARGUMENT", "pin is required".to_string()))?;
        let level = match cmd.get("level") {
            None | Some(Value::Null) => None,
            Some(v) => match v.as_u64() {
                Some(0) => Some(false),
                Some(1) => Some(true),
                _ => return Err(("INVALID_ARGUMENT", "level must be 0, 1 or null".into())),
            },
        };
        self.mcu
            .set_input(pin, level)
            .map_err(|e| ("UNKNOWN_PIN", e))?;
        Ok(json!({"cycle": self.mcu.cycles()}))
    }

    fn serial_input(&mut self, cmd: &Value) -> Result<Value, (&'static str, String)> {
        let bytes: Vec<u8> = if let Some(s) = cmd.get("data").and_then(Value::as_str) {
            s.as_bytes().to_vec()
        } else if let Some(arr) = cmd.get("bytes").and_then(Value::as_array) {
            arr.iter()
                .map(|b| b.as_u64().filter(|v| *v <= 255).map(|v| v as u8))
                .collect::<Option<Vec<u8>>>()
                .ok_or((
                    "INVALID_ARGUMENT",
                    "bytes must be integers 0..255".to_string(),
                ))?
        } else {
            return Err((
                "INVALID_ARGUMENT",
                "data (string) or bytes (array) is required".into(),
            ));
        };
        if bytes.len() > MAX_SERIAL_INPUT {
            return Err((
                "INVALID_ARGUMENT",
                format!("at most {MAX_SERIAL_INPUT} bytes per command"),
            ));
        }
        let accepted = self.mcu.serial_input(&bytes);
        Ok(json!({"accepted": accepted, "cycle": self.mcu.cycles()}))
    }

    fn state(&self) -> Value {
        let mut pins = serde_json::Map::new();
        for p in BOARD_PINS {
            if let Some(s) = self.mcu.pin_state(p.name) {
                pins.insert(
                    p.name.to_string(),
                    json!({"mode": s.mode.as_str(), "value": s.value as u8, "floating": s.floating}),
                );
            }
        }
        json!({
            "cycle": self.mcu.cycles(),
            "clockHz": CLOCK_HZ,
            "loaded": self.loaded,
            "halted": self.mcu.halted(),
            "pc": self.mcu.pc_bytes(),
            "sp": self.mcu.sp(),
            "sreg": self.mcu.sreg(),
            "pins": pins,
        })
    }
}

impl Default for Session {
    fn default() -> Self {
        Self::new()
    }
}
