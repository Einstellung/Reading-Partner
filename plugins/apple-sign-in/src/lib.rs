// Sign in with Apple (docs/platform/713): the native ASAuthorization sheet on
// iOS, returning an Apple identity token that the frontend trades for a
// Supabase session. Everything real is in Swift, under ios/; elsewhere both
// commands answer "unavailable". Dormant until the owner turns it on: the
// frontend wrapper (src/platform/app/apple-sign-in.ts) does not invoke it while
// APPLE_SIGN_IN_ENABLED is false.

use tauri::{
    plugin::{Builder, TauriPlugin},
    Manager, Runtime,
};

pub use models::*;

// Split by target_os rather than by tauri's desktop/mobile cfg: Android is
// mobile and has no implementation here either.
#[cfg(not(target_os = "ios"))]
mod fallback;
#[cfg(target_os = "ios")]
mod ios;

mod commands;
mod error;
mod models;

pub use error::{Error, Result};

#[cfg(not(target_os = "ios"))]
use fallback::AppleSignIn;
#[cfg(target_os = "ios")]
use ios::AppleSignIn;

/// Extensions to [`tauri::App`], [`tauri::AppHandle`] and [`tauri::Window`] to
/// access the Sign in with Apple API.
pub trait AppleSignInExt<R: Runtime> {
    fn apple_sign_in(&self) -> &AppleSignIn<R>;
}

impl<R: Runtime, T: Manager<R>> crate::AppleSignInExt<R> for T {
    fn apple_sign_in(&self) -> &AppleSignIn<R> {
        self.state::<AppleSignIn<R>>().inner()
    }
}

/// Initializes the plugin. The name makes the invoke prefix
/// `plugin:apple-sign-in|` and has to agree with `links` in Cargo.toml.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("apple-sign-in")
        .invoke_handler(tauri::generate_handler![
            commands::is_available,
            commands::sign_in
        ])
        .setup(|app, api| {
            #[cfg(target_os = "ios")]
            let apple_sign_in = ios::init(app, api)?;
            #[cfg(not(target_os = "ios"))]
            let apple_sign_in = fallback::init(app, api)?;
            app.manage(apple_sign_in);
            Ok(())
        })
        .build()
}
