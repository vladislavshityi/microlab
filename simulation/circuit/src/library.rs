//! Определения компонентов из общего пакета схем (`packages/circuit-schema/definitions`).
//! Выводы, внутренние соединения, электрические модели, значения свойств по умолчанию и
//! электрические пределы платы берутся оттуда, а не дублируются в коде решателя.

use serde_json::Value;
use std::collections::BTreeMap;

const BOARD_JSON: &str =
    include_str!("../../../packages/circuit-schema/definitions/arduino-uno-r3.json");
const BREADBOARD_JSON: &str =
    include_str!("../../../packages/circuit-schema/definitions/breadboard.json");
const RESISTOR_JSON: &str =
    include_str!("../../../packages/circuit-schema/definitions/resistor.json");
const LED_JSON: &str = include_str!("../../../packages/circuit-schema/definitions/led.json");
const BUTTON_JSON: &str =
    include_str!("../../../packages/circuit-schema/definitions/push-button.json");
const POT_JSON: &str =
    include_str!("../../../packages/circuit-schema/definitions/potentiometer.json");
const LDR_JSON: &str =
    include_str!("../../../packages/circuit-schema/definitions/photoresistor.json");
const RGB_JSON: &str = include_str!("../../../packages/circuit-schema/definitions/rgb-led.json");
const SEVEN_SEG_JSON: &str =
    include_str!("../../../packages/circuit-schema/definitions/seven-segment.json");
const PIEZO_JSON: &str =
    include_str!("../../../packages/circuit-schema/definitions/piezo-buzzer.json");
const SERVO_JSON: &str = include_str!("../../../packages/circuit-schema/definitions/servo.json");

/// Электрическая модель типа компонента.
#[derive(Debug, Clone, PartialEq)]
pub enum Model {
    /// Плата: выводы MCU, шины питания, земля.
    Board,
    /// Только связность (макетная плата): внутренние соединения, без элементов.
    Connectivity,
    Resistor {
        terminals: [String; 2],
        property: String,
    },
    Led {
        anode: String,
        cathode: String,
        property: String,
    },
    /// Идеальный переключатель (кнопка).
    Switch { terminals: [String; 2] },
    /// Потенциометр: два резистора, сопротивление делится положением движка.
    Potentiometer {
        terminals: [String; 2],
        wiper: String,
        resistance: String,
        position: String,
    },
    /// Фоторезистор: сопротивление по степенной модели от освещённости.
    Photoresistor {
        terminals: [String; 2],
        illuminance: String,
        r10: String,
        gamma: String,
    },
    /// Несколько светодиодов с общим выводом (RGB-светодиод, 7-сегментный индикатор).
    LedArray {
        common: String,
        /// Enum-свойство полярности: `common-cathode` или `common-anode`.
        polarity: String,
        /// (id канала, вывод, свойство прямого напряжения).
        channels: Vec<(String, String, String)>,
    },
    /// Пассивный пьезоизлучатель: без пути постоянного тока, наблюдается напряжение на выводах.
    Piezo { positive: String, negative: String },
    /// Сервопривод: наблюдаются сигнал и питание, нагрузки на схему нет.
    Servo {
        signal: String,
        power: String,
        ground: String,
        min_pulse: String,
        max_pulse: String,
        min_supply: String,
    },
}

#[derive(Debug, Clone)]
pub struct PinDef {
    pub id: String,
    pub electrical_type: String,
    pub voltage_domain: Option<String>,
    /// Вывод GPIO MCU (есть Arduino-номер).
    pub gpio: bool,
    pub mcu_pin: Option<String>,
}

#[derive(Debug, Clone)]
pub struct TypeDef {
    pub type_name: String,
    pub pins: Vec<PinDef>,
    pub internal: Vec<Vec<String>>,
    pub model: Model,
    /// Числовые свойства по умолчанию.
    pub defaults: BTreeMap<String, f64>,
    /// Значения enum-свойств по умолчанию.
    pub enum_defaults: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Direction {
    /// Ток втекает в вывод (IOL).
    Sink,
    /// Ток вытекает из вывода (IOH).
    Source,
}

impl Direction {
    pub fn as_str(self) -> &'static str {
        match self {
            Direction::Sink => "sink",
            Direction::Source => "source",
        }
    }
}

#[derive(Debug, Clone)]
pub struct GroupLimit {
    pub direction: Direction,
    /// Имена выводов платы (D0…A5), входящих в группу.
    pub pins: Vec<String>,
    pub max_a: f64,
}

/// Электрические характеристики платы из её определения.
#[derive(Debug, Clone)]
pub struct BoardLimits {
    /// Напряжение I/O платы (и шины 5V), В.
    pub io_voltage: f64,
    /// Рабочий предел тока на вывод GPIO, А.
    pub pin_limit_a: f64,
    pub groups: Vec<GroupLimit>,
}

#[derive(Debug, Clone)]
pub struct Library {
    pub types: BTreeMap<String, TypeDef>,
    pub board_type: String,
    pub limits: BoardLimits,
}

fn parse_type(text: &str) -> (TypeDef, Value) {
    let json: Value = serde_json::from_str(text).expect("определение компонента — корректный JSON");
    let type_name = json["type"].as_str().expect("type").to_string();
    let pins = json["pins"]
        .as_array()
        .expect("pins")
        .iter()
        .map(|p| PinDef {
            id: p["id"].as_str().expect("pin.id").to_string(),
            electrical_type: p["electricalType"]
                .as_str()
                .unwrap_or("passive")
                .to_string(),
            voltage_domain: p["voltageDomain"].as_str().map(str::to_string),
            gpio: p["arduinoPin"].is_u64(),
            mcu_pin: p["mcuPin"].as_str().map(str::to_string),
        })
        .collect();
    let internal = json["internalConnections"]
        .as_array()
        .map(|groups| {
            groups
                .iter()
                .map(|g| {
                    g.as_array()
                        .expect("internalConnections group")
                        .iter()
                        .map(|p| p.as_str().expect("pin id").to_string())
                        .collect()
                })
                .collect()
        })
        .unwrap_or_default();
    let mut defaults = BTreeMap::new();
    let mut enum_defaults = BTreeMap::new();
    if let Some(props) = json["properties"].as_array() {
        for p in props {
            let Some(id) = p["id"].as_str() else { continue };
            if let Some(d) = p["default"].as_f64() {
                defaults.insert(id.to_string(), d);
            } else if let Some(d) = p["default"].as_str() {
                enum_defaults.insert(id.to_string(), d.to_string());
            }
        }
    }
    let em = &json["electricalModel"];
    let s = |v: &Value| v.as_str().expect("electricalModel field").to_string();
    let model = if json["board"].is_object() {
        Model::Board
    } else {
        match em["kind"].as_str() {
            Some("resistor") => Model::Resistor {
                terminals: [s(&em["terminals"][0]), s(&em["terminals"][1])],
                property: s(&em["resistanceProperty"]),
            },
            Some("led") => Model::Led {
                anode: s(&em["anode"]),
                cathode: s(&em["cathode"]),
                property: s(&em["forwardVoltageProperty"]),
            },
            Some("switch") => Model::Switch {
                terminals: [s(&em["terminals"][0]), s(&em["terminals"][1])],
            },
            Some("potentiometer") => Model::Potentiometer {
                terminals: [s(&em["terminals"][0]), s(&em["terminals"][1])],
                wiper: s(&em["wiper"]),
                resistance: s(&em["resistanceProperty"]),
                position: s(&em["positionProperty"]),
            },
            Some("photoresistor") => Model::Photoresistor {
                terminals: [s(&em["terminals"][0]), s(&em["terminals"][1])],
                illuminance: s(&em["illuminanceProperty"]),
                r10: s(&em["resistanceAt10LuxProperty"]),
                gamma: s(&em["gammaProperty"]),
            },
            Some("led-array") => Model::LedArray {
                common: s(&em["common"]),
                polarity: s(&em["polarityProperty"]),
                channels: em["channels"]
                    .as_array()
                    .expect("channels")
                    .iter()
                    .map(|c| (s(&c["id"]), s(&c["pin"]), s(&c["forwardVoltageProperty"])))
                    .collect(),
            },
            Some("piezo") => Model::Piezo {
                positive: s(&em["positive"]),
                negative: s(&em["negative"]),
            },
            Some("servo") => Model::Servo {
                signal: s(&em["signal"]),
                power: s(&em["power"]),
                ground: s(&em["ground"]),
                min_pulse: s(&em["minPulseProperty"]),
                max_pulse: s(&em["maxPulseProperty"]),
                min_supply: s(&em["minSupplyProperty"]),
            },
            _ => Model::Connectivity,
        }
    };
    (
        TypeDef {
            type_name,
            pins,
            internal,
            model,
            defaults,
            enum_defaults,
        },
        json,
    )
}

impl Library {
    /// Библиотека из встроенных определений.
    pub fn builtin() -> Library {
        let mut types = BTreeMap::new();
        let (board, board_json) = parse_type(BOARD_JSON);
        let limits_json = &board_json["board"]["electricalLimits"];
        let mcu_to_name: BTreeMap<String, String> = board
            .pins
            .iter()
            .filter(|p| p.gpio)
            .filter_map(|p| p.mcu_pin.clone().map(|m| (m, p.id.clone())))
            .collect();
        let groups = limits_json["gpioGroupCurrentLimits"]
            .as_array()
            .map(|a| {
                a.iter()
                    .map(|g| GroupLimit {
                        direction: if g["direction"] == "sink" {
                            Direction::Sink
                        } else {
                            Direction::Source
                        },
                        pins: g["mcuPins"]
                            .as_array()
                            .expect("mcuPins")
                            .iter()
                            .filter_map(|m| m.as_str().and_then(|m| mcu_to_name.get(m)).cloned())
                            .collect(),
                        max_a: g["maxMa"].as_f64().expect("maxMa") / 1000.0,
                    })
                    .collect()
            })
            .unwrap_or_default();
        let limits = BoardLimits {
            io_voltage: limits_json["ioVoltage"].as_f64().expect("ioVoltage"),
            pin_limit_a: limits_json["gpioPinCurrentMa"]
                .as_f64()
                .expect("gpioPinCurrentMa")
                / 1000.0,
            groups,
        };
        let board_type = board.type_name.clone();
        types.insert(board.type_name.clone(), board);
        for text in [
            BREADBOARD_JSON,
            RESISTOR_JSON,
            LED_JSON,
            BUTTON_JSON,
            POT_JSON,
            LDR_JSON,
            RGB_JSON,
            SEVEN_SEG_JSON,
            PIEZO_JSON,
            SERVO_JSON,
        ] {
            let (t, _) = parse_type(text);
            types.insert(t.type_name.clone(), t);
        }
        Library {
            types,
            board_type,
            limits,
        }
    }

    pub fn board(&self) -> &TypeDef {
        &self.types[&self.board_type]
    }
}
