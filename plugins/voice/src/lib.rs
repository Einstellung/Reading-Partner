// The native half of on-device dictation (docs/15, docs/33). Audio capture,
// echo cancellation and SpeechAnalyzer recognition all live in Swift, under
// ios/; this crate is the bridge and nothing else.
//
// Four commands and one event. `start_dictation` / `stop_dictation` /
// `cancel_dictation` are invoked from the composer's hold-to-talk bar, and
// `release_microphone` when it goes away; the `dictation` event carries
// `{kind:"volatile"|"final",text}`, `{kind:"level",value}` and
// `{kind:"timing",timing}` and reaches the frontend as a plugin listener.

use std::sync::Arc;

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
/// The whole pipeline against the real vendor and the real speaker, driven from
/// the bench. Debug builds only, and the one path that runs every stage at once.
#[cfg(debug_assertions)]
mod live;
mod models;
/// One turn of speech, held together across the four `speak_*` commands.
mod session;
/// The relay's far end on the phone: `tts::Player` over `Voice::enqueue_speech`.
mod speaker;
/// Speaking (docs/33, M-voice-2). Platform-independent: it compiles and makes
/// real requests on the desktop, which is where it is measured. See the
/// README's "Speaking" for the contract between the two halves.
pub mod tts;

pub use error::{Error, Result};
pub use session::SpeechSession;
pub use speaker::{DevicePlayer, DeviceSpeakers, Speakers};

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
            commands::speech_live,
            commands::speech_report,
            commands::set_speech_key,
            commands::speak_begin,
            commands::speak_push,
            commands::speak_close,
            commands::speak_stop,
            commands::start_conversation,
            commands::stop_conversation,
            commands::set_speech_volume,
            commands::register_listener,
            commands::remove_listener
        ])
        .setup(|app, api| {
            #[cfg(target_os = "ios")]
            let voice = ios::init(app, api)?;
            #[cfg(not(target_os = "ios"))]
            let voice = fallback::init(app, api)?;
            app.manage(voice);
            // Not split by target_os, and deliberately: the session is Rust all
            // the way down — a relay and a vendor — and the one thing on it that
            // needs a phone is where the audio ends up. `DevicePlayer` already
            // handles that by asking `Voice`, which off iOS answers every
            // enqueue with a sentence saying so (fallback.rs). A second copy of
            // "this host cannot speak" here would say the same thing twice.
            app.manage(session::SpeechSession::from_env(Arc::new(
                speaker::DeviceSpeakers::new(app.clone()),
            )));
            Ok(())
        })
        .build()
}
