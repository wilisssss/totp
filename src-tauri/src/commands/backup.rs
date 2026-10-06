//! Encrypted backup: the vault payload sealed with a passphrase of the
//! user's choosing, using the same Argon2id + AES-256-GCM envelope as the
//! vault file itself.

use tauri::State;

use super::importer::{merge_entries, ImportReport};
use super::vault::validate_passphrase;
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use crate::vault::crypto::{self, VaultFile};
use crate::vault::store::{self, Payload};

/// File name stem for exported backups.
const FILE_STEM: &str = "totp-backup";

fn parse_backup(bytes: &[u8], passphrase: &str) -> AppResult<Vec<crate::otp::OtpEntry>> {
    let text = String::from_utf8(bytes.to_vec())
        .map_err(|_| AppError::Corrupt("file backup bukan teks yang valid".into()))?;
    let vault: VaultFile = serde_json::from_str(&text)
        .map_err(|error| AppError::Corrupt(format!("format backup tidak dikenali: {error}")))?;

    let key = crypto::derive_key(passphrase, &vault.salt, &vault.kdf)?;
    if !crypto::check_verifier(&key, &vault)? {
        return Err(AppError::WrongPassphrase);
    }

    let plaintext = crypto::decrypt(&key, &vault.nonce, &vault.ciphertext)?;
    let json = String::from_utf8(plaintext)
        .map_err(|_| AppError::Corrupt("isi backup bukan UTF-8 valid".into()))?;
    let payload: Payload = serde_json::from_str(&json)
        .map_err(|error| AppError::Corrupt(format!("isi backup tidak dikenali: {error}")))?;

    Ok(payload.entries)
}

/// Seal the current entries into an encrypted file via a native save dialog.
/// Returns `None` when the user cancels.
#[tauri::command]
pub async fn backup_export_encrypted(
    state: State<'_, AppState>,
    passphrase: String,
) -> AppResult<Option<String>> {
    validate_passphrase(&passphrase)?;

    let entries = state.read_entries(|entries| entries.to_vec())?;
    let plaintext = serde_json::to_string(&Payload { entries })
        .map_err(|error| AppError::Internal(format!("gagal serialisasi entri: {error}")))?;

    let (_key, vault) = crypto::seal(&passphrase, &crypto::default_kdf(), plaintext.as_bytes())?;
    let raw = serde_json::to_string_pretty(&vault)
        .map_err(|error| AppError::Internal(format!("gagal serialisasi backup: {error}")))?;

    let filename = format!(
        "{FILE_STEM}-{}.json",
        chrono::Local::now().format("%Y%m%d-%H%M%S")
    );
    let saved = tauri::async_runtime::spawn_blocking(move || {
        rfd::FileDialog::new()
            .set_file_name(&filename)
            .add_filter("Backup TOTP (JSON)", &["json"])
            .save_file()
    })
    .await
    .map_err(|error| AppError::Internal(error.to_string()))?;

    let Some(path) = saved else {
        return Ok(None);
    };

    store::write_private(&path, raw.as_bytes())?;
    Ok(Some(path.display().to_string()))
}

/// Restore entries from an encrypted backup through a native open dialog.
/// Entries are merged (duplicates skipped); `None` means the user cancelled
/// the dialog.
#[tauri::command]
pub async fn backup_import_encrypted(
    state: State<'_, AppState>,
    passphrase: String,
) -> AppResult<Option<ImportReport>> {
    validate_passphrase(&passphrase)?;

    let picked = tauri::async_runtime::spawn_blocking(|| {
        rfd::FileDialog::new()
            .add_filter("Backup TOTP (JSON)", &["json"])
            .add_filter("Semua berkas", &["*"])
            .pick_file()
    })
    .await
    .map_err(|error| AppError::Internal(error.to_string()))?;

    let Some(path) = picked else {
        return Ok(None);
    };

    let bytes = std::fs::read(&path)
        .map_err(|error| AppError::Io(format!("{}: {error}", path.display())))?;
    let entries = parse_backup(&bytes, &passphrase)?;

    if entries.is_empty() {
        return Err(AppError::Corrupt("backup tidak berisi entri".into()));
    }

    let parsed = entries.into_iter().map(Ok).collect();
    let report = merge_entries(&state, parsed)?;
    Ok(Some(report))
}
