// Speaking: the network half of the spoken briefing (docs/33, M-voice-2).
//
// It lives in this plugin and not in the app crate because the plugin already
// owns the audio: the PCM produced here is destined for an AVAudioPlayerNode on
// the same VPIO engine AudioFront holds, and producer and consumer in one crate
// is one function call instead of a cross-crate contract and a second ACL
// namespace. Nothing below is iOS-only — it compiles and makes real requests on
// the Linux desktop, which is the only place any of it can be measured.
//
// The pieces, in the order a sentence passes through them:
//
//   backend  what a vendor has to look like
//   mimo     the one vendor implemented
//   sse      the frame parser under it
//   trim     the head and tail silence that would otherwise stack up between
//            sentences
//   relay    how far ahead of the player to work
//   player   where finished PCM goes, and what it says back
//   opening  the first sentence, made before it is asked for

mod backend;
mod error;
mod format;
pub mod mimo;
mod opening;
mod player;
mod relay;
mod sse;
mod trim;

pub use backend::{SpeechRequest, TtsBackend};
pub use error::TtsError;
pub use format::AudioFormat;
pub use opening::{OpeningCache, OpeningKey, PrimedOpening};
pub use player::{Heard, PlaybackState, Player, SentenceAudio, VirtualPlayer};
pub use relay::{RelayConfig, RelayEvent, SpeechRelay};
pub use trim::{silence, SilenceTrimmer, TrimConfig, TrimReport};

use tokio::sync::mpsc;

/// How many times a synthesis is attempted before the sentence is given up on.
///
/// Two of forty sentences in the first bench failed with the request never
/// leaving the machine (docs/33). The fix is two-sided and neither half replaces
/// the other: a short connect timeout so a connection that will not happen costs
/// a retry instead of a stall, and a kept connection pool so most sentences
/// never reach the connect stage at all.
pub const MAX_ATTEMPTS: u32 = 3;

/// Synthesise one sentence, retrying only what is worth retrying.
///
/// A retry is only ever attempted while nothing has been sent to `out`; once the
/// head of a sentence has been handed on, starting over would speak it twice.
pub async fn synthesize_with_retry(
    backend: &dyn TtsBackend,
    request: &SpeechRequest,
    out: mpsc::Sender<Vec<u8>>,
) -> Result<u32, TtsError> {
    let mut attempt = 1;
    loop {
        match backend.synthesize(request, out.clone()).await {
            Ok(()) => return Ok(attempt),
            Err(e) if e.is_retryable() && attempt < MAX_ATTEMPTS => {
                attempt += 1;
            }
            Err(e) => return Err(e),
        }
    }
}
