//! Shared, mutex protected application state.
//!
//! Secrets (the master key and the decrypted entries) only exist here while
//! the vault is unlocked; [`AppState::lock`] drops them from memory.

use std::sync::{Mutex, MutexGuard};
use std::time::Instant;

use serde::Serialize;
use tauri::WebviewWindow;

use crate::error::{AppError, AppResult};
use crate::otp::OtpEntry;
use crate::settings::Settings;
use crate::vault::crypto::{self, MasterKey, VaultFile};
use crate::vault::store::Store;

pub struct AppState {
    store: Store,
    inner: Mutex<Inner>,
    /// Used to advertise the lock state in the window title / task switcher.
    window: Option<WebviewWindow>,
}

struct Inner {
    key: Option<MasterKey>,
    entries: Option<Vec<OtpEntry>>,
    /// Vault header (salts + verifier); reused on every save.
    header: Option<VaultFile>,
    settings: Settings,
    last_activity: Instant,
}

/// Serialises the entries the same way [`Payload`] does, without cloning.
#[derive(Serialize)]
struct PayloadRef<'a> {
    entries: &'a [OtpEntry],
}

impl AppState {
    pub fn new(store: Store, window: Option<WebviewWindow>) -> Self {
        let settings = store.load_settings();
        Self {
            store,
            window,
            inner: Mutex::new(Inner {
                key: None,
                entries: None,
                header: None,
                settings,
                last_activity: Instant::now(),
            }),
        }
    }

    pub fn store(&self) -> &Store {
        &self.store
    }

    /// Reflect the current lock state in the window title so the task
    /// switcher shows whether secrets are exposed at the moment.
    pub fn refresh_title(&self) {
        let Some(window) = self.window.as_ref() else {
            return;
        };

        let locked = self.is_locked().unwrap_or(true);
        let has_vault = self.store.vault_path().exists();
        let title = if locked && has_vault {
            "TOTP — terkunci"
        } else {
            "TOTP"
        };

        if let Err(error) = window.set_title(title) {
            eprintln!("gagal mengatur judul jendela: {error}");
        }
    }

    fn guard(&self) -> AppResult<MutexGuard<'_, Inner>> {
        self.inner
            .lock()
            .map_err(|_| AppError::Internal("state mutex terkunci".into()))
    }

    pub fn touch(&self) -> AppResult<()> {
        self.guard()?.last_activity = Instant::now();
        Ok(())
    }

    pub fn is_locked(&self) -> AppResult<bool> {
        Ok(self.guard()?.entries.is_none())
    }

    pub fn settings(&self) -> AppResult<Settings> {
        Ok(self.guard()?.settings.clone())
    }

    pub fn set_settings(&self, mut settings: Settings) -> AppResult<Settings> {
        settings.sanitize();
        self.store.save_settings(&settings)?;

        let mut inner = self.guard()?;
        inner.settings = settings.clone();
        inner.last_activity = Instant::now();
        Ok(settings)
    }

    /// Mark the vault unlocked. The caller has already verified the
    /// passphrase and decrypted the payload.
    pub fn unlock(
        &self,
        key: MasterKey,
        header: VaultFile,
        entries: Vec<OtpEntry>,
    ) -> AppResult<()> {
        {
            let mut inner = self.guard()?;
            inner.key = Some(key);
            inner.header = Some(header);
            inner.entries = Some(entries);
            inner.last_activity = Instant::now();
        }

        self.refresh_title();
        Ok(())
    }

    /// Drop every secret from memory.
    pub fn lock(&self) -> AppResult<()> {
        {
            let mut inner = self.guard()?;
            inner.key = None;
            inner.header = None;
            inner.entries = None;
            inner.last_activity = Instant::now();
        }

        self.refresh_title();
        Ok(())
    }

    /// Called periodically: locks the vault after the configured idle time.
    pub fn lock_if_idle(&self) {
        let should_lock = {
            let Ok(inner) = self.guard() else {
                return;
            };
            if inner.entries.is_none() {
                return;
            }

            let autolock = inner.settings.autolock_secs;
            autolock != 0 && inner.last_activity.elapsed().as_secs() >= autolock
        };

        if should_lock {
            let _ = self.lock();
        }
    }

    /// Read access, refreshes the idle timer.
    pub fn read_entries<T>(&self, f: impl FnOnce(&[OtpEntry]) -> T) -> AppResult<T> {
        let mut inner = self.guard()?;
        inner.last_activity = Instant::now();
        let entries = inner.entries.as_ref().ok_or(AppError::Locked)?;
        Ok(f(entries))
    }

    /// Write access: runs `f`, then re-encrypts and persists the vault.
    pub fn update_entries<T>(
        &self,
        f: impl FnOnce(&mut Vec<OtpEntry>) -> AppResult<T>,
    ) -> AppResult<T> {
        let mut inner = self.guard()?;
        inner.last_activity = Instant::now();

        let Inner {
            key,
            entries,
            header,
            ..
        } = &mut *inner;

        let entries = entries.as_mut().ok_or(AppError::Locked)?;
        let key = key.as_ref().ok_or(AppError::Locked)?;
        let current_header = header.as_ref().ok_or(AppError::Locked)?;

        let result = f(entries)?;

        let plaintext = serde_json::to_string(&PayloadRef {
            entries: entries.as_slice(),
        })
        .map_err(|error| AppError::Internal(format!("gagal serialisasi entri: {error}")))?;

        let (nonce, ciphertext) = crypto::encrypt(key, plaintext.as_bytes())?;
        let mut saved = current_header.clone();
        saved.nonce = nonce;
        saved.ciphertext = ciphertext;

        self.store.save_vault(&saved)?;
        *header = Some(saved);

        Ok(result)
    }

    /// Convenience used by the snapshot command.
    pub fn is_vault_present(&self) -> bool {
        self.store.exists()
    }
}
