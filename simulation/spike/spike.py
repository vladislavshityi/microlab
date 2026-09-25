"""Spike: минимальный цикл CPU AVR на чистом Python (только для замера скорости).

Программа — типичный цикл задержки:
    0: ldi r24, 0xFF
    1: ldi r25, 0xFF
    2: sbiw r24, 1
    3: brne .-4      (-> 2)
    4: rjmp .-12     (-> 0)
Декодирование выполняется на каждой выборке, как в полном эмуляторе.
"""

import time

PROGRAM = [0xEF8F, 0xEF9F, 0x9701, 0xF7F1, 0xCFFB]


def run(target_cycles: int) -> int:
    flash = PROGRAM
    r = [0] * 32
    pc = 0
    cycles = 0
    z = False
    while cycles < target_cycles:
        op = flash[pc]
        if op & 0xF000 == 0xE000:  # LDI
            r[16 + ((op >> 4) & 0xF)] = ((op >> 4) & 0xF0) | (op & 0xF)
            pc += 1
            cycles += 1
        elif op & 0xFF00 == 0x9700:  # SBIW
            d = 24 + ((op >> 3) & 0x6)
            k = ((op >> 2) & 0x30) | (op & 0xF)
            v = ((r[d + 1] << 8) | r[d]) - k
            v &= 0xFFFF
            r[d] = v & 0xFF
            r[d + 1] = v >> 8
            z = v == 0
            pc += 1
            cycles += 2
        elif op & 0xFC07 == 0xF401:  # BRNE
            if not z:
                k = (op >> 3) & 0x7F
                if k & 0x40:
                    k -= 0x80
                pc += k + 1
                cycles += 2
            else:
                pc += 1
                cycles += 1
        elif op & 0xF000 == 0xC000:  # RJMP
            k = op & 0xFFF
            if k & 0x800:
                k -= 0x1000
            pc += k + 1
            cycles += 2
        else:
            raise RuntimeError(f"opcode {op:#06x}")
    return cycles


if __name__ == "__main__":
    n = 20_000_000
    t0 = time.perf_counter()
    c = run(n)
    dt = time.perf_counter() - t0
    print(f"python: {c} cycles in {dt:.3f} s -> {c / dt / 1e6:.2f} MHz simulated")
