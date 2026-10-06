//! Pure OTP domain logic: Base32, HOTP (RFC 4226), TOTP (RFC 6238),
//! entry model and `otpauth://` URI handling.
//!
//! This module has no Tauri dependency so it can be unit tested in isolation.

pub mod base32;
pub mod entry;
pub mod hotp;
pub mod migration;
pub mod totp;
pub mod uri;

pub use entry::OtpEntry;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum OtpKind {
    Totp,
    Hotp,
}

impl OtpKind {
    pub fn as_uri_str(self) -> &'static str {
        match self {
            OtpKind::Totp => "totp",
            OtpKind::Hotp => "hotp",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum Algorithm {
    Sha1,
    Sha256,
    Sha512,
}

impl Algorithm {
    pub fn as_uri_str(self) -> &'static str {
        match self {
            Algorithm::Sha1 => "SHA1",
            Algorithm::Sha256 => "SHA256",
            Algorithm::Sha512 => "SHA512",
        }
    }

    pub fn parse(raw: &str) -> Option<Self> {
        match raw.trim().to_ascii_uppercase().as_str() {
            "SHA1" => Some(Algorithm::Sha1),
            "SHA256" => Some(Algorithm::Sha256),
            "SHA512" => Some(Algorithm::Sha512),
            _ => None,
        }
    }
}

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum OtpError {
    #[error("Secret tidak boleh kosong")]
    EmptySecret,
    #[error("Secret harus Base32 (huruf A-Z dan angka 2-7), ditemukan karakter '{0}'")]
    InvalidBase32Char(char),
    #[error("URI otpauth tidak valid: {0}")]
    InvalidUri(String),
    #[error("Tipe OTP tidak didukung: {0}")]
    UnsupportedKind(String),
}

/// Seconds since the Unix epoch.
pub fn now_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}
