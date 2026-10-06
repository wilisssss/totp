//! Entry CRUD plus the snapshot the frontend fetches on rotation.

use tauri::State;

use super::{EntryView, Snapshot};
use crate::error::{AppError, AppResult};
use crate::otp::entry::{EntryInput, OtpEntry};
use crate::otp::uri;
use crate::qr;
use crate::state::AppState;
use crate::vault::store;

fn view(entry: &OtpEntry, offset_secs: i64) -> EntryView {
    EntryView {
        id: entry.id.clone(),
        issuer: entry.issuer.clone(),
        account: entry.account.clone(),
        kind: entry.kind,
        algorithm: entry.algorithm,
        digits: entry.digits,
        period: entry.period,
        counter: entry.counter,
        pinned: entry.pinned,
        code: entry
            .code(offset_secs)
            .unwrap_or_else(|| "invalid".to_string()),
        remaining: entry.remaining(offset_secs),
        next_code: entry.next_code(offset_secs).unwrap_or_default(),
    }
}

/// Build the current snapshot. Also enforces the idle auto lock, so the
/// vault closes even if the frontend stops polling.
pub fn build_snapshot(state: &AppState) -> AppResult<Snapshot> {
    state.lock_if_idle();

    let settings = state.settings()?;

    if state.is_locked()? {
        return Ok(Snapshot {
            locked: true,
            entries: Vec::new(),
            offset_secs: settings.offset_secs,
            autolock_secs: settings.autolock_secs,
        });
    }

    let offset = settings.offset_secs;
    let entries = state.read_entries(|entries| {
        entries
            .iter()
            .map(|entry| view(entry, offset))
            .collect::<Vec<_>>()
    })?;

    Ok(Snapshot {
        locked: false,
        entries,
        offset_secs: offset,
        autolock_secs: settings.autolock_secs,
    })
}

#[tauri::command]
pub fn snapshot(state: State<'_, AppState>) -> AppResult<Snapshot> {
    build_snapshot(&state)
}

fn duplicate_of<'a>(entries: &'a [OtpEntry], candidate: &OtpEntry) -> Option<&'a OtpEntry> {
    entries.iter().find(|entry| {
        entry.id != candidate.id
            && entry.same_credential(&candidate.issuer, &candidate.account, &candidate.secret)
    })
}

#[tauri::command]
pub fn entry_create(state: State<'_, AppState>, input: EntryInput) -> AppResult<EntryView> {
    let offset = state.settings()?.offset_secs;
    let timestamp = chrono::Local::now().timestamp();

    let entry = state.update_entries(|entries| {
        let entry = OtpEntry::new(uuid::Uuid::new_v4().to_string(), &input, timestamp)?;
        if duplicate_of(entries, &entry).is_some() {
            return Err(AppError::Duplicate);
        }
        entries.push(entry);
        Ok(entries.last().expect("just pushed").clone())
    })?;

    Ok(view(&entry, offset))
}

#[tauri::command]
pub fn entry_update(
    state: State<'_, AppState>,
    id: String,
    input: EntryInput,
) -> AppResult<EntryView> {
    let offset = state.settings()?.offset_secs;
    let timestamp = chrono::Local::now().timestamp();

    let entry = state.update_entries(|entries| {
        let position = entries
            .iter()
            .position(|entry| entry.id == id)
            .ok_or(AppError::NotFound)?;

        let candidate = OtpEntry::new(id.clone(), &input, timestamp)?;
        if duplicate_of(entries, &candidate).is_some() {
            return Err(AppError::Duplicate);
        }

        let existing = &entries[position];
        let mut updated = candidate;
        updated.pinned = existing.pinned;
        updated.counter = existing.counter;
        updated.created_at = existing.created_at;
        updated.updated_at = timestamp;
        entries[position] = updated;

        Ok(entries[position].clone())
    })?;

    Ok(view(&entry, offset))
}

#[tauri::command]
pub fn entry_delete(state: State<'_, AppState>, id: String) -> AppResult<()> {
    state.update_entries(|entries| {
        let position = entries
            .iter()
            .position(|entry| entry.id == id)
            .ok_or(AppError::NotFound)?;
        entries.remove(position);
        Ok(())
    })
}

/// Apply a full new ordering (ids in display order).
#[tauri::command]
pub fn entry_reorder(state: State<'_, AppState>, ids: Vec<String>) -> AppResult<()> {
    state.update_entries(|entries| {
        if ids.len() != entries.len() {
            return Err(AppError::InvalidInput(
                "daftar entri tidak lengkap".to_string(),
            ));
        }

        let mut reordered = Vec::with_capacity(ids.len());
        for id in &ids {
            let position = entries
                .iter()
                .position(|entry| &entry.id == id)
                .ok_or(AppError::NotFound)?;
            reordered.push(entries.remove(position));
        }
        *entries = reordered;
        Ok(())
    })
}

#[tauri::command]
pub fn entry_toggle_pin(state: State<'_, AppState>, id: String) -> AppResult<EntryView> {
    let offset = state.settings()?.offset_secs;

    let entry = state.update_entries(|entries| {
        let position = entries
            .iter()
            .position(|entry| entry.id == id)
            .ok_or(AppError::NotFound)?;
        let mut entry = entries.remove(position);
        entry.pinned = !entry.pinned;
        entry.updated_at = chrono::Local::now().timestamp();

        // A freshly pinned entry moves to the top; unpinning keeps its slot.
        if entry.pinned {
            entries.insert(0, entry.clone());
        } else {
            entries.insert(position, entry.clone());
        }
        Ok(entry)
    })?;

    Ok(view(&entry, offset))
}

/// HOTP only: advance the counter and return the new code.
#[tauri::command]
pub fn entry_hotp_next(state: State<'_, AppState>, id: String) -> AppResult<EntryView> {
    let offset = state.settings()?.offset_secs;

    let entry = state.update_entries(|entries| {
        let entry = entries
            .iter_mut()
            .find(|entry| entry.id == id)
            .ok_or(AppError::NotFound)?;
        entry.next_hotp()?;
        Ok(entry.clone())
    })?;

    Ok(view(&entry, offset))
}

/// Only callable while unlocked; used by the reveal action.
#[tauri::command]
pub fn entry_reveal_secret(state: State<'_, AppState>, id: String) -> AppResult<String> {
    state.read_entries(|entries| {
        entries
            .iter()
            .find(|entry| entry.id == id)
            .map(|entry| entry.secret.as_str().to_string())
            .ok_or(AppError::NotFound)
    })?
}

/// PNG data URL of the entry's `otpauth://` URI, for sharing/backup.
#[tauri::command]
pub fn entry_qr(state: State<'_, AppState>, id: String) -> AppResult<String> {
    let data_url = state.read_entries(|entries| {
        entries
            .iter()
            .find(|entry| entry.id == id)
            .map(uri::to_uri)
            .ok_or(AppError::NotFound)
    })??;

    qr::encode::to_data_url(&data_url)
}

/// All entries as newline separated `otpauth://` URIs (clipboard export).
fn all_uris(state: &AppState) -> AppResult<String> {
    state.read_entries(|entries| {
        entries
            .iter()
            .map(uri::to_uri)
            .collect::<Vec<_>>()
            .join("\n")
    })
}

#[tauri::command]
pub fn export_text(state: State<'_, AppState>) -> AppResult<String> {
    all_uris(&state)
}

/// Save the whole vault as a text backup through a native save dialog.
/// Returns `None` when the user cancels.
#[tauri::command]
pub async fn export_backup(state: State<'_, AppState>) -> AppResult<Option<String>> {
    let text = all_uris(&state)?;

    let filename = format!(
        "totp-backup-{}.txt",
        chrono::Local::now().format("%Y%m%d-%H%M%S")
    );
    let saved = tauri::async_runtime::spawn_blocking(move || {
        rfd::FileDialog::new()
            .set_file_name(&filename)
            .add_filter("Teks", &["txt"])
            .save_file()
    })
    .await
    .map_err(|error| AppError::Internal(error.to_string()))?;

    let Some(path) = saved else {
        return Ok(None);
    };

    // The file contains every secret in plain text — owner-only permissions.
    store::write_private(&path, text.as_bytes())?;
    Ok(Some(path.display().to_string()))
}
