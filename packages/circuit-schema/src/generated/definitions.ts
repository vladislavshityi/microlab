/* Сгенерировано scripts/gen.mjs из packages/circuit-schema. Не редактировать вручную. */

import type { ComponentDefinition } from "./component-definition";

export const COMPONENT_DEFINITIONS: readonly ComponentDefinition[] = [
  {
    "type": "arduino-uno-r3",
    "displayName": {
      "key": "components.arduino-uno-r3.displayName",
      "ru": "Arduino UNO R3"
    },
    "description": {
      "key": "components.arduino-uno-r3.description",
      "ru": "Плата на ATmega328P, 16 МГц: 14 цифровых выводов (6 с PWM) и 6 аналоговых входов."
    },
    "category": "board",
    "board": {
      "mcu": "ATmega328P",
      "fqbn": "arduino:avr:uno",
      "clockHz": 16000000
    },
    "pins": [
      {
        "id": "D0",
        "name": "D0",
        "electricalType": "bidirectional",
        "voltageDomain": "5V",
        "capabilities": [
          "digital-io",
          "uart-rx"
        ],
        "arduinoPin": 0,
        "mcuPin": "PD0"
      },
      {
        "id": "D1",
        "name": "D1",
        "electricalType": "bidirectional",
        "voltageDomain": "5V",
        "capabilities": [
          "digital-io",
          "uart-tx"
        ],
        "arduinoPin": 1,
        "mcuPin": "PD1"
      },
      {
        "id": "D2",
        "name": "D2",
        "electricalType": "bidirectional",
        "voltageDomain": "5V",
        "capabilities": [
          "digital-io",
          "int0"
        ],
        "arduinoPin": 2,
        "mcuPin": "PD2"
      },
      {
        "id": "D3",
        "name": "D3",
        "electricalType": "bidirectional",
        "voltageDomain": "5V",
        "capabilities": [
          "digital-io",
          "pwm",
          "int1"
        ],
        "arduinoPin": 3,
        "mcuPin": "PD3"
      },
      {
        "id": "D4",
        "name": "D4",
        "electricalType": "bidirectional",
        "voltageDomain": "5V",
        "capabilities": [
          "digital-io"
        ],
        "arduinoPin": 4,
        "mcuPin": "PD4"
      },
      {
        "id": "D5",
        "name": "D5",
        "electricalType": "bidirectional",
        "voltageDomain": "5V",
        "capabilities": [
          "digital-io",
          "pwm"
        ],
        "arduinoPin": 5,
        "mcuPin": "PD5"
      },
      {
        "id": "D6",
        "name": "D6",
        "electricalType": "bidirectional",
        "voltageDomain": "5V",
        "capabilities": [
          "digital-io",
          "pwm"
        ],
        "arduinoPin": 6,
        "mcuPin": "PD6"
      },
      {
        "id": "D7",
        "name": "D7",
        "electricalType": "bidirectional",
        "voltageDomain": "5V",
        "capabilities": [
          "digital-io"
        ],
        "arduinoPin": 7,
        "mcuPin": "PD7"
      },
      {
        "id": "D8",
        "name": "D8",
        "electricalType": "bidirectional",
        "voltageDomain": "5V",
        "capabilities": [
          "digital-io"
        ],
        "arduinoPin": 8,
        "mcuPin": "PB0"
      },
      {
        "id": "D9",
        "name": "D9",
        "electricalType": "bidirectional",
        "voltageDomain": "5V",
        "capabilities": [
          "digital-io",
          "pwm"
        ],
        "arduinoPin": 9,
        "mcuPin": "PB1"
      },
      {
        "id": "D10",
        "name": "D10",
        "electricalType": "bidirectional",
        "voltageDomain": "5V",
        "capabilities": [
          "digital-io",
          "pwm",
          "spi-ss"
        ],
        "arduinoPin": 10,
        "mcuPin": "PB2"
      },
      {
        "id": "D11",
        "name": "D11",
        "electricalType": "bidirectional",
        "voltageDomain": "5V",
        "capabilities": [
          "digital-io",
          "pwm",
          "spi-mosi"
        ],
        "arduinoPin": 11,
        "mcuPin": "PB3"
      },
      {
        "id": "D12",
        "name": "D12",
        "electricalType": "bidirectional",
        "voltageDomain": "5V",
        "capabilities": [
          "digital-io",
          "spi-miso"
        ],
        "arduinoPin": 12,
        "mcuPin": "PB4"
      },
      {
        "id": "D13",
        "name": "D13",
        "electricalType": "bidirectional",
        "voltageDomain": "5V",
        "capabilities": [
          "digital-io",
          "spi-sck",
          "builtin-led"
        ],
        "arduinoPin": 13,
        "mcuPin": "PB5"
      },
      {
        "id": "A0",
        "name": "A0",
        "electricalType": "bidirectional",
        "voltageDomain": "5V",
        "capabilities": [
          "digital-io",
          "adc"
        ],
        "arduinoPin": 14,
        "mcuPin": "PC0"
      },
      {
        "id": "A1",
        "name": "A1",
        "electricalType": "bidirectional",
        "voltageDomain": "5V",
        "capabilities": [
          "digital-io",
          "adc"
        ],
        "arduinoPin": 15,
        "mcuPin": "PC1"
      },
      {
        "id": "A2",
        "name": "A2",
        "electricalType": "bidirectional",
        "voltageDomain": "5V",
        "capabilities": [
          "digital-io",
          "adc"
        ],
        "arduinoPin": 16,
        "mcuPin": "PC2"
      },
      {
        "id": "A3",
        "name": "A3",
        "electricalType": "bidirectional",
        "voltageDomain": "5V",
        "capabilities": [
          "digital-io",
          "adc"
        ],
        "arduinoPin": 17,
        "mcuPin": "PC3"
      },
      {
        "id": "A4",
        "name": "A4",
        "electricalType": "bidirectional",
        "voltageDomain": "5V",
        "capabilities": [
          "digital-io",
          "adc",
          "i2c-sda"
        ],
        "arduinoPin": 18,
        "mcuPin": "PC4"
      },
      {
        "id": "A5",
        "name": "A5",
        "electricalType": "bidirectional",
        "voltageDomain": "5V",
        "capabilities": [
          "digital-io",
          "adc",
          "i2c-scl"
        ],
        "arduinoPin": 19,
        "mcuPin": "PC5"
      },
      {
        "id": "SDA",
        "name": "SDA",
        "electricalType": "bidirectional",
        "voltageDomain": "5V",
        "capabilities": [
          "i2c-sda"
        ]
      },
      {
        "id": "SCL",
        "name": "SCL",
        "electricalType": "bidirectional",
        "voltageDomain": "5V",
        "capabilities": [
          "i2c-scl"
        ]
      },
      {
        "id": "AREF",
        "name": "AREF",
        "electricalType": "analog-input",
        "voltageDomain": "5V",
        "capabilities": [
          "adc-reference"
        ]
      },
      {
        "id": "IOREF",
        "name": "IOREF",
        "electricalType": "power-output",
        "voltageDomain": "5V"
      },
      {
        "id": "RESET",
        "name": "RESET",
        "electricalType": "digital-input",
        "voltageDomain": "5V",
        "capabilities": [
          "reset"
        ],
        "mcuPin": "PC6"
      },
      {
        "id": "3V3",
        "name": "3.3V",
        "electricalType": "power-output",
        "voltageDomain": "3V3"
      },
      {
        "id": "5V",
        "name": "5V",
        "electricalType": "power-output",
        "voltageDomain": "5V"
      },
      {
        "id": "VIN",
        "name": "VIN",
        "electricalType": "power-input",
        "voltageDomain": "VIN"
      },
      {
        "id": "GND1",
        "name": "GND",
        "electricalType": "ground"
      },
      {
        "id": "GND2",
        "name": "GND",
        "electricalType": "ground"
      },
      {
        "id": "GND3",
        "name": "GND",
        "electricalType": "ground"
      }
    ],
    "internalConnections": [
      [
        "5V",
        "IOREF"
      ],
      [
        "A4",
        "SDA"
      ],
      [
        "A5",
        "SCL"
      ],
      [
        "GND1",
        "GND2",
        "GND3"
      ]
    ],
    "properties": [],
    "simulationAccuracy": "DIGITAL",
    "limitations": [
      "Изображение платы схематическое: расположение выводов не повторяет механическую компоновку платы.",
      "Разъём ICSP, вывод NC и разъём USB не представлены.",
      "Встроенный светодиод «L» — часть схемы платы (управляется от D13 через буфер на ОУ), а не отдельный компонент.",
      "ATmega16U2 (преобразователь USB–UART) не представлен как отдельный компонент.",
      "Допустимый ток нагрузки выводов 5V и 3.3V не документирован и не проверяется."
    ],
    "visual": {
      "width": 12,
      "height": 21,
      "pins": {
        "IOREF": {
          "x": 0,
          "y": 2
        },
        "RESET": {
          "x": 0,
          "y": 3
        },
        "3V3": {
          "x": 0,
          "y": 4
        },
        "5V": {
          "x": 0,
          "y": 5
        },
        "GND1": {
          "x": 0,
          "y": 6
        },
        "GND2": {
          "x": 0,
          "y": 7
        },
        "VIN": {
          "x": 0,
          "y": 8
        },
        "A0": {
          "x": 0,
          "y": 10
        },
        "A1": {
          "x": 0,
          "y": 11
        },
        "A2": {
          "x": 0,
          "y": 12
        },
        "A3": {
          "x": 0,
          "y": 13
        },
        "A4": {
          "x": 0,
          "y": 14
        },
        "A5": {
          "x": 0,
          "y": 15
        },
        "SCL": {
          "x": 12,
          "y": 2
        },
        "SDA": {
          "x": 12,
          "y": 3
        },
        "AREF": {
          "x": 12,
          "y": 4
        },
        "GND3": {
          "x": 12,
          "y": 5
        },
        "D13": {
          "x": 12,
          "y": 6
        },
        "D12": {
          "x": 12,
          "y": 7
        },
        "D11": {
          "x": 12,
          "y": 8
        },
        "D10": {
          "x": 12,
          "y": 9
        },
        "D9": {
          "x": 12,
          "y": 10
        },
        "D8": {
          "x": 12,
          "y": 11
        },
        "D7": {
          "x": 12,
          "y": 12
        },
        "D6": {
          "x": 12,
          "y": 13
        },
        "D5": {
          "x": 12,
          "y": 14
        },
        "D4": {
          "x": 12,
          "y": 15
        },
        "D3": {
          "x": 12,
          "y": 16
        },
        "D2": {
          "x": 12,
          "y": 17
        },
        "D1": {
          "x": 12,
          "y": 18
        },
        "D0": {
          "x": 12,
          "y": 19
        }
      }
    }
  },
  {
    "type": "led",
    "displayName": {
      "key": "components.led.displayName",
      "ru": "Светодиод"
    },
    "description": {
      "key": "components.led.description",
      "ru": "Светодиод: светится, когда ток течёт от анода к катоду."
    },
    "category": "basic",
    "pins": [
      {
        "id": "A",
        "name": "Анод",
        "electricalType": "passive"
      },
      {
        "id": "K",
        "name": "Катод",
        "electricalType": "passive"
      }
    ],
    "properties": [
      {
        "id": "color",
        "displayName": {
          "key": "components.led.properties.color",
          "ru": "Цвет"
        },
        "type": "enum",
        "default": "red",
        "options": [
          {
            "value": "red",
            "label": {
              "key": "components.led.properties.color.red",
              "ru": "Красный"
            }
          },
          {
            "value": "green",
            "label": {
              "key": "components.led.properties.color.green",
              "ru": "Зелёный"
            }
          },
          {
            "value": "yellow",
            "label": {
              "key": "components.led.properties.color.yellow",
              "ru": "Жёлтый"
            }
          },
          {
            "value": "blue",
            "label": {
              "key": "components.led.properties.color.blue",
              "ru": "Синий"
            }
          },
          {
            "value": "white",
            "label": {
              "key": "components.led.properties.color.white",
              "ru": "Белый"
            }
          }
        ],
        "simulated": false
      },
      {
        "id": "forwardVoltage",
        "displayName": {
          "key": "components.led.properties.forwardVoltage",
          "ru": "Прямое напряжение"
        },
        "type": "number",
        "unit": "volt",
        "default": 2,
        "minimum": 0.5,
        "maximum": 5,
        "simulated": true
      }
    ],
    "simulationAccuracy": "BASIC_ELECTRICAL",
    "limitations": [
      "Прямое напряжение по умолчанию (2 В) — условное значение, не взятое из datasheet: задайте его по datasheet используемого светодиода.",
      "Цвет — только визуальные метаданные: он не меняет прямое напряжение.",
      "Максимально допустимый ток светодиода не задан и не проверяется.",
      "Тепловое поведение и длина волны излучения не моделируются."
    ],
    "visual": {
      "width": 4,
      "height": 2,
      "pins": {
        "A": {
          "x": 0,
          "y": 1
        },
        "K": {
          "x": 4,
          "y": 1
        }
      }
    }
  },
  {
    "type": "push-button",
    "displayName": {
      "key": "components.push-button.displayName",
      "ru": "Кнопка"
    },
    "description": {
      "key": "components.push-button.description",
      "ru": "Кнопка без фиксации: пока нажата, замыкает контакты A и B."
    },
    "category": "basic",
    "pins": [
      {
        "id": "A",
        "name": "A",
        "electricalType": "passive"
      },
      {
        "id": "B",
        "name": "B",
        "electricalType": "passive"
      }
    ],
    "properties": [],
    "simulationAccuracy": "BASIC_ELECTRICAL",
    "limitations": [
      "Моделируется как идеальный переключатель: сопротивление замкнутого контакта не учитывается.",
      "Дребезг контактов не моделируется.",
      "У каждого контакта один вывод: четырёхвыводная тактовая кнопка пока не представлена."
    ],
    "visual": {
      "width": 4,
      "height": 2,
      "pins": {
        "A": {
          "x": 0,
          "y": 1
        },
        "B": {
          "x": 4,
          "y": 1
        }
      }
    }
  },
  {
    "type": "resistor",
    "displayName": {
      "key": "components.resistor.displayName",
      "ru": "Резистор"
    },
    "description": {
      "key": "components.resistor.description",
      "ru": "Постоянный резистор с двумя выводами, ограничивает ток в цепи."
    },
    "category": "basic",
    "pins": [
      {
        "id": "1",
        "name": "1",
        "electricalType": "passive"
      },
      {
        "id": "2",
        "name": "2",
        "electricalType": "passive"
      }
    ],
    "properties": [
      {
        "id": "resistanceOhms",
        "displayName": {
          "key": "components.resistor.properties.resistanceOhms",
          "ru": "Сопротивление"
        },
        "type": "number",
        "unit": "ohm",
        "default": 220,
        "minimum": 1,
        "maximum": 100000000,
        "presets": [
          100,
          220,
          330,
          470,
          1000,
          2200,
          4700,
          10000,
          100000,
          1000000
        ],
        "simulated": true
      },
      {
        "id": "tolerancePercent",
        "displayName": {
          "key": "components.resistor.properties.tolerancePercent",
          "ru": "Допуск"
        },
        "type": "number",
        "unit": "percent",
        "default": 5,
        "minimum": 0.1,
        "maximum": 20,
        "presets": [
          1,
          2,
          5,
          10
        ],
        "simulated": false
      }
    ],
    "simulationAccuracy": "BASIC_ELECTRICAL",
    "limitations": [
      "Допуск — только справочные данные: в симуляции используется номинальное сопротивление.",
      "Рассеиваемая мощность, нагрев и температурная зависимость сопротивления не моделируются."
    ],
    "visual": {
      "width": 4,
      "height": 2,
      "pins": {
        "1": {
          "x": 0,
          "y": 1
        },
        "2": {
          "x": 4,
          "y": 1
        }
      }
    }
  }
];
