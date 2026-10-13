//! Encrypted backup: the vault payload sealed with a passphrase of the
//! user's choosing, using the same Argon2id + AES-256-GCM envelope as the
//! vault file itself.
//!
//! File picking lives in the frontend (dialog + fs plugins), so these
//! commands only handle sealed content — that keeps desktop and Android on
//! one code path (Android pickers return content URIs, not file paths).

use tauri::State;

use super::importer::{merge_entries, ImportReport};
use super::vault::validate_passphrase;
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use crate::vault::crypto::{self, VaultFile};
use crate::vault::store::Payload;

fn parse_backup(json: &str, passphrase: &str) -> AppResult<Vec<crate::otp::OtpEntry>> {
    let vault: VaultFile = serde_json::from_str(json)
        .map_err(|error| AppError::Corrupt(format!("format backup tidak dikenali: {error}")))?;

    let key = crypto::derive_key(passphrase, &vault.salt, &vault.kdf)?;
    if !crypto::check_verifier(&key, &vault)? {
        return Err(AppError::WrongPassphrase);
    }

    let plaintext = crypto::decrypt(&key, &vault.nonce, &vault.ciphertext)?;
    let payload_json = String::from_utf8(plaintext)
        .map_err(|_| AppError::Corrupt("isi backup bukan UTF-8 valid".into()))?;
    let payload: Payload = serde_json::from_str(&payload_json)
        .map_err(|error| AppError::Corrupt(format!("isi backup tidak dikenali: {error}")))?;

    Ok(payload.entries)
}

/// Seal the current entries with the given passphrase and hand the JSON
/// envelope back to the frontend, which saves it wherever the user picks.
#[tauri::command]
pub fn backup_encrypted_content(
    state: State<'_, AppState>,
    passphrase: String,
) -> AppResult<String> {
    validate_passphrase(&passphrase)?;

    let entries = state.read_entries(|entries| entries.to_vec())?;
    let plaintext = serde_json::to_string(&Payload { entries })
        .map_err(|error| AppError::Internal(format!("gagal serialisasi entri: {error}")))?;

    let (_key, vault) = crypto::seal(&passphrase, &crypto::default_kdf(), plaintext.as_bytes())?;
    serde_json::to_string_pretty(&vault)
        .map_err(|error| AppError::Internal(format!("gagal serialisasi backup: {error}")))
}

/// Restore entries from an encrypted backup's JSON content. Entries are
/// merged; duplicates are skipped.
#[tauri::command]
pub fn backup_import_encrypted(
    state: State<'_, AppState>,
    content: String,
    passphrase: String,
) -> AppResult<ImportReport> {
    validate_passphrase(&passphrase)?;

    let entries = parse_backup(&content, &passphrase)?;
    if entries.is_empty() {
        return Err(AppError::Corrupt("backup tidak berisi entri".into()));
    }

    let parsed = entries.into_iter().map(Ok).collect();
    merge_entries(&state, parsed)
}
