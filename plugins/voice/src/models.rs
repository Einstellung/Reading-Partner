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
