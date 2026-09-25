//! Декодирование инструкций AVR (ядро AVRe+, ATmega328P).
//!
//! Кодировки — по AVR Instruction Set Manual (DS40002198B), раздел 6.
//! Инструкции, отсутствующие у ATmega328P (ELPM, EIJMP, EICALL — таблица 7-2;
//! DES, XCH, LAS, LAC, LAT, SPM Z+ — только AVRxm), декодируются как `Invalid`.

/// Декодированная инструкция. Индексы регистров — абсолютные (0..=31).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Op {
    Nop,
    Movw {
        d: u8,
        r: u8,
    },
    Muls {
        d: u8,
        r: u8,
    },
    Mulsu {
        d: u8,
        r: u8,
    },
    Fmul {
        d: u8,
        r: u8,
    },
    Fmuls {
        d: u8,
        r: u8,
    },
    Fmulsu {
        d: u8,
        r: u8,
    },
    Mul {
        d: u8,
        r: u8,
    },
    Cpc {
        d: u8,
        r: u8,
    },
    Sbc {
        d: u8,
        r: u8,
    },
    Add {
        d: u8,
        r: u8,
    },
    Cpse {
        d: u8,
        r: u8,
    },
    Cp {
        d: u8,
        r: u8,
    },
    Sub {
        d: u8,
        r: u8,
    },
    Adc {
        d: u8,
        r: u8,
    },
    And {
        d: u8,
        r: u8,
    },
    Eor {
        d: u8,
        r: u8,
    },
    Or {
        d: u8,
        r: u8,
    },
    Mov {
        d: u8,
        r: u8,
    },
    Cpi {
        d: u8,
        k: u8,
    },
    Sbci {
        d: u8,
        k: u8,
    },
    Subi {
        d: u8,
        k: u8,
    },
    Ori {
        d: u8,
        k: u8,
    },
    Andi {
        d: u8,
        k: u8,
    },
    Ldi {
        d: u8,
        k: u8,
    },
    /// LD/LDD через указатель X/Y/Z. `ptr` — номер младшего регистра пары (26/28/30).
    Ld {
        d: u8,
        ptr: u8,
        mode: PtrMode,
    },
    St {
        r: u8,
        ptr: u8,
        mode: PtrMode,
    },
    Lds {
        d: u8,
        k: u16,
    },
    Sts {
        k: u16,
        r: u8,
    },
    /// LPM: `d` — приёмник, `inc` — Z+.
    Lpm {
        d: u8,
        inc: bool,
    },
    Spm,
    Pop {
        d: u8,
    },
    Push {
        r: u8,
    },
    Com {
        d: u8,
    },
    Neg {
        d: u8,
    },
    Swap {
        d: u8,
    },
    Inc {
        d: u8,
    },
    Asr {
        d: u8,
    },
    Lsr {
        d: u8,
    },
    Ror {
        d: u8,
    },
    Dec {
        d: u8,
    },
    Bset {
        s: u8,
    },
    Bclr {
        s: u8,
    },
    Ret,
    Reti,
    Sleep,
    Break,
    Wdr,
    Ijmp,
    Icall,
    Jmp {
        k: u32,
    },
    Call {
        k: u32,
    },
    Adiw {
        d: u8,
        k: u8,
    },
    Sbiw {
        d: u8,
        k: u8,
    },
    Cbi {
        a: u8,
        b: u8,
    },
    Sbic {
        a: u8,
        b: u8,
    },
    Sbi {
        a: u8,
        b: u8,
    },
    Sbis {
        a: u8,
        b: u8,
    },
    In {
        d: u8,
        a: u8,
    },
    Out {
        a: u8,
        r: u8,
    },
    Rjmp {
        k: i16,
    },
    Rcall {
        k: i16,
    },
    Brbs {
        s: u8,
        k: i8,
    },
    Brbc {
        s: u8,
        k: i8,
    },
    Bld {
        d: u8,
        b: u8,
    },
    Bst {
        d: u8,
        b: u8,
    },
    Sbrc {
        r: u8,
        b: u8,
    },
    Sbrs {
        r: u8,
        b: u8,
    },
    Invalid {
        opcode: u16,
    },
}

/// Режим адресации через указатель.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PtrMode {
    /// (ptr + q), в том числе q = 0 для простого LD/ST.
    Disp(u8),
    PostInc,
    PreDec,
}

/// Двухсловная ли инструкция (LDS, STS, JMP, CALL) — нужно для пропуска в CPSE/SBRx/SBIx.
#[inline]
pub fn is_two_word(op: u16) -> bool {
    let jmp_call = op & 0xFE0C == 0x940C;
    let lds_sts = op & 0xFC0F == 0x9000;
    jmp_call || lds_sts
}

#[inline]
fn d5(op: u16) -> u8 {
    ((op >> 4) & 0x1F) as u8
}

#[inline]
fn r5(op: u16) -> u8 {
    ((op & 0x0F) | ((op >> 5) & 0x10)) as u8
}

#[inline]
fn d4_hi(op: u16) -> u8 {
    16 + ((op >> 4) & 0x0F) as u8
}

#[inline]
fn k8(op: u16) -> u8 {
    (((op >> 4) & 0xF0) | (op & 0x0F)) as u8
}

/// Декодирует слово `op`; `next` — следующее слово программы (для 32-битных инструкций).
pub fn decode(op: u16, next: u16) -> Op {
    let d = d5(op);
    let r = r5(op);
    match op >> 12 {
        0x0 => match op & 0x0C00 {
            0x0000 => match op & 0x0300 {
                0x0000 if op == 0 => Op::Nop,
                0x0100 => Op::Movw {
                    d: (((op >> 4) & 0x0F) * 2) as u8,
                    r: ((op & 0x0F) * 2) as u8,
                },
                0x0200 => Op::Muls {
                    d: d4_hi(op),
                    r: 16 + (op & 0x0F) as u8,
                },
                0x0300 => {
                    let d = 16 + ((op >> 4) & 0x07) as u8;
                    let r = 16 + (op & 0x07) as u8;
                    match op & 0x0088 {
                        0x0000 => Op::Mulsu { d, r },
                        0x0008 => Op::Fmul { d, r },
                        0x0080 => Op::Fmuls { d, r },
                        _ => Op::Fmulsu { d, r },
                    }
                }
                _ => Op::Invalid { opcode: op },
            },
            0x0400 => Op::Cpc { d, r },
            0x0800 => Op::Sbc { d, r },
            _ => Op::Add { d, r },
        },
        0x1 => match op & 0x0C00 {
            0x0000 => Op::Cpse { d, r },
            0x0400 => Op::Cp { d, r },
            0x0800 => Op::Sub { d, r },
            _ => Op::Adc { d, r },
        },
        0x2 => match op & 0x0C00 {
            0x0000 => Op::And { d, r },
            0x0400 => Op::Eor { d, r },
            0x0800 => Op::Or { d, r },
            _ => Op::Mov { d, r },
        },
        0x3 => Op::Cpi {
            d: d4_hi(op),
            k: k8(op),
        },
        0x4 => Op::Sbci {
            d: d4_hi(op),
            k: k8(op),
        },
        0x5 => Op::Subi {
            d: d4_hi(op),
            k: k8(op),
        },
        0x6 => Op::Ori {
            d: d4_hi(op),
            k: k8(op),
        },
        0x7 => Op::Andi {
            d: d4_hi(op),
            k: k8(op),
        },
        0x8 | 0xA => {
            // LDD/STD (и LD/ST Y, Z без смещения): 10q0 qq s d dddd y qqq
            let q = ((op & 0x07) | ((op >> 7) & 0x18) | ((op >> 8) & 0x20)) as u8;
            let ptr = if op & 0x0008 != 0 { 28 } else { 30 };
            if op & 0x0200 != 0 {
                Op::St {
                    r: d,
                    ptr,
                    mode: PtrMode::Disp(q),
                }
            } else {
                Op::Ld {
                    d,
                    ptr,
                    mode: PtrMode::Disp(q),
                }
            }
        }
        0x9 => decode_9(op, next, d, r),
        0xB => {
            let a = ((op & 0x0F) | ((op >> 5) & 0x30)) as u8;
            if op & 0x0800 != 0 {
                Op::Out { a, r: d }
            } else {
                Op::In { d, a }
            }
        }
        0xC => Op::Rjmp {
            k: sign_extend(op & 0x0FFF, 12),
        },
        0xD => Op::Rcall {
            k: sign_extend(op & 0x0FFF, 12),
        },
        0xE => Op::Ldi {
            d: d4_hi(op),
            k: k8(op),
        },
        _ => {
            // 0xF: условные переходы и битовые операции с регистрами.
            let s = (op & 0x07) as u8;
            match op & 0x0C00 {
                0x0000 => Op::Brbs {
                    s,
                    k: sign_extend((op >> 3) & 0x7F, 7) as i8,
                },
                0x0400 => Op::Brbc {
                    s,
                    k: sign_extend((op >> 3) & 0x7F, 7) as i8,
                },
                _ if op & 0x0008 != 0 => Op::Invalid { opcode: op },
                0x0800 if op & 0x0200 == 0 => Op::Bld { d, b: s },
                0x0800 => Op::Bst { d, b: s },
                _ if op & 0x0200 == 0 => Op::Sbrc { r: d, b: s },
                _ => Op::Sbrs { r: d, b: s },
            }
        }
    }
}

fn decode_9(op: u16, next: u16, d: u8, r: u8) -> Op {
    match op & 0x0E00 {
        0x0000 => match op & 0x000F {
            0x0 => Op::Lds { d, k: next },
            0x1 => Op::Ld {
                d,
                ptr: 30,
                mode: PtrMode::PostInc,
            },
            0x2 => Op::Ld {
                d,
                ptr: 30,
                mode: PtrMode::PreDec,
            },
            0x4 => Op::Lpm { d, inc: false },
            0x5 => Op::Lpm { d, inc: true },
            0x9 => Op::Ld {
                d,
                ptr: 28,
                mode: PtrMode::PostInc,
            },
            0xA => Op::Ld {
                d,
                ptr: 28,
                mode: PtrMode::PreDec,
            },
            0xC => Op::Ld {
                d,
                ptr: 26,
                mode: PtrMode::Disp(0),
            },
            0xD => Op::Ld {
                d,
                ptr: 26,
                mode: PtrMode::PostInc,
            },
            0xE => Op::Ld {
                d,
                ptr: 26,
                mode: PtrMode::PreDec,
            },
            0xF => Op::Pop { d },
            _ => Op::Invalid { opcode: op }, // ELPM (6, 7) отсутствует у ATmega328P
        },
        0x0200 => match op & 0x000F {
            0x0 => Op::Sts { k: next, r: d },
            0x1 => Op::St {
                r: d,
                ptr: 30,
                mode: PtrMode::PostInc,
            },
            0x2 => Op::St {
                r: d,
                ptr: 30,
                mode: PtrMode::PreDec,
            },
            0x9 => Op::St {
                r: d,
                ptr: 28,
                mode: PtrMode::PostInc,
            },
            0xA => Op::St {
                r: d,
                ptr: 28,
                mode: PtrMode::PreDec,
            },
            0xC => Op::St {
                r: d,
                ptr: 26,
                mode: PtrMode::Disp(0),
            },
            0xD => Op::St {
                r: d,
                ptr: 26,
                mode: PtrMode::PostInc,
            },
            0xE => Op::St {
                r: d,
                ptr: 26,
                mode: PtrMode::PreDec,
            },
            0xF => Op::Push { r: d },
            _ => Op::Invalid { opcode: op }, // XCH/LAS/LAC/LAT — только AVRxm
        },
        0x0400 => decode_94_95(op, next, d),
        0x0600 => {
            let d = 24 + ((op >> 3) & 0x06) as u8;
            let k = (((op >> 2) & 0x30) | (op & 0x0F)) as u8;
            if op & 0x0100 == 0 {
                Op::Adiw { d, k }
            } else {
                Op::Sbiw { d, k }
            }
        }
        0x0800 | 0x0A00 => {
            let a = ((op >> 3) & 0x1F) as u8;
            let b = (op & 0x07) as u8;
            match op & 0x0300 {
                0x0000 => Op::Cbi { a, b },
                0x0100 => Op::Sbic { a, b },
                0x0200 => Op::Sbi { a, b },
                _ => Op::Sbis { a, b },
            }
        }
        _ => Op::Mul { d, r },
    }
}

fn decode_94_95(op: u16, next: u16, d: u8) -> Op {
    match op & 0x000F {
        0x0 => Op::Com { d },
        0x1 => Op::Neg { d },
        0x2 => Op::Swap { d },
        0x3 => Op::Inc { d },
        0x5 => Op::Asr { d },
        0x6 => Op::Lsr { d },
        0x7 => Op::Ror { d },
        0xA => Op::Dec { d },
        0xC | 0xD => Op::Jmp {
            k: (((op >> 3) & 0x3E) as u32 | (op & 1) as u32) << 16 | next as u32,
        },
        0xE | 0xF => Op::Call {
            k: (((op >> 3) & 0x3E) as u32 | (op & 1) as u32) << 16 | next as u32,
        },
        0x8 => match op {
            0x9508 => Op::Ret,
            0x9518 => Op::Reti,
            0x9588 => Op::Sleep,
            0x9598 => Op::Break,
            0x95A8 => Op::Wdr,
            0x95C8 => Op::Lpm { d: 0, inc: false },
            0x95E8 => Op::Spm,
            _ if op & 0xFF0F == 0x9408 => {
                let s = ((op >> 4) & 0x07) as u8;
                if op & 0x0080 == 0 {
                    Op::Bset { s }
                } else {
                    Op::Bclr { s }
                }
            }
            _ => Op::Invalid { opcode: op },
        },
        0x9 => match op {
            0x9409 => Op::Ijmp,
            0x9509 => Op::Icall,
            _ => Op::Invalid { opcode: op }, // EIJMP/EICALL отсутствуют у ATmega328P
        },
        _ => Op::Invalid { opcode: op }, // 0x4 (reserved), 0xB (DES)
    }
}

#[inline]
fn sign_extend(v: u16, bits: u32) -> i16 {
    let shift = 16 - bits;
    ((v << shift) as i16) >> shift
}
