//! Генерирует таблицу выводов платы из общего определения компонента
//! `packages/circuit-schema/definitions/arduino-uno-r3.json`.
//! Mapping не дублируется в коде эмулятора: при изменении JSON таблица пересобирается,
//! а несогласованное определение останавливает сборку.

use std::collections::HashSet;
use std::env;
use std::fmt::Write as _;
use std::fs;
use std::path::PathBuf;

fn main() {
    let manifest = PathBuf::from(env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR"));
    let path = env::var("MICROLAB_BOARD_DEFINITION")
        .map(PathBuf::from)
        .unwrap_or_else(|_| {
            manifest.join("../../packages/circuit-schema/definitions/arduino-uno-r3.json")
        });
    println!("cargo:rerun-if-changed={}", path.display());
    println!("cargo:rerun-if-env-changed=MICROLAB_BOARD_DEFINITION");

    let text = fs::read_to_string(&path)
        .unwrap_or_else(|e| panic!("не удалось прочитать {}: {e}", path.display()));
    let json: serde_json::Value = serde_json::from_str(&text).expect("некорректный JSON платы");

    assert_eq!(
        json["type"], "arduino-uno-r3",
        "ожидалось определение arduino-uno-r3"
    );
    assert_eq!(
        json["board"]["mcu"], "ATmega328P",
        "поддерживается только ATmega328P"
    );
    let clock_hz = json["board"]["clockHz"].as_u64().expect("board.clockHz");

    let mut out = String::new();
    writeln!(
        out,
        "// Сгенерировано build.rs из arduino-uno-r3.json. Не редактировать."
    )
    .unwrap();
    writeln!(out, "/// Тактовая частота MCU платы, Гц.").unwrap();
    writeln!(out, "pub const CLOCK_HZ: u64 = {clock_hz};").unwrap();
    writeln!(out, "/// Выводы платы, подключённые к GPIO MCU.").unwrap();
    writeln!(out, "pub const BOARD_PINS: &[BoardPin] = &[").unwrap();

    let mut seen_names = HashSet::new();
    let mut seen_mcu = HashSet::new();
    let mut seen_arduino = HashSet::new();
    let pins = json["pins"].as_array().expect("pins");
    for pin in pins {
        // Только выводы с Arduino-номером — это GPIO, доступные скетчу (RESET/PC6 исключён).
        let Some(arduino) = pin["arduinoPin"].as_u64() else {
            continue;
        };
        let id = pin["id"].as_str().expect("pin.id");
        let mcu = pin["mcuPin"]
            .as_str()
            .unwrap_or_else(|| panic!("{id}: нет mcuPin"));
        let bytes = mcu.as_bytes();
        assert!(
            bytes.len() == 3
                && bytes[0] == b'P'
                && matches!(bytes[1], b'B' | b'C' | b'D')
                && (b'0'..=b'7').contains(&bytes[2]),
            "{id}: неподдерживаемый mcuPin {mcu}"
        );
        let port = match bytes[1] {
            b'B' => "Port::B",
            b'C' => "Port::C",
            _ => "Port::D",
        };
        let bit = bytes[2] - b'0';
        assert!(seen_names.insert(id.to_string()), "повтор вывода {id}");
        assert!(seen_mcu.insert(mcu.to_string()), "повтор mcuPin {mcu}");
        assert!(seen_arduino.insert(arduino), "повтор arduinoPin {arduino}");
        writeln!(
            out,
            "    BoardPin {{ name: {id:?}, arduino: {arduino}, port: {port}, bit: {bit} }},"
        )
        .unwrap();
    }
    writeln!(out, "];").unwrap();
    assert_eq!(
        seen_arduino.len(),
        20,
        "UNO R3: ожидается 20 GPIO (D0–D13, A0–A5)"
    );

    let dest = PathBuf::from(env::var("OUT_DIR").expect("OUT_DIR")).join("board_pins.rs");
    fs::write(dest, out).expect("запись board_pins.rs");
}
