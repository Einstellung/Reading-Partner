// Apple Health, read-only: the body measurements the meal targets are computed
// from (height, weight, body fat, waist, sex, date of birth). One command,
// `read_body`, which asks for read authorization the first time it runs and
// then answers with whatever the reader allowed. Nothing is ever written to
// HealthKit.
//
// Everything real is in Swift, under ios/. The payload is passed through as
// JSON untouched; turning it into numbers the app uses is
// src/platform/app/health.ts's job, where it can be tested.

use tauri::{
    plugin::{Builder, TauriPlugin},
    Manager, Runtime,
};

// Split by target_os rather than by tauri's desktop/mobile cfg: Android is
// mobile and has no implementation here either.
#[cfg(not(target_os = "ios"))]
mod fallback;
#[cfg(target_os = "ios")]
mod ios;

mod commands;
mod error;

pub use error::{Error, Result};

#[cfg(not(target_os = "ios"))]
use fallback::Health;
#[cfg(target_os = "ios")]
use ios::Health;

/// Extensions to [`tauri::App`], [`tauri::AppHandle`] and [`tauri::Window`] to
/// access the Health API.
pub trait HealthExt<R: Runtime> {
    fn health(&self) -> &Health<R>;
}

impl<R: Runtime, T: Manager<R>> crate::HealthExt<R> for T {
    fn health(&self) -> &Health<R> {
        self.state::<Health<R>>().inner()
    }
}

/// Initializes the plugin.
///
/// The name given here makes the invoke prefix `plugin:health|`; it has to
/// agree with `links` in Cargo.toml, which names the ACL namespace.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("health")
        .invoke_handler(tauri::generate_handler![commands::read_body])
        .setup(|app, api| {
            #[cfg(target_os = "ios")]
            let health = ios::init(app, api)?;
            #[cfg(not(target_os = "ios"))]
            let health = fallback::init(app, api)?;
            app.manage(health);
            Ok(())
        })
        .build()
}
