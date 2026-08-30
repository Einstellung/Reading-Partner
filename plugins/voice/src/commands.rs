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

use tauri::{command, ipc::Channel, AppHandle, Manager, Runtime};

use crate::models::*;
use crate::session::SpeechSession;
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

/// Let the microphone go: voice mode is over. Whatever was being kept for the
/// next hold is torn down and the orange indicator goes out with it. Resolves on
/// a host with no microphone stack too — the composer calls it on its way out and
/// has nowhere to show a rejection.
#[command]
pub(crate) async fn release_microphone<R: Runtime>(app: AppHandle<R>) -> Result<()> {
    app.voice().release_microphone().await
}

/// Leave the audio stack standing at one step — session active, engine running,
/// tap installed, buffers read — and answer with where it stopped. Nothing is
/// transcribed and no audio is kept; the question it exists for is which of
/// those four lights the orange microphone indicator, which Apple documents
/// nowhere and only a phone in someone's hand can answer.
#[command]
pub(crate) async fn set_indicator_probe<R: Runtime>(
    app: AppHandle<R>,
    stage: String,
) -> Result<IndicatorProbe> {
    app.voice().set_indicator_probe(stage).await
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

// The playback half (docs/33, M-voice-2). Three commands, not four: sentences
// are put on the queue by the TTS client inside Rust through
// `Voice::enqueue_speech`, so the audio never enters the webview and needs no
// permission. What the webview owns is interrupting a turn and driving the
// bench.

/// Cut the voice off and say where it got to. The sentence index and character
/// offset come back so the caller can map them onto the text it sent.
#[command]
pub(crate) async fn stop_speaking<R: Runtime>(
    app: AppHandle<R>,
    reason: Option<String>,
) -> Result<SpeechPosition> {
    app.voice()
        .stop_speaking(reason.unwrap_or_else(|| "interrupted".to_string()))
        .await
}

/// The bench: play a fixture already on the device through the whole playback
/// path, with no network in the loop. Resolves as soon as the run starts; the
/// `speech` event says when it has finished.
///
/// Arguments are carried as one JSON value rather than spelled out, because
/// they are a bench's knobs and change with the question being asked. Tauri
/// keys command arguments by parameter name (docs/pitfall/185), so the webview
/// sends `{ args: { … } }`.
#[command]
pub(crate) async fn speech_probe<R: Runtime>(
    app: AppHandle<R>,
    args: serde_json::Value,
) -> Result<SpeechReport> {
    app.voice().speech_probe(args).await
}

/// The other bench: synthesise for real and speak it. Text goes to Mimo, the
/// trim and the relay run in Rust, and the sentences land on the same player the
/// fixture legs use, so the two are comparable. Resolves when every sentence has
/// been handed to the player — the audio is still playing then, and the `speech`
/// event is what says the voice has stopped.
///
/// Debug builds only. It needs a vendor key in the process environment, which is
/// a thing only a bench launch puts there.
#[command]
pub(crate) async fn speech_live<R: Runtime>(
    app: AppHandle<R>,
    args: serde_json::Value,
) -> Result<serde_json::Value> {
    #[cfg(debug_assertions)]
    {
        crate::live::run(app, args).await
    }
    #[cfg(not(debug_assertions))]
    {
        let _ = (app, args);
        Err(crate::Error::Speech(
            "Speaking from live synthesis is a debug build's bench.".to_string(),
        ))
    }
}

/// What the last bench run measured, and the point at which its tape is written
/// to the container.
#[command]
pub(crate) async fn speech_report<R: Runtime>(app: AppHandle<R>) -> Result<SpeechReport> {
    app.voice().speech_report().await
}

// A turn of speech, one sentence at a time (session.rs). The model streams, the
// webview cuts the stream into sentences, and each one arrives here on its own;
// what holds them together is the `SpeechSession` managed on the app.

/// Hand the speaking half the vendor key saved in Settings, and answer whether
/// there is a voice to speak with afterwards. `null` clears it, after which the
/// process environment's `MIMO_API_KEY` is used again if the run was launched
/// with one.
///
/// Its own command rather than an argument on `speak_begin`: the key belongs to
/// the process, not to a turn, so it crosses the IPC boundary when it changes
/// instead of once per answer.
#[command]
pub(crate) async fn set_speech_key<R: Runtime>(
    app: AppHandle<R>,
    key: Option<String>,
) -> Result<bool> {
    Ok(app.state::<SpeechSession>().use_key(key.as_deref()))
}

/// Open a turn and answer with its number. Whatever was still speaking stops.
#[command]
pub(crate) async fn speak_begin<R: Runtime>(app: AppHandle<R>) -> Result<u64> {
    app.state::<SpeechSession>().begin().await
}

/// The turn's next sentence, already split by the caller.
#[command]
pub(crate) async fn speak_push<R: Runtime>(app: AppHandle<R>, text: String) -> Result<()> {
    app.state::<SpeechSession>().push(text).await
}

/// No more sentences are coming. What was pushed is still spoken.
#[command]
pub(crate) async fn speak_close<R: Runtime>(app: AppHandle<R>) -> Result<()> {
    app.state::<SpeechSession>().close().await
}

/// Cut the turn off now. The answer is a sentinel on the path that matters —
/// see the warning on `SpeechSession::stop`.
#[command]
pub(crate) async fn speak_stop<R: Runtime>(app: AppHandle<R>) -> Result<SpeechStopped> {
    app.state::<SpeechSession>().stop().await
}
