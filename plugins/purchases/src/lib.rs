// The lifetime unlock (docs/platform/713): a non-consumable in-app purchase on
// iOS, bought and restored through RevenueCat so the purchase is tied to the
// Supabase account rather than to one device.
//
// Three commands and no events. Everything real is in Swift, under ios/; off
// iOS every command answers `ok: false, error: "unavailable"`.

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
mod models;

#[cfg(not(target_os = "ios"))]
use fallback::Purchases;
#[cfg(target_os = "ios")]
use ios::Purchases;

/// Extensions to [`tauri::App`], [`tauri::AppHandle`] and [`tauri::Window`] to
/// access the purchases API.
pub trait PurchasesExt<R: Runtime> {
    fn purchases(&self) -> &Purchases<R>;
}

impl<R: Runtime, T: Manager<R>> crate::PurchasesExt<R> for T {
    fn purchases(&self) -> &Purchases<R> {
        self.state::<Purchases<R>>().inner()
    }
}

/// Initializes the plugin.
///
/// The name given here is what makes the invoke prefix `plugin:purchases|` and
/// the Swift registration name `purchases`; it has to agree with `links` in
/// Cargo.toml, which is what names the ACL namespace, and nothing checks that
/// at compile time.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("purchases")
        .invoke_handler(tauri::generate_handler![
            commands::configure,
            commands::buy_lifetime,
            commands::restore
        ])
        .setup(|app, api| {
            #[cfg(target_os = "ios")]
            let purchases = ios::init(app, api)?;
            #[cfg(not(target_os = "ios"))]
            let purchases = fallback::init(app, api);
            app.manage(purchases);
            Ok(())
        })
        .build()
}
