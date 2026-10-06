//! TOTP implementation (RFC 6238).

use super::{hotp, Algorithm};

/// Counter for the given wall clock time, applying an optional clock offset.
pub fn counter_at(now_secs: u64, period: u64, offset_secs: i64) -> u64 {
    let period = period.max(1);
    let adjusted = i64::try_from(now_secs).unwrap_or(i64::MAX) + offset_secs;
    adjusted.max(0) as u64 / period
}

/// Seconds left before the current code rotates.
pub fn remaining(now_secs: u64, period: u64, offset_secs: i64) -> u64 {
    let period = period.max(1);
    let adjusted = (i64::try_from(now_secs).unwrap_or(i64::MAX) + offset_secs).max(0) as u64;
    period - (adjusted % period)
}

/// Generate the time based OTP.
pub fn generate(
    key: &[u8],
    now_secs: u64,
    period: u64,
    digits: u8,
    algorithm: Algorithm,
    offset_secs: i64,
) -> String {
    hotp::generate(
        key,
        counter_at(now_secs, period, offset_secs),
        digits,
        algorithm,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    /// RFC 6238 Appendix B seed per algorithm.
    const SEED_SHA1: &[u8] = b"12345678901234567890";
    const SEED_SHA256: &[u8] = b"12345678901234567890123456789012";
    const SEED_SHA512: &[u8] = b"1234567890123456789012345678901234567890123456789012345678901234";

    fn check(seed: &[u8], time: u64, algorithm: Algorithm, expected: &str) {
        assert_eq!(
            generate(seed, time, 30, 8, algorithm, 0),
            expected,
            "T={time} {algorithm:?}"
        );
    }

    #[test]
    fn rfc6238_sha1_vectors() {
        check(SEED_SHA1, 59, Algorithm::Sha1, "94287082");
        check(SEED_SHA1, 1_111_111_109, Algorithm::Sha1, "07081804");
        check(SEED_SHA1, 1_111_111_111, Algorithm::Sha1, "14050471");
        check(SEED_SHA1, 1_234_567_890, Algorithm::Sha1, "89005924");
        check(SEED_SHA1, 2_000_000_000, Algorithm::Sha1, "69279037");
        check(SEED_SHA1, 20_000_000_000, Algorithm::Sha1, "65353130");
    }

    #[test]
    fn rfc6238_sha256_vectors() {
        check(SEED_SHA256, 59, Algorithm::Sha256, "46119246");
        check(SEED_SHA256, 1_111_111_109, Algorithm::Sha256, "68084774");
        check(SEED_SHA256, 1_234_567_890, Algorithm::Sha256, "91819424");
        check(SEED_SHA256, 2_000_000_000, Algorithm::Sha256, "90698825");
    }

    #[test]
    fn rfc6238_sha512_vectors() {
        check(SEED_SHA512, 59, Algorithm::Sha512, "90693936");
        check(SEED_SHA512, 1_111_111_109, Algorithm::Sha512, "25091201");
        check(SEED_SHA512, 1_234_567_890, Algorithm::Sha512, "93441116");
        check(SEED_SHA512, 2_000_000_000, Algorithm::Sha512, "38618901");
    }

    #[test]
    fn applies_clock_offset() {
        let now = 1_000_000_000_u64;
        let base = generate(SEED_SHA1, now, 30, 6, Algorithm::Sha1, 0);
        // Shifting the clock by one full period must yield the code of the
        // next window.
        let shifted = generate(SEED_SHA1, now, 30, 6, Algorithm::Sha1, 30);
        let next_window = generate(SEED_SHA1, now + 30, 30, 6, Algorithm::Sha1, 0);
        assert_ne!(base, shifted);
        assert_eq!(shifted, next_window);
    }

    #[test]
    fn counts_remaining_seconds() {
        assert_eq!(remaining(60, 30, 0), 30);
        assert_eq!(remaining(89, 30, 0), 1);
        assert_eq!(remaining(61, 30, 0), 29);
        // Clock offset shifts the window, but the value must stay in 1..=period.
        assert_eq!(remaining(89, 30, 1), 30);
        assert_eq!(remaining(89, 30, -1), 2);
    }
}
