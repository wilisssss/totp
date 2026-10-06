//! HOTP implementation (RFC 4226).
//!
//! TOTP (RFC 6238) is HOTP with a time based counter, see [`super::totp`].

use hmac::{Hmac, Mac};
use sha1::Sha1;
use sha2::{Sha256, Sha512};

use super::Algorithm;

fn digest(algorithm: Algorithm, key: &[u8], message: &[u8]) -> Vec<u8> {
    macro_rules! hmac {
        ($ty:ty) => {{
            // HMAC accepts keys of any length, including empty ones.
            let mut mac = <$ty>::new_from_slice(key).expect("HMAC accepts any key length");
            mac.update(message);
            mac.finalize().into_bytes().to_vec()
        }};
    }

    match algorithm {
        Algorithm::Sha1 => hmac!(Hmac<Sha1>),
        Algorithm::Sha256 => hmac!(Hmac<Sha256>),
        Algorithm::Sha512 => hmac!(Hmac<Sha512>),
    }
}

/// Generate the OTP for the given counter.
pub fn generate(key: &[u8], counter: u64, digits: u8, algorithm: Algorithm) -> String {
    let hash = digest(algorithm, key, &counter.to_be_bytes());
    let offset = usize::from(hash[hash.len() - 1] & 0x0f);

    let binary = (u32::from(hash[offset] & 0x7f) << 24)
        | (u32::from(hash[offset + 1]) << 16)
        | (u32::from(hash[offset + 2]) << 8)
        | u32::from(hash[offset + 3]);

    let digits = digits.clamp(5, 10);
    let modulo = 10_u32.pow(u32::from(digits));
    format!("{:0width$}", binary % modulo, width = usize::from(digits))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// ASCII "12345678901234567890"
    const SEED: &[u8] = b"12345678901234567890";

    /// RFC 4226 Appendix D test vectors.
    #[test]
    fn rfc4226_vectors() {
        let expected = [
            "755224", "287082", "359152", "969429", "338314", //
            "254676", "287922", "162583", "399871", "520489",
        ];
        for (counter, want) in expected.iter().enumerate() {
            assert_eq!(
                generate(SEED, counter as u64, 6, Algorithm::Sha1),
                *want,
                "counter {counter}"
            );
        }
    }

    #[test]
    fn pads_to_requested_digits() {
        assert_eq!(generate(SEED, 0, 8, Algorithm::Sha1).len(), 8);
        // 31-bit truncated value is 84755224, so % 10^8 and % 10^6 agree on
        // the last six digits (755224, RFC 4226 test vector).
        assert_eq!(generate(SEED, 0, 8, Algorithm::Sha1), "84755224");
    }
}
