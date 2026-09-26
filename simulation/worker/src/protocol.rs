//! Протокол worker, версия 1.
//!
//! Команда: `{"id": <любое JSON-значение, необязательно>, "cmd": "<имя>", ...}`.
//! Ответ: `{"version":1,"type":"response","id":…,"ok":true,"result":{…}}`
//! или `{"version":1,"type":"response","id":…,"ok":false,"error":{"code":"…","message":"…"}}`.
//! Событие: `{"version":1,"type":"<тип>","timestamp":<такт MCU>,"payload":{…}}`.
//! `timestamp` — номер такта MCU (16 MHz) с момента запуска worker; время в мс = timestamp / 16000.
//!
//! Входы компонентов `set_component_input`: `pressed` (кнопка), `position` 0…1 (потенциометр),
//! `illuminanceLux` (фоторезистор).
//!
//! Команды схемы (`attach_circuit`, `detach_circuit`, `set_component_input`) и события
//! `component_state_changed`, `analog_value_changed` — обратно совместимые дополнения версии 1.

use crate::bridge::Bridge;
use avr_core::{parse_hex, Event, EventKind, Mcu, BOARD_PINS, CLOCK_HZ, CYCLES_PER_MS};
use circuit::{Circuit, CircuitSpec, ComponentSpec, Library, NetSpec};
use serde_json::{json, Value};
use std::io::Write;

pub const PROTOCOL_VERSION: u32 = 1;
/// Предел одного `run_for`: 60 с симулированного времени.
const MAX_RUN_CYCLES: u64 = 60 * CLOCK_HZ;
/// Размер среза выполнения, после которого события выгружаются в stdout (1 мс).
const CHUNK_CYCLES: u64 = CYCLES_PER_MS;
/// Предел байтов в одной команде serial_input.
const MAX_SERIAL_INPUT: usize = 4096;
/// Верхний предел освещённости входа фоторезистора, лк (совпадает с maximum свойства).
const MAX_ILLUMINANCE_LUX: f64 = 100_000.0;

fn unsupported_input(bridge: &Bridge, id: &str, input: &str) -> (&'static str, String) {
    let msg = if bridge.circuit().is_simulated(id) {
        format!("{id:?} has no {input} input")
    } else {
        format!("{id:?} is not a simulated component with a {input} input")
    };
    ("UNSUPPORTED_INPUT", msg)
}

pub struct Session {
    mcu: Mcu,
    loaded: bool,
    library: Library,
    circuit: Option<Bridge>,
}

type CmdResult = Result<Value, (&'static str, String)>;

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
            library: Library::builtin(),
            circuit: None,
        }
    }

    fn flush_events(&mut self, out: &mut impl Write) {
        for e in self.mcu.drain_events() {
            write_line(out, &event_json(&e));
        }
    }

    /// Пересчитывает схему (если подключена) и выводит события: сначала накопленные события MCU,
    /// затем события схемы с текущим тактом — порядок timestamp не нарушается.
    fn resolve_circuit(&mut self, out: &mut impl Write) {
        self.mcu.take_drive_changed();
        if self.circuit.is_none() {
            return;
        }
        self.flush_events(out);
        if let Some(bridge) = self.circuit.as_mut() {
            for e in bridge.resolve(&mut self.mcu) {
                write_line(out, &e);
            }
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
            "attach_circuit" => self.attach_circuit(&cmd, out),
            "detach_circuit" => self.detach_circuit(),
            "set_component_input" => self.set_component_input(&cmd, out),
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
        if let Some(b) = self.circuit.as_mut() {
            b.clear_warnings();
        }
        let result = json!({"flashBytes": image.used, "cycle": self.mcu.cycles()});
        Ok(result)
    }

    fn reset(&mut self, out: &mut impl Write) -> CmdResult {
        self.mcu.reset();
        self.flush_events(out);
        write_line(
            out,
            &json!({"version": PROTOCOL_VERSION, "type": "simulation_reset", "timestamp": self.mcu.cycles(), "payload": {}}),
        );
        self.resolve_circuit(out);
        Ok(json!({"cycle": self.mcu.cycles()}))
    }

    fn attach_circuit(&mut self, cmd: &Value, out: &mut impl Write) -> CmdResult {
        let bad = |m: &str| ("INVALID_ARGUMENT", m.to_string());
        let comps = cmd
            .get("components")
            .and_then(Value::as_array)
            .ok_or_else(|| bad("components (array) is required"))?;
        let nets = cmd
            .get("netlist")
            .and_then(Value::as_array)
            .ok_or_else(|| bad("netlist (array) is required"))?;
        let mut components = Vec::with_capacity(comps.len());
        for c in comps {
            let id = c.get("id").and_then(Value::as_str);
            let ty = c.get("type").and_then(Value::as_str);
            let (Some(id), Some(ty)) = (id, ty) else {
                return Err(bad("each component needs id and type"));
            };
            let properties = match c.get("properties") {
                None | Some(Value::Null) => serde_json::Map::new(),
                Some(Value::Object(m)) => m.clone(),
                Some(_) => return Err(bad("component properties must be an object")),
            };
            components.push(ComponentSpec {
                id: id.to_string(),
                type_name: ty.to_string(),
                properties,
            });
        }
        let mut netlist = Vec::with_capacity(nets.len());
        for n in nets {
            let id = n.get("id").and_then(Value::as_str);
            let members = n.get("members").and_then(Value::as_array);
            let (Some(id), Some(members)) = (id, members) else {
                return Err(bad("each net needs id and members"));
            };
            let members = members
                .iter()
                .map(|m| m.as_str().map(str::to_string))
                .collect::<Option<Vec<_>>>()
                .ok_or_else(|| bad("net members must be strings \"componentId.pinId\""))?;
            netlist.push(NetSpec {
                id: id.to_string(),
                members,
            });
        }
        let board_type = self.library.board_type.clone();
        let board_id = cmd
            .pointer("/board/id")
            .and_then(Value::as_str)
            .map(str::to_string)
            .or_else(|| {
                components
                    .iter()
                    .find(|c| c.type_name == board_type)
                    .map(|c| c.id.clone())
            })
            .ok_or_else(|| bad("board.id is required (or a component of the board type)"))?;
        if let Some(t) = cmd.pointer("/board/type").and_then(Value::as_str) {
            if t != board_type {
                return Err((
                    "UNSUPPORTED_BOARD",
                    format!("board type {t:?} is not simulated"),
                ));
            }
        }
        let spec = CircuitSpec {
            board_id: board_id.clone(),
            nets: netlist,
            components,
        };
        let circuit = Circuit::build(&self.library, &spec).map_err(|e| ("INVALID_ARGUMENT", e))?;
        let unsupported: Vec<String> = circuit.unsupported().to_vec();
        let n_nets = spec.nets.len();
        if let Some(old) = self.circuit.take() {
            old.detach(&mut self.mcu);
        }
        let io_voltage = self.library.limits.io_voltage;
        self.circuit = Some(Bridge::new(circuit, board_id, io_voltage));
        let cycle = self.mcu.cycles();
        self.flush_events(out);
        for id in &unsupported {
            write_line(
                out,
                &json!({"version": PROTOCOL_VERSION, "type": "simulation_error", "timestamp": cycle,
                        "payload": {"code": "UNSUPPORTED_COMPONENT", "severity": "warning", "componentId": id,
                                    "message": format!("component {id} is not simulated; its pins are left unconnected")}}),
            );
        }
        self.resolve_circuit(out);
        let fault = self
            .circuit
            .as_ref()
            .and_then(|b| b.fault())
            .map(|e| e.code());
        Ok(
            json!({"cycle": cycle, "nets": n_nets, "unsupportedComponents": unsupported, "fault": fault}),
        )
    }

    fn detach_circuit(&mut self) -> CmdResult {
        if let Some(b) = self.circuit.take() {
            b.detach(&mut self.mcu);
        }
        Ok(json!({"cycle": self.mcu.cycles()}))
    }

    fn set_component_input(&mut self, cmd: &Value, out: &mut impl Write) -> CmdResult {
        let Some(bridge) = self.circuit.as_mut() else {
            return Err(("NO_CIRCUIT", "attach_circuit must be called first".into()));
        };
        let id = cmd
            .get("componentId")
            .and_then(Value::as_str)
            .ok_or(("INVALID_ARGUMENT", "componentId is required".to_string()))?;
        let input = cmd
            .get("input")
            .and_then(Value::as_object)
            .ok_or(("INVALID_ARGUMENT", "input (object) is required".to_string()))?;
        if let Some(p) = input.get("pressed") {
            let pressed = p
                .as_bool()
                .ok_or(("INVALID_ARGUMENT", "pressed must be a boolean".to_string()))?;
            let changed = bridge
                .circuit_mut()
                .set_switch(id, pressed)
                .ok_or(("UNKNOWN_COMPONENT", format!("{id:?} is not a push button")))?;
            let cycle = self.mcu.cycles();
            if changed {
                self.flush_events(out);
                write_line(
                    out,
                    &json!({"version": PROTOCOL_VERSION, "type": "component_state_changed", "timestamp": cycle,
                            "payload": {"componentId": id, "state": {"pressed": pressed}}}),
                );
                self.resolve_circuit(out);
            }
            return Ok(json!({"cycle": cycle, "changed": changed}));
        }
        if let Some(p) = input.get("position") {
            let position = p.as_f64().filter(|v| (0.0..=1.0).contains(v)).ok_or((
                "INVALID_ARGUMENT",
                "position must be a number 0..1".to_string(),
            ))?;
            if !bridge.circuit().has_position_input(id) {
                return Err(unsupported_input(bridge, id, "position"));
            }
            let changed = bridge.circuit_mut().set_position(id, position) == Some(true);
            let state = json!({"position": position});
            return Ok(self.input_applied(id, changed, state, out));
        }
        if let Some(l) = input.get("illuminanceLux") {
            let lux = l
                .as_f64()
                .filter(|v| v.is_finite() && *v > 0.0 && *v <= MAX_ILLUMINANCE_LUX)
                .ok_or((
                    "INVALID_ARGUMENT",
                    format!("illuminanceLux must be a number in (0, {MAX_ILLUMINANCE_LUX}]"),
                ))?;
            if !bridge.circuit().has_illuminance_input(id) {
                return Err(unsupported_input(bridge, id, "illuminanceLux"));
            }
            let (changed, ohms) = bridge
                .circuit_mut()
                .set_illuminance(id, lux)
                .unwrap_or((false, 0.0));
            let state =
                json!({"illuminanceLux": lux, "resistanceOhms": (ohms * 1000.0).round() / 1000.0});
            return Ok(self.input_applied(id, changed, state, out));
        }
        Err((
            "INVALID_ARGUMENT",
            "input must contain pressed, position or illuminanceLux".into(),
        ))
    }

    /// Событие нового состояния входа компонента и пересчёт схемы.
    fn input_applied(
        &mut self,
        id: &str,
        changed: bool,
        state: Value,
        out: &mut impl Write,
    ) -> Value {
        let cycle = self.mcu.cycles();
        if changed {
            self.flush_events(out);
            write_line(
                out,
                &json!({"version": PROTOCOL_VERSION, "type": "component_state_changed", "timestamp": cycle,
                        "payload": {"componentId": id, "state": state}}),
            );
            self.resolve_circuit(out);
        }
        json!({"cycle": cycle, "changed": changed})
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
        if let Some(e) = self.circuit.as_ref().and_then(|b| b.fault()) {
            return Err(("CIRCUIT_FAULT", e.message()));
        }
        let target = self.mcu.cycles() + cycles;
        while self.mcu.cycles() < target && !self.mcu.halted() {
            let chunk_end = (self.mcu.cycles() + CHUNK_CYCLES).min(target);
            if self.circuit.is_some() {
                // Выполнение до изменения режима вывода/PWM → пересчёт схемы → продолжение.
                while self.mcu.run_until_drive_change(chunk_end) {
                    self.resolve_circuit(out);
                    if self.circuit.as_ref().and_then(|b| b.fault()).is_some() {
                        self.flush_events(out);
                        return Err((
                            "CIRCUIT_FAULT",
                            "circuit cannot be solved; simulation is paused".into(),
                        ));
                    }
                }
            } else {
                self.mcu.run_until(chunk_end);
            }
            if self.mcu.pending_events() > 0 {
                self.flush_events(out);
            }
            if let Some(bridge) = self.circuit.as_mut() {
                for e in bridge.tick(self.mcu.cycles()) {
                    write_line(out, &e);
                }
            }
        }
        Ok(json!({"cycle": self.mcu.cycles(), "halted": self.mcu.halted()}))
    }

    fn set_input(&mut self, cmd: &Value) -> CmdResult {
        if self.circuit.is_some() {
            return Err((
                "CIRCUIT_ATTACHED",
                "input levels are computed from the attached circuit".into(),
            ));
        }
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
        let circuit = self.circuit.as_ref().map(Bridge::state);
        json!({
            "circuit": circuit,
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
