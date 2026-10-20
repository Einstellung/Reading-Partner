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

/// The other bench: synthesise for real and speak it. Text goes to the
/// session's voice (on-device Kokoro), the trim and the relay run in Rust, and
/// the sentences land on the same player the fixture legs use, so the two are
/// comparable. Resolves when every sentence has
/// been handed to the player — the audio is still playing then, and the `speech`
/// event is what says the voice has stopped.
///
/// Debug builds only.
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

/// Open a turn and answer with its number. Whatever was still speaking stops.
#[command]
pub(crate) async fn speak_begin<R: Runtime>(app: AppHandle<R>) -> Result<u64> {
    crate::harness::mark("speak-begin", serde_json::json!({}));
    let utterance = app.state::<SpeechSession>().begin().await?;
    crate::harness::mark("speak-begun", serde_json::json!({ "utterance": utterance }));
    Ok(utterance)
}

/// The turn's next sentence, already split by the caller.
#[command]
pub(crate) async fn speak_push<R: Runtime>(app: AppHandle<R>, text: String) -> Result<()> {
    crate::harness::mark(
        "speak-push",
        serde_json::json!({ "chars": text.chars().count(), "text": text.chars().take(60).collect::<String>() }),
    );
    app.state::<SpeechSession>().push(text).await
}

/// No more sentences are coming. What was pushed is still spoken.
#[command]
pub(crate) async fn speak_close<R: Runtime>(app: AppHandle<R>) -> Result<()> {
    app.state::<SpeechSession>().close().await
}

/// Cut the turn off now. The answer names the turn it cut; the position in it
/// is zeroes on the path that matters — see the warning on
/// `SpeechSession::stop`.
#[command]
pub(crate) async fn speak_stop<R: Runtime>(app: AppHandle<R>) -> Result<SpeechStopped> {
    crate::harness::mark("speak-stop", serde_json::json!({}));
    app.state::<SpeechSession>().stop().await
}

/// Make the program's own short lines in `lang` (`zh`, `en`) ahead of need,
/// and answer how many are ready (tts/cues.rs). Called when a call opens.
#[command]
pub(crate) async fn prime_speech_cues<R: Runtime>(
    app: AppHandle<R>,
    lang: String,
) -> Result<usize> {
    app.state::<SpeechSession>().prime_cues(&lang).await
}

/// Say one of those lines as a turn of its own, and answer with the turn's
/// number. Whatever was speaking stops. A line that was not made in advance is
/// synthesised from its text.
#[command]
pub(crate) async fn speak_cue<R: Runtime>(app: AppHandle<R>, id: String) -> Result<u64> {
    app.state::<SpeechSession>().speak_cue(&id).await
}

/// The silent bench (src/harness.rs, docs/platform/560). Debug builds only.
///
/// `clock` answers the shared clock; `mark` writes a webview row; `arm`
/// opens a run directory under the app data directory and points the next
/// call at the harness; `clip` writes one WAV (base64) into it; `feed` plays a
/// written clip into the call and answers when it is over; `disarm` closes the
/// run and answers with its directory.
#[command]
#[allow(clippy::too_many_arguments)]
pub(crate) async fn harness<R: Runtime>(
    app: AppHandle<R>,
    op: String,
    name: Option<String>,
    run: Option<String>,
    wav: Option<String>,
    perf_ms: Option<f64>,
    data: Option<serde_json::Value>,
    vad: Option<String>,
) -> Result<serde_json::Value> {
    use serde_json::json;
    if !cfg!(debug_assertions) {
        return Err(crate::Error::Unsupported(
            "The voice harness is in debug builds only.".into(),
        ));
    }
    let safe = |s: &str| -> String {
        s.chars()
            .map(|c| if c.is_ascii_alphanumeric() || "-_.".contains(c) { c } else { '_' })
            .collect()
    };
    let armed_dir = || {
        crate::harness::dir()
            .ok_or_else(|| crate::Error::Speech("The harness is not armed.".into()))
    };
    match op.as_str() {
        "clock" => Ok(json!({ "t": crate::harness::now_ms() })),
        "mark" => {
            let t = crate::harness::mark_js(
                name.as_deref().unwrap_or("mark"),
                perf_ms,
                data.unwrap_or(serde_json::Value::Null),
            );
            Ok(json!({ "t": t }))
        }
        "arm" => {
            let run = safe(run.as_deref().unwrap_or("run"));
            let dir = app
                .path()
                .app_data_dir()
                .map_err(|e| crate::Error::Speech(e.to_string()))?
                .join("voice-harness")
                .join(run);
            crate::harness::arm(&dir)?;
            let native = app
                .voice()
                .harness(json!({ "op": "arm", "dir": dir.join("native"), "vad": vad }))
                .await;
            if let Err(e) = native {
                crate::harness::disarm();
                return Err(e);
            }
            Ok(json!({ "dir": dir, "t": crate::harness::now_ms() }))
        }
        "clip" => {
            use base64::Engine as _;
            let dir = armed_dir()?;
            let name = safe(name.as_deref().unwrap_or("clip.wav"));
            let bytes = base64::engine::general_purpose::STANDARD
                .decode(wav.unwrap_or_default())
                .map_err(|e| crate::Error::Speech(format!("clip {name} is not base64: {e}")))?;
            let path = dir.join("clips").join(&name);
            std::fs::write(&path, &bytes)?;
            Ok(json!({ "path": path, "bytes": bytes.len() }))
        }
        "feed" => {
            let dir = armed_dir()?;
            let name = safe(name.as_deref().unwrap_or("clip.wav"));
            let path = dir.join("clips").join(&name);
            crate::harness::mark("feed-call", json!({ "name": name }));
            app.voice()
                .harness(json!({ "op": "feed", "path": path, "name": name }))
                .await
        }
        "disarm" => {
            let native = app.voice().harness(json!({ "op": "disarm" })).await;
            let dir = crate::harness::disarm();
            native?;
            Ok(json!({ "dir": dir }))
        }
        other => Err(crate::Error::Speech(format!("Unknown harness op {other}."))),
    }
}

// The full-duplex call (docs/33 M-voice-3). Three forwarders, like the
// dictation ones: the microphone, the recogniser, the turn detector and the
// player are all in Swift, and the verdicts reach the webview as the
// `conversation` plugin event without passing through here.

/// Open the microphone for a call and keep it open until `stop_conversation`.
/// Same two arguments as `start_dictation`, with the same absence rules.
#[command]
pub(crate) async fn start_conversation<R: Runtime>(
    app: AppHandle<R>,
    locale: Option<String>,
    contextual_strings: Option<Vec<String>>,
) -> Result<()> {
    // The on-device model loads while the user says the first thing.
    app.state::<SpeechSession>().warm();
    app.voice()
        .start_conversation(locale, contextual_strings)
        .await
}

/// Whether this device can hold a call. Never rejects: anything short of a
/// yes is `{ call: false }`.
#[command]
pub(crate) async fn voice_capability<R: Runtime>(app: AppHandle<R>) -> Result<VoiceCapability> {
    Ok(app.voice().voice_capability().await)
}

/// End the call. Resolves on no call at all.
#[command]
pub(crate) async fn stop_conversation<R: Runtime>(app: AppHandle<R>) -> Result<()> {
    app.voice().stop_conversation().await
}

/// The playback level, 0..1: the webview's duck and full values. The native
/// side ducks and restores at the verdict on its own; this names the levels.
#[command]
pub(crate) async fn set_speech_volume<R: Runtime>(app: AppHandle<R>, value: f64) -> Result<()> {
    app.voice().set_speech_volume(value).await
}

// On-device Kokoro (src/kokoro), iOS's only voice (session.rs). These fetch the
// weights, say what is on disk, and bench the engine on the device; speaking
// goes through the `speak_*` commands like any voice.

/// What of the pinned Kokoro revision is on disk, and how a running download
/// is getting on. Cheap: file sizes only, no hashing.
#[command]
pub(crate) async fn kokoro_status<R: Runtime>(
    app: AppHandle<R>,
) -> Result<crate::kokoro::download::ModelStatus> {
    Ok(app.state::<crate::kokoro::KokoroModels>().0.status())
}

/// Start fetching these variants (`"fp32"`, `"fp16"`, `"int8"`) and the
/// voices, in the background, resuming whatever an earlier attempt left. A
/// call while one runs changes nothing. Answers with the status right after
/// starting; poll `kokoro_status` for progress.
#[command]
pub(crate) async fn kokoro_download<R: Runtime>(
    app: AppHandle<R>,
    variants: Vec<crate::kokoro::manifest::Variant>,
) -> Result<crate::kokoro::download::ModelStatus> {
    let models = app.state::<crate::kokoro::KokoroModels>().0.clone();
    let root = models.prepare_root()?.to_path_buf();
    app.voice().exclude_from_backup(root.display().to_string()).await?;
    models.start(variants);
    Ok(models.status())
}

/// The device bench (src/kokoro/bench.rs): load each downloaded variant at
/// each thread count and time every sentence. Debug builds with the engine
/// only (iOS). Takes minutes for the full grid.
#[command]
pub(crate) async fn kokoro_bench<R: Runtime>(
    app: AppHandle<R>,
    args: serde_json::Value,
) -> Result<serde_json::Value> {
    #[cfg(all(debug_assertions, feature = "kokoro"))]
    {
        let args: crate::kokoro::bench::BenchArgs = serde_json::from_value(args)
            .map_err(|e| crate::Error::Speech(format!("Bench arguments: {e}")))?;
        let root = app.state::<crate::kokoro::KokoroModels>().0.root().to_path_buf();
        let report = tauri::async_runtime::spawn_blocking(move || {
            crate::kokoro::bench::run(&root, &args)
        })
        .await
        .map_err(|e| crate::Error::Speech(e.to_string()))?
        .map_err(crate::Error::Speech)?;
        serde_json::to_value(report).map_err(|e| crate::Error::Speech(e.to_string()))
    }
    #[cfg(not(all(debug_assertions, feature = "kokoro")))]
    {
        let _ = (app, args);
        Err(crate::Error::Speech(
            "The Kokoro bench is in debug builds with the on-device engine only.".to_string(),
        ))
    }
}
