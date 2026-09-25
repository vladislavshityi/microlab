//! Связь эмулятора MCU и решателя схемы.
//!
//! Цикл: эмулятор выполняется до изменения режима какого-либо вывода или скважности PWM
//! (или до внешнего воздействия — кнопки), затем схема решается заново, и результат
//! передаётся обратно в MCU: логические уровни цифровых входов, напряжения каналов АЦП и AREF.
//! Все шаги детерминированы: одинаковые прошивка, схема и воздействия дают одинаковые события.

use avr_core::{Mcu, PinMode};
use circuit::{Circuit, Drive, InputLevel, LedResult, Solution, SolveError};
use serde_json::{json, Value};
use std::collections::BTreeSet;

use crate::protocol::PROTOCOL_VERSION;

/// Изменение напряжения/тока меньше этого порога не порождает событие.
const EPS: f64 = 1e-9;

pub struct Bridge {
    circuit: Circuit,
    board_id: String,
    /// Последний уровень, переданный MCU по каждому GPIO (`None` — вход не задан/плавает).
    applied: Vec<Option<Option<bool>>>,
    analog: Vec<Option<(f64, bool)>>,
    leds: Vec<Option<LedResult>>,
    /// Предупреждения, уже выданные в этой сессии (код, объект).
    warned: BTreeSet<(&'static str, String)>,
    fault: Option<SolveError>,
    last: Option<Solution>,
}

fn event(cycle: u64, kind: &str, payload: Value) -> Value {
    json!({"version": PROTOCOL_VERSION, "type": kind, "timestamp": cycle, "payload": payload})
}

fn round6(v: f64) -> f64 {
    (v * 1e6).round() / 1e6
}

/// Состояние вывода MCU для решателя.
fn drive_of(mcu: &Mcu, name: &str) -> Drive {
    let Some(st) = mcu.pin_state(name) else {
        return Drive::Input;
    };
    match st.mode {
        PinMode::OutputHigh => Drive::High,
        PinMode::OutputLow => Drive::Low,
        PinMode::Input => Drive::Input,
        PinMode::InputPullup => Drive::InputPullup,
        PinMode::Pwm => match mcu.pwm_measurement(name) {
            Some((high, total)) if total > 0 => Drive::Pwm {
                duty: high as f64 / total as f64,
            },
            // Период ещё не измерен: используется текущий уровень выхода.
            _ if st.value => Drive::High,
            _ => Drive::Low,
        },
    }
}

impl Bridge {
    pub fn new(circuit: Circuit, board_id: String) -> Self {
        let n = circuit.gpio_names().count();
        let leds = circuit.led_ids().count();
        Bridge {
            circuit,
            board_id,
            applied: vec![None; n],
            analog: vec![None; n],
            leds: vec![None; leds],
            warned: BTreeSet::new(),
            fault: None,
            last: None,
        }
    }

    pub fn circuit_mut(&mut self) -> &mut Circuit {
        &mut self.circuit
    }

    pub fn circuit(&self) -> &Circuit {
        &self.circuit
    }

    pub fn fault(&self) -> Option<&SolveError> {
        self.fault.as_ref()
    }

    /// Новая прошивка — новая сессия предупреждений.
    pub fn clear_warnings(&mut self) {
        self.warned.clear();
    }

    fn warn(
        &mut self,
        out: &mut Vec<Value>,
        cycle: u64,
        code: &'static str,
        key: String,
        mut payload: Value,
    ) {
        if self.warned.insert((code, key)) {
            payload["code"] = json!(code);
            payload["severity"] = json!("warning");
            out.push(event(cycle, "simulation_error", payload));
        }
    }

    /// Решает схему для текущего состояния MCU, передаёт результат в MCU и возвращает события.
    pub fn resolve(&mut self, mcu: &mut Mcu) -> Vec<Value> {
        let cycle = mcu.cycles();
        let names: Vec<String> = self.circuit.gpio_names().map(str::to_string).collect();
        let drives: Vec<Drive> = names.iter().map(|n| drive_of(mcu, n)).collect();
        let mut out = Vec::new();
        let sol = match self.circuit.solve(&drives) {
            Ok(s) => s,
            Err(e) => {
                if self.fault.as_ref() != Some(&e) {
                    out.push(event(
                        cycle,
                        "simulation_error",
                        json!({"code": e.code(), "severity": "error", "message": e.message()}),
                    ));
                }
                self.fault = Some(e);
                return out;
            }
        };
        self.fault = None;

        for (i, p) in sol.pins.iter().enumerate() {
            let mode = mcu.pin_state(&p.name).map(|s| s.mode);
            let is_input = matches!(mode, Some(PinMode::Input | PinMode::InputPullup));
            let prev = self.applied[i].flatten();
            let level = match p.level {
                InputLevel::Low => Some(false),
                InputLevel::High => Some(true),
                InputLevel::Undefined => {
                    if is_input && p.connected {
                        let v = p.voltage.unwrap_or(0.0);
                        self.warn(
                            &mut out,
                            cycle,
                            "UNDEFINED_INPUT_LEVEL",
                            p.name.clone(),
                            json!({"pin": p.name, "voltage": round6(v),
                                   "message": format!("{} is between VIL and VIH ({v:.3} V); previous level is kept", p.name)}),
                        );
                    }
                    Some(prev.unwrap_or(false))
                }
                InputLevel::Floating => {
                    if is_input && p.connected {
                        self.warn(
                            &mut out,
                            cycle,
                            "FLOATING_INPUT",
                            p.name.clone(),
                            json!({"pin": p.name,
                                   "message": format!("{} is connected to a net without a defined potential; it reads 0", p.name)}),
                        );
                    }
                    None
                }
            };
            if self.applied[i] != Some(level) {
                self.applied[i] = Some(level);
                // Имена выводов берутся из той же таблицы платы, поэтому ошибка невозможна.
                let _ = mcu.set_input(&p.name, level);
            }
        }

        // Аналоговые входы A0…A5 → каналы АЦП 0…5.
        for (i, p) in sol.pins.iter().enumerate() {
            let Some(ch) = p
                .name
                .strip_prefix('A')
                .and_then(|n| n.parse::<usize>().ok())
            else {
                continue;
            };
            let floating = p.voltage.is_none();
            let v = p.voltage.unwrap_or(0.0);
            mcu.set_analog_input(ch, v);
            let changed = match self.analog[i] {
                Some((old, f)) => (old - v).abs() > EPS || f != floating,
                None => true,
            };
            if changed {
                self.analog[i] = Some((v, floating));
                out.push(event(
                    cycle,
                    "analog_value_changed",
                    json!({"board": self.board_id, "pin": p.name, "voltage": round6(v), "floating": floating}),
                ));
            }
        }
        mcu.set_aref(sol.aref);

        for (i, l) in sol.leds.iter().enumerate() {
            let changed = match &self.leds[i] {
                Some(old) => {
                    old.on != l.on
                        || (old.current_a - l.current_a).abs() > EPS
                        || (old.brightness - l.brightness).abs() > EPS
                }
                None => true,
            };
            if changed {
                self.leds[i] = Some(l.clone());
                out.push(event(
                    cycle,
                    "component_state_changed",
                    json!({"componentId": l.id, "state": {
                        "on": l.on,
                        "currentMa": round6(l.current_a * 1000.0),
                        "brightness": round6(l.brightness),
                    }}),
                ));
            }
        }

        for oc in &sol.overcurrent {
            let (code, key) = if oc.group {
                (
                    "GPIO_GROUP_OVERCURRENT",
                    format!("{}:{}", oc.direction.as_str(), oc.pins.join(",")),
                )
            } else {
                ("GPIO_OVERCURRENT", oc.pins[0].clone())
            };
            let message = format!(
                "{} {} current {:.1} mA exceeds the {:.0} mA operating limit (simulation continues)",
                oc.pins.join(", "),
                oc.direction.as_str(),
                oc.current_a * 1000.0,
                oc.limit_a * 1000.0
            );
            let payload = if oc.group {
                json!({"pins": oc.pins, "direction": oc.direction.as_str(),
                       "currentMa": round6(oc.current_a * 1000.0), "limitMa": round6(oc.limit_a * 1000.0), "message": message})
            } else {
                json!({"pin": oc.pins[0], "direction": oc.direction.as_str(),
                       "currentMa": round6(oc.current_a * 1000.0), "limitMa": round6(oc.limit_a * 1000.0), "message": message})
            };
            self.warn(&mut out, cycle, code, key, payload);
        }
        self.last = Some(sol);
        out
    }

    /// Состояние схемы для `get_state`.
    pub fn state(&self) -> Value {
        let Some(sol) = &self.last else {
            return json!({"solved": false});
        };
        let leds: serde_json::Map<String, Value> = sol
            .leds
            .iter()
            .map(|l| {
                (
                    l.id.clone(),
                    json!({"on": l.on, "currentMa": round6(l.current_a * 1000.0), "brightness": round6(l.brightness)}),
                )
            })
            .collect();
        let switches: serde_json::Map<String, Value> = sol
            .switches
            .iter()
            .map(|(id, closed)| (id.clone(), json!({"pressed": closed})))
            .collect();
        let nets: serde_json::Map<String, Value> = sol
            .nets
            .iter()
            .map(|(id, v)| (id.clone(), json!(v.map(round6))))
            .collect();
        json!({
            "solved": self.fault.is_none(),
            "leds": leds,
            "switches": switches,
            "netVoltages": nets,
        })
    }

    /// Возвращает MCU в состояние без внешней схемы (все входы не подключены, 0 V на АЦП).
    pub fn detach(&self, mcu: &mut Mcu) {
        for name in self.circuit.gpio_names() {
            let _ = mcu.set_input(name, None);
        }
        for ch in 0..avr_core::adc::CHANNELS {
            mcu.set_analog_input(ch, 0.0);
        }
        mcu.set_aref(None);
    }
}
