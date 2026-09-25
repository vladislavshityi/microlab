//! Протокол worker: JSON-строки в stdin → события и ответы в stdout.

use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Write};
use std::process::{Command, Stdio};

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
        stdin.write_all(b"not json\n").unwrap();
    }
    drop(child.stdin.take());
    let out: Vec<Value> = BufReader::new(child.stdout.take().unwrap())
        .lines()
        .map(|l| serde_json::from_str(&l.unwrap()).unwrap())
        .collect();
    assert!(child.wait().unwrap().success());
    out
}

#[test]
fn blink_over_protocol() {
    let hex = std::fs::read_to_string(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../tests/fixtures/blink/blink.hex"
    ))
    .unwrap();
    let out = run_session(&[
        json!({"id": 1, "cmd": "run_for", "ms": 1}),
        json!({"id": 2, "cmd": "load_firmware", "hex": hex}),
        json!({"id": 3, "cmd": "run_for", "ms": 1500}),
        json!({"id": 4, "cmd": "set_input", "pin": "D7", "level": 1}),
        json!({"id": 5, "cmd": "get_state"}),
        json!({"id": 6, "cmd": "reset"}),
        json!({"id": 7, "cmd": "set_input", "pin": "X9", "level": 1}),
        json!({"id": 8, "cmd": "stop"}),
    ]);
    assert!(out.iter().all(|v| v["version"] == 1));
    let resp = |id: i64| {
        out.iter()
            .find(|v| v["type"] == "response" && v["id"] == id)
            .unwrap()
            .clone()
    };
    assert_eq!(resp(1)["error"]["code"], "NO_FIRMWARE");
    assert_eq!(resp(2)["ok"], true);
    assert_eq!(resp(3)["result"]["cycle"], 1500 * 16_000);
    let state = resp(5)["result"].clone();
    assert_eq!(state["pins"]["D13"]["mode"], "output-low");
    assert_eq!(state["pins"]["D7"]["value"], 1);
    assert_eq!(resp(7)["error"]["code"], "UNKNOWN_PIN");

    let d13: Vec<(u64, u64)> = out
        .iter()
        .filter(|v| v["type"] == "digital_pin_changed" && v["payload"]["pin"] == "D13")
        .map(|v| {
            (
                v["timestamp"].as_u64().unwrap(),
                v["payload"]["value"].as_u64().unwrap(),
            )
        })
        .collect();
    assert_eq!(
        d13.iter().map(|x| x.1).collect::<Vec<_>>(),
        [0, 1, 0, 0],
        "{d13:?}"
    );
    assert!(out.iter().any(|v| v["type"] == "simulation_reset"));
    assert!(out
        .iter()
        .any(|v| v["type"] == "simulation_error" && v["payload"]["severity"] == "warning"));
    // После stop worker завершается: строка «not json» не обрабатывается.
    assert_eq!(out.last().unwrap()["id"], 8);
}

#[test]
fn serial_over_protocol() {
    let hex = std::fs::read_to_string(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../tests/fixtures/serial_echo/serial_echo.hex"
    ))
    .unwrap();
    let out = run_session(&[
        json!({"cmd": "load_firmware", "hex": hex}),
        json!({"cmd": "run_for", "cycles": 160_000}),
        json!({"cmd": "serial_input", "data": "hi"}),
        json!({"cmd": "run_for", "ms": 10}),
        json!({"cmd": "load_firmware", "hex": ":00000001FF"}),
    ]);
    let bytes: Vec<u64> = out
        .iter()
        .filter(|v| v["type"] == "serial_output")
        .map(|v| v["payload"]["byte"].as_u64().unwrap())
        .collect();
    assert_eq!(bytes, [b'h' as u64, b'i' as u64]);
    assert!(out.iter().any(|v| v["error"]["code"] == "INVALID_FIRMWARE"));
    assert_eq!(out.last().unwrap()["error"]["code"], "INVALID_JSON");
}
