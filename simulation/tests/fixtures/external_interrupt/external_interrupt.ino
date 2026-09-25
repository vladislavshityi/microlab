volatile unsigned int count = 0;

void onFalling() {
  count++;
}

void setup() {
  pinMode(2, INPUT_PULLUP);
  attachInterrupt(digitalPinToInterrupt(2), onFalling, FALLING);
  Serial.begin(115200);
}

void loop() {
  noInterrupts();
  unsigned int c = count;
  interrupts();
  Serial.println(c);
  delay(50);
}
