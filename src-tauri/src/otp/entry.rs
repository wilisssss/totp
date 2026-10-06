//! The OTP entry domain model.

use serde::{Deserialize, Serialize};
use zeroize::Zeroizing;

use super::{base32, hotp, now_secs, totp, Algorithm, OtpError, OtpKind};

pub const MIN_DIGITS: u8 = 5;
pub const MAX_DIGITS: u8 = 10;
pub const MIN_PERIOD: u64 = 1;
pub const MAX_PERIOD: u64 = 300;
pub const MAX_LABEL_LEN: usize = 128;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OtpEntry {
    pub id: String,
    #[serde(default)]
    pub issuer: String,
    #[serde(default)]
    pub account: String,
    pub kind: OtpKind,
    pub algorithm: Algorithm,
    pub digits: u8,
    pub period: u64,
    pub counter: u64,
    /// Canonical Base32 secret, never leaves the backend.
    pub secret: Zeroizing<String>,
    #[serde(default)]
    pub pinned: bool,
    pub created_at: i64,
    pub updated_at: i64,
}

/// Normalised user input used for both creating and editing an entry.
#[derive(Debug, Clone, Deserialize)]
#[serde(default)]
pub struct EntryInput {
    pub issuer: String,
    pub account: String,
    pub secret: String,
    pub kind: Option<OtpKind>,
    pub algorithm: Option<Algorithm>,
    pub digits: Option<u8>,
    pub period: Option<u64>,
    pub counter: Option<u64>,
}

impl Default for EntryInput {
    fn default() -> Self {
        Self {
            issuer: String::new(),
            account: String::new(),
            secret: String::new(),
            kind: Some(OtpKind::Totp),
            algorithm: Some(Algorithm::Sha1),
            digits: Some(6),
            period: Some(30),
            counter: Some(0),
        }
    }
}

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum EntryError {
    #[error("Secret tidak valid")]
    Secret(#[from] OtpError),
    #[error("Nama issuer terlalu panjang (maks {MAX_LABEL_LEN} karakter)")]
    IssuerTooLong,
    #[error("Nama akun terlalu panjang (maks {MAX_LABEL_LEN} karakter)")]
    AccountTooLong,
    #[error("Issuer atau nama akun wajib diisi")]
    MissingLabel,
    #[error("Digit harus antara {MIN_DIGITS} dan {MAX_DIGITS}")]
    InvalidDigits,
    #[error("Periode harus antara {MIN_PERIOD} dan {MAX_PERIOD} detik")]
    InvalidPeriod,
}

impl OtpEntry {
    pub fn new(id: String, input: &EntryInput, timestamp: i64) -> Result<Self, EntryError> {
        let issuer = input.issuer.trim().to_string();
        let account = input.account.trim().to_string();

        if issuer.chars().count() > MAX_LABEL_LEN {
            return Err(EntryError::IssuerTooLong);
        }
        if account.chars().count() > MAX_LABEL_LEN {
            return Err(EntryError::AccountTooLong);
        }
        if issuer.is_empty() && account.is_empty() {
            return Err(EntryError::MissingLabel);
        }

        let digits = input.digits.unwrap_or(6).clamp(MIN_DIGITS, MAX_DIGITS);
        if input.digits.is_some() && !((MIN_DIGITS..=MAX_DIGITS).contains(&input.digits.unwrap())) {
            return Err(EntryError::InvalidDigits);
        }

        let period = input.period.unwrap_or(30);
        if !(MIN_PERIOD..=MAX_PERIOD).contains(&period) {
            return Err(EntryError::InvalidPeriod);
        }

        let secret = base32::normalize(&input.secret)?;

        Ok(Self {
            id,
            issuer,
            account,
            kind: input.kind.unwrap_or(OtpKind::Totp),
            algorithm: input.algorithm.unwrap_or(Algorithm::Sha1),
            digits,
            period,
            counter: input.counter.unwrap_or(0),
            secret: Zeroizing::new(secret),
            pinned: false,
            created_at: timestamp,
            updated_at: timestamp,
        })
    }

    /// Raw HMAC key bytes.
    pub fn key_bytes(&self) -> Result<Zeroizing<Vec<u8>>, OtpError> {
        Ok(Zeroizing::new(base32::decode(&self.secret)?))
    }

    /// Current code, or `None` when the secret cannot be decoded.
    pub fn code(&self, offset_secs: i64) -> Option<String> {
        self.code_at(now_secs(), offset_secs)
    }

    pub fn code_at(&self, now: u64, offset_secs: i64) -> Option<String> {
        let key = self.key_bytes().ok()?;
        Some(match self.kind {
            OtpKind::Totp => totp::generate(
                &key,
                now,
                self.period,
                self.digits,
                self.algorithm,
                offset_secs,
            ),
            OtpKind::Hotp => hotp::generate(&key, self.counter, self.digits, self.algorithm),
        })
    }

    /// Seconds until a TOTP code rotates (`0` for HOTP entries).
    pub fn remaining(&self, offset_secs: i64) -> u64 {
        match self.kind {
            OtpKind::Totp => totp::remaining(now_secs(), self.period, offset_secs),
            OtpKind::Hotp => 0,
        }
    }

    /// Advance and persist the HOTP counter.
    pub fn next_hotp(&mut self) -> Result<(), OtpError> {
        if self.kind != OtpKind::Hotp {
            return Ok(());
        }
        // Fail before incrementing when the secret is unusable.
        self.key_bytes()?;
        self.counter = self.counter.saturating_add(1);
        self.updated_at = chrono::Local::now().timestamp();
        Ok(())
    }

    /// True when two entries represent the same credential.
    pub fn same_credential(&self, issuer: &str, account: &str, secret: &str) -> bool {
        self.issuer.eq_ignore_ascii_case(issuer)
            && self.account.eq_ignore_ascii_case(account)
            && self.secret.eq_ignore_ascii_case(secret)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_input() -> EntryInput {
        EntryInput {
            issuer: " Example ".into(),
            account: "user@example.com".into(),
            secret: "jbsw y3dp eeh s==".into(),
            ..Default::default()
        }
    }

    #[test]
    fn builds_valid_entry() {
        let entry = OtpEntry::new("id".into(), &sample_input(), 1_700_000_000).unwrap();
        assert_eq!(entry.issuer, "Example");
        assert_eq!(entry.secret.as_str(), "JBSWY3DPEEHQ");
        assert_eq!(entry.digits, 6);
        assert_eq!(entry.period, 30);
        assert_eq!(entry.kind, OtpKind::Totp);
        assert!(entry.code(0).unwrap().len() == 6);
    }

    #[test]
    fn requires_a_label() {
        let mut input = sample_input();
        input.issuer = String::new();
        input.account = String::new();
        assert_eq!(
            OtpEntry::new("id".into(), &input, 0).unwrap_err(),
            EntryError::MissingLabel
        );
    }

    #[test]
    fn rejects_out_of_range_values() {
        let mut input = sample_input();
        input.digits = Some(3);
        assert_eq!(
            OtpEntry::new("id".into(), &input, 0).unwrap_err(),
            EntryError::InvalidDigits
        );

        let mut input = sample_input();
        input.period = Some(0);
        assert_eq!(
            OtpEntry::new("id".into(), &input, 0).unwrap_err(),
            EntryError::InvalidPeriod
        );
    }

    #[test]
    fn rejects_invalid_secret() {
        let mut input = sample_input();
        input.secret = "not-a-secret".into();
        assert!(matches!(
            OtpEntry::new("id".into(), &input, 0).unwrap_err(),
            EntryError::Secret(_)
        ));
    }

    #[test]
    fn hotp_counter_advances() {
        let mut input = sample_input();
        input.kind = Some(OtpKind::Hotp);
        let mut entry = OtpEntry::new("id".into(), &input, 0).unwrap();
        let first = entry.code(0).unwrap();
        entry.next_hotp().unwrap();
        assert_eq!(entry.counter, 1);
        assert_ne!(first, entry.code(0).unwrap());
    }
}
