// Одноразрядный индикатор с общим катодом: сегменты a–g на D2–D8, цифры 0–9 по кругу.
const byte SEGMENT_PINS[7] = {2, 3, 4, 5, 6, 7, 8};
const byte DIGITS[10] = {
  0b0111111, 0b0000110, 0b1011011, 0b1001111, 0b1100110,
  0b1101101, 0b1111101, 0b0000111, 0b1111111, 0b1101111,
};

void show(byte digit) {
  for (byte i = 0; i < 7; i++) {
    digitalWrite(SEGMENT_PINS[i], bitRead(DIGITS[digit], i) ? HIGH : LOW);
  }
}

void setup() {
  for (byte i = 0; i < 7; i++) {
    pinMode(SEGMENT_PINS[i], OUTPUT);
  }
}

void loop() {
  for (byte digit = 0; digit < 10; digit++) {
    show(digit);
    delay(200);
  }
}
