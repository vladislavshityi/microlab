//! Conformance-тесты Arduino UNO R3: реальные HEX, собранные воркером компиляции
//! (arduino-cli 1.5.1, arduino:avr 1.8.8, FQBN arduino:avr:uno). Исходники лежат рядом с HEX
//! в `simulation/tests/fixtures/<имя>/`.
//!
//! Каждый тест описывает: входную схему (внешние уровни на выводах / байты Serial),
//! исходный скетч, ожидаемые события и конечное состояние.

use avr_core::{parse_hex, Event, EventKind, Mcu, PinMode, CYCLES_PER_MS};

fn load(name: &str) -> Mcu {
    let path = format!(
        "{}/../tests/fixtures/{name}/{name}.hex",
        env!("CARGO_MANIFEST_DIR")
    );
    let text = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{path}: {e}"));
    let mut mcu = Mcu::new();
    mcu.load_firmware(&parse_hex(&text).expect("valid HEX"));
    mcu
}

fn ms(v: u64) -> u64 {
    v * CYCLES_PER_MS
}

fn pin_changes(events: &[Event], name: &str) -> Vec<(u64, PinMode, bool)> {
    events
        .iter()
        .filter_map(|e| match &e.kind {
            EventKind::DigitalPinChanged { pin, mode, value } if *pin == name => {
                Some((e.cycle, *mode, *value))
            }
            _ => None,
        })
        .collect()
}

fn serial(events: &[Event]) -> Vec<(u64, u8)> {
    events
        .iter()
        .filter_map(|e| match e.kind {
            EventKind::SerialOutput { byte } => Some((e.cycle, byte)),
            _ => None,
        })
        .collect()
}

/// Строки Serial с тактом окончания первого байта строки.
fn serial_lines(events: &[Event]) -> Vec<(u64, String)> {
    let mut lines = Vec::new();
    let mut cur = String::new();
    let mut start = None;
    for (t, b) in serial(events) {
        if start.is_none() {
            start = Some(t);
        }
        match b {
            b'\n' => {
                lines.push((
                    start.take().unwrap(),
                    cur.trim_end_matches('\r').to_string(),
                ));
                cur.clear();
            }
            _ => cur.push(b as char),
        }
    }
    lines
}

fn errors(events: &[Event]) -> Vec<&Event> {
    events
        .iter()
        .filter(|e| {
            matches!(
                e.kind,
                EventKind::SimulationError {
                    severity: avr_core::Severity::Error,
                    ..
                }
            )
        })
        .collect()
}

/// Blink (D13, delay(1000)).
///
/// Допуск интервала между переключениями: ±50 µs. Обоснование: Timer0 в fast PWM с делителем 64
/// переполняется каждые 64·256 = 16384 такта (1024 µs; core 1.8.8 `wiring.c`, `MICROSECONDS_PER_TIMER0_OVERFLOW`); `delay()` опрашивает `micros()`
/// с разрешением 4 µs (`wiring.c`, `micros()`) и накапливает старт по 1000 µs без дрейфа (`wiring.c`, `delay()`),
/// поэтому ошибка — одна итерация опроса плюс вызов `digitalWrite()` (единицы µs).
/// Погрешность керамического резонатора платы не моделируется.
#[test]
fn blink_toggles_d13_every_second() {
    let mut mcu = load("blink");
    mcu.run_for(ms(5_100));
    let events = mcu.drain_events();
    assert!(errors(&events).is_empty(), "{events:?}");

    let d13 = pin_changes(&events, "D13");
    // pinMode(OUTPUT) → LOW, затем HIGH и 5 переключений за 5,1 с.
    assert_eq!(d13[0].1, PinMode::OutputLow);
    let toggles: Vec<_> = d13[1..].to_vec();
    assert_eq!(toggles.len(), 6, "{d13:?}");
    assert!(
        toggles[0].0 < ms(1),
        "первое HIGH в течение 1 мс после reset"
    );
    for (i, w) in toggles.windows(2).enumerate() {
        assert_ne!(w[0].2, w[1].2, "уровень должен чередоваться");
        let dt = w[1].0 - w[0].0;
        let err = dt.abs_diff(ms(1000));
        assert!(
            err <= 50 * CYCLES_PER_MS / 1000,
            "интервал {i}: {dt} тактов"
        );
    }
    assert_eq!(
        toggles.iter().map(|t| t.2).collect::<Vec<_>>(),
        [true, false, true, false, true, false]
    );
    // Последнее переключение на 5000 мс — LOW.
    assert_eq!(mcu.pin_state("D13").unwrap().mode, PinMode::OutputLow);
}

/// Serial.println("Hello") на 9600 бод.
///
/// core 1.8.8: U2X0 = 1, UBRR0 = (16e6/4/9600 − 1)/2 = 207 (`HardwareSerial.cpp`, `begin()`; datasheet Table 19-12, стр. 165).
/// Такт бита = 8·(207+1) = 1664 (Table 19-1, стр. 146), кадр 8N1 = 10 бит = 16640 тактов.
/// Байты уходят подряд из буфера TX, поэтому интервал между концами кадров — ровно один кадр.
#[test]
fn serial_println_hello_at_9600_baud() {
    let mut mcu = load("serial_hello");
    mcu.run_for(ms(50));
    let events = mcu.drain_events();
    let out = serial(&events);
    let bytes: Vec<u8> = out.iter().map(|x| x.1).collect();
    assert_eq!(bytes, b"Hello\r\n");
    for w in out.windows(2) {
        assert_eq!(w[1].0 - w[0].0, 16_640);
    }
    assert!(out[0].0 < ms(2));
    assert_eq!(
        mcu.pin_state("D1").unwrap().mode,
        PinMode::OutputHigh,
        "TXD управляется USART"
    );
}

/// millis(): монотонность и соответствие времени симуляции.
///
/// Допуск 2,5 мс: `millis()` растёт на 1 за переполнение (1024 µs) с дробной коррекцией
/// (`wiring.c`, `FRACT_INC`/`FRACT_MAX`), поэтому отстаёт от реального времени не более чем на ~2 мс; дополнительно
/// учитывается время передачи первого байта строки на 115200 бод (1360 тактов).
#[test]
fn millis_is_monotonic_and_tracks_simulated_time() {
    let mut mcu = load("millis");
    mcu.run_for(ms(3_000));
    let events = mcu.drain_events();
    let lines = serial_lines(&events);
    assert!(lines.len() >= 11, "{lines:?}");
    let mut prev = None;
    for (t, text) in &lines {
        let value: u64 = text.parse().unwrap_or_else(|_| panic!("строка {text:?}"));
        let t_ms = *t as f64 / CYCLES_PER_MS as f64;
        assert!(
            (value as f64 - t_ms).abs() <= 2.5,
            "millis={value} при t={t_ms:.3} мс"
        );
        if let Some(p) = prev {
            assert!(value > p, "millis не монотонен: {p} → {value}");
            let d = value - p;
            // delay(250) + печать; дискретность millis() даёт ±2 мс.
            assert!((248..=253).contains(&d), "шаг {d}");
        }
        prev = Some(value);
    }
}

/// INPUT_PULLUP на D2: без внешнего источника — HIGH, при внешнем LOW (кнопка на GND) — LOW.
#[test]
fn input_pullup_reads_high_when_open_and_low_when_pressed() {
    let mut mcu = load("button_pullup");
    mcu.run_for(ms(350));
    let st = mcu.pin_state("D2").unwrap();
    assert_eq!(st.mode, PinMode::InputPullup);
    assert!(st.value && !st.floating);

    mcu.set_input("D2", Some(false)).unwrap(); // кнопка нажата
    mcu.run_for(ms(350));
    mcu.set_input("D2", None).unwrap(); // кнопка отпущена
    mcu.run_for(ms(350));
    let events = mcu.drain_events();
    let lines: Vec<String> = serial_lines(&events).into_iter().map(|l| l.1).collect();
    assert!(lines.len() >= 9, "{lines:?}");
    let t_press = ms(350);
    let t_release = ms(700);
    for (t, text) in serial_lines(&events) {
        // Строка печатается до передачи; окно 2 мс после переключения исключаем.
        let expected = if t < t_press || t > t_release + ms(2) {
            "1"
        } else if t > t_press + ms(2) && t < t_release {
            "0"
        } else {
            continue;
        };
        assert_eq!(text, expected, "t = {t}");
    }
}

/// Reset: все выводы — входы Hi-Z (datasheet стр. 4, 72–73), SP = RAMEND, PC = 0, скетч стартует заново.
#[test]
fn reset_puts_all_pins_into_input_state() {
    let mut mcu = load("blink");
    mcu.run_for(ms(10));
    assert_eq!(mcu.pin_state("D13").unwrap().mode, PinMode::OutputHigh);
    mcu.drain_events();

    mcu.reset();
    let events = mcu.drain_events();
    assert_eq!(
        pin_changes(&events, "D13"),
        vec![(mcu.cycles(), PinMode::Input, false)]
    );
    for p in avr_core::BOARD_PINS {
        let st = mcu.pin_state(p.name).unwrap();
        assert_eq!(st.mode, PinMode::Input, "{}", p.name);
        assert!(st.floating, "{}", p.name);
    }
    assert_eq!(mcu.sp(), 0x08FF);
    assert_eq!(mcu.pc_bytes(), 0);

    // После reset программа стартует заново.
    mcu.run_for(ms(1));
    assert_eq!(mcu.pin_state("D13").unwrap().mode, PinMode::OutputHigh);
}

/// Serial.read()/available(): эхо входных байтов (прерывание USART RX, буфер 64 байта core).
#[test]
fn serial_echo_returns_injected_bytes() {
    let mut mcu = load("serial_echo");
    mcu.run_for(ms(10));
    assert_eq!(mcu.serial_input(b"abc"), 3);
    mcu.run_for(ms(20));
    let events = mcu.drain_events();
    let bytes: Vec<u8> = serial(&events).iter().map(|x| x.1).collect();
    assert_eq!(bytes, b"abc");
}

/// attachInterrupt(INT0, FALLING) на D2 с INPUT_PULLUP: считает спады.
#[test]
fn external_interrupt_counts_falling_edges() {
    let mut mcu = load("external_interrupt");
    mcu.run_for(ms(20));
    for _ in 0..3 {
        mcu.set_input("D2", Some(false)).unwrap();
        mcu.run_for(ms(5));
        mcu.set_input("D2", Some(true)).unwrap();
        mcu.run_for(ms(5));
    }
    mcu.run_for(ms(120));
    let events = mcu.drain_events();
    let lines = serial_lines(&events);
    assert_eq!(lines.first().map(|l| l.1.as_str()), Some("0"));
    assert_eq!(lines.last().map(|l| l.1.as_str()), Some("3"), "{lines:?}");
}

/// analogWrite(9, 128): PWM Timer1, а не постоянный HIGH.
///
/// Частота 16 MHz / (2·64·255) = 490,196 Гц (datasheet стр. 104; core: Timer1 8-bit phase correct, делитель 64). Скважность: формула datasheet не зафиксирована
/// (не проверена по datasheet), поэтому проверяется результат модели формы сигнала (сброс при
/// совпадении на подъёме, установка на спаде) с допуском ±1/255 относительно 128/255.
#[test]
fn analog_write_produces_pwm_on_d9() {
    let mut mcu = load("pwm_led");
    mcu.run_for(ms(20));
    let events = mcu.drain_events();
    let d9 = pin_changes(&events, "D9");
    assert_eq!(d9.last().unwrap().1, PinMode::Pwm);
    let pwm: Vec<_> = events
        .iter()
        .filter_map(|e| match e.kind {
            EventKind::PwmChanged {
                pin: "D9",
                high_ticks,
                period_ticks,
                frequency_hz,
            } => Some((high_ticks, period_ticks, frequency_hz)),
            _ => None,
        })
        .collect();
    assert_eq!(
        pwm.len(),
        1,
        "повторяющиеся периоды не должны порождать события: {pwm:?}"
    );
    let (high, period, f) = pwm[0];
    assert_eq!(period, 510);
    assert!((f - 490.196).abs() < 0.01, "{f}");
    let duty = high as f64 / period as f64;
    assert!((duty - 128.0 / 255.0).abs() <= 1.0 / 255.0, "{duty}");
}

/// Детерминизм: одинаковые прошивка и воздействия — одинаковые события.
#[test]
fn simulation_is_deterministic() {
    let run = || {
        let mut mcu = load("button_pullup");
        mcu.run_for(ms(120));
        mcu.set_input("D2", Some(false)).unwrap();
        mcu.run_for(ms(120));
        mcu.drain_events()
    };
    assert_eq!(run(), run());
}
