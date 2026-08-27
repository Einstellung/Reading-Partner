// The one wire shape this plugin returns. Everything else it carries is a
// command argument or an event payload built in Swift.

use serde::{Deserialize, Serialize};

/// Answer to `stop_dictation`. An object rather than a bare string because the
/// webview reads `res?.transcript ?? ""` — a bare string would degrade to the
/// empty transcript silently, and the hold would fall back to the streamed text
/// without anything saying why.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StopDictation {
    /// The whole thing the user said, not the last flush: the webview uses this
    /// as a replacement for the streamed text, never as a supplement.
    pub transcript: String,
}

/// Answer to `set_indicator_probe`. Where the audio stack was left standing, and
/// enough of its state to show it really stopped there rather than one step
/// short. Read by the bench and by nothing else.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IndicatorProbe {
    /// The stage the native side reached: `off`, `session`, `engine`, `tap` or
    /// `recording`.
    pub stage: String,
    pub session_active: bool,
    pub engine_running: bool,
    pub tap_installed: bool,
    /// Buffers the tap has delivered since this stage was entered. Zero on the
    /// stages that install no tap, and what separates a tap that exists from a
    /// tap that is being called.
    pub buffers: u64,
    /// Linear RMS of the last buffer read, on the recording stage only.
    pub level: f64,
    /// The current input route, as port types.
    pub inputs: String,
}

/// Answer to `enqueue_speech`. Where Rust learns how much speech is ahead of
/// the listener and therefore whether it may run further ahead of it.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeechEnqueued {
    /// The sentence was thrown away rather than queued: its turn had already
    /// been stopped. Not an error — the vendor was mid-sentence when the user
    /// interrupted.
    pub dropped: bool,
    /// Speech queued ahead of the listener, this sentence included.
    pub queued_ms: f64,
    /// Where this sentence starts on the player's current timeline.
    pub start_ms: f64,
}

/// Where the voice is. The answer to `stop_speaking`, and what an interrupted
/// turn is resumed from: `index` and `char_offset` map back onto the sentence
/// text Rust sent, which Swift never sees.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeechPosition {
    pub speaking: bool,
    pub utterance: u64,
    /// The sentence being spoken, or -1 when nothing was.
    pub index: i64,
    /// Characters into that sentence, linearly interpolated.
    pub char_offset: i64,
    pub played_ms: f64,
}

/// The bench's measurement record, carried across whole rather than typed.
///
/// Untyped on purpose: it is a debug-build diagnostic whose shape changes with
/// the question being asked, it is read only by the smoke harness, which
/// stringifies it, and a Rust struct that drifted from the Swift one would fail
/// to decode on the device — a whole build cycle to learn that a field was
/// renamed. The three shapes above are typed because Rust acts on them.
pub type SpeechReport = serde_json::Value;
