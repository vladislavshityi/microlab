// RGB-светодиод: R — D9, G — D10, B — D11 (выводы PWM).
void setup() {
  pinMode(9, OUTPUT);
  pinMode(10, OUTPUT);
  pinMode(11, OUTPUT);
  analogWrite(9, 255);
  analogWrite(10, 128);
  analogWrite(11, 0);
}

void loop() {
}
