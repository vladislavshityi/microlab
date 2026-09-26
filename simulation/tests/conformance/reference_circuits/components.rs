//! Эталонные схемы дополнительных компонентов: потенциометр, RGB-светодиод, пьезоизлучатель,
//! 7-сегментный индикатор, сервопривод. Реальные HEX из `tests/fixtures/`.

use super::*;

const CYCLES_PER_MS: u64 = 16_000;

fn states<'a>(out: &'a [Value], id: &str) -> Vec<&'a Value> {
    led_states(out, id)
}

/// Последнее состояние компонента с timestamp не позже `ms`.
fn state_at<'a>(out: &'a [Value], id: &str, ms: u64) -> &'a Value {
    let s = states(out, id)
        .into_iter()
        .rfind(|v| v["timestamp"].as_u64().unwrap() <= ms * CYCLES_PER_MS)
        .unwrap_or_else(|| panic!("no state of {id} before {ms} ms"));
    &s["payload"]["state"]
}

/// Reference 05: потенциометр 10 kΩ между GND и 5V, движок на A0, скетч analog_read.
///
/// Ожидание: analogRead(A0) ≈ 1023 · p (0 %, 50 %, 100 %) — в пределах ±1 LSB от кода АЦП
/// для напряжения движка 5 · p (поправка 1 Ω у концов меньше 0,1 LSB).
#[test]
fn reference_05_potentiometer_analog_read() {
    let mut cmds = vec![
        json!({"cmd": "load_firmware", "hex": hex("analog_read")}),
        attach(
            json!([
                {"id": "NET_001", "members": ["uno1.GND1", "pot1.1"]},
                {"id": "NET_002", "members": ["uno1.5V", "pot1.2"]},
                {"id": "NET_003", "members": ["uno1.A0", "pot1.W"]},
            ]),
            json!([{"id": "pot1", "type": "potentiometer", "properties": {"resistanceOhms": 10000, "positionPercent": 0}}]),
        ),
        json!({"cmd": "run_for", "ms": 100}),
    ];
    for p in [0.5, 1.0] {
        cmds.push(
            json!({"cmd": "set_component_input", "componentId": "pot1", "input": {"position": p}}),
        );
        cmds.push(json!({"cmd": "run_for", "ms": 100}));
    }
    let out = run_session(&cmds);
    let lines = serial_lines(&out);
    let value_at = |ms: u64| -> i64 {
        lines
            .iter()
            .rfind(|(t, _)| *t <= ms * CYCLES_PER_MS)
            .unwrap()
            .1
            .parse()
            .unwrap()
    };
    assert!(value_at(95) <= 1, "0 %: {}", value_at(95));
    assert!((value_at(195) - 512).abs() <= 1, "50 %: {}", value_at(195));
    assert!(value_at(295) >= 1022, "100 %: {}", value_at(295));
    let inputs: Vec<f64> = states(&out, "pot1")
        .iter()
        .map(|v| v["payload"]["state"]["position"].as_f64().unwrap())
        .collect();
    assert_eq!(inputs, [0.5, 1.0]);
}

/// Потенциометр: вход вне 0…1 и вход, которого у компонента нет, отклоняются.
#[test]
fn component_inputs_are_checked() {
    let mut child = Command::new(env!("CARGO_BIN_EXE_microlab-sim-worker"))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .unwrap();
    {
        let stdin = child.stdin.as_mut().unwrap();
        for c in [
            attach(
                json!([{"id": "NET_001", "members": ["uno1.A0", "pot1.W", "ldr1.1"]}]),
                json!([
                    {"id": "pot1", "type": "potentiometer"},
                    {"id": "ldr1", "type": "photoresistor"},
                ]),
            ),
            json!({"cmd": "set_component_input", "componentId": "pot1", "input": {"position": 1.5}}),
            json!({"cmd": "set_component_input", "componentId": "pot1", "input": {"illuminanceLux": 5}}),
            json!({"cmd": "set_component_input", "componentId": "ldr1", "input": {"illuminanceLux": 1000}}),
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
    let codes: Vec<Value> = out
        .iter()
        .filter(|v| v["type"] == "response")
        .map(|v| v["error"]["code"].clone())
        .collect();
    assert_eq!(
        codes,
        [
            Value::Null,
            json!("INVALID_ARGUMENT"),
            json!("UNSUPPORTED_INPUT"),
            Value::Null
        ]
    );
    let ldr = states(&out, "ldr1");
    let r = ldr[0]["payload"]["state"]["resistanceOhms"]
        .as_f64()
        .unwrap();
    // R10 = 10 kΩ, γ = 0,7 (значения определения по умолчанию): 10k · 100^−0,7.
    assert!((r - 10_000.0 * 100f64.powf(-0.7)).abs() < 1e-3, "{r}");
}

/// RGB-светодиод с общим катодом: R — analogWrite(255) (постоянный HIGH в ядре), G — 128
/// (PWM Timer1, D10), B — analogWrite(0) (LOW). Средний ток канала G пропорционален скважности.
#[test]
fn rgb_led_pwm_channels() {
    let out = run_session(&[
        json!({"cmd": "load_firmware", "hex": hex("rgb_pwm")}),
        attach(
            json!([
                {"id": "NET_001", "members": ["uno1.D9", "r1.1"]},
                {"id": "NET_002", "members": ["r1.2", "rgb1.R"]},
                {"id": "NET_003", "members": ["uno1.D10", "r2.1"]},
                {"id": "NET_004", "members": ["r2.2", "rgb1.G"]},
                {"id": "NET_005", "members": ["uno1.D11", "r3.1"]},
                {"id": "NET_006", "members": ["r3.2", "rgb1.B"]},
                {"id": "NET_007", "members": ["rgb1.COM", "uno1.GND1"]},
            ]),
            json!([
                {"id": "r1", "type": "resistor", "properties": {"resistanceOhms": 220}},
                {"id": "r2", "type": "resistor", "properties": {"resistanceOhms": 220}},
                {"id": "r3", "type": "resistor", "properties": {"resistanceOhms": 220}},
                {"id": "rgb1", "type": "rgb-led", "properties": {"commonType": "common-cathode"}},
            ]),
        ),
        json!({"cmd": "run_for", "ms": 50}),
    ]);
    let duty = events(&out, "pwm_changed")
        .into_iter()
        .rfind(|v| v["payload"]["pin"] == "D10")
        .unwrap()["payload"]["dutyCycle"]
        .as_f64()
        .unwrap();
    assert!((duty - 128.0 / 255.0).abs() < 0.01, "{duty}");
    let st = state_at(&out, "rgb1", 50);
    let ch = |c: &str, k: &str| st["channels"][c][k].clone();
    assert_eq!(st["on"], true);
    let r_ma = ch("r", "currentMa").as_f64().unwrap();
    // (5 − 2) / (220 + 40 + 1) — HIGH-выход, Vf по умолчанию 2 В.
    assert!((r_ma - 3000.0 / 261.0).abs() < 0.01, "{r_ma}");
    let g_ma = ch("g", "currentMa").as_f64().unwrap();
    // Среднее по скважности: duty · (5 − 3) / 261.
    assert!((g_ma - duty * 2000.0 / 261.0).abs() < 0.01, "{g_ma}");
    assert_eq!(ch("b", "on"), false);
}

/// tone(8, 440) на 500 мс: частота по фронтам напряжения на пьезоизлучателе.
///
/// Ядро 1.8.8 (Tone.cpp): Timer2 CTC, делитель 128, OCR2A = 16 MHz / 440 / 2 / 128 − 1 = 141 →
/// переключение каждые 128 · 142 тактов, частота 16e6 / (2 · 128 · 142) ≈ 440,14 Гц.
#[test]
fn piezo_tone_440_hz() {
    let out = run_session(&[
        json!({"cmd": "load_firmware", "hex": hex("tone_440")}),
        attach(
            json!([
                {"id": "NET_001", "members": ["uno1.D8", "bz1.P"]},
                {"id": "NET_002", "members": ["bz1.N", "uno1.GND1"]},
            ]),
            json!([{"id": "bz1", "type": "piezo-buzzer"}]),
        ),
        json!({"cmd": "run_for", "ms": 700}),
    ]);
    let expected = 16e6 / (2.0 * 128.0 * 142.0);
    let st = state_at(&out, "bz1", 400);
    assert_eq!(st["active"], true);
    let f = st["frequencyHz"].as_f64().unwrap();
    assert!((f - expected).abs() < 0.5, "{f}");
    assert!((st["dutyCycle"].as_f64().unwrap() - 0.5).abs() < 0.01);
    // noTone() в 500 мс: не позже чем через два периода звук выключен.
    let off = states(&out, "bz1")
        .into_iter()
        .rfind(|v| v["payload"]["state"]["active"] == false)
        .unwrap();
    let t = off["timestamp"].as_u64().unwrap();
    assert!(t > 500 * CYCLES_PER_MS && t < 510 * CYCLES_PER_MS, "{t}");
    assert_eq!(state_at(&out, "bz1", 700)["active"], false);
}

fn seven_segment_circuit() -> Value {
    let mut nets = Vec::new();
    let mut comps = Vec::new();
    for (i, seg) in ["a", "b", "c", "d", "e", "f", "g"].iter().enumerate() {
        nets.push(json!({"id": format!("NET_P{i}"), "members": [format!("uno1.D{}", i + 2), format!("r{i}.1")]}));
        nets.push(json!({"id": format!("NET_S{i}"), "members": [format!("r{i}.2"), format!("seg1.{seg}")]}));
        comps.push(json!({"id": format!("r{i}"), "type": "resistor", "properties": {"resistanceOhms": 330}}));
    }
    nets.push(json!({"id": "NET_COM", "members": ["seg1.COM2", "uno1.GND1"]}));
    comps.push(json!({"id": "seg1", "type": "seven-segment", "properties": {"commonType": "common-cathode"}}));
    attach(json!(nets), json!(comps))
}

/// 7-сегментный индикатор с общим катодом (COM2 — через внутреннее соединение с COM1):
/// цифры 0 и 1 по таблице скетча.
#[test]
fn seven_segment_shows_digits() {
    let out = run_session(&[
        json!({"cmd": "load_firmware", "hex": hex("seven_segment")}),
        seven_segment_circuit(),
        json!({"cmd": "run_for", "ms": 450}),
    ]);
    let lit = |ms: u64| -> String {
        let st = state_at(&out, "seg1", ms);
        ["a", "b", "c", "d", "e", "f", "g", "dp"]
            .iter()
            .filter(|s| st["channels"][**s]["on"] == true)
            .copied()
            .collect()
    };
    assert_eq!(lit(150), "abcdef");
    assert_eq!(lit(350), "bc");
    let a_ma = state_at(&out, "seg1", 150)["channels"]["a"]["currentMa"]
        .as_f64()
        .unwrap();
    // (5 − 2) / (330 + 40 + 1).
    assert!((a_ma - 3000.0 / 371.0).abs() < 0.01, "{a_ma}");
}

fn servo_circuit(powered: bool) -> Value {
    let mut nets = vec![
        json!({"id": "NET_001", "members": ["uno1.D9", "s1.SIG"]}),
        json!({"id": "NET_002", "members": ["uno1.GND1", "s1.GND"]}),
    ];
    if powered {
        nets.push(json!({"id": "NET_003", "members": ["uno1.5V", "s1.VCC"]}));
    }
    attach(json!(nets), json!([{"id": "s1", "type": "servo"}]))
}

/// Servo 1.3.0: write(0/90/180) → импульс map(angle, 0, 180, 544, 2400) мкс на D9 → угол.
/// Допуск ±1,5°: задержка обработчика прерывания Timer1 и TRIM_DURATION библиотеки.
#[test]
fn servo_write_sets_angle() {
    let out = run_session(&[
        json!({"cmd": "load_firmware", "hex": hex("servo_write")}),
        servo_circuit(true),
        json!({"cmd": "run_for", "ms": 2600}),
    ]);
    for (ms, expected) in [(950, 0.0), (1950, 90.0), (2600, 180.0)] {
        let st = state_at(&out, "s1", ms);
        assert_eq!(st["powered"], true);
        let angle = st["angle"].as_f64().unwrap();
        assert!((angle - expected).abs() <= 1.5, "{ms} ms: {angle}");
    }
    let pulse = state_at(&out, "s1", 1950)["pulseUs"].as_f64().unwrap();
    assert!((pulse - 1472.0).abs() < 10.0, "{pulse}");
}

/// Без питания сервопривод не поворачивается, состояние сообщает powered = false.
#[test]
fn servo_without_power_does_not_move() {
    let out = run_session(&[
        json!({"cmd": "load_firmware", "hex": hex("servo_write")}),
        servo_circuit(false),
        json!({"cmd": "run_for", "ms": 300}),
    ]);
    let st = state_at(&out, "s1", 300);
    assert_eq!(st["powered"], false);
    assert!(st["angle"].is_null());
}
