use avr_core::*;
fn main() {
    let name = std::env::args().nth(1).unwrap();
    let ms: u64 = std::env::args().nth(2).unwrap().parse().unwrap();
    let hex = std::fs::read_to_string(format!("tests/fixtures/{name}/{name}.hex")).unwrap();
    let mut m = Mcu::new();
    m.load_firmware(&parse_hex(&hex).unwrap());
    m.run_for(ms * CYCLES_PER_MS);
    for e in m.drain_events() {
        println!("{:>12} {:?}", e.cycle, e.kind);
    }
}
