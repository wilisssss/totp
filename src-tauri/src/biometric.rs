//! Android biometric plugin bridge.
//!
//! The Kotlin plugin (`BiometricPlugin.kt`) owns the `BiometricPrompt` and the
//! Android Keystore key; this module only keeps the JNI handle so Rust
//! commands can talk to it. The vault master key is sealed/opened inside the
//! plugin and never crosses the IPC bridge to the frontend.

use tauri::plugin::{Builder, PluginHandle, TauriPlugin};
use tauri::{Manager, Runtime};

const PLUGIN_IDENTIFIER: &str = "id.wilisssss.totp.biometric";

/// JNI handle to the Kotlin plugin, managed as Tauri state.
pub struct BiometricHandle<R: Runtime>(pub PluginHandle<R>);

/// Registers the Kotlin plugin under the name `biometric`.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("biometric")
        .setup(|app, api| {
            let handle = api.register_android_plugin(PLUGIN_IDENTIFIER, "BiometricPlugin")?;
            app.manage(BiometricHandle(handle));
            Ok(())
        })
        .build()
}
