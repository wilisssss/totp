//! Import of `otpauth://` URIs from pasted text or from a QR code image.

use tauri::State;

use crate::error::{AppError, AppResult};
use crate::otp::entry::OtpEntry;
use crate::otp::uri;
use crate::qr;
use crate::state::AppState;

#[derive(Debug, Clone, serde::Serialize)]
pub struct ImportIssue {
    pub value: String,
    pub reason: String,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct ImportReport {
    pub imported: usize,
    pub skipped: usize,
    pub failed: usize,
    pub issues: Vec<ImportIssue>,
}

impl ImportReport {
    fn new(capacity: usize) -> Self {
        Self {
            imported: 0,
            skipped: 0,
            failed: 0,
            issues: Vec::with_capacity(capacity),
        }
    }

    fn fail(&mut self, value: &str, reason: impl Into<String>) {
        self.failed += 1;
        self.issues.push(ImportIssue {
            value: value.to_string(),
            reason: reason.into(),
        });
    }

    fn skip(&mut self, value: &str, reason: impl Into<String>) {
        self.skipped += 1;
        self.issues.push(ImportIssue {
            value: value.to_string(),
            reason: reason.into(),
        });
    }
}

/// Split arbitrary pasted text into candidate URIs.
pub fn extract_uris(text: &str) -> Vec<String> {
    text.split_whitespace()
        .filter(|token| token.to_ascii_lowercase().starts_with("otpauth://"))
        .map(str::to_string)
        .collect()
}

/// Parse every candidate URI and merge the valid ones into the vault.
fn import_uris(state: &AppState, uris: &[String]) -> AppResult<ImportReport> {
    let timestamp = chrono::Local::now().timestamp();

    // Parse outside the lock so a bad URI never touches the vault.
    let mut parsed: Vec<Result<OtpEntry, (String, String)>> = Vec::with_capacity(uris.len());
    for value in uris {
        match uri::parse(value, timestamp) {
            Ok(entry) => parsed.push(Ok(entry)),
            Err(error) => parsed.push(Err((value.clone(), error.to_string()))),
        }
    }

    let mut report = ImportReport::new(parsed.len());

    state.update_entries(|entries| {
        for item in parsed {
            match item {
                Err((value, reason)) => report.fail(&value, reason),
                Ok(entry) => {
                    let duplicate = entries.iter().any(|existing| {
                        existing.same_credential(&entry.issuer, &entry.account, &entry.secret)
                    });

                    if duplicate {
                        report.skip(&uri::to_uri(&entry), "sudah ada di vault");
                    } else {
                        report.imported += 1;
                        entries.push(entry);
                    }
                }
            }
        }

        Ok(())
    })?;

    Ok(report)
}

/// Paste a blob of text containing one or more `otpauth://` URIs.
#[tauri::command]
pub fn import_text(state: State<'_, AppState>, text: String) -> AppResult<ImportReport> {
    let uris = extract_uris(&text);
    if uris.is_empty() {
        return Err(AppError::InvalidInput(
            "tidak ditemukan URI otpauth:// di teks tersebut".to_string(),
        ));
    }
    import_uris(&state, &uris)
}

/// Decode a QR code from an image file picked by the user.
#[tauri::command]
pub fn import_qr_from_path(state: State<'_, AppState>, path: String) -> AppResult<ImportReport> {
    let bytes = std::fs::read(&path).map_err(|error| AppError::Io(format!("{path}: {error}")))?;
    import_qr_bytes_inner(&state, &bytes)
}

/// Decode a QR code from raw image bytes (drag & drop / paste / file input).
#[tauri::command]
pub fn import_qr_bytes(state: State<'_, AppState>, bytes: Vec<u8>) -> AppResult<ImportReport> {
    import_qr_bytes_inner(&state, &bytes)
}

fn import_qr_bytes_inner(state: &AppState, bytes: &[u8]) -> AppResult<ImportReport> {
    let content = qr::decode::decode_image(bytes)?;

    if content
        .to_ascii_lowercase()
        .starts_with("otpauth-migration://")
    {
        return Err(AppError::InvalidInput(
            "impor dari ekspor Google Authenticator (otpauth-migration) belum didukung".to_string(),
        ));
    }

    if !content.to_ascii_lowercase().starts_with("otpauth://") {
        return Err(AppError::InvalidInput(
            "QR code terbaca tetapi bukan URI otpauth://".to_string(),
        ));
    }

    import_uris(state, &[content])
}
