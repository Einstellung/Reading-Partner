// The whole production line in one run, on the phone. Debug builds only.
//
// The fixture legs (SpeechProbe.swift) play PCM synthesised days ago: they
// measure the player and nothing in front of it, which is what makes them the
// control — no vendor latency in the middle of a question about splicing. This
// is the other half, and it is the only path that ever runs all of it at once:
// text in, the on-device voice, the trim, the relay's admission gate, the phone's own
// speaker, and a per-sentence timeline of the whole thing back out.
//
// The answer is untyped for the same reason the Swift report is (models.rs): it
// is a diagnostic whose shape follows the question being asked, and the only
// thing that reads it is the smoke harness, which stringifies it.

use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Deserialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Manager, Runtime};
use tokio::sync::mpsc;

use crate::speaker::DevicePlayer;
use crate::session::SpeechSession;
use crate::tts::{RelayConfig, RelayEvent, SpeechRelay};
use crate::{Error, Result};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LiveArgs {
    /// The sentences to speak, already split. The harness reads them out of the
    /// fixture manifest, so a live run says exactly what the fixture legs say
    /// and the two can be compared line by line.
    sentences: Vec<String>,
    /// Voice id. Absent takes the backend's own default.
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
    // The same voice a turn speaks with, so the run is the production line.
    let backend = app.state::<SpeechSession>().vendor()?;
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
    if let Some(most) = backend.max_in_flight() {
        config.concurrency = config.concurrency.min(most.max(1));
    }
    let relay = SpeechRelay::start(backend, player, config.clone(), events);

    let chars: usize = args.sentences.iter().map(|s| s.chars().count()).sum();
    for sentence in &args.sentences {
        relay.push(sentence.clone());
    }
    relay.close();

    // Until the relay says every sentence has been handed to the player. The
    // audio goes on playing after that — the `speech` event is what says the
    // voice has stopped — and there is no timeout here: the harness owns the
    // one it already has.
    let mut timeline = Vec::new();
    let mut queued = 0;
    let mut failed = 0;
    while let Some(event) = incoming.recv().await {
        match event {
            RelayEvent::Queued { .. } => queued += 1,
            RelayEvent::Failed { .. } => failed += 1,
            _ => {}
        }
        // Either way the relay's loop has ended and nothing else is coming.
        let over = matches!(
            event,
            RelayEvent::Drained { .. } | RelayEvent::Abandoned { .. }
        );
        timeline.push(record(&event));
        if over {
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
pub(crate) fn record(event: &RelayEvent) -> Value {
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
        RelayEvent::Waiting { id, at_ms, tail_ms } => {
            json!({ "event": "waiting", "id": id, "atMs": at_ms, "tailMs": tail_ms })
        }
        RelayEvent::Abandoned { id, at_ms } => {
            json!({ "event": "abandoned", "id": id, "atMs": at_ms })
        }
        RelayEvent::Drained { at_ms } => json!({ "event": "drained", "atMs": at_ms }),
    }
}
