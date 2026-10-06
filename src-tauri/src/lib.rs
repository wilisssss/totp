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

use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Manager,
};

use crate::state::AppState;
use crate::vault::store::Store;

/// Idle-loop cadence: poll often while unlocked so auto lock feels precise,
/// back off while locked (nothing to lock, save the CPU wakeups).
const AWAKE_POLL_SECS: u64 = 2;
const LOCKED_POLL_SECS: u64 = 30;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            let window = app.get_webview_window("main");

            let state = AppState::new(Store::new(data_dir), window);
            state.refresh_title();
            app.manage(state);

            build_tray(app)?;

            // Belt and braces: close the vault after the idle timeout even if
            // the frontend stops polling.
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                loop {
                    let locked = handle.state::<AppState>().is_locked().unwrap_or(true);
                    let secs = if locked {
                        LOCKED_POLL_SECS
                    } else {
                        AWAKE_POLL_SECS
                    };
                    tokio::time::sleep(std::time::Duration::from_secs(secs)).await;
                    handle.state::<AppState>().lock_if_idle();
                }
            });

            Ok(())
        })
        .on_window_event(|window, event| {
            // Optional "close to tray": hide the window instead of quitting.
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let state = window.app_handle().state::<AppState>();
                let close_to_tray = state.settings().map(|s| s.close_to_tray).unwrap_or(false);
                if close_to_tray {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
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
            commands::backup::backup_export_encrypted,
            commands::backup::backup_import_encrypted,
            commands::settings::settings_get,
            commands::settings::settings_set,
            commands::settings::clock_sync,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// System tray with quick actions: reopen, lock, quit.
fn build_tray(app: &tauri::App) -> Result<(), tauri::Error> {
    let show = MenuItem::with_id(app, "show", "Buka TOTP", true, None::<&str>)?;
    let lock = MenuItem::with_id(app, "lock", "Kunci vault", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Keluar", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &lock, &quit])?;

    let mut tray = TrayIconBuilder::with_id("main-tray")
        .menu(&menu)
        .show_menu_on_left_click(true)
        .tooltip("TOTP")
        .on_menu_event(|app, event| match event.id().as_ref() {
            "show" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.unminimize();
                    let _ = window.set_focus();
                }
            }
            "lock" => {
                let state = app.state::<AppState>();
                let _ = state.lock();
            }
            "quit" => app.exit(0),
            _ => {}
        });

    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }

    tray.build(app)?;
    Ok(())
}
