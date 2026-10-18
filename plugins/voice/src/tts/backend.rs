// What a voice has to look like from here. The one implementation is
// on-device Kokoro (tts/kokoro.rs); the network vendor it replaced, Xiaomi
// MiMo, was removed on 2026-10-18. Tests speak through stand-ins.

use async_trait::async_trait;
use tokio::sync::mpsc;

use super::error::TtsError;
use super::format::AudioFormat;

/// One sentence to say.
#[derive(Debug, Clone)]
pub struct SpeechRequest {
    pub text: String,
    /// Backend-specific voice name (a Kokoro voice id). Empty takes the
    /// backend's default.
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

    /// How many sentences this backend can usefully work on at once, when that
    /// is fewer than the relay would otherwise send. A vendor over the network
    /// answers `None`: its requests overlap. An engine on this device's CPU
    /// runs one sentence at a time, and a second request in flight would only
    /// race the first for it and could win, putting the first sentence of a
    /// turn behind the second.
    fn max_in_flight(&self) -> Option<usize> {
        None
    }

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

/// A voice that runs on this device from downloaded files, which may not be on
/// disk yet. When the session has one it is the only voice (session.rs).
pub trait OnDeviceVoice: Send + Sync + 'static {
    /// Whether the files are on disk and verified. Cheap: no hashing, no load.
    fn ready(&self) -> bool;

    /// The backend, once `ready`, and the model loading in the background if
    /// it is not in memory yet, so the sentence after this does not wait for
    /// it. Otherwise the reason there is none, worded for the user.
    fn backend(&self) -> Result<std::sync::Arc<dyn TtsBackend>, String>;
}
