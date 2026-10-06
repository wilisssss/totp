//! Persistence for the encrypted vault and the plain text settings file.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};
use crate::otp::OtpEntry;
use crate::settings::Settings;

use super::crypto::VaultFile;

/// The decrypted vault payload, i.e. everything AES-GCM protects.
#[derive(Debug, Default, Serialize, Deserialize)]
pub struct Payload {
    #[serde(default)]
    pub entries: Vec<OtpEntry>,
}

pub struct Store {
    dir: PathBuf,
}

impl Store {
    pub fn new(dir: PathBuf) -> Self {
        Self { dir }
    }

    pub fn vault_path(&self) -> PathBuf {
        self.dir.join("vault.json")
    }

    pub fn settings_path(&self) -> PathBuf {
        self.dir.join("settings.json")
    }

    pub fn exists(&self) -> bool {
        self.vault_path().exists()
    }

    pub fn load_vault(&self) -> AppResult<Option<VaultFile>> {
        if !self.exists() {
            return Ok(None);
        }

        let raw = fs::read_to_string(self.vault_path())?;
        let vault: VaultFile = serde_json::from_str(&raw)
            .map_err(|error| AppError::Corrupt(format!("format vault tidak dikenali: {error}")))?;
        Ok(Some(vault))
    }

    pub fn save_vault(&self, vault: &VaultFile) -> AppResult<()> {
        let raw = serde_json::to_string(vault)
            .map_err(|error| AppError::Internal(format!("gagal serialisasi vault: {error}")))?;
        self.write_atomic(&self.vault_path(), raw.as_bytes())
    }

    /// Settings are deliberately plain text: the theme and auto lock policy
    /// have to work before the vault is unlocked.
    pub fn load_settings(&self) -> Settings {
        fs::read_to_string(self.settings_path())
            .ok()
            .and_then(|raw| serde_json::from_str(&raw).ok())
            .map(|mut settings: Settings| {
                settings.sanitize();
                settings
            })
            .unwrap_or_default()
    }

    pub fn save_settings(&self, settings: &Settings) -> AppResult<()> {
        let raw = serde_json::to_string_pretty(settings)
            .map_err(|error| AppError::Internal(format!("gagal serialisasi settings: {error}")))?;
        self.write_atomic(&self.settings_path(), raw.as_bytes())
    }

    /// Write to a temp file, fsync, then rename over the target so a crash
    /// can never leave a half written vault behind.
    fn write_atomic(&self, path: &Path, bytes: &[u8]) -> AppResult<()> {
        fs::create_dir_all(&self.dir)?;

        let tmp = path.with_extension("json.tmp");
        {
            let mut options = fs::OpenOptions::new();
            options.write(true).create(true).truncate(true);
            #[cfg(unix)]
            {
                use std::os::unix::fs::OpenOptionsExt;
                options.mode(0o600);
            }

            let mut file = options.open(&tmp)?;
            file.write_all(bytes)?;
            file.sync_all()?;
        }

        fs::rename(&tmp, path)?;

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = fs::set_permissions(path, fs::Permissions::from_mode(0o600));
        }

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::vault::crypto::{default_kdf, seal};

    fn temp_store() -> (tempfile::TempDir, Store) {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::new(dir.path().to_path_buf());
        (dir, store)
    }

    #[test]
    fn missing_vault_reports_none() {
        let (_dir, store) = temp_store();
        assert!(!store.exists());
        assert!(store.load_vault().unwrap().is_none());
    }

    #[test]
    fn vault_roundtrip() {
        let (_dir, store) = temp_store();
        let (_key, vault) = seal("passphrase", &default_kdf(), b"{\"entries\":[]}").unwrap();

        store.save_vault(&vault).unwrap();
        assert!(store.exists());

        let loaded = store.load_vault().unwrap().unwrap();
        assert_eq!(loaded.ciphertext, vault.ciphertext);
        assert_eq!(loaded.salt, vault.salt);
    }

    #[test]
    fn corrupt_vault_is_reported() {
        let (_dir, store) = temp_store();
        fs::create_dir_all(store.vault_path().parent().unwrap()).unwrap();
        fs::write(store.vault_path(), "not json at all").unwrap();

        assert!(matches!(
            store.load_vault().unwrap_err(),
            AppError::Corrupt(_)
        ));
    }

    #[test]
    fn settings_fall_back_to_defaults() {
        let (_dir, store) = temp_store();
        assert_eq!(store.load_settings().autolock_secs, 300);

        let mut settings = store.load_settings();
        settings.autolock_secs = 60;
        store.save_settings(&settings).unwrap();
        assert_eq!(store.load_settings().autolock_secs, 60);
    }

    #[test]
    fn stored_file_is_owner_only() {
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let (_dir, store) = temp_store();
            let (_key, vault) = seal("pw", &default_kdf(), b"{}").unwrap();
            store.save_vault(&vault).unwrap();

            let mode = fs::metadata(store.vault_path())
                .unwrap()
                .permissions()
                .mode();
            assert_eq!(mode & 0o777, 0o600);
        }
    }
}
