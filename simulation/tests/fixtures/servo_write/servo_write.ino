#include <Servo.h>

// Сервопривод на D9: 0°, 90°, 180° с паузой 1 с.
Servo servo;

void setup() {
  servo.attach(9);
  servo.write(0);
  delay(1000);
  servo.write(90);
  delay(1000);
  servo.write(180);
}

void loop() {
}
