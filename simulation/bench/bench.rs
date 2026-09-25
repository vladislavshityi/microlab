//! Бенчмарк: скорость симуляции (симулированные МГц) на эталонных прошивках.
//! Запуск: `cargo run --release -p avr-core --example bench [секунды_симуляции]`.

use avr_core::{parse_hex, Mcu, CLOCK_HZ};
use std::time::Instant;

const FIXTURES: &[(&str, &str)] = &[
    ("blink", include_str!("../tests/fixtures/blink/blink.hex")),
    (
        "serial_hello",
        include_str!("../tests/fixtures/serial_hello/serial_hello.hex"),
    ),
    (
        "millis",
        include_str!("../tests/fixtures/millis/millis.hex"),
    ),
    (
        "pwm_led",
        include_str!("../tests/fixtures/pwm_led/pwm_led.hex"),
    ),
];

fn main() {
    let seconds: u64 = std::env::args()
        .nth(1)
        .and_then(|s| s.parse().ok())
        .unwrap_or(10);
    for (name, hex) in FIXTURES {
        let image = parse_hex(hex).expect("valid HEX");
        let mut mcu = Mcu::new();
        mcu.load_firmware(&image);
        let target = seconds * CLOCK_HZ;
        let t0 = Instant::now();
        let mut events = 0usize;
        // Как worker: прогон срезами по 10 мс симулированного времени с выборкой событий.
        while mcu.cycles() < target && !mcu.halted() {
            mcu.run_for(CLOCK_HZ / 100);
            events += mcu.drain_events().len();
        }
        let wall = t0.elapsed().as_secs_f64();
        let mhz = mcu.cycles() as f64 / wall / 1e6;
        println!(
            "{name:>13}: {seconds} s simulated in {wall:.3} s wall -> {mhz:.1} MHz ({:.1}x real time), {events} events",
            mhz * 1e6 / CLOCK_HZ as f64
        );
    }
}
