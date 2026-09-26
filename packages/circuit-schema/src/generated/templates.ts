/* Сгенерировано scripts/gen.mjs из packages/circuit-schema. Не редактировать вручную. */

import type { ProjectTemplate } from "../project-template";

export const PROJECT_TEMPLATES: readonly ProjectTemplate[] = [
  {
    "id": "blink",
    "order": 1,
    "name": {
      "key": "templates.blink.name",
      "ru": "Blink"
    },
    "description": {
      "key": "templates.blink.description",
      "ru": "Светодиод на D13 через резистор 220 Ω мигает раз в секунду."
    },
    "code": "void setup() {\n  pinMode(13, OUTPUT);\n}\n\nvoid loop() {\n  digitalWrite(13, HIGH);\n  delay(1000);\n  digitalWrite(13, LOW);\n  delay(1000);\n}\n",
    "circuit": {
      "schemaVersion": 1,
      "board": {
        "id": "uno1",
        "type": "arduino-uno-r3",
        "position": {
          "x": 0,
          "y": 0
        },
        "rotation": 0
      },
      "components": [
        {
          "id": "r1",
          "type": "resistor",
          "position": {
            "x": 16,
            "y": 5
          },
          "rotation": 0,
          "properties": {
            "resistanceOhms": 220
          }
        },
        {
          "id": "led1",
          "type": "led",
          "position": {
            "x": 22,
            "y": 5
          },
          "rotation": 0,
          "properties": {
            "color": "red"
          }
        }
      ],
      "connections": [
        {
          "id": "w1",
          "from": {
            "componentId": "uno1",
            "pinId": "D13"
          },
          "to": {
            "componentId": "r1",
            "pinId": "1"
          }
        },
        {
          "id": "w2",
          "from": {
            "componentId": "r1",
            "pinId": "2"
          },
          "to": {
            "componentId": "led1",
            "pinId": "A"
          }
        },
        {
          "id": "w3",
          "from": {
            "componentId": "led1",
            "pinId": "K"
          },
          "to": {
            "componentId": "uno1",
            "pinId": "GND3"
          }
        }
      ]
    }
  },
  {
    "id": "button",
    "order": 2,
    "name": {
      "key": "templates.button.name",
      "ru": "Кнопка"
    },
    "description": {
      "key": "templates.button.description",
      "ru": "Кнопка между D2 и GND, вход с INPUT_PULLUP: отпущена — 1, нажата — 0 в мониторе порта."
    },
    "code": "void setup() {\n  pinMode(2, INPUT_PULLUP);\n  Serial.begin(9600);\n}\n\nvoid loop() {\n  Serial.println(digitalRead(2));\n  delay(100);\n}\n",
    "circuit": {
      "schemaVersion": 1,
      "board": {
        "id": "uno1",
        "type": "arduino-uno-r3",
        "position": {
          "x": 0,
          "y": 0
        },
        "rotation": 0
      },
      "components": [
        {
          "id": "button1",
          "type": "push-button",
          "position": {
            "x": 16,
            "y": 16
          },
          "rotation": 0,
          "properties": {}
        }
      ],
      "connections": [
        {
          "id": "w1",
          "from": {
            "componentId": "uno1",
            "pinId": "D2"
          },
          "to": {
            "componentId": "button1",
            "pinId": "A"
          }
        },
        {
          "id": "w2",
          "from": {
            "componentId": "button1",
            "pinId": "B"
          },
          "to": {
            "componentId": "uno1",
            "pinId": "GND3"
          }
        }
      ]
    }
  },
  {
    "id": "pwm-led",
    "order": 3,
    "name": {
      "key": "templates.pwm-led.name",
      "ru": "PWM-светодиод"
    },
    "description": {
      "key": "templates.pwm-led.description",
      "ru": "Плавное изменение яркости светодиода на D9 функцией analogWrite()."
    },
    "code": "const int LED_PIN = 9;\n\nvoid setup() {\n  pinMode(LED_PIN, OUTPUT);\n}\n\nvoid loop() {\n  for (int value = 0; value <= 255; value += 5) {\n    analogWrite(LED_PIN, value);\n    delay(30);\n  }\n  for (int value = 255; value >= 0; value -= 5) {\n    analogWrite(LED_PIN, value);\n    delay(30);\n  }\n}\n",
    "circuit": {
      "schemaVersion": 1,
      "board": {
        "id": "uno1",
        "type": "arduino-uno-r3",
        "position": {
          "x": 0,
          "y": 0
        },
        "rotation": 0
      },
      "components": [
        {
          "id": "r1",
          "type": "resistor",
          "position": {
            "x": 16,
            "y": 9
          },
          "rotation": 0,
          "properties": {
            "resistanceOhms": 220
          }
        },
        {
          "id": "led1",
          "type": "led",
          "position": {
            "x": 22,
            "y": 9
          },
          "rotation": 0,
          "properties": {
            "color": "green"
          }
        }
      ],
      "connections": [
        {
          "id": "w1",
          "from": {
            "componentId": "uno1",
            "pinId": "D9"
          },
          "to": {
            "componentId": "r1",
            "pinId": "1"
          }
        },
        {
          "id": "w2",
          "from": {
            "componentId": "r1",
            "pinId": "2"
          },
          "to": {
            "componentId": "led1",
            "pinId": "A"
          }
        },
        {
          "id": "w3",
          "from": {
            "componentId": "led1",
            "pinId": "K"
          },
          "to": {
            "componentId": "uno1",
            "pinId": "GND3"
          }
        }
      ]
    }
  },
  {
    "id": "potentiometer",
    "order": 4,
    "name": {
      "key": "templates.potentiometer.name",
      "ru": "Потенциометр"
    },
    "description": {
      "key": "templates.potentiometer.description",
      "ru": "Потенциометр делит 5 В, analogRead(A0) выводится в монитор порта."
    },
    "code": "void setup() {\n  Serial.begin(9600);\n}\n\nvoid loop() {\n  int value = analogRead(A0);\n  Serial.println(value);\n  delay(200);\n}\n",
    "circuit": {
      "schemaVersion": 1,
      "board": {
        "id": "uno1",
        "type": "arduino-uno-r3",
        "position": {
          "x": 0,
          "y": 0
        },
        "rotation": 0
      },
      "components": [
        {
          "id": "pot1",
          "type": "potentiometer",
          "position": {
            "x": -10,
            "y": 8
          },
          "rotation": 0,
          "properties": {
            "resistanceOhms": 10000,
            "positionPercent": 50
          }
        }
      ],
      "connections": [
        {
          "id": "w1",
          "from": {
            "componentId": "pot1",
            "pinId": "1"
          },
          "to": {
            "componentId": "uno1",
            "pinId": "GND1"
          }
        },
        {
          "id": "w2",
          "from": {
            "componentId": "pot1",
            "pinId": "2"
          },
          "to": {
            "componentId": "uno1",
            "pinId": "5V"
          }
        },
        {
          "id": "w3",
          "from": {
            "componentId": "pot1",
            "pinId": "W"
          },
          "to": {
            "componentId": "uno1",
            "pinId": "A0"
          }
        }
      ]
    }
  },
  {
    "id": "servo-sweep",
    "order": 5,
    "name": {
      "key": "templates.servo-sweep.name",
      "ru": "Сервопривод: качание"
    },
    "description": {
      "key": "templates.servo-sweep.description",
      "ru": "Сервопривод на D9 поворачивается от 0° до 180° и обратно (библиотека Servo)."
    },
    "code": "#include <Servo.h>\n\nServo servo;\n\nvoid setup() {\n  servo.attach(9);\n}\n\nvoid loop() {\n  for (int angle = 0; angle <= 180; angle++) {\n    servo.write(angle);\n    delay(15);\n  }\n  for (int angle = 180; angle >= 0; angle--) {\n    servo.write(angle);\n    delay(15);\n  }\n}\n",
    "circuit": {
      "schemaVersion": 1,
      "board": {
        "id": "uno1",
        "type": "arduino-uno-r3",
        "position": {
          "x": 0,
          "y": 0
        },
        "rotation": 0
      },
      "components": [
        {
          "id": "servo1",
          "type": "servo",
          "position": {
            "x": -12,
            "y": 10
          },
          "rotation": 0,
          "properties": {}
        }
      ],
      "connections": [
        {
          "id": "w1",
          "from": {
            "componentId": "servo1",
            "pinId": "SIG"
          },
          "to": {
            "componentId": "uno1",
            "pinId": "D9"
          }
        },
        {
          "id": "w2",
          "from": {
            "componentId": "servo1",
            "pinId": "VCC"
          },
          "to": {
            "componentId": "uno1",
            "pinId": "5V"
          }
        },
        {
          "id": "w3",
          "from": {
            "componentId": "servo1",
            "pinId": "GND"
          },
          "to": {
            "componentId": "uno1",
            "pinId": "GND1"
          }
        }
      ]
    }
  },
  {
    "id": "seven-segment-counter",
    "order": 6,
    "name": {
      "key": "templates.seven-segment-counter.name",
      "ru": "7-сегментный счётчик"
    },
    "description": {
      "key": "templates.seven-segment-counter.description",
      "ru": "Индикатор с общим катодом: сегменты a–g на D2–D8 через резисторы 330 Ω, цифры 0–9 раз в секунду."
    },
    "code": "// Сегменты a–g подключены к D2–D8.\nconst byte SEGMENT_PINS[7] = {2, 3, 4, 5, 6, 7, 8};\n// Биты 0–6 — сегменты a–g.\nconst byte DIGITS[10] = {\n  0b0111111, 0b0000110, 0b1011011, 0b1001111, 0b1100110,\n  0b1101101, 0b1111101, 0b0000111, 0b1111111, 0b1101111,\n};\n\nvoid show(byte digit) {\n  for (byte i = 0; i < 7; i++) {\n    digitalWrite(SEGMENT_PINS[i], bitRead(DIGITS[digit], i) ? HIGH : LOW);\n  }\n}\n\nvoid setup() {\n  for (byte i = 0; i < 7; i++) {\n    pinMode(SEGMENT_PINS[i], OUTPUT);\n  }\n}\n\nvoid loop() {\n  for (byte digit = 0; digit < 10; digit++) {\n    show(digit);\n    delay(1000);\n  }\n}\n",
    "circuit": {
      "schemaVersion": 1,
      "board": {
        "id": "uno1",
        "type": "arduino-uno-r3",
        "position": {
          "x": 0,
          "y": 0
        },
        "rotation": 0
      },
      "components": [
        {
          "id": "r1",
          "type": "resistor",
          "position": {
            "x": 16,
            "y": 16
          },
          "rotation": 0,
          "properties": {
            "resistanceOhms": 330
          }
        },
        {
          "id": "r2",
          "type": "resistor",
          "position": {
            "x": 16,
            "y": 15
          },
          "rotation": 0,
          "properties": {
            "resistanceOhms": 330
          }
        },
        {
          "id": "r3",
          "type": "resistor",
          "position": {
            "x": 16,
            "y": 14
          },
          "rotation": 0,
          "properties": {
            "resistanceOhms": 330
          }
        },
        {
          "id": "r4",
          "type": "resistor",
          "position": {
            "x": 16,
            "y": 13
          },
          "rotation": 0,
          "properties": {
            "resistanceOhms": 330
          }
        },
        {
          "id": "r5",
          "type": "resistor",
          "position": {
            "x": 16,
            "y": 12
          },
          "rotation": 0,
          "properties": {
            "resistanceOhms": 330
          }
        },
        {
          "id": "r6",
          "type": "resistor",
          "position": {
            "x": 16,
            "y": 11
          },
          "rotation": 0,
          "properties": {
            "resistanceOhms": 330
          }
        },
        {
          "id": "r7",
          "type": "resistor",
          "position": {
            "x": 16,
            "y": 10
          },
          "rotation": 0,
          "properties": {
            "resistanceOhms": 330
          }
        },
        {
          "id": "seg1",
          "type": "seven-segment",
          "position": {
            "x": 26,
            "y": 10
          },
          "rotation": 0,
          "properties": {
            "commonType": "common-cathode",
            "color": "red"
          }
        }
      ],
      "connections": [
        {
          "id": "w1",
          "from": {
            "componentId": "uno1",
            "pinId": "D2"
          },
          "to": {
            "componentId": "r1",
            "pinId": "1"
          }
        },
        {
          "id": "w2",
          "from": {
            "componentId": "r1",
            "pinId": "2"
          },
          "to": {
            "componentId": "seg1",
            "pinId": "a"
          }
        },
        {
          "id": "w3",
          "from": {
            "componentId": "uno1",
            "pinId": "D3"
          },
          "to": {
            "componentId": "r2",
            "pinId": "1"
          }
        },
        {
          "id": "w4",
          "from": {
            "componentId": "r2",
            "pinId": "2"
          },
          "to": {
            "componentId": "seg1",
            "pinId": "b"
          }
        },
        {
          "id": "w5",
          "from": {
            "componentId": "uno1",
            "pinId": "D4"
          },
          "to": {
            "componentId": "r3",
            "pinId": "1"
          }
        },
        {
          "id": "w6",
          "from": {
            "componentId": "r3",
            "pinId": "2"
          },
          "to": {
            "componentId": "seg1",
            "pinId": "c"
          }
        },
        {
          "id": "w7",
          "from": {
            "componentId": "uno1",
            "pinId": "D5"
          },
          "to": {
            "componentId": "r4",
            "pinId": "1"
          }
        },
        {
          "id": "w8",
          "from": {
            "componentId": "r4",
            "pinId": "2"
          },
          "to": {
            "componentId": "seg1",
            "pinId": "d"
          }
        },
        {
          "id": "w9",
          "from": {
            "componentId": "uno1",
            "pinId": "D6"
          },
          "to": {
            "componentId": "r5",
            "pinId": "1"
          }
        },
        {
          "id": "w10",
          "from": {
            "componentId": "r5",
            "pinId": "2"
          },
          "to": {
            "componentId": "seg1",
            "pinId": "e"
          }
        },
        {
          "id": "w11",
          "from": {
            "componentId": "uno1",
            "pinId": "D7"
          },
          "to": {
            "componentId": "r6",
            "pinId": "1"
          }
        },
        {
          "id": "w12",
          "from": {
            "componentId": "r6",
            "pinId": "2"
          },
          "to": {
            "componentId": "seg1",
            "pinId": "f"
          }
        },
        {
          "id": "w13",
          "from": {
            "componentId": "uno1",
            "pinId": "D8"
          },
          "to": {
            "componentId": "r7",
            "pinId": "1"
          }
        },
        {
          "id": "w14",
          "from": {
            "componentId": "r7",
            "pinId": "2"
          },
          "to": {
            "componentId": "seg1",
            "pinId": "g"
          }
        },
        {
          "id": "w15",
          "from": {
            "componentId": "seg1",
            "pinId": "COM2"
          },
          "to": {
            "componentId": "uno1",
            "pinId": "GND3"
          }
        }
      ]
    }
  }
];
