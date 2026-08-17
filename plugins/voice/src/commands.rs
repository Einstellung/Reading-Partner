// The frontend-facing commands. Each one is a thin forwarder: the whole audio
// and recognition pipeline lives in Swift (docs/33, 形态：全原生), and Rust only
// carries arguments across.
//
// `start_dictation` takes its two arguments one by one rather than as a single
// struct on purpose. Tauri keys command arguments by parameter name, so a
// `params: StartParams` argument would force the frontend to send
// `{ params: { … } }`; listing them keeps the invoke payload flat, which is the
// shape src/ai/voice/dictation.ts sends.
//
// `#[tauri::command]` reads arguments as camelCase by default, so
// `contextual_strings` is `contextualStrings` on the wire with no annotation.

use tauri::{command, ipc::Channel, AppHandle, Runtime};

use crate::models::*;
use crate::Result;
use crate::VoiceExt;

/// Open the microphone and start recognising. Both arguments are usually
/// absent rather than null: the invoke payload is JSON.stringify'd and
/// undefined properties vanish, and the composer passes neither on a book with
/// no glossary.
#[command]
pub(crate) async fn start_dictation<R: Runtime>(
    app: AppHandle<R>,
    // BCP-47. Left unset the native side picks from the device's preferred
    // languages, because `Locale.current` is not usable for this (docs/33).
    locale: Option<String>,
    // Proper nouns to bias recognition towards. Capped and truncated natively;
    // the composer sends an uncapped `glossary.split('\n')`.
    contextual_strings: Option<Vec<String>>,
) -> Result<()> {
    app.voice().start_dictation(locale, contextual_strings).await
}

/// Finish, flush what the recogniser was still holding, and hand back
/// everything the user said.
#[command]
pub(crate) async fn stop_dictation<R: Runtime>(app: AppHandle<R>) -> Result<StopDictation> {
    app.voice().stop_dictation().await
}

/// Same teardown, transcript discarded. Routinely arrives milliseconds after
/// `start_dictation` resolves — any tap is a start followed by a cancel — so it
/// has to be safe on a session that never produced a sample.
#[command]
pub(crate) async fn cancel_dictation<R: Runtime>(app: AppHandle<R>) -> Result<()> {
    app.voice().cancel_dictation().await
}

// The two below are the machinery behind `addPluginListener('voice', …)`. The
// frontend sends a Channel; deserializing it here is what registers it with the
// mobile bridge, and serializing it back out (as `__CHANNEL__:<id>`) is what
// lets the Swift side's `trigger` reach it. Tauri core implements neither, so
// without them `addPluginListener` is rejected by the ACL before Rust sees it.
#[command]
pub(crate) async fn register_listener<R: Runtime>(
    app: AppHandle<R>,
    event: String,
    handler: Channel,
) -> Result<()> {
    app.voice().register_listener(event, handler).await
}

#[command]
pub(crate) async fn remove_listener<R: Runtime>(
    app: AppHandle<R>,
    event: String,
    channel_id: u32,
) -> Result<()> {
    app.voice().remove_listener(event, channel_id).await
}
