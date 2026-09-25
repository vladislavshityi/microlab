//! Simulation Worker MicroLab.
//!
//! Отдельный процесс без доступа к файлам и сети: команды — JSON по одной на строку в stdin,
//! события и ответы — JSON по одному на строку в stdout (версия протокола 1).
//! Темп симуляции задаёт оркестратор: worker выполняет `run_for` так быстро, как может,
//! поэтому результат не зависит от нагрузки на хост.

mod protocol;

use std::io::{self, BufRead, BufWriter, Read, Write};

/// Предел длины одной команды (HEX образа 32 KB занимает ~90 KB).
const MAX_LINE: usize = 512 * 1024;

fn main() {
    let stdin = io::stdin();
    let mut input = stdin.lock();
    let stdout = io::stdout();
    let mut out = BufWriter::new(stdout.lock());
    let mut session = protocol::Session::new();
    let mut buf = Vec::with_capacity(4096);

    loop {
        buf.clear();
        let n = match (&mut input)
            .take(MAX_LINE as u64 + 1)
            .read_until(b'\n', &mut buf)
        {
            Ok(n) => n,
            Err(_) => break,
        };
        if n == 0 {
            break; // EOF: оркестратор закрыл канал
        }
        if buf.len() > MAX_LINE && buf.last() != Some(&b'\n') {
            // Слишком длинная строка: отбрасываем остаток до перевода строки.
            let _ = input.skip_until(b'\n');
            protocol::write_line(
                &mut out,
                &protocol::error_response(None, "COMMAND_TOO_LARGE", "command line exceeds limit"),
            );
            let _ = out.flush();
            continue;
        }
        let keep_running = session.handle_line(&buf, &mut out);
        if out.flush().is_err() || !keep_running {
            break;
        }
    }
}
