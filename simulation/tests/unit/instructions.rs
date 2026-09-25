//! Семантика инструкций AVR: флаги SREG и такты (AVR Instruction Set Manual DS40002198B,
//! раздел 6 и таблицы 5-2…5-6, колонка AVRe, 16-битный PC).

use avr_core::{EventKind, Mcu};

const C: u8 = 1 << 0;
const Z: u8 = 1 << 1;
const N: u8 = 1 << 2;
const V: u8 = 1 << 3;
const S: u8 = 1 << 4;
const H: u8 = 1 << 5;
const T: u8 = 1 << 6;
const I: u8 = 1 << 7;

/// Двухрегистровые инструкции: `base | r4<<9 | d<<4 | r3..0`.
fn rr(base: u16, d: u16, r: u16) -> u16 {
    base | ((r & 0x10) << 5) | (d << 4) | (r & 0x0F)
}

/// Инструкции с непосредственным операндом (r16–r31).
fn imm(base: u16, d: u16, k: u16) -> u16 {
    base | ((k & 0xF0) << 4) | ((d - 16) << 4) | (k & 0x0F)
}

fn one_reg(base: u16, d: u16) -> u16 {
    base | (d << 4)
}

fn ldi(d: u16, k: u16) -> u16 {
    imm(0xE000, d, k)
}

const NOP: u16 = 0x0000;
const SEI: u16 = 0x9478;

fn mcu(words: &[u16]) -> Mcu {
    let mut m = Mcu::new();
    m.load_words(words);
    m
}

/// Выполняет одну инструкцию и возвращает её такты.
fn step(m: &mut Mcu) -> u64 {
    let c0 = m.cycles();
    m.step();
    m.cycles() - c0
}

/// Выполняет двухоперандную ALU-инструкцию и возвращает (результат, SREG).
fn alu(op: u16, a: u8, b: u8, sreg_in: u8) -> (u8, u8) {
    let mut m = mcu(&[op]);
    m.set_reg(16, a);
    m.set_reg(17, b);
    m.set_sreg(sreg_in);
    assert_eq!(step(&mut m), 1);
    (m.reg(16), m.sreg())
}

fn alu1(op: u16, a: u8, sreg_in: u8) -> (u8, u8) {
    alu(op, a, 0, sreg_in)
}

const ADD: u16 = 0x0C00;
const ADC: u16 = 0x1C00;
const SUB: u16 = 0x1800;
const SBC: u16 = 0x0800;
const CP: u16 = 0x1400;
const CPC: u16 = 0x0400;
const AND: u16 = 0x2000;
const OR: u16 = 0x2800;
const EOR: u16 = 0x2400;

#[test]
fn add_flags() {
    assert_eq!(alu(rr(ADD, 16, 17), 0x7F, 0x01, 0), (0x80, N | V | H));
    assert_eq!(alu(rr(ADD, 16, 17), 0xFF, 0x01, 0), (0x00, Z | C | H));
    assert_eq!(alu(rr(ADD, 16, 17), 0x80, 0x80, 0), (0x00, Z | C | V | S));
    assert_eq!(
        alu(rr(ADD, 16, 17), 0x01, 0x02, C),
        (0x03, 0),
        "ADD не использует C"
    );
}

#[test]
fn adc_uses_carry() {
    assert_eq!(alu(rr(ADC, 16, 17), 0xFF, 0x00, C), (0x00, Z | C | H));
    assert_eq!(alu(rr(ADC, 16, 17), 0x0E, 0x01, C), (0x10, H));
}

#[test]
fn sub_flags() {
    assert_eq!(alu(rr(SUB, 16, 17), 0x00, 0x01, 0), (0xFF, C | N | S | H));
    assert_eq!(alu(rr(SUB, 16, 17), 0x80, 0x01, 0), (0x7F, V | S | H));
    assert_eq!(alu(rr(SUB, 16, 17), 0x05, 0x05, 0), (0x00, Z));
    let (r, f) = alu(imm(0x5000, 16, 0x10), 0x20, 0, 0); // SUBI r16, 0x10
    assert_eq!((r, f), (0x10, 0));
}

#[test]
fn sbc_keeps_zero_flag_chain() {
    // Результат 0: Z остаётся прежним (1 → 1, 0 → 0).
    assert_eq!(alu(rr(SBC, 16, 17), 0x05, 0x04, C | Z).1 & Z, Z);
    assert_eq!(alu(rr(SBC, 16, 17), 0x05, 0x04, C).1 & Z, 0);
    // Ненулевой результат сбрасывает Z.
    assert_eq!(alu(rr(SBC, 16, 17), 0x05, 0x01, Z), (0x04, 0));
    // SBCI r16, 0x00 с заёмом из 0.
    assert_eq!(alu(imm(0x4000, 16, 0), 0x00, 0, C), (0xFF, C | N | S | H));
}

#[test]
fn cp_cpc_compare_16_bit() {
    // cp r16,r18 ; cpc r17,r19 — 0x0100 == 0x0100
    let mut m = mcu(&[rr(CP, 16, 18), rr(CPC, 17, 19)]);
    m.set_reg(16, 0x00);
    m.set_reg(17, 0x01);
    m.set_reg(18, 0x00);
    m.set_reg(19, 0x01);
    m.step();
    m.step();
    assert_eq!(m.sreg() & (Z | C), Z);
    assert_eq!(
        (m.reg(16), m.reg(17)),
        (0x00, 0x01),
        "CP/CPC не меняют регистры"
    );
    // 0x00FF < 0x0100
    let mut m = mcu(&[rr(CP, 16, 18), rr(CPC, 17, 19)]);
    m.set_reg(16, 0xFF);
    m.set_reg(17, 0x00);
    m.set_reg(18, 0x00);
    m.set_reg(19, 0x01);
    m.step();
    m.step();
    assert_eq!(m.sreg() & (Z | C), C);
    // CPI
    assert_eq!(alu(imm(0x3000, 16, 0x42), 0x42, 0, 0), (0x42, Z));
}

#[test]
fn logic_ops_clear_v() {
    assert_eq!(alu(rr(AND, 16, 17), 0xF0, 0x0F, V), (0x00, Z));
    assert_eq!(alu(rr(OR, 16, 17), 0x80, 0x01, V | C), (0x81, N | S | C));
    assert_eq!(alu(rr(EOR, 16, 17), 0xAA, 0xAA, 0), (0x00, Z));
    assert_eq!(alu(imm(0x7000, 16, 0x80), 0xFF, 0, 0), (0x80, N | S)); // ANDI
    assert_eq!(alu(imm(0x6000, 16, 0x01), 0x00, 0, 0), (0x01, 0)); // ORI
}

#[test]
fn shifts_and_rotates() {
    // LSR
    assert_eq!(alu1(one_reg(0x9406, 16), 0x01, 0), (0x00, Z | C | V | S));
    assert_eq!(alu1(one_reg(0x9406, 16), 0x80, 0), (0x40, 0));
    // ROR с переносом
    assert_eq!(alu1(one_reg(0x9407, 16), 0x02, C), (0x81, N | V));
    assert_eq!(alu1(one_reg(0x9407, 16), 0x01, 0), (0x00, Z | C | V | S));
    // ASR сохраняет знак
    assert_eq!(alu1(one_reg(0x9405, 16), 0x81, 0), (0xC0, C | N | S));
    // SWAP не меняет флаги
    assert_eq!(alu1(one_reg(0x9402, 16), 0x12, C), (0x21, C));
    // LSL = ADD Rd,Rd; ROL = ADC Rd,Rd
    assert_eq!(alu1(rr(ADD, 16, 16), 0x81, 0), (0x02, C | V | S));
    assert_eq!(alu1(rr(ADC, 16, 16), 0x40, C), (0x81, N | V));
}

#[test]
fn inc_dec_com_neg() {
    assert_eq!(
        alu1(one_reg(0x9403, 16), 0x7F, C),
        (0x80, N | V | C),
        "INC: C не меняется"
    );
    assert_eq!(alu1(one_reg(0x9403, 16), 0xFF, 0), (0x00, Z));
    assert_eq!(alu1(one_reg(0x940A, 16), 0x80, 0), (0x7F, V | S));
    assert_eq!(alu1(one_reg(0x940A, 16), 0x01, 0), (0x00, Z));
    assert_eq!(alu1(one_reg(0x9400, 16), 0x55, 0), (0xAA, C | N | S));
    assert_eq!(alu1(one_reg(0x9401, 16), 0x80, 0), (0x80, C | N | V));
    assert_eq!(alu1(one_reg(0x9401, 16), 0x00, C), (0x00, Z));
    assert_eq!(alu1(one_reg(0x9401, 16), 0x01, 0), (0xFF, C | N | S | H));
}

fn mul(op: u16, a: u8, b: u8) -> (u16, u8, u64) {
    let mut m = mcu(&[op]);
    m.set_reg(16, a);
    m.set_reg(17, b);
    let c = step(&mut m);
    ((m.reg(1) as u16) << 8 | m.reg(0) as u16, m.sreg(), c)
}

#[test]
fn multiply_family() {
    assert_eq!(mul(rr(0x9C00, 16, 17), 0xFF, 0xFF), (0xFE01, C, 2)); // MUL
    assert_eq!(mul(rr(0x9C00, 16, 17), 0x00, 0x12), (0x0000, Z, 2));
    assert_eq!(mul(0x0201, 0xFF, 0xFF), (0x0001, 0, 2)); // MULS r16,r17: (-1)·(-1)
    assert_eq!(mul(0x0201, 0x80, 0x7F), (0xC080, C, 2)); // -128·127 = -16256
    assert_eq!(mul(0x0301, 0xFF, 0xFF), (0xFF01, C, 2)); // MULSU: (-1)·255
    assert_eq!(mul(0x0309, 0x80, 0x80), (0x8000, 0, 2)); // FMUL: 0.5·0.5 = 0.25 (1.15) → 0x2000<<1
    assert_eq!(mul(0x0381, 0x80, 0x80), (0x8000, 0, 2)); // FMULS: (-1)·(-1) переполнение 1.15
    assert_eq!(mul(0x0389, 0xC0, 0x80), (0xC000, C, 2)); // FMULSU: -0.5·0.5 → -0.25
}

#[test]
fn adiw_sbiw() {
    // ADIW r24, 1 при 0xFFFF → 0, C, Z
    let mut m = mcu(&[0x9601]);
    m.set_reg(24, 0xFF);
    m.set_reg(25, 0xFF);
    assert_eq!(step(&mut m), 2);
    assert_eq!((m.reg(24), m.reg(25), m.sreg()), (0, 0, Z | C));
    // ADIW r24, 1 при 0x7FFF → 0x8000, V
    let mut m = mcu(&[0x9601]);
    m.set_reg(24, 0xFF);
    m.set_reg(25, 0x7F);
    m.step();
    assert_eq!(m.sreg(), N | V);
    // SBIW r30, 63 при 0x0000 → 0xFFC1, C, N
    let mut m = mcu(&[0x97FF]);
    assert_eq!(step(&mut m), 2);
    assert_eq!((m.reg(30), m.reg(31), m.sreg()), (0xC1, 0xFF, C | N | S));
}

#[test]
fn branches_and_timing() {
    // ldi r16,1 ; dec r16 ; brne -2 (не берётся) ; brne +0 после Z=1
    let mut m = mcu(&[ldi(16, 1), one_reg(0x940A, 16), 0xF7F1, NOP]);
    m.step();
    m.step();
    assert_eq!(step(&mut m), 1, "BRNE не взят: 1 такт");
    assert_eq!(m.pc_bytes(), 6);
    // Взятый переход: 2 такта.
    let mut m = mcu(&[ldi(16, 2), one_reg(0x940A, 16), 0xF7F1]);
    m.step();
    m.step();
    assert_eq!(step(&mut m), 2);
    assert_eq!(m.pc_bytes(), 2);
    // RJMP -1 (сам на себя): 2 такта.
    let mut m = mcu(&[0xCFFF]);
    assert_eq!(step(&mut m), 2);
    assert_eq!(m.pc_bytes(), 0);
    // JMP 0x0010 (слова): 3 такта.
    let mut m = mcu(&[0x940C, 0x0010]);
    assert_eq!(step(&mut m), 3);
    assert_eq!(m.pc_bytes(), 0x20);
    // IJMP через Z
    let mut m = mcu(&[0x9409]);
    m.set_reg(30, 0x05);
    assert_eq!(step(&mut m), 2);
    assert_eq!(m.pc_bytes(), 10);
}

#[test]
fn skips_count_two_word_instructions() {
    // sbrs r16,0 ; lds r0,0x0100 ; nop
    let mut m = mcu(&[0xFF00, 0x9000, 0x0100, NOP]);
    m.set_reg(16, 1);
    assert_eq!(step(&mut m), 3, "пропуск двухсловной инструкции: 3 такта");
    assert_eq!(m.pc_bytes(), 6);
    // sbrc r16,0 при бите 1 — без пропуска
    let mut m = mcu(&[0xFD00, NOP]);
    m.set_reg(16, 1);
    assert_eq!(step(&mut m), 1);
    assert_eq!(m.pc_bytes(), 2);
    // cpse r16,r17 при равенстве — пропуск одного слова, 2 такта
    let mut m = mcu(&[rr(0x1000, 16, 17), NOP, NOP]);
    assert_eq!(step(&mut m), 2);
    assert_eq!(m.pc_bytes(), 4);
}

#[test]
fn load_store_addressing_modes() {
    // ldi r26,0x00 ; ldi r27,0x01 ; st X+,r16 ; st X,r17 ; ld r18,-X ; ldd r19,Y+2 ; std Z+5,r16 ; lds r20,0x0101 ; sts 0x0200,r20
    let prog = [
        ldi(26, 0x00),
        ldi(27, 0x01),
        0x930D, // st X+, r16
        0x931C, // st X, r17
        0x912E, // ld r18, -X
        0x813A, // ldd r19, Y+2
        0x8305, // std Z+5, r16
        0x9140,
        0x0101, // lds r20, 0x0101
        0x9340,
        0x0200, // sts 0x0200, r20
    ];
    let mut m = mcu(&prog);
    m.set_reg(16, 0xAA);
    m.set_reg(17, 0xBB);
    m.set_reg(28, 0x00); // Y = 0x0100
    m.set_reg(29, 0x01);
    m.set_reg(30, 0x00); // Z = 0x0300
    m.set_reg(31, 0x03);
    m.step();
    m.step();
    assert_eq!(step(&mut m), 2);
    assert_eq!(m.peek(0x0100), 0xAA);
    assert_eq!((m.reg(26), m.reg(27)), (0x01, 0x01), "X после X+");
    assert_eq!(step(&mut m), 2);
    assert_eq!(m.peek(0x0101), 0xBB);
    assert_eq!(step(&mut m), 2);
    assert_eq!(m.reg(18), 0xAA, "ld -X читает 0x0100");
    assert_eq!((m.reg(26), m.reg(27)), (0x00, 0x01));
    m.poke(0x0102, 0x5A);
    assert_eq!(step(&mut m), 2);
    assert_eq!(m.reg(19), 0x5A);
    assert_eq!(step(&mut m), 2);
    assert_eq!(m.peek(0x0305), 0xAA);
    assert_eq!(step(&mut m), 2);
    assert_eq!(m.reg(20), 0xBB);
    assert_eq!(step(&mut m), 2);
    assert_eq!(m.peek(0x0200), 0xBB);
    assert_eq!(m.pc_bytes(), 22);
}

#[test]
fn register_file_is_memory_mapped() {
    // ld r16, Z с Z = 5 читает r5
    let mut m = mcu(&[0x8100]);
    m.set_reg(5, 0x77);
    m.set_reg(30, 5);
    m.step();
    assert_eq!(m.reg(16), 0x77);
}

#[test]
fn push_pop_call_ret() {
    // call 0x0004 ; nop ; nop ; nop ; push r16 ; pop r17 ; ret
    let prog = [0x940E, 0x0004, NOP, NOP, 0x930F, 0x911F, 0x9508];
    let mut m = mcu(&prog);
    m.set_reg(16, 0x3C);
    assert_eq!(step(&mut m), 4, "CALL: 4 такта");
    assert_eq!(m.sp(), 0x08FD);
    // Адрес возврата — слово 2: младший байт по старшему адресу.
    assert_eq!((m.peek(0x08FF), m.peek(0x08FE)), (0x02, 0x00));
    assert_eq!(step(&mut m), 2, "PUSH: 2 такта");
    assert_eq!(m.peek(0x08FD), 0x3C);
    assert_eq!(step(&mut m), 2, "POP: 2 такта");
    assert_eq!(m.reg(17), 0x3C);
    assert_eq!(step(&mut m), 4, "RET: 4 такта");
    assert_eq!(m.pc_bytes(), 4);
    assert_eq!(m.sp(), 0x08FF);
    // RCALL +1: 3 такта
    let mut m = mcu(&[0xD001, NOP, NOP]);
    assert_eq!(step(&mut m), 3);
    assert_eq!(m.pc_bytes(), 4);
}

#[test]
fn sreg_bit_ops_and_t_flag() {
    // set ; bld r16,3 ; bst r17,0 ; clt
    let mut m = mcu(&[0x9468, 0xF903, 0xFB10, 0x94E8]);
    m.set_reg(17, 0x00);
    m.step();
    assert_eq!(m.sreg(), T);
    m.step();
    assert_eq!(m.reg(16), 0x08);
    m.step();
    assert_eq!(m.sreg(), 0, "BST бита 0 = 0 сбрасывает T");
    m.step();
    assert_eq!(m.sreg(), 0);
}

#[test]
fn interrupt_entry_latency_and_reti() {
    // 0x0000: jmp 0x0010; вектор INT0 (слово 2): reti.
    // 0x0010: ldi r16,1 ; out EIMSK(0x1D),r16 ; sei ; nop ; nop
    // EICRA = 0 — запрос INT0 по низкому уровню; на D2 подан внешний LOW.
    let mut prog = vec![NOP; 0x16];
    prog[0] = 0x940C;
    prog[1] = 0x0010;
    prog[2] = 0x9518;
    prog[0x10] = ldi(16, 1);
    prog[0x11] = 0xBB0D;
    prog[0x12] = SEI;
    let mut m = mcu(&prog);
    m.set_input("D2", Some(false)).unwrap();
    for _ in 0..4 {
        m.step(); // jmp, ldi, out, sei
    }
    assert_eq!(m.sreg() & I, I);
    // Инструкция после SEI выполняется до обработки прерывания (datasheet стр. 16).
    assert_eq!(step(&mut m), 1);
    assert_eq!(m.pc_bytes(), 0x28);
    // Вход в прерывание: 4 такта (стр. 16), затем RETI — 4 такта.
    assert_eq!(step(&mut m), 4 + 4);
    assert_eq!(m.sreg() & I, I, "RETI устанавливает I");
    assert_eq!(m.pc_bytes(), 0x28, "возврат в прерванную точку");
    assert_eq!(m.sp(), 0x08FF);
    // После RETI выполняется ещё одна инструкция, даже если запрос активен (стр. 15).
    assert_eq!(step(&mut m), 1);
    assert_eq!(m.pc_bytes(), 0x2A);
    m.set_input("D2", Some(true)).unwrap();
    assert_eq!(step(&mut m), 1, "запрос снят — прерывания нет");
}

#[test]
fn invalid_opcode_halts_with_error() {
    let mut m = mcu(&[0xFFFF]);
    m.step();
    assert!(m.halted());
    let ev = m.drain_events();
    assert!(ev.iter().any(|e| matches!(
        &e.kind,
        EventKind::SimulationError {
            code: avr_core::ErrorCode::InvalidOpcode,
            ..
        }
    )));
}

#[test]
fn pin_register_write_toggles_port_and_pullup_rules() {
    // ldi r16,0x20 ; out DDRB(0x04), r16 ; out PINB(0x03), r16 ; out PINB, r16 ; sbi PINB,5
    let mut m = mcu(&[ldi(16, 0x20), 0xB904, 0xB903, 0xB903, 0x9A1D]);
    m.step();
    m.step();
    assert_eq!(
        m.pin_state("D13").unwrap().mode,
        avr_core::PinMode::OutputLow
    );
    m.step();
    assert_eq!(
        m.pin_state("D13").unwrap().mode,
        avr_core::PinMode::OutputHigh
    );
    m.step();
    assert_eq!(
        m.pin_state("D13").unwrap().mode,
        avr_core::PinMode::OutputLow
    );
    assert_eq!(step(&mut m), 2, "SBI: 2 такта");
    assert_eq!(
        m.pin_state("D13").unwrap().mode,
        avr_core::PinMode::OutputHigh
    );

    // DDR=0, PORT=1 → pull-up; MCUCR.PUD=1 отключает pull-up.
    // ldi r16,0x04 ; out PORTD(0x0B), r16 ; ldi r17,0x10 ; out MCUCR(0x35), r17
    let mut m = mcu(&[ldi(16, 0x04), 0xB90B, ldi(17, 0x10), 0xBF15]);
    m.step();
    m.step();
    let st = m.pin_state("D2").unwrap();
    assert_eq!(
        (st.mode, st.value, st.floating),
        (avr_core::PinMode::InputPullup, true, false)
    );
    m.step();
    m.step();
    let st = m.pin_state("D2").unwrap();
    assert_eq!(
        (st.mode, st.value, st.floating),
        (avr_core::PinMode::Input, false, true)
    );
}

#[test]
fn in_reads_pin_register_with_external_level() {
    // in r16, PIND(0x09)
    let mut m = mcu(&[0xB109]);
    m.set_input("D7", Some(true)).unwrap();
    m.step();
    assert_eq!(m.reg(16), 0x80);
}

#[test]
fn unsupported_peripheral_is_reported_once() {
    // sts SPCR(0x4C), r16 дважды
    let mut m = mcu(&[0x9300, 0x004C, 0x9300, 0x004C]);
    m.set_reg(16, 0x53);
    m.step();
    m.step();
    assert!(!m.halted());
    assert_eq!(m.peek(0x4C), 0x53, "значение сохраняется");
    let ev = m.drain_events();
    let n = ev
        .iter()
        .filter(|e| {
            matches!(
                &e.kind,
                EventKind::SimulationError {
                    code: avr_core::ErrorCode::UnsupportedPeripheral,
                    ..
                }
            )
        })
        .count();
    assert_eq!(n, 1);
}

/// Fast PWM Timer0 на D6 (OC0A): неинвертирующий режим, OCR0A = 100 → (OCR+1)/256 по модели
/// «сброс при совпадении, установка на BOTTOM»; частота 16 MHz / (64·256) = 976,5625 Гц.
#[test]
fn timer0_fast_pwm_on_d6() {
    let prog = [
        ldi(16, 0x83),
        0xBD04, // out TCCR0A(0x24), r16: COM0A1 | WGM01 | WGM00
        ldi(16, 100),
        0xBD07, // out OCR0A(0x27), r16
        ldi(16, 0x40),
        0xB90A, // out DDRD(0x0A), r16
        ldi(16, 0x03),
        0xBD05, // out TCCR0B(0x25), r16: делитель 64
        0xCFFF, // rjmp .-2
    ];
    let mut m = mcu(&prog);
    m.run_for(64 * 256 * 4);
    let pwm: Vec<_> = m
        .drain_events()
        .into_iter()
        .filter_map(|e| match e.kind {
            EventKind::PwmChanged {
                pin,
                high_ticks,
                period_ticks,
                frequency_hz,
            } => Some((pin, high_ticks, period_ticks, frequency_hz)),
            _ => None,
        })
        .collect();
    assert_eq!(pwm.len(), 1, "{pwm:?}");
    assert_eq!((pwm[0].0, pwm[0].1, pwm[0].2), ("D6", 101, 256));
    assert!((pwm[0].3 - 976.5625).abs() < 1e-9);
    assert_eq!(m.pin_state("D6").unwrap().mode, avr_core::PinMode::Pwm);
}

/// Timer0 overflow: TOV0 каждые 64·256 тактов, прерывание TIMER0_OVF (вектор 0x0020).
#[test]
fn timer0_overflow_interrupt_period() {
    let mut prog = vec![NOP; 0x40];
    prog[0] = 0x940C;
    prog[1] = 0x0030; // jmp 0x0030
                      // Вектор TIMER0 OVF — слово 0x0020: inc r20 ; reti
    prog[0x20] = one_reg(0x9403, 20);
    prog[0x21] = 0x9518;
    prog[0x30] = ldi(16, 0x01);
    prog[0x31] = 0x9300; // sts TIMSK0(0x6E), r16
    prog[0x32] = 0x006E;
    prog[0x33] = ldi(16, 0x03);
    prog[0x34] = 0xBD05; // out TCCR0B, r16
    prog[0x35] = SEI;
    prog[0x36] = 0xCFFF; // rjmp .-2
    let mut m = mcu(&prog);
    m.run_for(10 * 16_384 + 100);
    assert_eq!(m.reg(20), 10);
}
