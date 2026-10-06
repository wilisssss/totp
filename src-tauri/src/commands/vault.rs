//! Vault lifecycle: create, unlock, lock, change passphrase.

use tauri::State;

use crate::commands::entries::build_snapshot;
use crate::commands::Snapshot;
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use crate::vault::crypto::{self, default_kdf};
use crate::vault::store::Payload;

/// Minimum passphrase length accepted at creation time.
///
/// NOTE: keep the "min. 8 karakter" hints in `SetupScreen.tsx` and
/// `SettingsModal.tsx` in sync with this constant.
pub const MIN_PASSPHRASE_LEN: usize = 8;

#[derive(Debug, Clone, serde::Serialize)]
pub struct VaultStatus {
    pub exists: bool,
    pub locked: bool,
}

/// The sealed passphrase is the untrimmed input, so validate the untrimmed
/// input too (mismatches here would lock users out of their own vault).
pub(crate) fn validate_passphrase(passphrase: &str) -> AppResult<()> {
    if passphrase.chars().count() < MIN_PASSPHRASE_LEN {
        return Err(AppError::InvalidInput(format!(
            "passphrase minimal {MIN_PASSPHRASE_LEN} karakter"
        )));
    }
    Ok(())
}

fn decrypt_payload(key: &crypto::MasterKey, vault: &crypto::VaultFile) -> AppResult<Payload> {
    let plaintext = crypto::decrypt(key, &vault.nonce, &vault.ciphertext)?;
    let json = String::from_utf8(plaintext)
        .map_err(|_| AppError::Corrupt("payload vault bukan UTF-8 valid".into()))?;
    serde_json::from_str(&json)
        .map_err(|error| AppError::Corrupt(format!("payload vault tidak dikenali: {error}")))
}

fn load_vault(state: &AppState) -> AppResult<crypto::VaultFile> {
    state.store().load_vault()?.ok_or(AppError::VaultMissing)
}

#[tauri::command]
pub fn vault_status(state: State<'_, AppState>) -> AppResult<VaultStatus> {
    let exists = state.is_vault_present();
    Ok(VaultStatus {
        exists,
        locked: exists && state.is_locked()?,
    })
}

/// First run: seal an empty vault and leave it unlocked.
#[tauri::command]
pub fn vault_create(state: State<'_, AppState>, passphrase: String) -> AppResult<Snapshot> {
    validate_passphrase(&passphrase)?;

    if state.is_vault_present() {
        return Err(AppError::VaultExists);
    }

    let payload = serde_json::to_string(&Payload::default())
        .map_err(|error| AppError::Internal(format!("gagal serialisasi payload: {error}")))?;

    let (key, vault) = crypto::seal(&passphrase, &default_kdf(), payload.as_bytes())?;
    state.store().save_vault(&vault)?;
    state.unlock(key, vault, Vec::new())?;

    build_snapshot(&state)
}

#[tauri::command]
pub fn vault_unlock(state: State<'_, AppState>, passphrase: String) -> AppResult<Snapshot> {
    let vault = load_vault(&state)?;

    let key = crypto::derive_key(&passphrase, &vault.salt, &vault.kdf)?;
    if !crypto::check_verifier(&key, &vault)? {
        return Err(AppError::WrongPassphrase);
    }

    let payload = decrypt_payload(&key, &vault)?;
    state.unlock(key, vault, payload.entries)?;

    build_snapshot(&state)
}

#[tauri::command]
pub fn vault_lock(state: State<'_, AppState>) -> AppResult<VaultStatus> {
    state.lock()?;
    Ok(VaultStatus {
        exists: state.is_vault_present(),
        locked: true,
    })
}

/// Re-encrypt the whole vault under a new passphrase.
#[tauri::command]
pub fn vault_change_passphrase(
    state: State<'_, AppState>,
    old_passphrase: String,
    new_passphrase: String,
) -> AppResult<Snapshot> {
    validate_passphrase(&new_passphrase)?;

    let vault = load_vault(&state)?;

    // The old passphrase must still be valid.
    let old_key = crypto::derive_key(&old_passphrase, &vault.salt, &vault.kdf)?;
    if !crypto::check_verifier(&old_key, &vault)? {
        return Err(AppError::WrongPassphrase);
    }

    // Re-serialize the entries currently held in memory (requires unlocked).
    let entries = state.read_entries(|entries| entries.to_vec())?;
    let plaintext = serde_json::to_string(&Payload {
        entries: entries.clone(),
    })
    .map_err(|error| AppError::Internal(format!("gagal serialisasi entri: {error}")))?;

    let (key, next_vault) = crypto::seal(&new_passphrase, &default_kdf(), plaintext.as_bytes())?;

    state.store().save_vault(&next_vault)?;
    state.unlock(key, next_vault, entries)?;

    build_snapshot(&state)
}
