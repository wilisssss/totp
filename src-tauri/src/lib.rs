//! TOTP desktop authenticator.
//!
//! Architecture:
//! - [`otp`]  – pure RFC 4226/6238 domain logic, no Tauri types.
//! - [`vault`]– Argon2id + AES-256-GCM encrypted persistence.
//! - [`state`]– in-memory master key + entries, guarded by a mutex.
//! - [`commands`] – the IPC surface exposed to the frontend.

mod commands;
mod error;
mod otp;
mod qr;
mod settings;
mod state;
mod vault;

use tauri::Manager;

use crate::state::AppState;
use crate::vault::store::Store;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            let window = app.get_webview_window("main");

            let state = AppState::new(Store::new(data_dir), window);
            state.refresh_title();
            app.manage(state);

            // Belt and braces: close the vault after the idle timeout even if
            // the frontend stops polling.
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                loop {
                    tokio::time::sleep(std::time::Duration::from_secs(2)).await;
                    handle.state::<AppState>().lock_if_idle();
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::vault::vault_status,
            commands::vault::vault_create,
            commands::vault::vault_unlock,
            commands::vault::vault_lock,
            commands::vault::vault_change_passphrase,
            commands::entries::snapshot,
            commands::entries::entry_create,
            commands::entries::entry_update,
            commands::entries::entry_delete,
            commands::entries::entry_reorder,
            commands::entries::entry_toggle_pin,
            commands::entries::entry_hotp_next,
            commands::entries::entry_reveal_secret,
            commands::entries::entry_qr,
            commands::entries::export_text,
            commands::entries::export_backup,
            commands::importer::import_text,
            commands::importer::import_qr_from_path,
            commands::importer::import_qr_bytes,
            commands::settings::settings_get,
            commands::settings::settings_set,
            commands::settings::clock_sync,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
