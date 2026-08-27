// The native half of on-device dictation (docs/15, docs/33). Audio capture,
// echo cancellation and SpeechAnalyzer recognition all live in Swift, under
// ios/; this crate is the bridge and nothing else.
//
// Four commands and one event. `start_dictation` / `stop_dictation` /
// `cancel_dictation` are invoked from the composer's hold-to-talk bar, and
// `release_microphone` when it goes away; the `dictation` event carries
// `{kind:"volatile"|"final",text}`, `{kind:"level",value}` and
// `{kind:"timing",timing}` and reaches the frontend as a plugin listener.

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
/// Speaking (docs/33, M-voice-2). Platform-independent: it compiles and makes
/// real requests on the desktop, which is where it is measured. No command
/// reaches it yet — the far end is an AVAudioPlayerNode that does not exist, and
/// the shape of the commands follows from what that hand-off turns out to be.
/// See the README's "Speaking" for the contract the Swift half has to meet.
pub mod tts;

pub use error::{Error, Result};

#[cfg(not(target_os = "ios"))]
use fallback::Voice;
#[cfg(target_os = "ios")]
use ios::Voice;

/// Extensions to [`tauri::App`], [`tauri::AppHandle`] and [`tauri::Window`] to access the voice APIs.
pub trait VoiceExt<R: Runtime> {
    fn voice(&self) -> &Voice<R>;
}

impl<R: Runtime, T: Manager<R>> crate::VoiceExt<R> for T {
    fn voice(&self) -> &Voice<R> {
        self.state::<Voice<R>>().inner()
    }
}

/// Initializes the plugin.
///
/// The name given here is what makes the invoke prefix `plugin:voice|` and the
/// Swift registration name `voice`; it has to agree with `links` in Cargo.toml,
/// which is what names the ACL namespace, and nothing checks that at compile
/// time.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("voice")
        .invoke_handler(tauri::generate_handler![
            commands::start_dictation,
            commands::stop_dictation,
            commands::cancel_dictation,
            commands::release_microphone,
            commands::set_indicator_probe,
            commands::stop_speaking,
            commands::speech_probe,
            commands::speech_report,
            commands::register_listener,
            commands::remove_listener
        ])
        .setup(|app, api| {
            #[cfg(target_os = "ios")]
            let voice = ios::init(app, api)?;
            #[cfg(not(target_os = "ios"))]
            let voice = fallback::init(app, api)?;
            app.manage(voice);
            Ok(())
        })
        .build()
}
