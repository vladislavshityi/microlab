//! Загрузчик Intel HEX в память программ (32 KB flash ATmega328P).

use std::fmt;

/// Размер flash ATmega328P в байтах.
pub const FLASH_BYTES: usize = 32 * 1024;

/// Максимальная длина HEX-файла: образ 32 KB в Intel HEX занимает ~90 KB.
pub const MAX_HEX_TEXT: usize = 256 * 1024;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum HexError {
    TooLarge,
    Syntax { line: usize, message: &'static str },
    Checksum { line: usize },
    AddressOutOfRange { line: usize, address: u32 },
    UnsupportedRecord { line: usize, record_type: u8 },
    MissingEof,
    Empty,
}

impl fmt::Display for HexError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            HexError::TooLarge => write!(f, "HEX file is too large"),
            HexError::Syntax { line, message } => write!(f, "line {line}: {message}"),
            HexError::Checksum { line } => write!(f, "line {line}: checksum mismatch"),
            HexError::AddressOutOfRange { line, address } => {
                write!(
                    f,
                    "line {line}: address {address:#x} is outside 32 KB flash"
                )
            }
            HexError::UnsupportedRecord { line, record_type } => {
                write!(f, "line {line}: unsupported record type {record_type:02X}")
            }
            HexError::MissingEof => write!(f, "missing EOF record"),
            HexError::Empty => write!(f, "HEX file contains no data"),
        }
    }
}

impl std::error::Error for HexError {}

/// Образ flash. Незаписанные байты равны 0xFF (стёртая flash).
pub struct FlashImage {
    pub bytes: Box<[u8; FLASH_BYTES]>,
    /// Максимальный записанный адрес + 1.
    pub used: usize,
}

fn hex_byte(s: &[u8], line: usize) -> Result<u8, HexError> {
    let v = |c: u8| match c {
        b'0'..=b'9' => Some(c - b'0'),
        b'a'..=b'f' => Some(c - b'a' + 10),
        b'A'..=b'F' => Some(c - b'A' + 10),
        _ => None,
    };
    match (v(s[0]), v(s[1])) {
        (Some(h), Some(l)) => Ok(h << 4 | l),
        _ => Err(HexError::Syntax {
            line,
            message: "invalid hex digit",
        }),
    }
}

/// Разбирает Intel HEX. Поддерживаются записи 00 (data), 01 (EOF),
/// 02 (extended segment address), 04 (extended linear address), 03/05 (start address — игнорируются).
pub fn parse(text: &str) -> Result<FlashImage, HexError> {
    if text.len() > MAX_HEX_TEXT {
        return Err(HexError::TooLarge);
    }
    let mut bytes = Box::new([0xFFu8; FLASH_BYTES]);
    let mut used = 0usize;
    let mut base: u32 = 0;
    let mut eof = false;
    let mut any = false;

    for (idx, raw) in text.lines().enumerate() {
        let line = idx + 1;
        let raw = raw.trim();
        if raw.is_empty() {
            continue;
        }
        if eof {
            return Err(HexError::Syntax {
                line,
                message: "data after EOF record",
            });
        }
        let b = raw.as_bytes();
        if b[0] != b':' || b.len() < 11 || (b.len() - 1) % 2 != 0 {
            return Err(HexError::Syntax {
                line,
                message: "malformed record",
            });
        }
        let mut rec = Vec::with_capacity((b.len() - 1) / 2);
        for pair in b[1..].chunks(2) {
            rec.push(hex_byte(pair, line)?);
        }
        let len = rec[0] as usize;
        if rec.len() != len + 5 {
            return Err(HexError::Syntax {
                line,
                message: "length mismatch",
            });
        }
        let sum = rec.iter().fold(0u8, |a, &x| a.wrapping_add(x));
        if sum != 0 {
            return Err(HexError::Checksum { line });
        }
        let offset = u16::from_be_bytes([rec[1], rec[2]]) as u32;
        let data = &rec[4..4 + len];
        match rec[3] {
            0x00 => {
                for (i, &byte) in data.iter().enumerate() {
                    let address = base + offset + i as u32;
                    if address as usize >= FLASH_BYTES {
                        return Err(HexError::AddressOutOfRange { line, address });
                    }
                    bytes[address as usize] = byte;
                    used = used.max(address as usize + 1);
                    any = true;
                }
            }
            0x01 => eof = true,
            0x02 if len == 2 => base = (u16::from_be_bytes([data[0], data[1]]) as u32) << 4,
            0x04 if len == 2 => base = (u16::from_be_bytes([data[0], data[1]]) as u32) << 16,
            0x03 | 0x05 => {}
            t => {
                return Err(HexError::UnsupportedRecord {
                    line,
                    record_type: t,
                })
            }
        }
    }
    if !eof {
        return Err(HexError::MissingEof);
    }
    if !any {
        return Err(HexError::Empty);
    }
    Ok(FlashImage { bytes, used })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_minimal_file() {
        let img = parse(":020000000C945E\n:00000001FF\n").unwrap();
        assert_eq!(&img.bytes[0..2], &[0x0C, 0x94]);
        assert_eq!(img.bytes[2], 0xFF);
        assert_eq!(img.used, 2);
    }

    #[test]
    fn rejects_bad_checksum() {
        assert_eq!(
            parse(":020000000C9400\n:00000001FF\n").err(),
            Some(HexError::Checksum { line: 1 })
        );
    }

    #[test]
    fn rejects_out_of_range() {
        // Extended linear address 0x0001 → 0x10000, за пределами 32 KB.
        let r = parse(":020000040001F9\n:0100000000FF\n:00000001FF\n");
        assert!(matches!(r, Err(HexError::AddressOutOfRange { .. })));
    }

    #[test]
    fn requires_eof() {
        assert_eq!(parse(":020000000C945E\n").err(), Some(HexError::MissingEof));
    }
}
