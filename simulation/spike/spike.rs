// Spike: тот же минимальный цикл CPU AVR на Rust (только для замера скорости).
use std::time::Instant;

const PROGRAM: [u16; 5] = [0xEF8F, 0xEF9F, 0x9701, 0xF7F1, 0xCFFB];

fn run(flash: &[u16], target: u64) -> u64 {
    let mut r = [0u8; 32];
    let mut pc: usize = 0;
    let mut cycles: u64 = 0;
    let mut z = false;
    while cycles < target {
        let op = flash[pc];
        if op & 0xF000 == 0xE000 {
            r[16 + ((op >> 4) & 0xF) as usize] = (((op >> 4) & 0xF0) | (op & 0xF)) as u8;
            pc += 1;
            cycles += 1;
        } else if op & 0xFF00 == 0x9700 {
            let d = 24 + ((op >> 3) & 0x6) as usize;
            let k = ((op >> 2) & 0x30) | (op & 0xF);
            let v = (((r[d + 1] as u16) << 8) | r[d] as u16).wrapping_sub(k);
            r[d] = v as u8;
            r[d + 1] = (v >> 8) as u8;
            z = v == 0;
            pc += 1;
            cycles += 2;
        } else if op & 0xFC07 == 0xF401 {
            if !z {
                let k = (((op >> 3) & 0x7F) as i16) << 9 >> 9;
                pc = (pc as isize + k as isize + 1) as usize;
                cycles += 2;
            } else {
                pc += 1;
                cycles += 1;
            }
        } else if op & 0xF000 == 0xC000 {
            let k = ((op & 0xFFF) as i16) << 4 >> 4;
            pc = (pc as isize + k as isize + 1) as usize;
            cycles += 2;
        } else {
            panic!("opcode {op:#06x}");
        }
    }
    cycles
}

fn main() {
    let flash = std::hint::black_box(PROGRAM.to_vec());
    let n = 2_000_000_000u64;
    let t0 = Instant::now();
    let c = run(&flash, n);
    let dt = t0.elapsed().as_secs_f64();
    println!("rust: {c} cycles in {dt:.3} s -> {:.1} MHz simulated", c as f64 / dt / 1e6);
}
