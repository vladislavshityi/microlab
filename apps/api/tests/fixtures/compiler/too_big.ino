const unsigned char a[20000] PROGMEM = {1};
const unsigned char b[20000] PROGMEM = {2};

void setup() {
  Serial.begin(9600);
  Serial.write(pgm_read_byte(&a[analogRead(A0)]));
  Serial.write(pgm_read_byte(&b[analogRead(A1)]));
}

void loop() {}
