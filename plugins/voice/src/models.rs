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
    /// The sentence was thrown away rather than queued. Not an error — either
    /// the vendor was mid-sentence when the user interrupted, or the turn it
    /// belongs to has not started yet.
    pub dropped: bool,
    /// Which of those two, and only meaningful when `dropped`. True when the
    /// player is still finishing an earlier turn: this sentence is early rather
    /// than stale, and the same bytes are taken once that tail runs out, with
    /// `queued_ms` saying how much of it is left. False is the permanent
    /// refusal — the player has moved on to a later turn and this one will
    /// never be spoken.
    ///
    /// Absent from the payload counts as false, which is the reading that ends
    /// the turn rather than the one that waits for it.
    #[serde(default)]
    pub busy: bool,
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

/// Answer to `speak_stop`: which turn was cut, and where the voice got to in it.
///
/// Read the warning on `SpeechSession::stop` before using any of it. On the
/// real barge-in path Swift has already stopped the player by the time this
/// command runs, so the position that comes back is zeroes — the turn's own
/// number with sentence 0 and both times 0, not `UNKNOWN`. The authority on
/// where a turn was cut is the event Swift emits when it cuts it. `UNKNOWN` is
/// only ever "there was no turn": a player that refused to stop is an error,
/// not a sentinel.
#[derive(Debug, Clone, Copy, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeechStopped {
    /// The turn this is about, counted from 1. Zero means there was no turn.
    pub utterance: u64,
    /// The sentence that was playing, counted from zero within the turn.
    pub sentence: u64,
    /// How far into that sentence the playhead had got.
    pub position_ms: f64,
    /// That sentence's whole length. The caller holds the text it sent and
    /// turns the pair into a character offset.
    pub duration_ms: f64,
}

impl SpeechStopped {
    /// Nothing was playing, or nothing here knows what was. Utterance 0 is the
    /// value no real turn is ever given.
    pub const UNKNOWN: Self = Self {
        utterance: 0,
        sentence: 0,
        position_ms: 0.0,
        duration_ms: 0.0,
    };
}
