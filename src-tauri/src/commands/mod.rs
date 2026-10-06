//! Tauri command surface. Everything the frontend can call lives here.

pub mod entries;
pub mod importer;
pub mod settings;
pub mod vault;

use serde::Serialize;

use crate::otp::{Algorithm, OtpKind};

/// Projection of an entry sent to the UI. The secret itself never appears
/// here — only the derived code.
#[derive(Debug, Clone, Serialize)]
pub struct EntryView {
    pub id: String,
    pub issuer: String,
    pub account: String,
    pub kind: OtpKind,
    pub algorithm: Algorithm,
    pub digits: u8,
    pub period: u64,
    pub counter: u64,
    pub pinned: bool,
    pub code: String,
    /// Seconds until the code rotates (`0` for HOTP).
    pub remaining: u64,
    pub updated_at: i64,
}

/// Full state of the app, polled once per second by the frontend.
#[derive(Debug, Clone, Serialize)]
pub struct Snapshot {
    pub locked: bool,
    pub vault_exists: bool,
    pub entries: Vec<EntryView>,
    pub offset_secs: i64,
    pub autolock_secs: u64,
}
