// The whole production line in one run, on the phone. Debug builds only.
//
// The fixture legs (SpeechProbe.swift) play PCM synthesised days ago: they
// measure the player and nothing in front of it, which is what makes them the
// control — no vendor latency in the middle of a question about splicing. This
// is the other half, and it is the only path that ever runs all of it at once:
// text in, Mimo's SSE, the trim, the relay's admission gate, the phone's own
// speaker, and a per-sentence timeline of the whole thing back out.
//
// The answer is untyped for the same reason the Swift report is (models.rs): it
// is a diagnostic whose shape follows the question being asked, and the only
// thing that reads it is the smoke harness, which stringifies it.

use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Deserialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Runtime};
use tokio::sync::mpsc;

use crate::speaker::DevicePlayer;
use crate::tts::{mimo::MimoBackend, RelayConfig, RelayEvent, SpeechRelay, TtsBackend};
use crate::{Error, Result};

// The key is read from the process environment, never from an argument and
// never from a file: the run is launched with
// `DEVICECTL_CHILD_MIMO_API_KEY=… xcrun devicectl device process launch`, so it
// exists for the length of the run and is nowhere on the phone's disk, in the
// bundle, or in the repository. The same variable the session reads.
use crate::session::KEY_VAR;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LiveArgs {
    /// The sentences to speak, already split. The harness reads them out of the
    /// fixture manifest, so a live run says exactly what the fixture legs say
    /// and the two can be compared line by line.
    sentences: Vec<String>,
    /// Vendor voice name. Absent takes the backend's own default (冰糖).
    voice: Option<String>,
    prefetch_ms: Option<f64>,
    concurrency: Option<usize>,
    gap_ms: Option<f64>,
}

pub async fn run<R: Runtime>(app: AppHandle<R>, args: Value) -> Result<Value> {
    let args: LiveArgs = serde_json::from_value(args)
        .map_err(|e| Error::Speech(format!("That live run did not parse: {e}")))?;
    if args.sentences.is_empty() {
        return Err(Error::Speech("A live run needs a sentence to say.".into()));
    }
    let key = std::env::var(KEY_VAR).map_err(|_| {
        Error::Speech(format!(
            "{KEY_VAR} is not in this process's environment. Launch the app with \
             DEVICECTL_CHILD_{KEY_VAR} set."
        ))
    })?;

    let backend = MimoBackend::new(key).map_err(|e| Error::Speech(e.to_string()))?;
    let mut config = RelayConfig::default();
    if let Some(voice) = args.voice.filter(|v| !v.is_empty()) {
        config.voice = voice;
    }
    if let Some(ms) = args.prefetch_ms {
        config.prefetch_ms = ms;
    }
    if let Some(n) = args.concurrency {
        config.concurrency = n.max(1);
    }
    if let Some(ms) = args.gap_ms {
        config.gap_ms = ms;
    }
    let model = backend.model().to_string();
    let voice = if config.voice.is_empty() {
        backend.default_voice().to_string()
    } else {
        config.voice.clone()
    };

    // Wall-clock milliseconds: one turn per run, and Swift drops any sentence
    // whose utterance is not the one it is playing, so the number only has to
    // increase.
    let utterance = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    let player = Arc::new(DevicePlayer::new(app, utterance));
    let (events, mut incoming) = mpsc::unbounded_channel();
    let relay = SpeechRelay::start(Arc::new(backend), player, config.clone(), events);

    let chars: usize = args.sentences.iter().map(|s| s.chars().count()).sum();
    for sentence in &args.sentences {
        relay.push(sentence.clone());
    }
    relay.close();

    // Until the relay says every sentence has been handed to the player. The
    // audio goes on playing after that — the `speech` event is what says the
    // voice has stopped — and there is no timeout here: the harness owns the
    // one it already has, and the vendor's own read and connect timeouts bound
    // each request.
    let mut timeline = Vec::new();
    let mut queued = 0;
    let mut failed = 0;
    while let Some(event) = incoming.recv().await {
        match event {
            RelayEvent::Queued { .. } => queued += 1,
            RelayEvent::Failed { .. } => failed += 1,
            _ => {}
        }
        let drained = matches!(event, RelayEvent::Drained { .. });
        timeline.push(record(&event));
        if drained {
            break;
        }
    }

    Ok(json!({
        "utterance": utterance,
        "model": model,
        "voice": voice,
        "sentences": args.sentences.len(),
        "chars": chars,
        "prefetchMs": config.prefetch_ms,
        "concurrency": config.concurrency,
        "gapMs": config.gap_ms,
        "queued": queued,
        "failed": failed,
        "timeline": timeline,
    }))
}

/// One relay event as a row of the record. Written out by hand rather than
/// derived, so that the event type stays a domain type with no wire shape.
fn record(event: &RelayEvent) -> Value {
    match event {
        RelayEvent::Started { id, chars, at_ms } => {
            json!({ "event": "started", "id": id, "chars": chars, "atMs": at_ms })
        }
        RelayEvent::FirstAudio { id, at_ms } => {
            json!({ "event": "firstAudio", "id": id, "atMs": at_ms })
        }
        RelayEvent::Ready {
            id,
            at_ms,
            speech_ms,
            attempts,
            trim,
        } => json!({
            "event": "ready",
            "id": id,
            "atMs": at_ms,
            "speechMs": speech_ms,
            "attempts": attempts,
            "trim": {
                "inputMs": trim.input_ms,
                "keptMs": trim.kept_ms,
                "headTrimmedMs": trim.head_trimmed_ms,
                "tailTrimmedMs": trim.tail_trimmed_ms,
                "headCapped": trim.head_capped,
            },
        }),
        RelayEvent::Queued {
            id,
            at_ms,
            queued_ahead_ms,
        } => json!({
            "event": "queued",
            "id": id,
            "atMs": at_ms,
            "queuedAheadMs": queued_ahead_ms,
        }),
        RelayEvent::Failed { id, at_ms, error } => {
            json!({ "event": "failed", "id": id, "atMs": at_ms, "error": error })
        }
        RelayEvent::Drained { at_ms } => json!({ "event": "drained", "atMs": at_ms }),
    }
}
