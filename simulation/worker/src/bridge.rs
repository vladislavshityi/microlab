//! Связь эмулятора MCU и решателя схемы.
//!
//! Цикл: эмулятор выполняется до изменения режима какого-либо вывода или скважности PWM
//! (или до внешнего воздействия — кнопки), затем схема решается заново, и результат
//! передаётся обратно в MCU: логические уровни цифровых входов, напряжения каналов АЦП и AREF.
//! Все шаги детерминированы: одинаковые прошивка, схема и воздействия дают одинаковые события.
//!
//! Поведенческие модели по фронтам напряжений (время фронта — такт MCU, на котором схема
//! пересчитана после инструкции, изменившей вывод):
//! * пьезоизлучатель — период между соседними фронтами «вверх» напряжения на выводах
//!   (порог [`EDGE_THRESHOLD_FRACTION`] · Vcc) → частота и скважность; нет фронтов дольше
//!   двух периодов — звук выключен;
//! * сервопривод — длительность импульса на выводе сигнала → угол
//!   `180° · (t − t_min) / (t_max − t_min)` с ограничением 0…180°; при напряжении питания ниже
//!   минимального угол не меняется.

use avr_core::{Mcu, PinMode, CLOCK_HZ};
use circuit::{Circuit, Drive, InputLevel, LedResult, MonitorKind, Solution, SolveError};
use serde_json::{json, Value};
use std::collections::BTreeSet;

use crate::protocol::PROTOCOL_VERSION;

/// Изменение напряжения/тока меньше этого порога не порождает событие.
const EPS: f64 = 1e-9;
/// Порог логического уровня для фронтов пьезоизлучателя и сигнала сервопривода — доля
/// напряжения питания платы. Допущение модели: между VIL и VIH реального входа.
pub const EDGE_THRESHOLD_FRACTION: f64 = 0.5;
/// Относительное изменение частоты, ниже которого новое событие не выдаётся (дрожание
/// задержки прерывания на несколько тактов).
const FREQ_REL_EPS: f64 = 2e-3;
/// Изменение угла сервопривода, ниже которого новое событие не выдаётся, градусы: дрожание
/// задержки прерывания Timer1 (единицы мкс) не порождает поток событий. Порог событий, а не
/// параметр сервопривода.
const ANGLE_EPS: f64 = 1.0;
/// Допустимое расхождение двух соседних периодов пьезоизлучателя, при котором частота
/// считается установившейся (первый полупериод после tone() короче).
const PERIOD_MATCH: f64 = 0.02;

/// Состояние измерения пьезоизлучателя.
#[derive(Debug, Clone, Default)]
struct PiezoTrack {
    level: bool,
    last_rise: Option<u64>,
    last_fall: Option<u64>,
    last_edge: Option<u64>,
    /// Установившийся период (два соседних периода совпали), такты.
    period: Option<u64>,
    /// Последний измеренный период, такты.
    candidate: Option<u64>,
    /// Опубликованное состояние: (звучит, частота, скважность).
    published: Option<(bool, f64, f64)>,
}

/// Состояние измерения сервопривода.
#[derive(Debug, Clone, Default)]
struct ServoTrack {
    level: bool,
    rise: Option<u64>,
    powered: Option<bool>,
    angle: Option<f64>,
    pulse_us: Option<f64>,
    published: Option<(bool, Option<f64>)>,
}

#[derive(Debug, Clone)]
enum Track {
    Piezo(PiezoTrack),
    Servo(ServoTrack),
}
pub struct Bridge {
    circuit: Circuit,
    board_id: String,
    /// Последний уровень, переданный MCU по каждому GPIO (`None` — вход не задан/плавает).
    applied: Vec<Option<Option<bool>>>,
    analog: Vec<Option<(f64, bool)>>,
    leds: Vec<Option<LedResult>>,
    tracks: Vec<Track>,
    io_voltage: f64,
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
    pub fn new(circuit: Circuit, board_id: String, io_voltage: f64) -> Self {
        let n = circuit.gpio_names().count();
        let leds = circuit.led_ids().count();
        let tracks = circuit
            .monitors()
            .iter()
            .map(|m| match m.kind {
                MonitorKind::Piezo => Track::Piezo(PiezoTrack::default()),
                MonitorKind::Servo { .. } => Track::Servo(ServoTrack::default()),
            })
            .collect();
        Bridge {
            circuit,
            board_id,
            applied: vec![None; n],
            analog: vec![None; n],
            leds: vec![None; leds],
            tracks,
            io_voltage,
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

        // Светодиоды: одиночный — своё событие; каналы составного индикатора — одно событие
        // на компонент со всеми каналами, если изменился хотя бы один.
        let mut dirty: BTreeSet<String> = BTreeSet::new();
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
                if l.channel.is_none() {
                    out.push(event(
                        cycle,
                        "component_state_changed",
                        json!({"componentId": l.id, "state": led_state(l)}),
                    ));
                } else {
                    dirty.insert(l.id.clone());
                }
            }
        }
        for id in dirty {
            out.push(event(
                cycle,
                "component_state_changed",
                json!({"componentId": id, "state": array_state(&sol.leds, &id)}),
            ));
        }

        self.observe(&sol, cycle, &mut out);

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
                let state = if l.channel.is_none() {
                    led_state(l)
                } else {
                    array_state(&sol.leds, &l.id)
                };
                (l.id.clone(), state)
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

    /// Пересчёт тайм-аутов поведенческих моделей без изменения схемы (вызывается по срезам
    /// выполнения): пьезоизлучатель без фронтов дольше двух периодов замолкает.
    pub fn tick(&mut self, cycle: u64) -> Vec<Value> {
        let mut out = Vec::new();
        for (i, track) in self.tracks.iter_mut().enumerate() {
            if let Track::Piezo(t) = track {
                if let (Some(period), Some(edge)) = (t.period.or(t.candidate), t.last_edge) {
                    if cycle.saturating_sub(edge) > 2 * period {
                        t.period = None;
                        t.candidate = None;
                        t.last_rise = None;
                        t.last_fall = None;
                        let id = self.circuit.monitors()[i].id.clone();
                        publish_piezo(t, &id, cycle, &mut out);
                    }
                }
            }
        }
        out
    }

    /// Фронты напряжений наблюдаемых компонентов → частота пьезоизлучателя, угол сервопривода.
    fn observe(&mut self, sol: &Solution, cycle: u64, out: &mut Vec<Value>) {
        let threshold = EDGE_THRESHOLD_FRACTION * self.io_voltage;
        for (i, track) in self.tracks.iter_mut().enumerate() {
            let monitor = &self.circuit.monitors()[i];
            let v = &sol.probes[i];
            match (track, &monitor.kind) {
                (Track::Piezo(t), _) => {
                    let diff = v[0].unwrap_or(0.0) - v[1].unwrap_or(0.0);
                    let level = v[0].is_some() && v[1].is_some() && diff > threshold;
                    if level != t.level {
                        t.level = level;
                        t.last_edge = Some(cycle);
                        if level {
                            if let Some(prev) = t.last_rise {
                                let p = cycle - prev;
                                if t.candidate.is_some_and(|c| {
                                    c.abs_diff(p) as f64 <= PERIOD_MATCH * p as f64
                                }) {
                                    t.period = Some(p);
                                }
                                t.candidate = Some(p);
                            }
                            t.last_rise = Some(cycle);
                        } else {
                            t.last_fall = Some(cycle);
                        }
                        publish_piezo(t, &monitor.id, cycle, out);
                    } else if t.published.is_none() {
                        publish_piezo(t, &monitor.id, cycle, out);
                    }
                }
                (
                    Track::Servo(t),
                    MonitorKind::Servo {
                        min_pulse_us,
                        max_pulse_us,
                        min_supply_v,
                    },
                ) => {
                    let ground = v[2].unwrap_or(0.0);
                    let powered =
                        matches!((v[1], v[2]), (Some(p), Some(g)) if p - g >= *min_supply_v);
                    let level = v[0].is_some_and(|s| s - ground > threshold);
                    if level && !t.level {
                        t.rise = Some(cycle);
                    } else if !level && t.level {
                        if let Some(rise) = t.rise.take() {
                            let us = (cycle - rise) as f64 * 1e6 / CLOCK_HZ as f64;
                            // Импульс длиннее 2·t_max — не управляющий (например, постоянный HIGH).
                            if powered && us <= 2.0 * max_pulse_us {
                                let span = max_pulse_us - min_pulse_us;
                                let angle = (180.0 * (us - min_pulse_us) / span).clamp(0.0, 180.0);
                                t.pulse_us = Some(us);
                                t.angle = Some(angle);
                            }
                        }
                    }
                    t.level = level;
                    t.powered = Some(powered);
                    let changed = match t.published {
                        None => true,
                        Some((p, a)) => {
                            p != powered
                                || match (a, t.angle) {
                                    (Some(a), Some(b)) => (a - b).abs() > ANGLE_EPS,
                                    (a, b) => a.is_some() != b.is_some(),
                                }
                        }
                    };
                    if changed {
                        t.published = Some((powered, t.angle));
                        out.push(event(
                            cycle,
                            "component_state_changed",
                            json!({"componentId": monitor.id, "state": {
                                "powered": powered,
                                "angle": t.angle.map(|a| (a * 100.0).round() / 100.0),
                                "pulseUs": t.pulse_us.map(|u| (u * 100.0).round() / 100.0),
                            }}),
                        ));
                    }
                }
                (Track::Servo(_), MonitorKind::Piezo) => {}
            }
        }
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

fn led_state(l: &LedResult) -> Value {
    json!({"on": l.on, "currentMa": round6(l.current_a * 1000.0), "brightness": round6(l.brightness)})
}

/// Состояние составного индикатора: `on` — светится хотя бы один канал, `channels` — по каналам.
fn array_state(leds: &[LedResult], id: &str) -> Value {
    let mut channels = serde_json::Map::new();
    let mut any = false;
    for l in leds.iter().filter(|l| l.id == id) {
        any |= l.on;
        if let Some(ch) = &l.channel {
            channels.insert(ch.clone(), led_state(l));
        }
    }
    json!({"on": any, "channels": channels})
}

/// Выдаёт состояние пьезоизлучателя, если оно заметно изменилось.
fn publish_piezo(t: &mut PiezoTrack, id: &str, cycle: u64, out: &mut Vec<Value>) {
    let (active, freq, duty) = match (t.period, t.last_rise, t.last_fall) {
        (Some(p), Some(rise), Some(fall)) if p > 0 => {
            // Длительность «1» последнего полного периода.
            let high = if fall > rise {
                fall - rise
            } else {
                p.saturating_sub(rise - fall)
            };
            (
                true,
                CLOCK_HZ as f64 / p as f64,
                (high as f64 / p as f64).clamp(0.0, 1.0),
            )
        }
        (Some(p), _, _) if p > 0 => (true, CLOCK_HZ as f64 / p as f64, 0.5),
        _ => (false, 0.0, 0.0),
    };
    let changed = match t.published {
        None => true,
        Some((a, f, _)) => a != active || (active && ((f - freq).abs() > FREQ_REL_EPS * f)),
    };
    if changed {
        t.published = Some((active, freq, duty));
        out.push(event(
            cycle,
            "component_state_changed",
            json!({"componentId": id, "state": {
                "active": active,
                "frequencyHz": (freq * 100.0).round() / 100.0,
                "dutyCycle": (duty * 1000.0).round() / 1000.0,
            }}),
        ));
    }
}
