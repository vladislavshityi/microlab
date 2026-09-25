//! АЦП ATmega328P (datasheet 7810D, раздел 23, стр. 205–220).
//!
//! Моделируется:
//! * ADMUX: REFS1:0 (Table 23-3, стр. 217), ADLAR (стр. 217, 219), MUX3:0 (Table 23-4, стр. 218);
//! * ADCSRA: ADEN, ADSC, ADATE, ADIF (сброс записью 1), ADIE, ADPS2:0 (Table 23-5, стр. 219);
//! * ADCSRB.ADTS: только free running (000); остальные источники запуска не моделируются;
//! * DIDR0: при установленном бите PINC соответствующего вывода читается как 0 (стр. 220);
//! * предделитель запускается при установке ADEN и сбрасывается при ADEN = 0 (стр. 208);
//! * преобразование начинается на следующем фронте такта АЦП после записи ADSC; длительность —
//!   13 тактов АЦП, первое после включения — 25; выборка через 1,5 / 13,5 такта АЦП
//!   (Table 23-1, стр. 210);
//! * выбор канала и опорного фиксируется в момент начала преобразования (раздел 23.5, стр. 211);
//! * результат ADC = ⌊VIN·1024/VREF⌋, ограниченный 0…0x3FF (раздел 23.7, стр. 215; вход выше
//!   VREF даёт коды около 0x3FF, стр. 211);
//! * чтение ADCL блокирует обновление ADCL/ADCH до чтения ADCH; результат, завершившийся в это
//!   время, теряется, но ADIF устанавливается (стр. 206–207).
//!
//! Приближения (явно):
//! * напряжения входов задаёт внешняя модель схемы; шум, INL/DNL, ошибки смещения и усиления,
//!   сопротивление источника и заряд конденсатора выборки не моделируются — результат идеален;
//! * AVCC = 5 V (номинальное напряжение I/O платы UNO R3), внутренний опорный — типовое 1,1 V
//!   (диапазон 1,0…1,2 V не моделируется);
//! * в free running следующее преобразование считается обычным (13 тактов, выборка через 1,5);
//! * ADC6/ADC7 отсутствуют в корпусе DIP платы UNO, датчик температуры не моделируется —
//!   такие каналы дают 0 и предупреждение.

/// Биты ADCSRA (стр. 218–219).
pub const ADEN: u8 = 1 << 7;
pub const ADSC: u8 = 1 << 6;
pub const ADATE: u8 = 1 << 5;
pub const ADIF: u8 = 1 << 4;
pub const ADIE: u8 = 1 << 3;
/// ADMUX.ADLAR (стр. 217).
pub const ADLAR: u8 = 1 << 5;

/// Число внешних аналоговых каналов платы UNO R3 (A0…A5 = ADC0…ADC5).
pub const CHANNELS: usize = 6;
/// Напряжение AVCC: на UNO R3 AVCC питается от +5V платы; I/O-напряжение платы 5 V.
pub const AVCC_VOLTS: f64 = 5.0;
/// Внутренний опорный источник, типовое значение при VCC = 5 V (datasheet стр. 265).
pub const INTERNAL_REF_VOLTS: f64 = 1.1;
/// Вход 1.1V (VBG) мультиплексора (Table 23-4); используется то же типовое значение.
pub const BANDGAP_VOLTS: f64 = 1.1;

/// Такты АЦП: обычное и первое преобразование, момент выборки ×2 (Table 23-1, стр. 210).
const NORMAL_CYCLES: u64 = 13;
const FIRST_CYCLES: u64 = 25;
const NORMAL_SAMPLE_X2: u64 = 3;
const FIRST_SAMPLE_X2: u64 = 27;

/// Диагностики АЦП, выдаваемые один раз.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AdcDiag {
    /// Выбран канал, который не моделируется (ADC6/7, датчик температуры, reserved).
    UnsupportedChannel,
    /// ADATE с источником запуска, отличным от free running.
    UnsupportedTrigger,
    /// REFS1:0 = 10 (reserved).
    ReservedReference,
    /// Выбран внешний опорный AREF, но напряжение на AREF не задано схемой.
    ArefNotConnected,
    /// На AREF подано внешнее напряжение, а выбран внутренний опорный (они замыкаются, стр. 211).
    ArefConflict,
}

impl AdcDiag {
    pub fn message(self) -> &'static str {
        match self {
            AdcDiag::UnsupportedChannel => {
                "ADC channel is not simulated (ADC6/ADC7 are absent on the DIP package, temperature sensor and reserved inputs are not modelled); result is 0"
            }
            AdcDiag::UnsupportedTrigger => {
                "ADC auto trigger sources other than free running are not simulated; conversions start only by ADSC"
            }
            AdcDiag::ReservedReference => "ADMUX.REFS1:0 = 10 is reserved; result is 0",
            AdcDiag::ArefNotConnected => {
                "AREF reference selected but no voltage is applied to AREF; result is 0"
            }
            AdcDiag::ArefConflict => {
                "external voltage on AREF while an internal reference is selected: they are shorted on a real MCU"
            }
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Stage {
    /// Ждёт фронта такта АЦП, на котором начнётся преобразование.
    Start,
    /// Ждёт момента выборки.
    Sample,
    /// Ждёт завершения.
    Done,
}

#[derive(Debug, Clone, Copy)]
struct Conversion {
    stage: Stage,
    start: u64,
    sample_at: u64,
    done_at: u64,
    admux: u8,
    code: u16,
}

#[derive(Debug, Clone)]
pub struct Adc {
    pub admux: u8,
    /// ADCSRA без бита ADSC (он вычисляется из состояния преобразования).
    ctrl: u8,
    pub adcsrb: u8,
    pub didr0: u8,
    result: u16,
    locked: bool,
    /// Такт включения ADEN — начало отсчёта предделителя.
    epoch: u64,
    /// Следующее преобразование — первое после включения.
    first_pending: bool,
    conv: Option<Conversion>,
    inputs: [f64; CHANNELS],
    aref: Option<f64>,
    /// Диагностики, ещё не забранные MCU.
    pub diags: Vec<AdcDiag>,
}

impl Default for Adc {
    fn default() -> Self {
        Self::new()
    }
}

/// Делитель предделителя АЦП по ADPS2:0 (Table 23-5, стр. 219).
fn divider(adcsra: u8) -> u64 {
    match adcsra & 0x07 {
        0 | 1 => 2,
        2 => 4,
        3 => 8,
        4 => 16,
        5 => 32,
        6 => 64,
        _ => 128,
    }
}

impl Adc {
    pub fn new() -> Self {
        Adc {
            admux: 0,
            ctrl: 0,
            adcsrb: 0,
            didr0: 0,
            result: 0,
            locked: false,
            epoch: 0,
            first_pending: true,
            conv: None,
            inputs: [0.0; CHANNELS],
            aref: None,
            diags: Vec::new(),
        }
    }

    /// Сброс регистров (reset MCU). Внешние напряжения — свойство схемы и сохраняются.
    pub fn reset(&mut self) {
        let inputs = self.inputs;
        let aref = self.aref;
        *self = Adc::new();
        self.inputs = inputs;
        self.aref = aref;
    }

    pub fn set_input(&mut self, channel: usize, volts: f64) {
        if channel < CHANNELS {
            self.inputs[channel] = volts;
        }
    }

    pub fn input(&self, channel: usize) -> f64 {
        self.inputs.get(channel).copied().unwrap_or(0.0)
    }

    pub fn set_aref(&mut self, volts: Option<f64>) {
        self.aref = volts;
    }

    pub fn next_event(&self) -> u64 {
        match self.conv {
            None => u64::MAX,
            Some(c) => match c.stage {
                Stage::Start => c.start,
                Stage::Sample => c.sample_at,
                Stage::Done => c.done_at,
            },
        }
    }

    pub fn read_adcsra(&self) -> u8 {
        self.ctrl | if self.conv.is_some() { ADSC } else { 0 }
    }

    pub fn interrupt_pending(&self) -> bool {
        self.ctrl & ADIF != 0 && self.ctrl & ADIE != 0
    }

    /// Аппаратный сброс ADIF при входе в прерывание.
    pub fn clear_flag(&mut self) {
        self.ctrl &= !ADIF;
    }

    pub fn write_adcsra(&mut self, v: u8, now: u64) {
        let was_enabled = self.ctrl & ADEN != 0;
        let enabled = v & ADEN != 0;
        // ADIF сбрасывается записью 1; запись 0 его не меняет.
        let flag = if v & ADIF != 0 { 0 } else { self.ctrl & ADIF };
        self.ctrl = (v & !(ADSC | ADIF)) | flag;
        if !enabled {
            // Выключение прерывает преобразование; предделитель удерживается в сбросе.
            self.conv = None;
            return;
        }
        if !was_enabled {
            self.epoch = now;
            self.first_pending = true;
        }
        if v & ADATE != 0 && self.adcsrb & 0x07 != 0 {
            self.diags.push(AdcDiag::UnsupportedTrigger);
        }
        if v & ADSC != 0 && self.conv.is_none() {
            self.begin(now, false);
        }
    }

    pub fn write_adcsrb(&mut self, v: u8) {
        self.adcsrb = v & 0x47;
        if self.ctrl & ADATE != 0 && self.adcsrb & 0x07 != 0 {
            self.diags.push(AdcDiag::UnsupportedTrigger);
        }
    }

    /// Планирует преобразование: на следующем фронте такта АЦП (`immediate` — сразу, free running).
    fn begin(&mut self, now: u64, immediate: bool) {
        let n = divider(self.ctrl);
        let start = if immediate {
            now
        } else {
            let k = (now - self.epoch) / n + 1;
            self.epoch + k * n
        };
        let first = std::mem::replace(&mut self.first_pending, false);
        let (cycles, sample_x2) = if first {
            (FIRST_CYCLES, FIRST_SAMPLE_X2)
        } else {
            (NORMAL_CYCLES, NORMAL_SAMPLE_X2)
        };
        self.conv = Some(Conversion {
            stage: Stage::Start,
            start,
            sample_at: start + sample_x2 * n / 2,
            done_at: start + cycles * n,
            admux: self.admux,
            code: 0,
        });
    }

    /// Код преобразования для зафиксированного ADMUX.
    fn convert(&mut self, admux: u8) -> u16 {
        let vref = match admux >> 6 {
            0 => match self.aref {
                Some(v) => v,
                None => {
                    self.diags.push(AdcDiag::ArefNotConnected);
                    return 0;
                }
            },
            1 => AVCC_VOLTS,
            2 => {
                self.diags.push(AdcDiag::ReservedReference);
                return 0;
            }
            _ => INTERNAL_REF_VOLTS,
        };
        if admux >> 6 != 0 && self.aref.is_some() {
            self.diags.push(AdcDiag::ArefConflict);
        }
        let vin = match admux & 0x0F {
            ch @ 0..=5 => self.inputs[ch as usize],
            0x0E => BANDGAP_VOLTS,
            0x0F => 0.0,
            _ => {
                self.diags.push(AdcDiag::UnsupportedChannel);
                return 0;
            }
        };
        code(vin, vref)
    }

    /// Продвигает АЦП до такта `now`. Возвращает true, если установлен ADIF.
    pub fn advance(&mut self, now: u64) -> bool {
        let mut flagged = false;
        while let Some(mut c) = self.conv {
            match c.stage {
                Stage::Start if c.start <= now => {
                    c.admux = self.admux;
                    c.stage = Stage::Sample;
                    self.conv = Some(c);
                }
                Stage::Sample if c.sample_at <= now => {
                    c.code = self.convert(c.admux);
                    c.stage = Stage::Done;
                    self.conv = Some(c);
                }
                Stage::Done if c.done_at <= now => {
                    if !self.locked {
                        self.result = c.code;
                    }
                    self.ctrl |= ADIF;
                    flagged = true;
                    self.conv = None;
                    // Free running: следующее преобразование начинается сразу (стр. 208).
                    if self.ctrl & ADATE != 0 && self.adcsrb & 0x07 == 0 {
                        self.begin(c.done_at, true);
                    }
                }
                _ => break,
            }
        }
        flagged
    }

    pub fn read_adcl(&mut self) -> u8 {
        self.locked = true;
        if self.admux & ADLAR != 0 {
            ((self.result & 0x03) << 6) as u8
        } else {
            self.result as u8
        }
    }

    pub fn read_adch(&mut self) -> u8 {
        self.locked = false;
        if self.admux & ADLAR != 0 {
            (self.result >> 2) as u8
        } else {
            (self.result >> 8) as u8
        }
    }

    /// Значения ADCL/ADCH без побочных эффектов (для отладки).
    pub fn result(&self) -> u16 {
        self.result
    }
}

/// ADC = ⌊VIN·1024/VREF⌋ с ограничением 0…0x3FF (datasheet раздел 23.7, стр. 215).
pub fn code(vin: f64, vref: f64) -> u16 {
    if vref.is_nan() || vref <= 0.0 || !vin.is_finite() {
        return 0;
    }
    let v = (vin * 1024.0 / vref).floor();
    v.clamp(0.0, 1023.0) as u16
}

#[cfg(test)]
mod tests {
    use super::*;

    const PS128: u8 = 0x07;

    /// Первое преобразование — 25 тактов АЦП, следующее — 13 (Table 23-1); старт на следующем фронте.
    #[test]
    fn conversion_timing_follows_table_23_1() {
        let mut adc = Adc::new();
        adc.admux = 0x40; // AVCC, ADC0
        adc.set_input(0, 2.5);
        adc.write_adcsra(ADEN | ADSC | PS128, 0);
        assert_ne!(adc.read_adcsra() & ADSC, 0);
        // Старт на фронте 128, завершение через 25·128.
        let done = 128 + 25 * 128;
        adc.advance(done - 1);
        assert_ne!(adc.read_adcsra() & ADSC, 0);
        assert!(adc.advance(done));
        assert_eq!(adc.read_adcsra() & (ADSC | ADIF), ADIF);
        assert_eq!(adc.read_adcl() as u16 | (adc.read_adch() as u16) << 8, 512);

        // Обычное преобразование: ADSC в такт 5000 → старт на фронте 5120, 13 тактов АЦП.
        adc.write_adcsra(ADEN | ADSC | ADIF | PS128, 5000);
        assert_eq!(adc.read_adcsra() & ADIF, 0, "ADIF сбрасывается записью 1");
        assert!(!adc.advance(5120 + 13 * 128 - 1));
        assert!(adc.advance(5120 + 13 * 128));
    }

    #[test]
    fn result_formula_and_clamping() {
        assert_eq!(code(0.0, 5.0), 0);
        assert_eq!(code(2.5, 5.0), 512);
        assert_eq!(code(5.0, 5.0), 1023);
        assert_eq!(code(7.0, 5.0), 1023);
        assert_eq!(code(-1.0, 5.0), 0);
        assert_eq!(code(0.55, INTERNAL_REF_VOLTS), 512);
    }

    #[test]
    fn adlar_and_data_register_lock() {
        let mut adc = Adc::new();
        adc.admux = 0x40 | ADLAR;
        adc.set_input(0, 5.0);
        adc.write_adcsra(ADEN | ADSC | PS128, 0);
        adc.advance(10_000);
        assert_eq!(adc.read_adch(), 0xFF);
        adc.admux = 0x40;
        // ADCL прочитан — следующий результат теряется до чтения ADCH, но ADIF ставится.
        let _ = adc.read_adcl();
        adc.set_input(0, 0.0);
        adc.write_adcsra(ADEN | ADSC | ADIF | PS128, 20_000);
        assert!(adc.advance(40_000));
        assert_eq!(adc.read_adch(), 0x03);
        assert_eq!(adc.result(), 1023);
    }

    #[test]
    fn aref_reference_requires_voltage() {
        let mut adc = Adc::new();
        adc.admux = 0x00; // AREF
        adc.set_input(0, 1.0);
        adc.write_adcsra(ADEN | ADSC | PS128, 0);
        adc.advance(10_000);
        assert_eq!(adc.result(), 0);
        assert!(adc.diags.contains(&AdcDiag::ArefNotConnected));
        adc.set_aref(Some(2.0));
        adc.write_adcsra(ADEN | ADSC | PS128, 10_000);
        adc.advance(20_000);
        assert_eq!(adc.result(), 512);
    }

    #[test]
    fn disabling_adc_aborts_conversion() {
        let mut adc = Adc::new();
        adc.write_adcsra(ADEN | ADSC | PS128, 0);
        adc.write_adcsra(PS128, 100);
        assert_eq!(adc.next_event(), u64::MAX);
        assert_eq!(adc.read_adcsra() & ADSC, 0);
    }
}
