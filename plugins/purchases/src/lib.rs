// The lifetime unlock (docs/platform/713): a non-consumable in-app purchase on
// iOS and Android. RevenueCat ties it to the user's Supabase account.

use tauri::{
    plugin::{Builder, TauriPlugin},
    Manager, Runtime,
};

pub use models::*;

#[cfg(not(any(target_os = "android", target_os = "ios")))]
mod fallback;
#[cfg(any(target_os = "android", target_os = "ios"))]
mod mobile;

mod commands;
mod models;

#[cfg(not(any(target_os = "android", target_os = "ios")))]
use fallback::Purchases;
#[cfg(any(target_os = "android", target_os = "ios"))]
use mobile::Purchases;

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
/// the native registration name `purchases`; it has to agree with `links` in
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
            #[cfg(any(target_os = "android", target_os = "ios"))]
            let purchases = mobile::init(api)?;
            #[cfg(not(any(target_os = "android", target_os = "ios")))]
            let purchases = fallback::init(app, api);
            app.manage(purchases);
            Ok(())
        })
        .build()
}
