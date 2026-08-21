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
