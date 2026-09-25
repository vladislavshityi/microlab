# simulation/

Эмулятор ATmega328P (Arduino UNO R3) и Simulation Worker.

| Каталог | Назначение |
|---|---|
| `avr-core/` | Библиотека ядра: CPU AVRe+, пространство данных, GPIO B/C/D, прерывания, Timer0/1/2, USART0, загрузчик Intel HEX |
| `worker/` | Бинарник `microlab-sim-worker`: JSON-lines протокол поверх stdin/stdout |
| `tests/unit/` | Семантика инструкций: флаги SREG, такты, адресация, стек, прерывания |
| `tests/conformance/arduino_uno/` | Conformance-тесты на реальных HEX (blink, serial, millis, INPUT_PULLUP, reset, эхо Serial, INT0, PWM, детерминизм) |
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
`MICROLAB_BOARD_DEFINITION`); несогласованное определение останавливает сборку.

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
| `set_input` | `pin` (`D0`…`D13`, `A0`…`A5`), `level`: `0`, `1` или `null` (не подключён) | — |
| `serial_input` | `data` (строка UTF-8) или `bytes` (0…255); ≤ 4096 байт | `accepted` |
| `get_state` | — | `cycle`, `pc`, `sp`, `sreg`, `halted`, `pins.{name}.{mode,value,floating}` |
| `stop` | — | ответ и завершение процесса |

Ответ: `{"version":1,"type":"response","id":…,"ok":true,"result":{…}}` или `"ok":false,"error":{"code","message"}`
(коды: `INVALID_JSON`, `UNKNOWN_COMMAND`, `INVALID_ARGUMENT`, `INVALID_FIRMWARE`, `NO_FIRMWARE`, `UNKNOWN_PIN`, `COMMAND_TOO_LARGE`).

Событие: `{"version":1,"type":"…","timestamp":<такт MCU>,"payload":{…}}`. `timestamp` — номер такта 16 MHz,
монотонный на протяжении жизни процесса (reset не обнуляет время).

| Тип | payload |
|---|---|
| `digital_pin_changed` | `pin`, `mode` (`output-high`, `output-low`, `input`, `input-pullup`, `pwm`), `value` (уровень, читаемый MCU) |
| `pwm_changed` | `pin`, `dutyCycle`, `highTicks`, `periodTicks`, `frequencyHz` — только при изменении измеренного периода |
| `serial_output` | `port` (`Serial`), `byte`; время — конец стоп-бита кадра |
| `simulation_error` | `code` (`INVALID_OPCODE`, `UNSUPPORTED_INSTRUCTION`, `UNSUPPORTED_PERIPHERAL`, `DATA_ADDRESS_OUT_OF_RANGE`, `EVENT_BUFFER_OVERFLOW`), `severity` (`error` — CPU остановлен, `warning` — продолжает), `message`, `pc` |
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
* Не реализованы: ADC (`analogRead()` зависнет в ожидании ADSC), SPI, TWI, EEPROM, WDT, режимы сна, аналоговый компаратор.
  Доступ к их регистрам сохраняет значение и один раз выдаёт `UNSUPPORTED_PERIPHERAL`. `init()` Arduino core пишет ADCSRA,
  поэтому это предупреждение появляется у любого скетча.
* Погрешность резонатора платы и электрические уровни (напряжения, токи) не моделируются — это задача circuit simulation.
