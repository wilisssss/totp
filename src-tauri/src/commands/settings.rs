//! Settings (theme, auto lock, clock offset) and clock synchronisation.

use std::time::Duration;

use tauri::State;

use crate::error::{AppError, AppResult};
use crate::settings::{Settings, MAX_CLOCK_OFFSET_SECS};
use crate::state::AppState;

/// Anything further away than this is treated as a broken response, not a
/// clock problem worth correcting.
const MAX_TRUSTED_OFFSET_SECS: i64 = 86_400;

const TIME_URLS: [&str; 2] = [
    "https://www.google.com/generate_204",
    "https://www.cloudflare.com/",
];

#[tauri::command]
pub fn settings_get(state: State<'_, AppState>) -> AppResult<Settings> {
    state.settings()
}

#[tauri::command]
pub fn settings_set(state: State<'_, AppState>, settings: Settings) -> AppResult<Settings> {
    state.set_settings(settings)
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct ClockSync {
    pub offset_secs: i64,
    pub corrected: bool,
}

/// Ask a couple of HTTPS endpoints for their `Date` header and store the
/// difference against the local clock.
#[tauri::command]
pub async fn clock_sync(state: State<'_, AppState>) -> AppResult<ClockSync> {
    state.touch()?;

    let offset = tauri::async_runtime::spawn_blocking(fetch_clock_offset)
        .await
        .map_err(|error| AppError::Internal(error.to_string()))??;

    if offset.abs() > MAX_TRUSTED_OFFSET_SECS {
        return Err(AppError::ClockSync(format!(
            "selisih jam terlalu besar ({offset} detik), periksa jam sistem"
        )));
    }

    let mut settings = state.settings()?;
    settings.offset_secs = offset;
    state.set_settings(settings)?;

    Ok(ClockSync {
        offset_secs: offset,
        corrected: offset.abs() >= 2,
    })
}

fn fetch_clock_offset() -> AppResult<i64> {
    let mut last_error = "tidak ada endpoint waktu yang menjawab".to_string();

    for url in TIME_URLS {
        match fetch_date_offset(url) {
            Ok(offset) => return Ok(offset),
            Err(reason) => last_error = reason.to_string(),
        }
    }

    Err(AppError::ClockSync(last_error))
}

fn fetch_date_offset(url: &str) -> AppResult<i64> {
    let agent: ureq::Agent = ureq::Agent::config_builder()
        .timeout_global(Some(Duration::from_secs(8)))
        .build()
        .into();

    let response = agent
        .get(url)
        .call()
        .map_err(|error| AppError::ClockSync(format!("{url}: {error}")))?;

    let date = response
        .headers()
        .get("date")
        .and_then(|value| value.to_str().ok())
        .ok_or_else(|| AppError::ClockSync(format!("{url}: header Date tidak ada")))?;

    let server = chrono::DateTime::parse_from_rfc2822(date)
        .map_err(|error| AppError::ClockSync(format!("{url}: Date tidak valid: {error}")))?
        .timestamp();

    let local = chrono::Local::now().timestamp();
    Ok((server - local).clamp(-MAX_CLOCK_OFFSET_SECS, MAX_CLOCK_OFFSET_SECS))
}
