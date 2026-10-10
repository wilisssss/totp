//! Import of `otpauth://` URIs, Google Authenticator exports and QR images.

use base64::Engine as _;
use tauri::State;

use crate::error::{AppError, AppResult};
use crate::otp::entry::OtpEntry;
use crate::otp::{migration, uri};
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
        .filter(|token| {
            let lower = token.to_ascii_lowercase();
            lower.starts_with("otpauth://") || lower.starts_with("otpauth-migration://")
        })
        .map(str::to_string)
        .collect()
}

/// Merge parsed entries into the vault, deduplicating by credential.
/// `Err((display_value, reason))` items are reported as failures.
pub(crate) fn merge_entries(
    state: &AppState,
    parsed: Vec<Result<OtpEntry, (String, String)>>,
) -> AppResult<ImportReport> {
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

/// Parse every candidate URI and merge the valid ones into the vault.
fn import_uris(state: &AppState, uris: &[String]) -> AppResult<ImportReport> {
    let timestamp = chrono::Local::now().timestamp();

    // Parse outside the lock so a bad URI never touches the vault.
    let mut parsed: Vec<Result<OtpEntry, (String, String)>> = Vec::with_capacity(uris.len());
    for value in uris {
        if value
            .to_ascii_lowercase()
            .starts_with("otpauth-migration://")
        {
            match migration::parse_uri(value, timestamp) {
                Ok(results) => {
                    for (index, result) in results.into_iter().enumerate() {
                        parsed.push(
                            result.map_err(|reason| {
                                (format!("entri migrasi #{})", index + 1), reason)
                            }),
                        );
                    }
                }
                Err(error) => parsed.push(Err((value.clone(), error.to_string()))),
            }
            continue;
        }

        match uri::parse(value, timestamp) {
            Ok(entry) => parsed.push(Ok(entry)),
            Err(error) => parsed.push(Err((value.clone(), error.to_string()))),
        }
    }

    merge_entries(state, parsed)
}

/// Paste a blob of text containing one or more `otpauth://` URIs.
#[tauri::command]
pub fn import_text(state: State<'_, AppState>, text: String) -> AppResult<ImportReport> {
    let uris = extract_uris(&text);
    if uris.is_empty() {
        return Err(AppError::InvalidInput(
            "tidak ditemukan URI otpauth:// atau otpauth-migration:// di teks tersebut".to_string(),
        ));
    }
    import_uris(&state, &uris)
}

/// Decode a QR code from an image file picked by the user.
#[tauri::command]
pub fn import_qr_from_path(state: State<'_, AppState>, path: String) -> AppResult<ImportReport> {
    let bytes = std::fs::read(&path).map_err(|error| AppError::Io(format!("{path}: {error}")))?;
    let image = image::load_from_memory(&bytes)
        .map_err(|error| AppError::Qr(format!("format gambar tidak didukung: {error}")))?;
    import_content(&state, qr::decode::decode_dynamic(image)?)
}

/// Decode a QR code from raw base64 image data (drag & drop / paste / file
/// input). Base64 instead of a JSON number array keeps large images cheap
/// over the IPC bridge.
#[tauri::command]
pub fn import_qr_bytes(
    state: State<'_, AppState>,
    bytes_base64: String,
) -> AppResult<ImportReport> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(bytes_base64.trim())
        .map_err(|_| AppError::InvalidInput("data gambar base64 tidak valid".into()))?;
    let image = image::load_from_memory(&bytes)
        .map_err(|error| AppError::Qr(format!("format gambar tidak didukung: {error}")))?;
    import_content(&state, qr::decode::decode_dynamic(image)?)
}

/// Decode a QR code from raw RGBA pixels read straight out of the system
/// clipboard (screenshots never exist as files, so there are no bytes to
/// decode — the clipboard plugin hands us the pixel buffer instead).
#[tauri::command]
pub fn import_qr_rgba(
    state: State<'_, AppState>,
    rgba_base64: String,
    width: u32,
    height: u32,
) -> AppResult<ImportReport> {
    const MAX_SIDE: u32 = 8192;
    if width == 0 || height == 0 || width > MAX_SIDE || height > MAX_SIDE {
        return Err(AppError::InvalidInput(
            "dimensi gambar clipboard tidak valid".into(),
        ));
    }

    let rgba = base64::engine::general_purpose::STANDARD
        .decode(rgba_base64.trim())
        .map_err(|_| AppError::InvalidInput("data piksel base64 tidak valid".into()))?;
    if rgba.len() != width as usize * height as usize * 4 {
        return Err(AppError::InvalidInput(
            "ukuran data piksel tidak cocok dengan dimensinya".into(),
        ));
    }

    let image = image::RgbaImage::from_raw(width, height, rgba)
        .ok_or_else(|| AppError::InvalidInput("gambar clipboard tidak valid".into()))?;
    import_content(
        &state,
        qr::decode::decode_dynamic(image::DynamicImage::ImageRgba8(image))?,
    )
}

/// Route a decoded QR payload into the import pipeline.
fn import_content(state: &AppState, content: String) -> AppResult<ImportReport> {
    let lower = content.to_ascii_lowercase();

    if lower.starts_with("otpauth-migration://") {
        return import_uris(state, &[content]);
    }

    if !lower.starts_with("otpauth://") {
        return Err(AppError::InvalidInput(
            "QR code terbaca tetapi bukan URI otpauth:// atau otpauth-migration://".to_string(),
        ));
    }

    import_uris(state, &[content])
}
