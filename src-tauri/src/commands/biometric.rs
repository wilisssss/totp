//! Biometric (fingerprint) unlock commands.
//!
//! Only the sealed master key ever reaches the Kotlin plugin; the passphrase
//! and the plaintext key never cross the IPC bridge to the frontend. On
//! desktop every command reports "unavailable" so the UI can hide the
//! feature without a platform check.

use tauri::{AppHandle, State};

#[cfg(target_os = "android")]
use tauri::Manager;

use super::Snapshot;
use crate::error::{AppError, AppResult};
use crate::state::AppState;

#[derive(Debug, Clone, serde::Serialize)]
pub struct BiometricStatus {
    /// The device has a usable strong biometric sensor.
    pub available: bool,
    /// A sealed key is stored for this vault.
    pub enrolled: bool,
}

#[cfg(target_os = "android")]
mod android {
    use tauri::plugin::mobile::PluginInvokeError;

    use crate::error::AppError;

    /// Translate the Kotlin rejection codes into typed backend errors.
    pub fn map_error(error: PluginInvokeError) -> AppError {
        match error {
            PluginInvokeError::InvokeRejected(response) => match response.code.as_deref() {
                Some("cancelled") => AppError::BiometricCancelled,
                Some("not_enrolled") => AppError::BiometricNotEnrolled,
                Some("unavailable") => AppError::BiometricUnavailable,
                Some("invalidated") => AppError::BiometricInvalidated,
                _ => AppError::BiometricFailed(
                    response
                        .message
                        .unwrap_or_else(|| "sidik jari gagal".to_string()),
                ),
            },
            other => AppError::BiometricFailed(other.to_string()),
        }
    }
}

/// Sensor availability + whether this vault can be opened with a fingerprint.
#[tauri::command]
pub async fn biometric_status(app: AppHandle) -> AppResult<BiometricStatus> {
    #[cfg(target_os = "android")]
    {
        #[derive(serde::Deserialize)]
        struct Reply {
            available: bool,
            enrolled: bool,
        }

        let handle = app.state::<crate::biometric::BiometricHandle<tauri::Wry>>();
        let reply: Reply = handle
            .0
            .run_mobile_plugin_async("status", serde_json::json!({}))
            .await
            .map_err(android::map_error)?;
        Ok(BiometricStatus {
            available: reply.available,
            enrolled: reply.enrolled,
        })
    }

    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
        Ok(BiometricStatus {
            available: false,
            enrolled: false,
        })
    }
}

/// Seal the current master key behind the device fingerprint. Requires an
/// unlocked vault (there is nothing to seal otherwise).
#[tauri::command]
pub async fn biometric_enroll(
    app: AppHandle,
    state: State<'_, AppState>,
) -> AppResult<BiometricStatus> {
    let key = state.master_key()?;

    #[cfg(target_os = "android")]
    {
        use base64::Engine as _;

        #[derive(serde::Deserialize)]
        struct Reply {
            enrolled: bool,
        }

        let secret = base64::engine::general_purpose::STANDARD.encode(key.as_ref());
        let handle = app.state::<crate::biometric::BiometricHandle<tauri::Wry>>();
        let reply: Reply = handle
            .0
            .run_mobile_plugin_async("enroll", serde_json::json!({ "secret": secret }))
            .await
            .map_err(android::map_error)?;

        Ok(BiometricStatus {
            available: true,
            enrolled: reply.enrolled,
        })
    }

    #[cfg(not(target_os = "android"))]
    {
        let _ = (app, key);
        Err(AppError::BiometricUnavailable)
    }
}

/// Ask for the fingerprint, decrypt the sealed key and unlock the vault.
#[tauri::command]
pub async fn biometric_unlock(app: AppHandle, state: State<'_, AppState>) -> AppResult<Snapshot> {
    #[cfg(target_os = "android")]
    {
        use base64::Engine as _;
        use zeroize::Zeroizing;

        use crate::vault::crypto::MasterKey;

        #[derive(serde::Deserialize)]
        struct Reply {
            secret: String,
        }

        if !state.is_vault_present() {
            return Err(AppError::VaultMissing);
        }

        let handle = app.state::<crate::biometric::BiometricHandle<tauri::Wry>>();
        let reply: Reply = handle
            .0
            .run_mobile_plugin_async("unlock", serde_json::json!({}))
            .await
            .map_err(android::map_error)?;

        let bytes = base64::engine::general_purpose::STANDARD
            .decode(reply.secret.trim())
            .map_err(|_| AppError::BiometricFailed("kunci tersegel rusak".into()))?;
        if bytes.len() != 32 {
            return Err(AppError::BiometricFailed(
                "panjang kunci tersegel tidak valid".into(),
            ));
        }

        let mut raw = [0_u8; 32];
        raw.copy_from_slice(&bytes);
        let key: MasterKey = Zeroizing::new(raw);

        super::vault::unlock_with_key(&state, key)
    }

    #[cfg(not(target_os = "android"))]
    {
        let _ = (app, state);
        Err(AppError::BiometricUnavailable)
    }
}

/// Forget the sealed key (does not touch the vault itself).
#[tauri::command]
pub async fn biometric_disable(app: AppHandle) -> AppResult<()> {
    #[cfg(target_os = "android")]
    {
        let handle = app.state::<crate::biometric::BiometricHandle<tauri::Wry>>();
        let _: serde_json::Value = handle
            .0
            .run_mobile_plugin_async("disable", serde_json::json!({}))
            .await
            .map_err(android::map_error)?;
        Ok(())
    }

    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
        Ok(())
    }
}
