# simulation/

Эмулятор ATmega328P (Arduino UNO R3) и Simulation Worker.

| Каталог | Назначение |
|---|---|
| `avr-core/` | Библиотека ядра: CPU AVRe+, пространство данных, GPIO B/C/D, прерывания, Timer0/1/2, USART0, ADC, загрузчик Intel HEX |
| `circuit/` | Решатель рабочей точки схемы (DC): резисторы, светодиоды, кнопки, выводы MCU и шины платы |
| `worker/` | Бинарник `microlab-sim-worker`: JSON-lines протокол поверх stdin/stdout |
| `tests/unit/` | Семантика инструкций: флаги SREG, такты, адресация, стек, прерывания |
| `tests/conformance/arduino_uno/` | Conformance-тесты на реальных HEX (blink, serial, millis, INPUT_PULLUP, reset, эхо Serial, INT0, PWM, analogRead, детерминизм) |
| `tests/conformance/reference_circuits/` | Эталонные схемы MCU + схема через worker: внешний LED, LED без резистора, кнопка, PWM LED, делитель на A0, замыкание шин |
| `tests/worker/` | Тесты протокола worker |
| `tests/fixtures/<имя>/` | Скетч `.ino` и собранный из него `.hex` |
| `bench/` | `bench` — скорость симуляции; `dump` — печать событий прошивки |
| `spike/` | Замер скорости минимального цикла CPU на Python и Rust (выбор языка ядра) |

## Команды

```sh
cd simulation
cargo test --release                                        # все тесты
cargo clippy --all-targets -- -D warnings && cargo fmt --all --check
cargo run --release -p avr-core --example bench -- 10       # симулированные МГц, 10 с на прошивку
cargo run --release -p avr-core --example dump -- blink 3000
cargo build --release -p microlab-sim-worker                 # target/release/microlab-sim-worker
```

Toolchain закреплён в `rust-toolchain.toml`. Таблица выводов платы генерируется при сборке из
`packages/circuit-schema/definitions/arduino-uno-r3.json` (путь можно переопределить переменной
`MICROLAB_BOARD_DEFINITION`); несогласованное определение останавливает сборку. Решатель схемы встраивает
определения платы, макетной платы, резистора, светодиода и кнопки из того же каталога (выводы, внутренние
соединения, свойства по умолчанию, пределы тока GPIO).

### Пересборка HEX-фикстур

HEX собирается воркером компиляции (arduino-cli 1.5.1, `arduino:avr@1.8.8`, `arduino:avr:uno`):

```sh
curl -s http://127.0.0.1:8081/compile -H 'Content-Type: application/json' \
  -d "$(jq -Rs '{source: .}' tests/fixtures/blink/blink.ino)" | jq -r .hex > tests/fixtures/blink/blink.hex
```

## Протокол worker (версия 1)

Одна команда — одна строка JSON в stdin; ответы и события — строки JSON в stdout.
Поле `id` команды (любое JSON-значение) возвращается в ответе.

| Команда | Параметры | Результат |
|---|---|---|
| `load_firmware` | `hex`: Intel HEX (≤ 256 KB текста, ≤ 32 KB flash) | power-on reset; `flashBytes` |
| `reset` | — | внешний reset; событие `simulation_reset` |
| `run_for` | `cycles` (целое) или `ms` (число); ≤ 60 с симуляции за команду | `cycle`, `halted`; события выдаются срезами по 1 мс |
| `set_input` | `pin` (`D0`…`D13`, `A0`…`A5`), `level`: `0`, `1` или `null` (не подключён); только без схемы | — |
| `attach_circuit` | `board` `{id, type}`, `netlist` `[{id, members: ["компонент.вывод"]}]`, `components` `[{id, type, properties}]` | `nets`, `unsupportedComponents`, `fault`; начальные события схемы |
| `detach_circuit` | — | входы MCU снова не подключены, АЦП 0 V |
| `set_component_input` | `componentId`, `input`: `{pressed: bool}` (кнопка); `{position: 0…1}` — зарезервировано (потенциометр ещё не моделируется → `UNSUPPORTED_INPUT`) | `changed` |
| `serial_input` | `data` (строка UTF-8) или `bytes` (0…255); ≤ 4096 байт | `accepted` |
| `get_state` | — | `cycle`, `pc`, `sp`, `sreg`, `halted`, `pins.{name}.{mode,value,floating}` |
| `stop` | — | ответ и завершение процесса |

Ответ: `{"version":1,"type":"response","id":…,"ok":true,"result":{…}}` или `"ok":false,"error":{"code","message"}`
(коды: `INVALID_JSON`, `UNKNOWN_COMMAND`, `INVALID_ARGUMENT`, `INVALID_FIRMWARE`, `NO_FIRMWARE`, `UNKNOWN_PIN`, `COMMAND_TOO_LARGE`,
`NO_CIRCUIT`, `CIRCUIT_ATTACHED`, `CIRCUIT_FAULT`, `UNKNOWN_COMPONENT`, `UNSUPPORTED_INPUT`, `UNSUPPORTED_BOARD`).
Команды и события схемы — обратно совместимые дополнения: версия протокола остаётся 1. `get_state` при подключённой
схеме добавляет `circuit.{leds, switches, netVoltages}`.

Событие: `{"version":1,"type":"…","timestamp":<такт MCU>,"payload":{…}}`. `timestamp` — номер такта 16 MHz,
монотонный на протяжении жизни процесса (reset не обнуляет время).

| Тип | payload |
|---|---|
| `digital_pin_changed` | `pin`, `mode` (`output-high`, `output-low`, `input`, `input-pullup`, `pwm`), `value` (уровень, читаемый MCU) |
| `pwm_changed` | `pin`, `dutyCycle`, `highTicks`, `periodTicks`, `frequencyHz` — только при изменении измеренного периода |
| `serial_output` | `port` (`Serial`), `byte`; время — конец стоп-бита кадра |
| `simulation_error` | `code` (`INVALID_OPCODE`, `UNSUPPORTED_INSTRUCTION`, `UNSUPPORTED_PERIPHERAL`, `DATA_ADDRESS_OUT_OF_RANGE`, `EVENT_BUFFER_OVERFLOW`), `severity` (`error` — CPU остановлен, `warning` — продолжает), `message`, `pc` |
| `simulation_error` (схема, без `pc`) | warning: `GPIO_OVERCURRENT` (`pin`, `direction`, `currentMa`, `limitMa`), `GPIO_GROUP_OVERCURRENT` (`pins`, …), `FLOATING_INPUT` / `UNDEFINED_INPUT_LEVEL` (`pin`), `UNSUPPORTED_COMPONENT` (`componentId`) — каждое один раз за прошивку; error: `CIRCUIT_SHORT`, `CIRCUIT_NOT_CONVERGED`, `CIRCUIT_SINGULAR` — `run_for` отвечает `CIRCUIT_FAULT`, пока схема не изменится |
| `component_state_changed` | `componentId`, `state`: LED — `on`, `currentMa` (средний), `brightness` (0…1); кнопка — `pressed` |
| `analog_value_changed` | `board`, `pin` (`A0`…`A5`), `voltage` (В), `floating` |
| `simulation_reset` | — |

Worker не читает файлы и не использует сеть; память ограничена (очередь входа Serial 4096 байт,
буфер событий ядра 2²⁰ событий с предупреждением о переполнении).

## Что моделируется

* Все инструкции ATmega328P (AVRe+, без ELPM/EIJMP/EICALL) с тактами AVRe; пропуск двухсловных инструкций;
  `SPM` и неизвестные опкоды останавливают CPU.
* Reset: SP = 0x08FF, PC = 0, I/O в начальных значениях (UCSR0A = 0x20, UCSR0C = 0x06), MCUSR.PORF/EXTRF.
* Прерывания: приоритет по вектору, 4 такта на вход, I сбрасывается, флаг источника сбрасывается;
  инструкция после SEI и после RETI выполняется до следующего прерывания.
* GPIO: DDRx/PORTx/PINx, запись 1 в PINx переключает PORTx, pull-up при DDR = 0 и PORT = 1 с учётом MCUCR.PUD;
  INT0/INT1 (уровень и фронты), PCINT0–2.
* Timer0/1/2: все режимы WGM, делители, двойная буферизация OCR, флаги TOV/OCF и прерывания,
  выходы OCnx (в PWM-режимах — событие `pwm_changed` с измеренной скважностью), 16-битный доступ через TEMP.
* USART0 асинхронный: скорость из UBRR0/U2X0, формат кадра из UCSR0B/C, UDRE0/TXC0/RXC0/DOR0, прерывания RX/UDRE/TX,
  двухуровневый FIFO приёма.
* ADC: ADMUX (REFS, ADLAR, MUX), ADCSRA (ADEN, ADSC, ADATE, ADIF, ADIE, ADPS), ADCSRB (free running), DIDR0; старт на
  следующем фронте такта АЦП, 13 тактов АЦП (первое после ADEN — 25), выборка через 1,5/13,5; результат ⌊VIN·1024/VREF⌋
  с ограничением 0x3FF; блокировка ADCL/ADCH; прерывание ADC. VREF: AVCC = 5 V, внутренний 1,1 V (типовое), AREF — от схемы.

## Модель схемы (`circuit/`)

Узловой анализ резистивной цепи с кусочно-линейными элементами; решение пересчитывается по событиям: смена режима
вывода MCU или измеренной скважности PWM, нажатие кнопки, reset, подключение схемы. Эмулятор выполняется до такого
события (после вызвавшей его инструкции), затем уровни цифровых входов, напряжения A0…A5 и AREF передаются в MCU.

| Элемент | Модель | Значения |
|---|---|---|
| Выход MCU HIGH / LOW | источник 5 V / 0 V с выходным сопротивлением | R = (5 − VOH)/20 mA = 40 Ω; R = VOL/20 mA = 45 Ω (VOH ≥ 4,2 V, VOL ≤ 0,9 V при 20 mA, 85 °C, коммерческий datasheet) |
| INPUT / INPUT_PULLUP | высокий импеданс / резистор к 5 V | pull-up 35 kΩ — **допущение**: середина гарантированного диапазона 20–50 kΩ |
| Цифровой вход | ≤ 0,3·VCC → 0, ≥ 0,6·VCC → 1 | между порогами — прежний уровень + `UNDEFINED_INPUT_LEVEL`; плавающий узел — 0 + `FLOATING_INPUT` |
| Шины 5V, IOREF, 3V3, GND | идеальные источники 5 V, 5 V, 3,3 V, 0 V | **допущение**: ток не ограничен (допустимая нагрузка шин не документирована) |
| Резистор | проводимость 1/R | `resistanceOhms`; допуск не моделируется |
| LED | закрыт при V_AK < Vf; открыт — Vf + 1 Ω | `forwardVoltage`; 1 Ω — **допущение** (численная регуляризация); яркость = средний ток / 20 mA, ограничена 1 — **допущение** для визуализации |
| Кнопка | идеальный ключ (объединение узлов) | — |
| Макетная плата | только связность (внутренние группы выводов) | — |
| PWM | два решения (вывод в 1 и в 0), взвешенные скважностью | ток GPIO для предупреждений — пиковый (фаза 1) |

Предупреждение о токе: > 20 mA на вывод и суммы по группам портов (100 mA sink / 150 mA source) из определения платы;
симуляция не останавливается и выводы не «повреждаются».

## Приближения и ограничения

* Загрузчик optiboot не эмулируется: после reset выполнение сразу начинается с 0x0000.
* Регистровый файл и SRAM после reset обнуляются (в реальном MCU их содержимое не определено).
* Порядок байтов адреса возврата в стеке (младший по старшему адресу) не подтверждён извлечённым текстом документации.
* Совпадение сравнения таймера обрабатывается на такте, когда счётчик покидает значение OCR; скважность PWM —
  результат этой модели (fast PWM: (OCR+1)/256, phase correct: OCR/255), а не формула datasheet.
* Не моделируются: синхронизатор входа порта, блокировка совпадения после записи TCNT, FOC, input capture,
  внешний такт T0/T1, асинхронный Timer2, COM = 01 в PWM-режимах (вывод считается отключённым, выдаётся warning).
* USART: без отдельных битов на TXD (TXD при TXEN показывается как `output-high`), без ошибок кадра/чётности на приёме,
  без синхронного режима; входные байты приходят с настроенной скоростью подряд.
* Плавающий вход читается как 0 и помечается `floating: true`; конфликт внешнего уровня с выходом не разрешается (выход MCU приоритетнее).
* Не реализованы: SPI, TWI, EEPROM, WDT, режимы сна, аналоговый компаратор. Доступ к их регистрам сохраняет значение
  и один раз выдаёт `UNSUPPORTED_PERIPHERAL`.
* ADC идеален: без шума, INL/DNL, ошибок смещения/усиления, влияния сопротивления источника и конденсатора выборки;
  внутренний опорный — типовые 1,1 V (не 1,0–1,2 V); ADC6/7 (нет в DIP), датчик температуры и источники автозапуска,
  кроме free running, не моделируются (warning); первое преобразование free running после ручного старта — обычное.
* Погрешность резонатора платы не моделируется.

Ограничения модели схемы:

* Не SPICE: только DC рабочая точка, без ёмкостей, индуктивностей, переходных процессов и температуры; характеристики
  выхода MCU и LED линеаризованы (VOH/VOL — гарантированные границы, поэтому ток нагрузки выхода занижен).
* PWM не разрешается по времени: цифровые входы и АЦП на узлах с PWM видят напряжение, усреднённое по скважности;
  при нескольких PWM-выводах в одной связной части схемы берётся средняя скважность. До первого измеренного периода
  PWM вывод считается постоянным выходом с текущим уровнем.
* Вывод, настроенный как выход, читается по своему регистру PORT даже при внешней перегрузке (конфликт выходов
  проявляется только как ток и предупреждение).
* Ток утечки входов, входное сопротивление АЦП (100 MΩ), защитные диоды, обратный пробой LED, ограничение тока шин
  питания, VIN, RESET, связь D0/D1 с ATmega16U2 через 1 kΩ и внутренний LED «L» (нагрузка — вход ОУ, не D13)
  в схеме не моделируются. Потенциометр и прочие компоненты пока не поддерживаются (`UNSUPPORTED_COMPONENT`).
* После reset все выводы — входы без подтяжки, поэтому до `pinMode()` подключённый к разомкнутой кнопке вход
  даёт `FLOATING_INPUT` (как и на реальной плате, уровень в этот момент не определён).
