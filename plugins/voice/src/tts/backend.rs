// What a TTS vendor has to look like from here. Mimo's free period has neither
// an end date nor a published price after it (docs/33, 小米落地要点 four), so
// the shape has to hold a second vendor without anything above it changing.
// Qwen3-TTS-flash is the named alternate and fits: different host, different
// body, different JSON path to the audio, same raw PCM out.

use async_trait::async_trait;
use tokio::sync::mpsc;

use super::error::TtsError;
use super::format::AudioFormat;

/// One sentence to say.
#[derive(Debug, Clone)]
pub struct SpeechRequest {
    pub text: String,
    /// Vendor-specific voice name. Mimo takes the Chinese literal (冰糖 / 茉莉 /
    /// 苏打 / 白桦); Qwen3 takes `Cherry` and friends. No shared enum: an enum
    /// would have to be extended for every vendor and would still not say what
    /// any of them sound like.
    pub voice: String,
}

/// A vendor. Implementations own their wire protocol and nothing else — no
/// trimming, no scheduling, no retry policy; those are the same for everyone
/// and live above this line.
#[async_trait]
pub trait TtsBackend: Send + Sync + 'static {
    /// Stable identifier, part of the prewarm cache's key.
    fn id(&self) -> &'static str;

    /// Which model the id above is currently pointed at. Also part of the cache
    /// key, because the same vendor behind a new model is new audio.
    fn model(&self) -> &str;

    /// The layout of every byte this backend sends to `out`. Fixed per vendor,
    /// not per request: neither known vendor lets the caller choose.
    fn format(&self) -> AudioFormat;

    /// The voice used when the caller names none.
    fn default_voice(&self) -> &str;

    /// Synthesise one sentence, sending raw PCM to `out` as it arrives.
    ///
    /// Contract: every byte sent is playable PCM in `format()` — container
    /// headers stripped, base64 already decoded. Nothing is sent after an error
    /// is returned. Returning `Ok` means the vendor said the sentence is
    /// complete, not merely that the socket closed.
    ///
    /// A closed `out` means the caller stopped caring (barge-in); the
    /// implementation returns `TtsError::Cancelled` rather than treating it as
    /// a failure.
    /// `out` is taken by value and dropped when this returns, which is what
    /// closes the channel and tells the reader the sentence is over.
    async fn synthesize(
        &self,
        request: &SpeechRequest,
        out: mpsc::Sender<Vec<u8>>,
    ) -> Result<(), TtsError>;
}
