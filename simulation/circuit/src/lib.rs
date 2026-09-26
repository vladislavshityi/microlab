//! Решатель рабочей точки схемы (DC operating point) для симуляции Arduino UNO R3.
//!
//! Модель — узловой анализ (nodal analysis) линейной резистивной цепи с кусочно-линейными
//! элементами. Узел = класс эквивалентности выводов: net из netlist, внутренние соединения
//! компонентов (из их определений) и замкнутые кнопки. Решение пересчитывается по событиям
//! (смена режима вывода MCU, скважности PWM, состояния кнопки), а не на каждом такте.
//!
//! Элементы и источники значений:
//! * резистор — проводимость 1/R (свойство компонента);
//! * светодиод — кусочно-линейный диод: закрыт при V_AK < Vf (обрыв); открыт — источник Vf
//!   (свойство компонента) с последовательным сопротивлением [`LED_SERIES_OHMS`] (допущение модели);
//!   состояние подбирается итерациями до согласованности, число итераций ограничено;
//! * кнопка — идеальный переключатель (объединение узлов), как указано в её определении;
//! * потенциометр — два резистора R·p и R·(1 − p) (p — положение движка), каждый не меньше
//!   [`POT_MIN_SEGMENT_OHMS`]; фоторезистор — резистор R10·(E / 10 лк)^(−γ);
//! * RGB-светодиод и 7-сегментный индикатор — несколько светодиодов с общим выводом;
//! * пьезоизлучатель и сервопривод — без элементов в цепи: решатель только сообщает напряжения
//!   их выводов, поведение (частота, угол) вычисляется снаружи по фронтам этих напряжений;
//! * шины 5V/IOREF и GND платы — идеальные источники напряжения (допущение: ток не ограничен);
//!   3V3 — идеальный источник [`RAIL_3V3_VOLTS`];
//! * выход MCU — источник Vcc/0 V с выходным сопротивлением, выведенным из гарантированных VOH/VOL
//!   при 20 mA (см. [`R_OUT_HIGH_OHMS`], [`R_OUT_LOW_OHMS`]);
//! * INPUT — высокий импеданс (ток утечки не учитывается); INPUT_PULLUP — резистор
//!   [`PULLUP_OHMS`] к Vcc;
//! * PWM — два решения (вывод в «1» и в «0»), результаты взвешиваются скважностью: мгновенные
//!   значения внутри периода PWM не моделируются.

pub mod library;
mod linalg;

pub use library::{Direction, Library, Model};
use serde_json::Value;
use std::collections::BTreeMap;

/// Напряжение вывода 3V3 платы: номинал стабилизатора LP2985-33 и метка «+3V3» разъёма платы.
/// Допущение модели: идеальный источник без ограничения тока и без погрешности стабилизатора.
pub const RAIL_3V3_VOLTS: f64 = 3.3;

/// Гарантированное VOH ≥ 4,2 V при IOH = −20 mA, VCC = 5 V, TA = 85 °C (ATmega328P, Microchip
/// DS40002061B, Table 30-1). Строка 85 °C ближе к комнатной температуре, чем строка 105 °C (4,1 V).
pub const VOH_AT_TEST_VOLTS: f64 = 4.2;
/// Гарантированное VOL ≤ 0,9 V при IOL = 20 mA, VCC = 5 V, TA = 85 °C (там же).
pub const VOL_AT_TEST_VOLTS: f64 = 0.9;
/// Тестовый ток VOH/VOL, А.
pub const OUTPUT_TEST_CURRENT_A: f64 = 0.020;
/// VCC тестового условия VOH/VOL, В.
pub const OUTPUT_TEST_VCC_VOLTS: f64 = 5.0;
/// Выходное сопротивление в состоянии HIGH: линейная модель через точки (0 A, Vcc) и
/// (20 mA, VOH): (5 − 4,2) / 0,02 = 40 Ω. Допущение: реальная характеристика нелинейна, а VOH —
/// гарантированная граница, поэтому модель консервативна (ток нагрузки занижен).
pub const R_OUT_HIGH_OHMS: f64 =
    (OUTPUT_TEST_VCC_VOLTS - VOH_AT_TEST_VOLTS) / OUTPUT_TEST_CURRENT_A;
/// Выходное сопротивление в состоянии LOW: 0,9 / 0,02 = 45 Ω (та же линейная модель).
pub const R_OUT_LOW_OHMS: f64 = VOL_AT_TEST_VOLTS / OUTPUT_TEST_CURRENT_A;
/// Внутренний pull-up: гарантированный диапазон 20–50 kΩ (datasheet DS40002061B, Table 30-1);
/// допущение модели — середина диапазона.
pub const PULLUP_OHMS: f64 = 35_000.0;
/// VIL max = 0,3·VCC, VIH min = 0,6·VCC (там же); между ними уровень не гарантирован.
pub const VIL_FRACTION: f64 = 0.3;
pub const VIH_FRACTION: f64 = 0.6;
/// Последовательное сопротивление открытого светодиода. Допущение модели (численная
/// регуляризация, а не параметр реального светодиода): прямое напряжение считается постоянным.
pub const LED_SERIES_OHMS: f64 = 1.0;
/// Наименьшее сопротивление части потенциометра. Допущение модели (численная регуляризация):
/// движок в крайнем положении не даёт нулевого сопротивления.
pub const POT_MIN_SEGMENT_OHMS: f64 = 1.0;
/// Пределы сопротивления фоторезистора, Ом (численная защита степенной модели).
pub const LDR_MIN_OHMS: f64 = 1.0;
pub const LDR_MAX_OHMS: f64 = 1e12;

/// Сопротивления частей потенциометра (вывод 1 — движок, движок — вывод 2).
pub fn pot_segments(total: f64, position: f64) -> (f64, f64) {
    let p = position.clamp(0.0, 1.0);
    (
        (total * p).max(POT_MIN_SEGMENT_OHMS),
        (total * (1.0 - p)).max(POT_MIN_SEGMENT_OHMS),
    )
}

/// Сопротивление фоторезистора по степенной модели R = R10 · (E / 10 лк)^(−γ).
pub fn ldr_resistance(r10: f64, gamma: f64, lux: f64) -> f64 {
    (r10 * (lux.max(1e-6) / 10.0).powf(-gamma)).clamp(LDR_MIN_OHMS, LDR_MAX_OHMS)
}

/// Состояние вывода MCU для решателя.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Drive {
    High,
    Low,
    Input,
    InputPullup,
    /// PWM со скважностью 0…1.
    Pwm {
        duty: f64,
    },
}

/// Логический уровень, который увидит цифровой вход.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InputLevel {
    Low,
    High,
    /// Напряжение между VIL и VIH.
    Undefined,
    /// Узел не связан ни с одним источником потенциала.
    Floating,
}

#[derive(Debug, Clone)]
pub struct NetSpec {
    pub id: String,
    pub members: Vec<String>,
}

#[derive(Debug, Clone)]
pub struct ComponentSpec {
    pub id: String,
    pub type_name: String,
    pub properties: serde_json::Map<String, Value>,
}

#[derive(Debug, Clone)]
pub struct CircuitSpec {
    pub board_id: String,
    pub nets: Vec<NetSpec>,
    pub components: Vec<ComponentSpec>,
}

#[derive(Debug, Clone, PartialEq)]
pub enum SolveError {
    /// Идеальные источники с разным напряжением оказались в одном узле.
    Short(String),
    /// Состояния светодиодов не согласовались за отведённое число итераций.
    NotConverged,
    /// Вырожденная система уравнений.
    Singular,
}

impl SolveError {
    pub fn code(&self) -> &'static str {
        match self {
            SolveError::Short(_) => "CIRCUIT_SHORT",
            SolveError::NotConverged => "CIRCUIT_NOT_CONVERGED",
            SolveError::Singular => "CIRCUIT_SINGULAR",
        }
    }

    pub fn message(&self) -> String {
        match self {
            SolveError::Short(s) => format!("ideal supply rails are shorted: {s}"),
            SolveError::NotConverged => "LED states did not converge".into(),
            SolveError::Singular => "circuit equations are singular".into(),
        }
    }
}

#[derive(Debug, Clone)]
pub struct PinResult {
    pub name: String,
    /// Напряжение узла (для PWM — усреднённое по скважности); `None` — узел плавающий.
    pub voltage: Option<f64>,
    pub level: InputLevel,
    /// Пиковый ток вывода, А: > 0 — вытекает из вывода (source), < 0 — втекает (sink).
    pub current_a: f64,
    /// К выводу подключено что-то кроме внутренних соединений платы.
    pub connected: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub struct LedResult {
    pub id: String,
    /// Канал составного индикатора (`r`, `a`, …); `None` — одиночный светодиод.
    pub channel: Option<String>,
    pub on: bool,
    /// Средний ток от анода к катоду, А.
    pub current_a: f64,
    /// Яркость 0…1: средний ток, нормированный на рабочий предел тока вывода GPIO платы
    /// (допущение модели для визуализации, не фотометрия).
    pub brightness: f64,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Overcurrent {
    /// Один вывод или выводы группы.
    pub pins: Vec<String>,
    pub group: bool,
    pub direction: Direction,
    pub current_a: f64,
    pub limit_a: f64,
}

#[derive(Debug, Clone)]
pub struct Solution {
    pub pins: Vec<PinResult>,
    pub leds: Vec<LedResult>,
    pub switches: Vec<(String, bool)>,
    /// Напряжение на выводе AREF (`None` — не подключён к источнику).
    pub aref: Option<f64>,
    pub overcurrent: Vec<Overcurrent>,
    pub nets: Vec<(String, Option<f64>)>,
    /// Напряжения выводов наблюдаемых компонентов (в порядке [`Circuit::monitors`]).
    pub probes: Vec<Vec<Option<f64>>>,
}

/// Компонент, поведение которого вычисляется вне решателя по напряжениям его выводов.
#[derive(Debug, Clone, PartialEq)]
pub enum MonitorKind {
    /// Выводы: [+, −].
    Piezo,
    /// Выводы: [сигнал, питание, земля].
    Servo {
        min_pulse_us: f64,
        max_pulse_us: f64,
        min_supply_v: f64,
    },
}

#[derive(Debug, Clone)]
pub struct Monitor {
    pub id: String,
    pub kind: MonitorKind,
    pins: Vec<usize>,
}

#[derive(Debug, Clone)]
struct Pot {
    id: String,
    total: f64,
    position: f64,
    /// Индексы двух резисторов.
    r: [usize; 2],
}

#[derive(Debug, Clone)]
struct Ldr {
    id: String,
    r10: f64,
    gamma: f64,
    lux: f64,
    r: usize,
}

#[derive(Debug, Clone)]
struct Resistor {
    a: usize,
    b: usize,
    g: f64,
}

#[derive(Debug, Clone)]
struct Led {
    id: String,
    channel: Option<String>,
    a: usize,
    k: usize,
    vf: f64,
}

#[derive(Debug, Clone)]
struct Switch {
    id: String,
    a: usize,
    b: usize,
    closed: bool,
}

#[derive(Debug, Clone)]
struct Gpio {
    name: String,
    r: usize,
    connected: bool,
}

/// Схема, подготовленная к решению.
#[derive(Debug, Clone)]
pub struct Circuit {
    refs: Vec<String>,
    base: Vec<usize>,
    resistors: Vec<Resistor>,
    leds: Vec<Led>,
    switches: Vec<Switch>,
    pots: Vec<Pot>,
    ldrs: Vec<Ldr>,
    monitors: Vec<Monitor>,
    gpio: Vec<Gpio>,
    rails: Vec<(usize, f64, String)>,
    aref: Option<usize>,
    nets: Vec<(String, usize)>,
    limits: library::BoardLimits,
    unsupported: Vec<String>,
    /// Состояния светодиодов последнего решения по фазам (начальное приближение итераций).
    warm: [Vec<bool>; 2],
}

fn find(uf: &mut [usize], mut x: usize) -> usize {
    while uf[x] != x {
        uf[x] = uf[uf[x]];
        x = uf[x];
    }
    x
}

fn union(uf: &mut [usize], a: usize, b: usize) {
    let (ra, rb) = (find(uf, a), find(uf, b));
    if ra != rb {
        // Меньший индекс — корень: детерминированно и независимо от порядка объединений.
        let (lo, hi) = if ra < rb { (ra, rb) } else { (rb, ra) };
        uf[hi] = lo;
    }
}

fn number(props: &serde_json::Map<String, Value>, key: &str, default: Option<f64>) -> Option<f64> {
    match props.get(key) {
        Some(v) => v.as_f64(),
        None => default,
    }
}

/// Конечное числовое свойство компонента (или значение по умолчанию из определения).
fn prop(c: &ComponentSpec, t: &library::TypeDef, key: &str, positive: bool) -> Result<f64, String> {
    number(&c.properties, key, t.defaults.get(key).copied())
        .filter(|v| v.is_finite() && (!positive || *v > 0.0))
        .ok_or_else(|| {
            let what = if positive {
                "a positive number"
            } else {
                "a number"
            };
            format!("{}: {key} must be {what}", c.id)
        })
}

struct Refs {
    names: Vec<String>,
    index: BTreeMap<String, usize>,
}

impl Refs {
    fn get(&mut self, name: String) -> usize {
        if let Some(&i) = self.index.get(&name) {
            return i;
        }
        let i = self.names.len();
        self.index.insert(name.clone(), i);
        self.names.push(name);
        i
    }
}

impl Circuit {
    /// Строит схему из netlist и списка компонентов. Ошибка — строка для ответа `INVALID_ARGUMENT`.
    pub fn build(lib: &Library, spec: &CircuitSpec) -> Result<Circuit, String> {
        let board = lib.board();
        let mut refs = Refs {
            names: Vec::new(),
            index: BTreeMap::new(),
        };
        let mut comp_types: BTreeMap<&str, Option<&library::TypeDef>> = BTreeMap::new();
        comp_types.insert(spec.board_id.as_str(), Some(board));
        let mut unsupported = Vec::new();
        for c in &spec.components {
            if c.id == spec.board_id && c.type_name == board.type_name {
                continue;
            }
            if comp_types.contains_key(c.id.as_str()) {
                return Err(format!("duplicate component id {:?}", c.id));
            }
            let t = lib.types.get(&c.type_name);
            if t.is_none() || t.map(|t| t.model == Model::Board) == Some(true) {
                unsupported.push(c.id.clone());
            }
            comp_types.insert(c.id.as_str(), t.filter(|t| t.model != Model::Board));
        }
        // Все выводы известных компонентов получают свой индекс в фиксированном порядке.
        for (id, t) in &comp_types {
            if let Some(t) = t {
                for p in &t.pins {
                    refs.get(format!("{id}.{}", p.id));
                }
            }
        }
        let mut pairs: Vec<(String, String)> = Vec::new();
        for (id, t) in &comp_types {
            if let Some(t) = t {
                for group in &t.internal {
                    for w in group.windows(2) {
                        pairs.push((format!("{id}.{}", w[0]), format!("{id}.{}", w[1])));
                    }
                }
            }
        }
        let mut nets = Vec::new();
        for net in &spec.nets {
            let mut first: Option<usize> = None;
            for m in &net.members {
                let (comp, pin) = m
                    .split_once('.')
                    .ok_or_else(|| format!("net {}: invalid member {m:?}", net.id))?;
                match comp_types.get(comp) {
                    None => return Err(format!("net {}: unknown component {comp:?}", net.id)),
                    Some(Some(t)) if !t.pins.iter().any(|p| p.id == pin) => {
                        return Err(format!("net {}: unknown pin {m:?}", net.id))
                    }
                    _ => {}
                }
                let r = refs.get(m.clone());
                if let Some(f) = first {
                    pairs.push((refs.names[f].clone(), m.clone()));
                } else {
                    first = Some(r);
                }
            }
            if let Some(f) = first {
                nets.push((net.id.clone(), f));
            }
        }
        let mut base: Vec<usize> = (0..refs.names.len()).collect();
        for (a, b) in &pairs {
            let (a, b) = (refs.index[a], refs.index[b]);
            union(&mut base, a, b);
        }

        let mut resistors = Vec::new();
        let mut leds = Vec::new();
        let mut switches = Vec::new();
        let mut pots = Vec::new();
        let mut ldrs = Vec::new();
        let mut monitors = Vec::new();
        for c in &spec.components {
            let Some(Some(t)) = comp_types.get(c.id.as_str()) else {
                continue;
            };
            let pin = |p: &str| refs.index[&format!("{}.{p}", c.id)];
            match &t.model {
                Model::Resistor {
                    terminals,
                    property,
                } => {
                    let r = number(&c.properties, property, t.defaults.get(property).copied())
                        .filter(|r| r.is_finite() && *r > 0.0)
                        .ok_or_else(|| format!("{}: {property} must be a positive number", c.id))?;
                    resistors.push(Resistor {
                        a: pin(&terminals[0]),
                        b: pin(&terminals[1]),
                        g: 1.0 / r,
                    });
                }
                Model::Led {
                    anode,
                    cathode,
                    property,
                } => {
                    let vf = number(&c.properties, property, t.defaults.get(property).copied())
                        .filter(|v| v.is_finite() && *v > 0.0)
                        .ok_or_else(|| format!("{}: {property} must be a positive number", c.id))?;
                    leds.push(Led {
                        id: c.id.clone(),
                        channel: None,
                        a: pin(anode),
                        k: pin(cathode),
                        vf,
                    });
                }
                Model::Switch { terminals } => switches.push(Switch {
                    id: c.id.clone(),
                    a: pin(&terminals[0]),
                    b: pin(&terminals[1]),
                    closed: false,
                }),
                Model::Potentiometer {
                    terminals,
                    wiper,
                    resistance,
                    position,
                } => {
                    let total = prop(c, t, resistance, true)?;
                    let pos = prop(c, t, position, false)? / 100.0;
                    let (r1, r2) = pot_segments(total, pos);
                    let first = resistors.len();
                    resistors.push(Resistor {
                        a: pin(&terminals[0]),
                        b: pin(wiper),
                        g: 1.0 / r1,
                    });
                    resistors.push(Resistor {
                        a: pin(wiper),
                        b: pin(&terminals[1]),
                        g: 1.0 / r2,
                    });
                    pots.push(Pot {
                        id: c.id.clone(),
                        total,
                        position: pos.clamp(0.0, 1.0),
                        r: [first, first + 1],
                    });
                }
                Model::Photoresistor {
                    terminals,
                    illuminance,
                    r10,
                    gamma,
                } => {
                    let lux = prop(c, t, illuminance, true)?;
                    let r10 = prop(c, t, r10, true)?;
                    let gamma = prop(c, t, gamma, true)?;
                    ldrs.push(Ldr {
                        id: c.id.clone(),
                        r10,
                        gamma,
                        lux,
                        r: resistors.len(),
                    });
                    resistors.push(Resistor {
                        a: pin(&terminals[0]),
                        b: pin(&terminals[1]),
                        g: 1.0 / ldr_resistance(r10, gamma, lux),
                    });
                }
                Model::LedArray {
                    common,
                    polarity,
                    channels,
                } => {
                    let kind = match c.properties.get(polarity) {
                        Some(v) => v.as_str().map(str::to_string),
                        None => t.enum_defaults.get(polarity).cloned(),
                    };
                    let common_anode = match kind.as_deref() {
                        Some("common-cathode") => false,
                        Some("common-anode") => true,
                        _ => {
                            return Err(format!(
                                "{}: {polarity} must be common-cathode or common-anode",
                                c.id
                            ))
                        }
                    };
                    for (ch, ch_pin, vf_prop) in channels {
                        let vf = prop(c, t, vf_prop, true)?;
                        let (a, k) = if common_anode {
                            (pin(common), pin(ch_pin))
                        } else {
                            (pin(ch_pin), pin(common))
                        };
                        leds.push(Led {
                            id: c.id.clone(),
                            channel: Some(ch.clone()),
                            a,
                            k,
                            vf,
                        });
                    }
                }
                Model::Piezo { positive, negative } => monitors.push(Monitor {
                    id: c.id.clone(),
                    kind: MonitorKind::Piezo,
                    pins: vec![pin(positive), pin(negative)],
                }),
                Model::Servo {
                    signal,
                    power,
                    ground,
                    min_pulse,
                    max_pulse,
                    min_supply,
                } => {
                    let min_pulse_us = prop(c, t, min_pulse, true)?;
                    let max_pulse_us = prop(c, t, max_pulse, true)?;
                    if max_pulse_us <= min_pulse_us {
                        return Err(format!("{}: {max_pulse} must be above {min_pulse}", c.id));
                    }
                    monitors.push(Monitor {
                        id: c.id.clone(),
                        kind: MonitorKind::Servo {
                            min_pulse_us,
                            max_pulse_us,
                            min_supply_v: prop(c, t, min_supply, true)?,
                        },
                        pins: vec![pin(signal), pin(power), pin(ground)],
                    });
                }
                Model::Board | Model::Connectivity => {}
            }
        }

        let bid = &spec.board_id;
        let bref = |p: &str| refs.index[&format!("{bid}.{p}")];
        let mut rails = Vec::new();
        let mut gpio = Vec::new();
        let mut aref = None;
        for p in &board.pins {
            let r = bref(&p.id);
            match p.electrical_type.as_str() {
                "ground" => rails.push((r, 0.0, p.id.clone())),
                "power-output" => {
                    let v = match p.voltage_domain.as_deref() {
                        Some("3V3") => RAIL_3V3_VOLTS,
                        _ => lib.limits.io_voltage,
                    };
                    rails.push((r, v, p.id.clone()));
                }
                _ => {}
            }
            if p.id == "AREF" {
                aref = Some(r);
            }
            if p.gpio {
                // Подключён — если в узле есть вывод, не связанный с этим выводом внутри платы.
                let partners: Vec<usize> = board
                    .internal
                    .iter()
                    .filter(|g| g.contains(&p.id))
                    .flat_map(|g| g.iter().map(|x| bref(x)))
                    .collect();
                let root = find(&mut base.clone(), r);
                let mut uf = base.clone();
                let connected = (0..refs.names.len())
                    .any(|x| x != r && !partners.contains(&x) && find(&mut uf, x) == root);
                gpio.push(Gpio {
                    name: p.id.clone(),
                    r,
                    connected,
                });
            }
        }
        let n_leds = leds.len();
        Ok(Circuit {
            refs: refs.names,
            base,
            resistors,
            leds,
            switches,
            pots,
            ldrs,
            monitors,
            gpio,
            rails,
            aref,
            nets,
            limits: lib.limits.clone(),
            unsupported,
            warm: [vec![false; n_leds], vec![false; n_leds]],
        })
    }

    /// Компоненты, тип которых решатель не моделирует (их выводы остаются узлами без элементов).
    pub fn unsupported(&self) -> &[String] {
        &self.unsupported
    }

    /// Имена выводов GPIO в порядке, в котором `solve` ожидает их состояния.
    pub fn gpio_names(&self) -> impl Iterator<Item = &str> {
        self.gpio.iter().map(|g| g.name.as_str())
    }

    /// Светодиоды в порядке `Solution::leds`: (компонент, канал).
    pub fn led_ids(&self) -> impl Iterator<Item = (&str, Option<&str>)> {
        self.leds
            .iter()
            .map(|l| (l.id.as_str(), l.channel.as_deref()))
    }

    /// Наблюдаемые компоненты (пьезоизлучатели, сервоприводы) в порядке `Solution::probes`.
    pub fn monitors(&self) -> &[Monitor] {
        &self.monitors
    }

    /// Компонент моделируется решателем (есть элемент или наблюдение).
    pub fn is_simulated(&self, id: &str) -> bool {
        self.has_switch(id)
            || self.leds.iter().any(|l| l.id == id)
            || self.pots.iter().any(|p| p.id == id)
            || self.ldrs.iter().any(|l| l.id == id)
            || self.monitors.iter().any(|m| m.id == id)
    }

    pub fn has_position_input(&self, id: &str) -> bool {
        self.pots.iter().any(|p| p.id == id)
    }

    pub fn has_illuminance_input(&self, id: &str) -> bool {
        self.ldrs.iter().any(|l| l.id == id)
    }

    /// Положение движка потенциометра 0…1. Возвращает true, если оно изменилось.
    pub fn set_position(&mut self, id: &str, position: f64) -> Option<bool> {
        let pot = self.pots.iter_mut().find(|p| p.id == id)?;
        let position = position.clamp(0.0, 1.0);
        let changed = pot.position != position;
        pot.position = position;
        let (r1, r2) = pot_segments(pot.total, position);
        self.resistors[pot.r[0]].g = 1.0 / r1;
        self.resistors[pot.r[1]].g = 1.0 / r2;
        Some(changed)
    }

    /// Освещённость фоторезистора, лк. Возвращает (изменилась ли, новое сопротивление, Ом).
    pub fn set_illuminance(&mut self, id: &str, lux: f64) -> Option<(bool, f64)> {
        let ldr = self.ldrs.iter_mut().find(|l| l.id == id)?;
        let changed = ldr.lux != lux;
        ldr.lux = lux;
        let r = ldr_resistance(ldr.r10, ldr.gamma, lux);
        self.resistors[ldr.r].g = 1.0 / r;
        Some((changed, r))
    }

    pub fn has_switch(&self, id: &str) -> bool {
        self.switches.iter().any(|s| s.id == id)
    }

    /// Нажимает/отпускает кнопку. Возвращает true, если состояние изменилось.
    pub fn set_switch(&mut self, id: &str, closed: bool) -> Option<bool> {
        let s = self.switches.iter_mut().find(|s| s.id == id)?;
        let changed = s.closed != closed;
        s.closed = closed;
        Some(changed)
    }

    /// Решает схему для заданных состояний выводов (в порядке `gpio_names`).
    pub fn solve(&mut self, drives: &[Drive]) -> Result<Solution, SolveError> {
        assert_eq!(
            drives.len(),
            self.gpio.len(),
            "по одному Drive на вывод GPIO"
        );
        let vcc = self.limits.io_voltage;
        // Узлы с учётом замкнутых кнопок.
        let mut uf = self.base.clone();
        for s in &self.switches {
            if s.closed {
                union(&mut uf, s.a, s.b);
            }
        }
        let mut node_of = vec![0usize; self.refs.len()];
        let mut roots = BTreeMap::new();
        for (r, slot) in node_of.iter_mut().enumerate() {
            let root = find(&mut uf, r);
            let next = roots.len();
            *slot = *roots.entry(root).or_insert(next);
        }
        let n = roots.len();
        let mut fixed: Vec<Option<(f64, &str)>> = vec![None; n];
        for (r, v, name) in &self.rails {
            let node = node_of[*r];
            match fixed[node] {
                Some((old, other)) if (old - v).abs() > 1e-12 => {
                    return Err(SolveError::Short(format!("{other} and {name}")));
                }
                _ => fixed[node] = Some((*v, name)),
            }
        }
        let fixed_v: Vec<Option<f64>> = fixed.iter().map(|f| f.map(|x| x.0)).collect();

        // Группы связности для взвешивания PWM: через резисторы и светодиоды, но не через шины.
        let mut guf: Vec<usize> = (0..n).collect();
        let pairs = self
            .resistors
            .iter()
            .map(|r| (r.a, r.b))
            .chain(self.leds.iter().map(|l| (l.a, l.k)));
        for (a, b) in pairs {
            let (a, b) = (node_of[a], node_of[b]);
            if fixed_v[a].is_none() && fixed_v[b].is_none() {
                union(&mut guf, a, b);
            }
        }
        let mut duty_sum: BTreeMap<usize, (f64, u32)> = BTreeMap::new();
        for (g, d) in self.gpio.iter().zip(drives) {
            if let Drive::Pwm { duty } = d {
                let root = find(&mut guf, node_of[g.r]);
                let e = duty_sum.entry(root).or_insert((0.0, 0));
                e.0 += duty.clamp(0.0, 1.0);
                e.1 += 1;
            }
        }
        let mut duty_of_node = |node: usize| -> f64 {
            let root = find(&mut guf, node);
            duty_sum
                .get(&root)
                .map(|(s, c)| s / *c as f64)
                .unwrap_or(1.0)
        };

        let has_pwm = !duty_sum.is_empty();
        let mut phases = Vec::new();
        for (ph, level) in [(0usize, true), (1, false)] {
            if ph == 1 && !has_pwm {
                break;
            }
            let pin_drives: Vec<Drive> = drives
                .iter()
                .map(|d| match d {
                    Drive::Pwm { .. } if level => Drive::High,
                    Drive::Pwm { .. } => Drive::Low,
                    other => *other,
                })
                .collect();
            let warm = self.warm[ph].clone();
            let res = self.solve_phase(&node_of, &fixed_v, &pin_drives, warm, vcc)?;
            self.warm[ph] = res.led_on.clone();
            phases.push(res);
        }
        let hi = &phases[0];
        let lo = phases.get(1).unwrap_or(hi);

        let mix = |d: f64, a: Option<f64>, b: Option<f64>| match (a, b) {
            (Some(a), Some(b)) => Some(d * a + (1.0 - d) * b),
            (Some(a), None) => Some(a),
            (None, b) => b,
        };
        let node_v = |node: usize, d: f64| mix(d, hi.v[node], lo.v[node]);

        let mut pins = Vec::with_capacity(self.gpio.len());
        for (i, g) in self.gpio.iter().enumerate() {
            let node = node_of[g.r];
            let voltage = node_v(node, duty_of_node(node));
            let level = match voltage {
                None => InputLevel::Floating,
                Some(v) if v <= VIL_FRACTION * vcc => InputLevel::Low,
                Some(v) if v >= VIH_FRACTION * vcc => InputLevel::High,
                Some(_) => InputLevel::Undefined,
            };
            let (a, b) = (hi.pin_i[i], lo.pin_i[i]);
            let current_a = if a.abs() >= b.abs() { a } else { b };
            pins.push(PinResult {
                name: g.name.clone(),
                voltage,
                level,
                current_a,
                connected: g.connected,
            });
        }

        let full_scale = self.limits.pin_limit_a;
        let mut leds = Vec::with_capacity(self.leds.len());
        for (i, l) in self.leds.iter().enumerate() {
            let (na, nk) = (node_of[l.a], node_of[l.k]);
            let node = if fixed_v[na].is_none() { na } else { nk };
            let d = duty_of_node(node);
            let current_a = (d * hi.led_i[i] + (1.0 - d) * lo.led_i[i]).max(0.0);
            leds.push(LedResult {
                id: l.id.clone(),
                channel: l.channel.clone(),
                on: current_a > 0.0,
                current_a,
                brightness: (current_a / full_scale).min(1.0),
            });
        }

        let mut overcurrent = Vec::new();
        for (i, g) in self.gpio.iter().enumerate() {
            let peak = pins[i].current_a;
            if peak.abs() > self.limits.pin_limit_a {
                overcurrent.push(Overcurrent {
                    pins: vec![g.name.clone()],
                    group: false,
                    direction: if peak > 0.0 {
                        Direction::Source
                    } else {
                        Direction::Sink
                    },
                    current_a: peak.abs(),
                    limit_a: self.limits.pin_limit_a,
                });
            }
        }
        for grp in &self.limits.groups {
            let mut worst = 0.0f64;
            for ph in [hi, lo] {
                let mut sum = 0.0;
                for (i, g) in self.gpio.iter().enumerate() {
                    if grp.pins.contains(&g.name) {
                        let c = ph.pin_i[i];
                        sum += match grp.direction {
                            Direction::Source => c.max(0.0),
                            Direction::Sink => (-c).max(0.0),
                        };
                    }
                }
                worst = worst.max(sum);
            }
            if worst > grp.max_a {
                overcurrent.push(Overcurrent {
                    pins: grp.pins.clone(),
                    group: true,
                    direction: grp.direction,
                    current_a: worst,
                    limit_a: grp.max_a,
                });
            }
        }

        let aref = self.aref.and_then(|r| {
            let node = node_of[r];
            node_v(node, duty_of_node(node))
        });
        let nets = self
            .nets
            .iter()
            .map(|(id, r)| {
                let node = node_of[*r];
                (id.clone(), node_v(node, duty_of_node(node)))
            })
            .collect();
        let switches = self
            .switches
            .iter()
            .map(|s| (s.id.clone(), s.closed))
            .collect();
        let probes = self
            .monitors
            .iter()
            .map(|m| {
                m.pins
                    .iter()
                    .map(|&r| {
                        let node = node_of[r];
                        node_v(node, duty_of_node(node))
                    })
                    .collect()
            })
            .collect();
        Ok(Solution {
            pins,
            leds,
            switches,
            aref,
            overcurrent,
            nets,
            probes,
        })
    }

    fn solve_phase(
        &self,
        node_of: &[usize],
        fixed: &[Option<f64>],
        drives: &[Drive],
        mut on: Vec<bool>,
        vcc: f64,
    ) -> Result<Phase, SolveError> {
        let n = fixed.len();
        // Источники выводов MCU: (узел, напряжение источника, проводимость).
        let sources: Vec<Option<(usize, f64, f64)>> = self
            .gpio
            .iter()
            .zip(drives)
            .map(|(g, d)| {
                let node = node_of[g.r];
                match d {
                    Drive::High => Some((node, vcc, 1.0 / R_OUT_HIGH_OHMS)),
                    Drive::Low => Some((node, 0.0, 1.0 / R_OUT_LOW_OHMS)),
                    Drive::InputPullup => Some((node, vcc, 1.0 / PULLUP_OHMS)),
                    Drive::Input | Drive::Pwm { .. } => None,
                }
            })
            .collect();
        let g_led = 1.0 / LED_SERIES_OHMS;
        let max_iter = 8 * self.leds.len() + 16;
        for _ in 0..max_iter {
            // Узлы, связанные с источником потенциала через проводящие элементы.
            let mut adj: Vec<Vec<usize>> = vec![Vec::new(); n];
            let mut link = |a: usize, b: usize| {
                adj[a].push(b);
                adj[b].push(a);
            };
            for r in &self.resistors {
                link(node_of[r.a], node_of[r.b]);
            }
            for (l, &is_on) in self.leds.iter().zip(&on) {
                if is_on {
                    link(node_of[l.a], node_of[l.k]);
                }
            }
            let mut reach = vec![false; n];
            let mut stack: Vec<usize> = (0..n).filter(|&i| fixed[i].is_some()).collect();
            stack.extend(sources.iter().flatten().map(|s| s.0));
            while let Some(x) = stack.pop() {
                if !reach[x] {
                    reach[x] = true;
                    stack.extend(adj[x].iter().copied().filter(|&y| !reach[y]));
                }
            }
            let mut idx = vec![usize::MAX; n];
            let mut m = 0;
            for i in 0..n {
                if reach[i] && fixed[i].is_none() {
                    idx[i] = m;
                    m += 1;
                }
            }
            let mut a = vec![0.0; m * m];
            let mut b = vec![0.0; m];
            // Проводимость g между узлами x и y; `inject` — ток источника, втекающий в x из y.
            let mut stamp = |x: usize, y: usize, g: f64, inject: f64| {
                let (ix, iy) = (idx[x], idx[y]);
                if ix != usize::MAX {
                    a[ix * m + ix] += g;
                    b[ix] += inject;
                    if iy != usize::MAX {
                        a[ix * m + iy] -= g;
                    } else if let Some(v) = fixed[y] {
                        b[ix] += g * v;
                    }
                }
                if iy != usize::MAX {
                    a[iy * m + iy] += g;
                    b[iy] -= inject;
                    if ix != usize::MAX {
                        a[iy * m + ix] -= g;
                    } else if let Some(v) = fixed[x] {
                        b[iy] += g * v;
                    }
                }
            };
            for r in &self.resistors {
                stamp(node_of[r.a], node_of[r.b], r.g, 0.0);
            }
            for (l, &is_on) in self.leds.iter().zip(&on) {
                if is_on {
                    // I_AK = g·(V_A − V_K − Vf): проводимость плюс источник тока g·Vf в анод.
                    stamp(node_of[l.a], node_of[l.k], g_led, g_led * l.vf);
                }
            }
            for &(node, v, g) in sources.iter().flatten() {
                if idx[node] != usize::MAX {
                    a[idx[node] * m + idx[node]] += g;
                    b[idx[node]] += g * v;
                }
            }
            let x = linalg::solve(a, b).ok_or(SolveError::Singular)?;
            let v: Vec<Option<f64>> = (0..n)
                .map(|i| {
                    if let Some(f) = fixed[i] {
                        Some(f)
                    } else if idx[i] != usize::MAX {
                        Some(x[idx[i]])
                    } else {
                        None
                    }
                })
                .collect();

            // Нарушение согласованности (в вольтах); переключаем самый сильный нарушитель.
            let mut worst: Option<(usize, f64)> = None;
            for (i, l) in self.leds.iter().enumerate() {
                let (Some(va), Some(vk)) = (v[node_of[l.a]], v[node_of[l.k]]) else {
                    continue;
                };
                let over = va - vk - l.vf;
                let violation = if on[i] { -over } else { over };
                if violation > 1e-9 && worst.is_none_or(|w| violation > w.1) {
                    worst = Some((i, violation));
                }
            }
            if let Some((i, _)) = worst {
                on[i] = !on[i];
                continue;
            }
            let led_i = self
                .leds
                .iter()
                .zip(&on)
                .map(
                    |(l, &is_on)| match (is_on, v[node_of[l.a]], v[node_of[l.k]]) {
                        (true, Some(va), Some(vk)) => (g_led * (va - vk - l.vf)).max(0.0),
                        _ => 0.0,
                    },
                )
                .collect();
            let pin_i = self
                .gpio
                .iter()
                .zip(&sources)
                .map(|(g, s)| match (s, v[node_of[g.r]]) {
                    (Some((_, vs, gs)), Some(vn)) => (vs - vn) * gs,
                    _ => 0.0,
                })
                .collect();
            return Ok(Phase {
                v,
                led_i,
                led_on: on,
                pin_i,
            });
        }
        Err(SolveError::NotConverged)
    }
}

struct Phase {
    v: Vec<Option<f64>>,
    led_i: Vec<f64>,
    led_on: Vec<bool>,
    pin_i: Vec<f64>,
}

#[cfg(test)]
mod tests;
