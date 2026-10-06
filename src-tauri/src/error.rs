//! Central error type shared by every Tauri command.
//!
//! It serialises to `{ code, message }` so the frontend can branch on `code`
//! while still showing a human readable message.

use serde::{Serialize, Serializer};

use crate::vault::crypto::CryptoError;

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("Passphrase salah")]
    WrongPassphrase,
    #[error("Vault belum dibuat")]
    VaultMissing,
    #[error("Vault sudah dibuat")]
    VaultExists,
    #[error("Vault terkunci")]
    Locked,
    #[error("Entri tidak ditemukan")]
    NotFound,
    #[error("Entri dengan issuer, akun, dan secret yang sama sudah ada")]
    Duplicate,
    #[error("{0}")]
    InvalidInput(String),
    #[error("{0}")]
    Qr(String),
    #[error("Tidak ada jaringan untuk menyinkronkan jam")]
    ClockSync(String),
    #[error("File tidak bisa dibaca atau ditulis: {0}")]
    Io(String),
    #[error("Data vault rusak: {0}")]
    Corrupt(String),
    #[error("{0}")]
    Internal(String),
}

impl AppError {
    pub fn code(&self) -> &'static str {
        match self {
            Self::WrongPassphrase => "wrong_passphrase",
            Self::VaultMissing => "vault_missing",
            Self::VaultExists => "vault_exists",
            Self::Locked => "locked",
            Self::NotFound => "not_found",
            Self::Duplicate => "duplicate",
            Self::InvalidInput(_) => "invalid_input",
            Self::Qr(_) => "qr",
            Self::ClockSync(_) => "clock_sync",
            Self::Io(_) => "io",
            Self::Corrupt(_) => "corrupt",
            Self::Internal(_) => "internal",
        }
    }
}

impl From<std::io::Error> for AppError {
    fn from(error: std::io::Error) -> Self {
        AppError::Io(error.to_string())
    }
}

impl From<crate::otp::OtpError> for AppError {
    fn from(error: crate::otp::OtpError) -> Self {
        AppError::InvalidInput(error.to_string())
    }
}

impl From<crate::otp::entry::EntryError> for AppError {
    fn from(error: crate::otp::entry::EntryError) -> Self {
        AppError::InvalidInput(error.to_string())
    }
}

impl From<crate::vault::crypto::CryptoError> for AppError {
    fn from(error: crate::vault::crypto::CryptoError) -> Self {
        match error {
            CryptoError::Decrypt => AppError::Corrupt(error.to_string()),
            other => AppError::Internal(other.to_string()),
        }
    }
}

impl Serialize for AppError {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        #[derive(serde::Serialize)]
        struct Payload<'a> {
            code: &'a str,
            message: &'a str,
        }

        Payload {
            code: self.code(),
            message: &self.to_string(),
        }
        .serialize(serializer)
    }
}

pub type AppResult<T> = Result<T, AppError>;
