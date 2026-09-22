// Open in…: hand a file the app owns to the system share sheet, so the reader
// can read it in whatever app they already use. On a phone the lesson is the
// only way into a PDF, and this is the way out of it.
//
// Two commands and no events. `is_available` says whether the control should be
// drawn at all; `open_in` takes an absolute path inside the app's container and
// puts UIActivityViewController on screen. Everything real is in Swift, under
// ios/; this crate is the bridge and nothing else.

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
use fallback::OpenIn;
#[cfg(target_os = "ios")]
use ios::OpenIn;

/// Extensions to [`tauri::App`], [`tauri::AppHandle`] and [`tauri::Window`] to
/// access the Open in… API.
pub trait OpenInExt<R: Runtime> {
    fn open_in(&self) -> &OpenIn<R>;
}

impl<R: Runtime, T: Manager<R>> crate::OpenInExt<R> for T {
    fn open_in(&self) -> &OpenIn<R> {
        self.state::<OpenIn<R>>().inner()
    }
}

/// Initializes the plugin.
///
/// The name given here is what makes the invoke prefix `plugin:openin|` and the
/// Swift registration name `openin`; it has to agree with `links` in Cargo.toml,
/// which is what names the ACL namespace, and nothing checks that at compile
/// time.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("openin")
        .invoke_handler(tauri::generate_handler![
            commands::is_available,
            commands::open_in
        ])
        .setup(|app, api| {
            #[cfg(target_os = "ios")]
            let open_in = ios::init(app, api)?;
            #[cfg(not(target_os = "ios"))]
            let open_in = fallback::init(app, api)?;
            app.manage(open_in);
            Ok(())
        })
        .build()
}
