//! Non-secret application settings.
//!
//! Kept in a plain `settings.json` so the theme and auto lock policy work
//! while the vault is locked. Secrets never live here.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Theme {
    System,
    Light,
    Dark,
}

pub const MAX_AUTOLOCK_SECS: u64 = 86_400;
pub const MAX_CLOCK_OFFSET_SECS: i64 = 86_400;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct Settings {
    pub theme: Theme,
    /// Idle seconds before the vault locks itself. `0` disables auto lock.
    pub autolock_secs: u64,
    /// Local clock correction in seconds, applied to TOTP windows.
    pub offset_secs: i64,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            theme: Theme::System,
            autolock_secs: 300,
            offset_secs: 0,
        }
    }
}

impl Settings {
    /// Clamp values that arrive from the frontend or a hand edited file.
    pub fn sanitize(&mut self) {
        if self.autolock_secs > MAX_AUTOLOCK_SECS {
            self.autolock_secs = MAX_AUTOLOCK_SECS;
        }
        if self.offset_secs.abs() > MAX_CLOCK_OFFSET_SECS {
            self.offset_secs = 0;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_are_sane() {
        let settings = Settings::default();
        assert_eq!(settings.autolock_secs, 300);
        assert_eq!(settings.offset_secs, 0);
        assert_eq!(settings.theme, Theme::System);
    }

    #[test]
    fn sanitizes_out_of_range_values() {
        let mut settings = Settings {
            autolock_secs: 999_999,
            offset_secs: 999_999,
            ..Default::default()
        };
        settings.sanitize();
        assert_eq!(settings.autolock_secs, MAX_AUTOLOCK_SECS);
        assert_eq!(settings.offset_secs, 0);
    }

    #[test]
    fn missing_fields_fall_back_to_defaults() {
        let settings: Settings = serde_json::from_str("{}").unwrap();
        assert_eq!(settings.autolock_secs, 300);
    }
}
