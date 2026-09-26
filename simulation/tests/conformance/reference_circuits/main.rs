//! Эталонные схемы Arduino UNO R3 со связанной симуляцией MCU и схемы: реальные HEX из
//! `tests/fixtures/`, схема передаётся в worker командой `attach_circuit`.
//!
//! Каждый тест описывает входную схему (netlist + компоненты), скетч, воздействия,
//! ожидаемые события и конечное состояние.

use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Write};
use std::process::{Command, Stdio};

/// Выходное сопротивление HIGH (5 − 4,2) / 0,02 и последовательное сопротивление LED решателя, Ом.
const R_OUT_HIGH: f64 = 40.0;
const R_LED: f64 = 1.0;
/// Прямое напряжение LED по умолчанию из определения компонента, В.
const VF: f64 = 2.0;

fn run_session(commands: &[Value]) -> Vec<Value> {
    let mut child = Command::new(env!("CARGO_BIN_EXE_microlab-sim-worker"))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .expect("worker starts");
    {
        let stdin = child.stdin.as_mut().unwrap();
        for c in commands {
            writeln!(stdin, "{c}").unwrap();
        }
    }
    drop(child.stdin.take());
    let out: Vec<Value> = BufReader::new(child.stdout.take().unwrap())
        .lines()
        .map(|l| serde_json::from_str(&l.unwrap()).unwrap())
        .collect();
    assert!(child.wait().unwrap().success());
    for v in &out {
        if v["type"] == "response" {
            assert_eq!(v["ok"], true, "{v}");
        }
    }
    out
}

fn hex(name: &str) -> String {
    std::fs::read_to_string(format!(
        "{}/../tests/fixtures/{name}/{name}.hex",
        env!("CARGO_MANIFEST_DIR")
    ))
    .unwrap()
}

fn attach(netlist: Value, components: Value) -> Value {
    json!({"cmd": "attach_circuit", "board": {"id": "uno1", "type": "arduino-uno-r3"},
           "netlist": netlist, "components": components})
}

fn events<'a>(out: &'a [Value], kind: &str) -> Vec<&'a Value> {
    out.iter().filter(|v| v["type"] == kind).collect()
}

fn led_states<'a>(out: &'a [Value], id: &str) -> Vec<&'a Value> {
    events(out, "component_state_changed")
        .into_iter()
        .filter(|v| v["payload"]["componentId"] == id)
        .collect()
}

fn warnings<'a>(out: &'a [Value], code: &str) -> Vec<&'a Value> {
    events(out, "simulation_error")
        .into_iter()
        .filter(|v| v["payload"]["code"] == code)
        .collect()
}

fn serial_lines(out: &[Value]) -> Vec<(u64, String)> {
    let mut lines = Vec::new();
    let mut cur = String::new();
    let mut start = None;
    for v in events(out, "serial_output") {
        let t = v["timestamp"].as_u64().unwrap();
        start.get_or_insert(t);
        match v["payload"]["byte"].as_u64().unwrap() as u8 {
            b'\n' => {
                lines.push((start.take().unwrap(), cur.trim_end().to_string()));
                cur.clear();
            }
            b => cur.push(b as char),
        }
    }
    lines
}

fn external_led_circuit(pin: &str) -> Value {
    attach(
        json!([
            {"id": "NET_001", "members": [format!("uno1.{pin}"), "r1.1"]},
            {"id": "NET_002", "members": ["r1.2", "led1.A"]},
            {"id": "NET_003", "members": ["led1.K", "uno1.GND1"]},
        ]),
        json!([
            {"id": "r1", "type": "resistor", "properties": {"resistanceOhms": 220}},
            {"id": "led1", "type": "led", "properties": {"color": "red"}},
        ]),
    )
}

/// Reference 02: D13 → 220 Ω → LED → GND, скетч blink.
///
/// Ожидание: LED включается и выключается вместе с D13 (в пределах нескольких тактов — схема
/// пересчитывается после инструкции, изменившей вывод); ток открытого LED
/// (5 − Vf) / (220 + R_out + R_led) ≈ 11,49 mA с допуском 0,1 %; предупреждений о токе нет.
#[test]
fn reference_02_external_led_follows_d13() {
    let out = run_session(&[
        json!({"cmd": "load_firmware", "hex": hex("blink")}),
        external_led_circuit("D13"),
        json!({"cmd": "run_for", "ms": 3100}),
        json!({"cmd": "get_state"}),
    ]);
    let d13: Vec<(u64, u64)> = events(&out, "digital_pin_changed")
        .into_iter()
        .filter(|v| v["payload"]["pin"] == "D13" && v["payload"]["mode"] != "input")
        .map(|v| {
            (
                v["timestamp"].as_u64().unwrap(),
                v["payload"]["value"].as_u64().unwrap(),
            )
        })
        .collect();
    let leds: Vec<(u64, bool, f64)> = led_states(&out, "led1")
        .into_iter()
        .map(|v| {
            (
                v["timestamp"].as_u64().unwrap(),
                v["payload"]["state"]["on"].as_bool().unwrap(),
                v["payload"]["state"]["currentMa"].as_f64().unwrap(),
            )
        })
        .collect();
    // Первое событие — начальное состояние при подключении схемы (выключен).
    assert!(!leds[0].1);
    let toggles = &leds[1..];
    assert_eq!(toggles.len(), d13.len() - 1, "{leds:?} / {d13:?}");
    let expected_ma = (5.0 - VF) / (220.0 + R_OUT_HIGH + R_LED) * 1000.0;
    for (led, pin) in toggles.iter().zip(&d13[1..]) {
        assert_eq!(led.1, pin.1 == 1);
        assert!(led.0 >= pin.0 && led.0 - pin.0 <= 4, "{led:?} {pin:?}");
        if led.1 {
            assert!(
                (led.2 - expected_ma).abs() / expected_ma < 1e-3,
                "{}",
                led.2
            );
        } else {
            assert_eq!(led.2, 0.0);
        }
    }
    assert_eq!(toggles.iter().filter(|l| l.1).count(), 2);
    assert!(warnings(&out, "GPIO_OVERCURRENT").is_empty());
    let state = &out.last().unwrap()["result"]["circuit"];
    // На 3000 мс D13 = LOW.
    assert_eq!(state["leds"]["led1"]["on"], false);
}

/// LED без резистора на D13: ток (5 − 2) / (40 + 1) ≈ 73 mA > рабочего предела 20 mA —
/// одно предупреждение GPIO_OVERCURRENT, симуляция продолжается.
#[test]
fn led_without_resistor_warns_overcurrent() {
    let out = run_session(&[
        json!({"cmd": "load_firmware", "hex": hex("blink")}),
        attach(
            json!([
                {"id": "NET_001", "members": ["uno1.D13", "led1.A"]},
                {"id": "NET_002", "members": ["led1.K", "uno1.GND2"]},
            ]),
            json!([{"id": "led1", "type": "led"}]),
        ),
        json!({"cmd": "run_for", "ms": 2100}),
    ]);
    let w = warnings(&out, "GPIO_OVERCURRENT");
    assert_eq!(w.len(), 1, "предупреждение выдаётся один раз за сессию");
    let p = &w[0]["payload"];
    assert_eq!(p["severity"], "warning");
    assert_eq!(p["pin"], "D13");
    assert_eq!(p["direction"], "source");
    assert_eq!(p["limitMa"], 20.0);
    let expected = (5.0 - VF) / (R_OUT_HIGH + R_LED) * 1000.0;
    assert!((p["currentMa"].as_f64().unwrap() - expected).abs() < 1e-3);
    // Симуляция не остановлена: LED продолжает мигать.
    assert!(led_states(&out, "led1").len() >= 4);
    assert_eq!(out.last().unwrap()["result"]["halted"], false);
}

/// Reference 03: D2 INPUT_PULLUP, кнопка между D2 и GND; Serial печатает digitalRead(2) каждые 100 мс.
/// Ожидание: отпущена → «1», нажата → «0», снова отпущена → «1».
#[test]
fn reference_03_button_with_input_pullup() {
    let out = run_session(&[
        json!({"cmd": "load_firmware", "hex": hex("button_pullup")}),
        attach(
            json!([
                {"id": "NET_001", "members": ["uno1.D2", "btn1.A"]},
                {"id": "NET_002", "members": ["btn1.B", "uno1.GND1"]},
            ]),
            json!([{"id": "btn1", "type": "push-button"}]),
        ),
        json!({"cmd": "run_for", "ms": 350}),
        json!({"cmd": "set_component_input", "componentId": "btn1", "input": {"pressed": true}}),
        json!({"cmd": "run_for", "ms": 350}),
        json!({"cmd": "set_component_input", "componentId": "btn1", "input": {"pressed": false}}),
        json!({"cmd": "run_for", "ms": 350}),
    ]);
    let ms = 16_000u64;
    let (t_press, t_release) = (350 * ms, 700 * ms);
    let lines = serial_lines(&out);
    assert!(lines.len() >= 9, "{lines:?}");
    for (t, text) in &lines {
        let expected = if *t < t_press || *t > t_release + 2 * ms {
            "1"
        } else if *t > t_press + 2 * ms && *t < t_release {
            "0"
        } else {
            continue;
        };
        assert_eq!(text, expected, "t = {t}");
    }
    let pressed: Vec<bool> = led_states(&out, "btn1")
        .iter()
        .map(|v| v["payload"]["state"]["pressed"].as_bool().unwrap())
        .collect();
    assert_eq!(pressed, [true, false]);
    // До pinMode(INPUT_PULLUP) вывод после reset — вход без подтяжки на разомкнутой кнопке:
    // допускается только предупреждение о плавающем входе, ошибок нет.
    assert!(events(&out, "simulation_error")
        .iter()
        .all(|v| v["payload"]["code"] == "FLOATING_INPUT"));
}

/// Reference 04: analogWrite(9, 128), D9 → 220 Ω → LED → GND.
/// Ожидание: яркость = скважность × яркость при постоянном HIGH; скважность 128/255 с допуском 1/255
/// (как в conformance-тесте PWM эмулятора), ток открытого LED — как в Reference 02.
#[test]
fn reference_04_pwm_led_brightness() {
    let out = run_session(&[
        json!({"cmd": "load_firmware", "hex": hex("pwm_led")}),
        external_led_circuit("D9"),
        json!({"cmd": "run_for", "ms": 50}),
        json!({"cmd": "get_state"}),
    ]);
    let pwm = events(&out, "pwm_changed");
    assert_eq!(pwm.len(), 1);
    let led = &out.last().unwrap()["result"]["circuit"]["leds"]["led1"];
    let full_ma = (5.0 - VF) / (220.0 + R_OUT_HIGH + R_LED) * 1000.0;
    let ratio = led["currentMa"].as_f64().unwrap() / full_ma;
    assert!((ratio - 128.0 / 255.0).abs() <= 1.0 / 255.0, "{ratio}");
    let brightness = led["brightness"].as_f64().unwrap();
    assert!(
        (brightness - full_ma / 20.0 * ratio).abs() < 1e-5,
        "{brightness}"
    );
    assert_eq!(led["on"], true);
}

/// Делитель 10 kΩ / 10 kΩ между 5V и GND, средняя точка на A0; скетч печатает analogRead(A0).
/// Ожидание: 2,5 V на A0 (analog_value_changed) и ⌊2,5·1024/5⌋ = 512 (допуск ±1 LSB).
#[test]
fn adc_reads_resistor_divider() {
    let out = run_session(&[
        json!({"cmd": "load_firmware", "hex": hex("analog_read")}),
        attach(
            json!([
                {"id": "NET_001", "members": ["uno1.5V", "r1.1"]},
                {"id": "NET_002", "members": ["r1.2", "r2.1", "uno1.A0"]},
                {"id": "NET_003", "members": ["r2.2", "uno1.GND3"]},
            ]),
            json!([
                {"id": "r1", "type": "resistor", "properties": {"resistanceOhms": 10000}},
                {"id": "r2", "type": "resistor", "properties": {"resistanceOhms": 10000}},
            ]),
        ),
        json!({"cmd": "run_for", "ms": 200}),
    ]);
    let a0: Vec<&Value> = events(&out, "analog_value_changed")
        .into_iter()
        .filter(|v| v["payload"]["pin"] == "A0")
        .collect();
    assert!((a0[0]["payload"]["voltage"].as_f64().unwrap() - 2.5).abs() < 1e-6);
    let lines = serial_lines(&out);
    assert!(lines.len() >= 5);
    for (_, l) in &lines {
        let v: i64 = l.parse().unwrap();
        assert!((v - 512).abs() <= 1, "{v}");
    }
}

/// Замыкание шины 5V на GND — ошибка решателя, run_for отказывается продолжать.
#[test]
fn shorted_supply_is_reported() {
    let mut child = Command::new(env!("CARGO_BIN_EXE_microlab-sim-worker"))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .unwrap();
    {
        let stdin = child.stdin.as_mut().unwrap();
        for c in [
            json!({"cmd": "load_firmware", "hex": hex("blink")}),
            attach(
                json!([{"id": "NET_001", "members": ["uno1.5V", "uno1.GND1"]}]),
                json!([]),
            ),
            json!({"id": 3, "cmd": "run_for", "ms": 1}),
        ] {
            writeln!(stdin, "{c}").unwrap();
        }
    }
    drop(child.stdin.take());
    let out: Vec<Value> = BufReader::new(child.stdout.take().unwrap())
        .lines()
        .map(|l| serde_json::from_str(&l.unwrap()).unwrap())
        .collect();
    child.wait().unwrap();
    let e = events(&out, "simulation_error");
    assert_eq!(e[0]["payload"]["code"], "CIRCUIT_SHORT");
    assert_eq!(e[0]["payload"]["severity"], "error");
    let r = out.iter().find(|v| v["id"] == 3).unwrap();
    assert_eq!(r["error"]["code"], "CIRCUIT_FAULT");
}

/// Детерминизм: одинаковые прошивка, схема и воздействия дают одинаковый поток событий.
#[test]
fn coupled_simulation_is_deterministic() {
    let run = || {
        run_session(&[
            json!({"cmd": "load_firmware", "hex": hex("pwm_led")}),
            external_led_circuit("D9"),
            json!({"cmd": "run_for", "ms": 30}),
        ])
    };
    assert_eq!(run(), run());
}

mod components;
