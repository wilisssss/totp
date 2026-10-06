//! Tolerant RFC 4648 Base32 codec used by OTP secrets.
//!
//! The decoder is intentionally forgiving: it ignores whitespace and padding,
//! accepts mixed case and allows any length (leftover bits are dropped), which
//! is what real-world secrets from vendors look like.

use super::OtpError;

/// Decode a Base32 secret into raw key bytes.
pub fn decode(input: &str) -> Result<Vec<u8>, OtpError> {
    let mut bits: u32 = 0;
    let mut nbits: u32 = 0;
    let mut out: Vec<u8> = Vec::new();
    let mut seen: usize = 0;

    for ch in input.chars() {
        if ch.is_whitespace() || ch == '=' {
            continue;
        }

        let upper = ch.to_ascii_uppercase();
        let value: u32 = match upper {
            'A'..='Z' => u32::from(upper as u8 - b'A'),
            '2'..='7' => u32::from(upper as u8 - b'2') + 26,
            _ => return Err(OtpError::InvalidBase32Char(ch)),
        };

        bits = (bits << 5) | value;
        nbits += 5;
        seen += 1;

        if nbits >= 8 {
            nbits -= 8;
            out.push(((bits >> nbits) & 0xff) as u8);
            bits &= (1 << nbits) - 1;
        }
    }

    if seen == 0 {
        return Err(OtpError::EmptySecret);
    }

    Ok(out)
}

/// Encode raw bytes as unpadded Base32.
pub fn encode(bytes: &[u8]) -> String {
    const ALPHABET: &[u8; 32] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    let mut out = String::new();
    let mut bits: u32 = 0;
    let mut nbits: u32 = 0;

    for byte in bytes {
        bits = (bits << 8) | u32::from(*byte);
        nbits += 8;
        while nbits >= 5 {
            nbits -= 5;
            out.push(ALPHABET[((bits >> nbits) & 0x1f) as usize] as char);
        }
    }

    if nbits > 0 {
        out.push(ALPHABET[((bits << (5 - nbits)) & 0x1f) as usize] as char);
    }

    out
}

/// Normalise a user supplied secret: strip whitespace, upper case, validate,
/// and re-encode canonically so two spellings of the same key deduplicate.
/// Returns the canonical (unpadded, upper case) Base32 string to store.
pub fn normalize(raw: &str) -> Result<String, OtpError> {
    let cleaned: String = raw
        .chars()
        .filter(|c| !c.is_whitespace() && *c != '=')
        .collect::<String>()
        .to_ascii_uppercase();

    if cleaned.is_empty() {
        return Err(OtpError::EmptySecret);
    }

    let bytes = decode(&cleaned)?;
    Ok(encode(&bytes))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_known_secret() {
        // "Hello!" in Base32
        assert_eq!(decode("JBSWY3DPEE").unwrap(), b"Hello!".to_vec());
    }

    #[test]
    fn tolerates_case_padding_and_spaces() {
        let a = decode("jbswy3dpeehs").unwrap();
        let b = decode("  JBSW Y3DP EEH S== ").unwrap();
        assert_eq!(a, b);
    }

    #[test]
    fn rejects_invalid_characters() {
        assert_eq!(
            decode("JBSW0Y3D").unwrap_err(),
            OtpError::InvalidBase32Char('0')
        );
        assert_eq!(
            decode("JBSW1Y3D").unwrap_err(),
            OtpError::InvalidBase32Char('1')
        );
        assert_eq!(
            decode("JBSW8Y3D").unwrap_err(),
            OtpError::InvalidBase32Char('8')
        );
        assert_eq!(
            decode("JBSW9Y3D").unwrap_err(),
            OtpError::InvalidBase32Char('9')
        );
    }

    #[test]
    fn rejects_empty() {
        assert_eq!(decode("   = ").unwrap_err(), OtpError::EmptySecret);
    }

    #[test]
    fn roundtrip() {
        let data = b"12345678901234567890";
        let encoded = encode(data);
        assert_eq!(encoded, "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
        assert_eq!(decode(&encoded).unwrap(), data.to_vec());
    }

    #[test]
    fn normalize_produces_canonical_form() {
        // Trailing bits that the decoder drops are re-encoded as zeros, so the
        // stored spelling is always canonical while the key bytes stay put.
        assert_eq!(normalize(" jbsw y3dp eeh s== ").unwrap(), "JBSWY3DPEEHQ");
        assert_eq!(normalize("JBSWY3DPEEHQ").unwrap(), "JBSWY3DPEEHQ");
        // Canonical form decodes to exactly the same key bytes.
        let original = decode("JBSWY3DPEEHS").unwrap();
        let canonical = decode(&normalize("JBSWY3DPEEHS").unwrap()).unwrap();
        assert_eq!(original, canonical);
    }
}
