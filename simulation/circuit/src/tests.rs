//! Модульные тесты решателя на эталонных схемах.

use super::*;
use serde_json::json;

fn spec(nets: &[&[&str]], comps: &[(&str, &str, Value)]) -> CircuitSpec {
    CircuitSpec {
        board_id: "uno1".into(),
        nets: nets
            .iter()
            .enumerate()
            .map(|(i, m)| NetSpec {
                id: format!("NET_{i:03}"),
                members: m.iter().map(|s| s.to_string()).collect(),
            })
            .collect(),
        components: comps
            .iter()
            .map(|(id, t, p)| ComponentSpec {
                id: id.to_string(),
                type_name: t.to_string(),
                properties: p.as_object().cloned().unwrap_or_default(),
            })
            .collect(),
    }
}

fn drives(c: &Circuit, set: &[(&str, Drive)]) -> Vec<Drive> {
    c.gpio_names()
        .map(|n| {
            set.iter()
                .find(|(p, _)| *p == n)
                .map(|x| x.1)
                .unwrap_or(Drive::Input)
        })
        .collect()
}

fn pin<'a>(s: &'a Solution, name: &str) -> &'a PinResult {
    s.pins.iter().find(|p| p.name == name).unwrap()
}

fn external_led() -> Circuit {
    Circuit::build(
        &Library::builtin(),
        &spec(
            &[
                &["uno1.D13", "r1.1"],
                &["r1.2", "led1.A"],
                &["led1.K", "uno1.GND1"],
            ],
            &[
                ("r1", "resistor", json!({"resistanceOhms": 220})),
                ("led1", "led", json!({"forwardVoltage": 2.0})),
            ],
        ),
    )
    .unwrap()
}

#[test]
fn output_resistance_derivation() {
    assert!((R_OUT_HIGH_OHMS - 40.0).abs() < 1e-9);
    assert!((R_OUT_LOW_OHMS - 45.0).abs() < 1e-9);
}

#[test]
fn external_led_current_follows_ohms_law() {
    let mut c = external_led();
    let s = c.solve(&drives(&c, &[("D13", Drive::High)])).unwrap();
    let expected = (5.0 - 2.0) / (220.0 + R_OUT_HIGH_OHMS + LED_SERIES_OHMS);
    assert!(s.leds[0].on);
    assert!(
        (s.leds[0].current_a - expected).abs() < 1e-9,
        "{:?}",
        s.leds
    );
    assert!((pin(&s, "D13").current_a - expected).abs() < 1e-9);
    assert!(s.overcurrent.is_empty());

    let s = c.solve(&drives(&c, &[("D13", Drive::Low)])).unwrap();
    assert!(!s.leds[0].on);
    assert_eq!(s.leds[0].current_a, 0.0);
    // Выход LOW: узел D13 на 0 В, ток не течёт.
    assert_eq!(pin(&s, "D13").voltage, Some(0.0));
}

#[test]
fn led_without_resistor_overcurrents_gpio() {
    let mut c = Circuit::build(
        &Library::builtin(),
        &spec(
            &[&["uno1.D13", "led1.A"], &["led1.K", "uno1.GND2"]],
            &[("led1", "led", json!({}))],
        ),
    )
    .unwrap();
    let s = c.solve(&drives(&c, &[("D13", Drive::High)])).unwrap();
    let expected = (5.0 - 2.0) / (R_OUT_HIGH_OHMS + LED_SERIES_OHMS);
    assert!((s.leds[0].current_a - expected).abs() < 1e-9);
    assert_eq!(s.leds[0].brightness, 1.0);
    let oc = &s.overcurrent[0];
    assert_eq!(oc.pins, ["D13"]);
    assert_eq!(oc.direction, Direction::Source);
    assert!(!oc.group && oc.limit_a == 0.020);
}

#[test]
fn reversed_led_stays_off() {
    let mut c = Circuit::build(
        &Library::builtin(),
        &spec(
            &[
                &["uno1.D13", "r1.1"],
                &["r1.2", "led1.K"],
                &["led1.A", "uno1.GND1"],
            ],
            &[
                ("r1", "resistor", json!({"resistanceOhms": 220})),
                ("led1", "led", json!({})),
            ],
        ),
    )
    .unwrap();
    let s = c.solve(&drives(&c, &[("D13", Drive::High)])).unwrap();
    assert!(!s.leds[0].on);
    assert!(pin(&s, "D13").current_a.abs() < 1e-12);
}

#[test]
fn button_with_input_pullup() {
    let mut c = Circuit::build(
        &Library::builtin(),
        &spec(
            &[&["uno1.D2", "btn1.A"], &["btn1.B", "uno1.GND1"]],
            &[("btn1", "push-button", json!({}))],
        ),
    )
    .unwrap();
    let d = drives(&c, &[("D2", Drive::InputPullup)]);
    let s = c.solve(&d).unwrap();
    assert_eq!(pin(&s, "D2").level, InputLevel::High);
    assert!(pin(&s, "D2").connected);
    assert_eq!(c.set_switch("btn1", true), Some(true));
    let s = c.solve(&d).unwrap();
    assert_eq!(pin(&s, "D2").level, InputLevel::Low);
    // Ток через pull-up: 5 V / 35 kΩ, втекает в вывод со стороны источника pull-up.
    assert!((pin(&s, "D2").current_a - 5.0 / PULLUP_OHMS).abs() < 1e-12);
    // Без pull-up отпущенная кнопка оставляет вход плавающим.
    c.set_switch("btn1", false);
    let s = c.solve(&drives(&c, &[("D2", Drive::Input)])).unwrap();
    assert_eq!(pin(&s, "D2").level, InputLevel::Floating);
    // Неподключённый вывод плавает, но не считается подключённым.
    assert!(!pin(&s, "D7").connected);
    assert_eq!(pin(&s, "D7").level, InputLevel::Floating);
    // A4 связан с SDA внутри платы — это не внешнее подключение.
    assert!(!pin(&s, "A4").connected);
}

#[test]
fn resistor_divider_on_a0() {
    let mut c = Circuit::build(
        &Library::builtin(),
        &spec(
            &[
                &["uno1.5V", "r1.1"],
                &["r1.2", "r2.1", "uno1.A0"],
                &["r2.2", "uno1.GND3"],
            ],
            &[
                ("r1", "resistor", json!({"resistanceOhms": 10000})),
                ("r2", "resistor", json!({"resistanceOhms": 10000})),
            ],
        ),
    )
    .unwrap();
    let s = c.solve(&drives(&c, &[])).unwrap();
    assert!((pin(&s, "A0").voltage.unwrap() - 2.5).abs() < 1e-9);
    assert_eq!(pin(&s, "A0").level, InputLevel::Undefined);
    assert_eq!(s.aref, None);
}

#[test]
fn pwm_led_brightness_is_duty_weighted() {
    let mut c = external_led();
    let full = c.solve(&drives(&c, &[("D13", Drive::High)])).unwrap().leds[0].clone();
    let s = c
        .solve(&drives(&c, &[("D13", Drive::Pwm { duty: 0.25 })]))
        .unwrap();
    assert!((s.leds[0].brightness - 0.25 * full.brightness).abs() < 1e-12);
    // Пиковый ток вывода — ток фазы HIGH.
    assert!((pin(&s, "D13").current_a - full.current_a).abs() < 1e-12);
}

#[test]
fn shorted_rails_are_reported() {
    let mut c = Circuit::build(
        &Library::builtin(),
        &spec(&[&["uno1.5V", "uno1.GND1"]], &[]),
    )
    .unwrap();
    let e = c.solve(&drives(&c, &[])).unwrap_err();
    assert_eq!(e.code(), "CIRCUIT_SHORT");
}

#[test]
fn output_shorted_to_ground_overcurrents_and_group_limits() {
    // Шесть выводов порта B в HIGH напрямую на GND: каждый 125 mA > 20 mA, группа source > 150 mA.
    let pins = ["D8", "D9", "D10", "D11", "D12", "D13"];
    let mut members: Vec<String> = pins.iter().map(|p| format!("uno1.{p}")).collect();
    members.push("uno1.GND1".into());
    let refs: Vec<&str> = members.iter().map(String::as_str).collect();
    let mut c = Circuit::build(&Library::builtin(), &spec(&[&refs], &[])).unwrap();
    let set: Vec<(&str, Drive)> = pins.iter().map(|p| (*p, Drive::High)).collect();
    let s = c.solve(&drives(&c, &set)).unwrap();
    assert_eq!(s.overcurrent.iter().filter(|o| !o.group).count(), 6);
    let g = s.overcurrent.iter().find(|o| o.group).unwrap();
    assert_eq!(g.direction, Direction::Source);
    assert!((g.current_a - 6.0 * 5.0 / R_OUT_HIGH_OHMS).abs() < 1e-9);
}

#[test]
fn series_and_parallel_leds_converge() {
    // D13 → 100 Ω → две последовательные LED (2 V + 2 V) и параллельно — одна LED к GND.
    let mut c = Circuit::build(
        &Library::builtin(),
        &spec(
            &[
                &["uno1.D13", "r1.1"],
                &["r1.2", "l1.A", "l3.A"],
                &["l1.K", "l2.A"],
                &["l2.K", "l3.K", "uno1.GND1"],
            ],
            &[
                ("r1", "resistor", json!({"resistanceOhms": 100})),
                ("l1", "led", json!({})),
                ("l2", "led", json!({})),
                ("l3", "led", json!({})),
            ],
        ),
    )
    .unwrap();
    let s = c.solve(&drives(&c, &[("D13", Drive::High)])).unwrap();
    // Узел ~2 V: цепочка 4 V закрыта, одиночная LED открыта.
    let on: Vec<bool> = s.leds.iter().map(|l| l.on).collect();
    assert_eq!(on, [false, false, true]);
}

#[test]
fn rejects_unknown_pins_and_duplicates() {
    let lib = Library::builtin();
    assert!(Circuit::build(&lib, &spec(&[&["uno1.D99"]], &[])).is_err());
    assert!(Circuit::build(&lib, &spec(&[&["x.1"]], &[])).is_err());
    let dup = spec(
        &[],
        &[("r1", "resistor", json!({})), ("r1", "resistor", json!({}))],
    );
    assert!(Circuit::build(&lib, &dup).is_err());
    let bad = spec(&[], &[("r1", "resistor", json!({"resistanceOhms": -5}))]);
    assert!(Circuit::build(&lib, &bad).is_err());
    let c = Circuit::build(&lib, &spec(&[], &[("u1", "hc-sr04", json!({}))])).unwrap();
    assert_eq!(c.unsupported(), ["u1"]);
    let rgb = spec(
        &[],
        &[("rgb1", "rgb-led", json!({"commonType": "common-both"}))],
    );
    assert!(Circuit::build(&lib, &rgb).is_err());
    let servo = spec(
        &[],
        &[(
            "s1",
            "servo",
            json!({"minPulseUs": 2000, "maxPulseUs": 1000}),
        )],
    );
    assert!(Circuit::build(&lib, &servo).is_err());
}

fn pot_divider(position_percent: f64) -> Circuit {
    Circuit::build(
        &Library::builtin(),
        &spec(
            &[
                &["uno1.GND1", "p1.1"],
                &["uno1.5V", "p1.2"],
                &["uno1.A0", "p1.W"],
            ],
            &[(
                "p1",
                "potentiometer",
                json!({"resistanceOhms": 10000, "positionPercent": position_percent}),
            )],
        ),
    )
    .unwrap()
}

/// Потенциометр 10 kΩ между GND и 5V: напряжение движка = 5 · p (с поправкой на 1 Ω у концов).
#[test]
fn potentiometer_divides_supply_by_position() {
    for (p, expect) in [
        (0.0, 5.0 * 1.0 / 10001.0),
        (50.0, 2.5),
        (100.0, 5.0 * 10000.0 / 10001.0),
    ] {
        let mut c = pot_divider(p);
        let s = c.solve(&drives(&c, &[])).unwrap();
        let v = pin(&s, "A0").voltage.unwrap();
        assert!((v - expect).abs() < 1e-9, "p={p}: {v}");
    }
    let mut c = pot_divider(0.0);
    assert_eq!(c.set_position("p1", 0.25), Some(true));
    assert_eq!(c.set_position("p1", 0.25), Some(false));
    assert_eq!(c.set_position("nope", 0.25), None);
    let s = c.solve(&drives(&c, &[])).unwrap();
    assert!((pin(&s, "A0").voltage.unwrap() - 1.25).abs() < 1e-9);
}

/// Фоторезистор в делителе с 10 kΩ к 5V: R = R10 · (E/10)^−γ.
#[test]
fn photoresistor_follows_power_law() {
    assert!((ldr_resistance(10_000.0, 0.7, 10.0) - 10_000.0).abs() < 1e-9);
    assert!((ldr_resistance(10_000.0, 0.7, 100.0) - 10_000.0 * 10f64.powf(-0.7)).abs() < 1e-6);
    let mut c = Circuit::build(
        &Library::builtin(),
        &spec(
            &[
                &["uno1.5V", "r1.1"],
                &["r1.2", "ldr1.1", "uno1.A1"],
                &["ldr1.2", "uno1.GND1"],
            ],
            &[
                ("r1", "resistor", json!({"resistanceOhms": 10000})),
                ("ldr1", "photoresistor", json!({"illuminanceLux": 10})),
            ],
        ),
    )
    .unwrap();
    let s = c.solve(&drives(&c, &[])).unwrap();
    assert!((pin(&s, "A1").voltage.unwrap() - 2.5).abs() < 1e-9);
    let (changed, r) = c.set_illuminance("ldr1", 1000.0).unwrap();
    assert!(changed);
    let s = c.solve(&drives(&c, &[])).unwrap();
    let expect = 5.0 * r / (r + 10_000.0);
    assert!((pin(&s, "A1").voltage.unwrap() - expect).abs() < 1e-9);
}

/// RGB-светодиод с общим катодом и общим анодом: каналы — отдельные светодиоды.
#[test]
fn rgb_led_channels_follow_polarity() {
    let build = |kind: &str, com: &str| {
        Circuit::build(
            &Library::builtin(),
            &spec(
                &[
                    &["uno1.D9", "r1.1"],
                    &["r1.2", "rgb1.R"],
                    &["uno1.D10", "r2.1"],
                    &["r2.2", "rgb1.G"],
                    &["rgb1.COM", com],
                ],
                &[
                    ("r1", "resistor", json!({"resistanceOhms": 220})),
                    ("r2", "resistor", json!({"resistanceOhms": 220})),
                    ("rgb1", "rgb-led", json!({"commonType": kind})),
                ],
            ),
        )
        .unwrap()
    };
    let mut cc = build("common-cathode", "uno1.GND1");
    let s = cc
        .solve(&drives(&cc, &[("D9", Drive::High), ("D10", Drive::Low)]))
        .unwrap();
    let on: Vec<(Option<&str>, bool)> = s
        .leds
        .iter()
        .map(|l| (l.channel.as_deref(), l.on))
        .collect();
    assert_eq!(
        on,
        [(Some("r"), true), (Some("g"), false), (Some("b"), false)]
    );
    let mut ca = build("common-anode", "uno1.5V");
    let s = ca
        .solve(&drives(&ca, &[("D9", Drive::High), ("D10", Drive::Low)]))
        .unwrap();
    let on: Vec<bool> = s.leds.iter().map(|l| l.on).collect();
    assert_eq!(on, [false, true, false]);
    // (5 − 3) / (220 + 45 + 1) — выход LOW принимает ток зелёного канала.
    assert!((s.leds[1].current_a - 2.0 / 266.0).abs() < 1e-9);
}

/// Пьезоизлучатель и сервопривод не нагружают схему, решатель сообщает напряжения их выводов.
#[test]
fn monitors_report_pin_voltages() {
    let mut c = Circuit::build(
        &Library::builtin(),
        &spec(
            &[
                &["uno1.D8", "bz1.P"],
                &["bz1.N", "uno1.GND1", "s1.GND"],
                &["uno1.5V", "s1.VCC"],
                &["uno1.D9", "s1.SIG"],
            ],
            &[
                ("bz1", "piezo-buzzer", json!({})),
                ("s1", "servo", json!({})),
            ],
        ),
    )
    .unwrap();
    assert_eq!(c.monitors().len(), 2);
    let s = c
        .solve(&drives(&c, &[("D8", Drive::High), ("D9", Drive::Low)]))
        .unwrap();
    assert_eq!(s.probes[0], [Some(5.0), Some(0.0)]);
    assert_eq!(s.probes[1], [Some(0.0), Some(5.0), Some(0.0)]);
    assert!(pin(&s, "D8").current_a.abs() < 1e-12);
}
