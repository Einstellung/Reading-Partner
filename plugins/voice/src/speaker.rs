// The relay's far end on a real phone (docs/33, M-voice-2).
//
// `tts::Player` is the contract and `tts::VirtualPlayer` is the same shape with
// the audio thrown away, which is how the scheduler was measured without a
// device. This is the other implementation: one `Voice::enqueue_speech` per
// sentence, over the bridge to the AVAudioPlayerNode on the engine AudioFront
// already holds. There is no `target_os` in this file — off iOS `Voice` rejects
// every one of these calls with a sentence (fallback.rs), which is exactly what
// a player that cannot play should answer.

use std::sync::{Arc, Mutex};
use std::time::Instant;

use async_trait::async_trait;
use tauri::{AppHandle, Runtime};

use crate::tts::{Heard, PlaybackState, Player, SentenceAudio, TtsError};
use crate::VoiceExt;

/// The reason `stop()` gives Swift. `Player::stop` has no reason of its own —
/// barge-in is the only thing that calls it — and the command's own default is
/// the same word.
const STOP_REASON: &str = "interrupted";

pub struct DevicePlayer<R: Runtime> {
    app: AppHandle<R>,
    /// One number per turn of conversation, increasing. Swift drops a sentence
    /// whose utterance is not the one it is playing, which is how audio the
    /// vendor finished after a barge-in is thrown away rather than spoken into
    /// the next turn.
    utterance: u64,
    book: Mutex<Book>,
}

#[derive(Default)]
struct Book {
    /// The margin the last enqueue answered with, and when it answered. Nothing
    /// polls the phone for it: every enqueue refreshes it and between enqueues
    /// it decays with the wall clock, which is what playback does anyway.
    queued_ahead_ms: f64,
    measured_at: Option<Instant>,
    /// Where each sentence starts on the player's timeline and how long it is.
    /// Swift answers a stop with a sentence index and a position on that same
    /// timeline, and this is what turns the pair back into `Heard`.
    sentences: Vec<Placed>,
}

struct Placed {
    id: u64,
    start_ms: f64,
    duration_ms: f64,
}

impl<R: Runtime> DevicePlayer<R> {
    pub fn new(app: AppHandle<R>, utterance: u64) -> Self {
        Self {
            app,
            utterance,
            book: Mutex::new(Book::default()),
        }
    }

    /// The turn this player speaks for.
    pub fn utterance(&self) -> u64 {
        self.utterance
    }
}

#[async_trait]
impl<R: Runtime> Player for DevicePlayer<R> {
    async fn enqueue(&self, sentence: SentenceAudio) -> Result<PlaybackState, TtsError> {
        let duration_ms = sentence.format.duration_ms(sentence.pcm.len());
        // The lock is taken only after the await: a std MutexGuard held across
        // one would make this future non-Send and the trait object impossible.
        let ack = self
            .app
            .voice()
            .enqueue_speech(
                self.utterance,
                sentence.id as u32,
                sentence.chars as u32,
                sentence.last,
                sentence.format.sample_rate_hz,
                sentence.pcm,
            )
            .await
            .map_err(|e| TtsError::Player(e.to_string()))?;

        if ack.dropped {
            // Swift compares utterances, not sentences: it drops this one
            // because the turn it belongs to is not the turn it is playing
            // (SpeechOut.swift), and a player carries one utterance for its
            // whole life. So this is the turn being refused, not the sentence,
            // and every sentence behind it would be refused the same way. The
            // relay reads it as the end of the turn and stops synthesising
            // (tts/relay.rs). Cancelled rather than an empty queue: an empty
            // queue reads as "run further ahead".
            return Err(TtsError::Cancelled);
        }

        let mut book = self.book.lock().unwrap();
        book.queued_ahead_ms = ack.queued_ms;
        book.measured_at = Some(Instant::now());
        book.sentences.push(Placed {
            id: sentence.id,
            start_ms: ack.start_ms,
            duration_ms,
        });
        Ok(PlaybackState {
            queued_ahead_ms: ack.queued_ms,
            playing: true,
        })
    }

    async fn state(&self) -> Result<PlaybackState, TtsError> {
        let book = self.book.lock().unwrap();
        let Some(measured_at) = book.measured_at else {
            return Ok(PlaybackState {
                queued_ahead_ms: 0.0,
                playing: false,
            });
        };
        let since = measured_at.elapsed().as_secs_f64() * 1000.0;
        let queued_ahead_ms = (book.queued_ahead_ms - since).max(0.0);
        Ok(PlaybackState {
            queued_ahead_ms,
            playing: queued_ahead_ms > 0.0,
        })
    }

    async fn stop(&self) -> Result<Heard, TtsError> {
        let at = self
            .app
            .voice()
            .stop_speaking(STOP_REASON.to_string())
            .await
            .map_err(|e| TtsError::Player(e.to_string()))?;

        let mut book = self.book.lock().unwrap();
        book.queued_ahead_ms = 0.0;
        book.measured_at = None;
        // -1 is Swift saying nothing was playing. The same answer VirtualPlayer
        // gives for a queue that never started.
        if at.index < 0 {
            return Ok(Heard {
                sentence: 0,
                position_ms: 0.0,
                duration_ms: 0.0,
            });
        }
        let id = at.index as u64;
        // `playedMs` is on the player's timeline, which is the timeline every
        // `startMs` above came back on, so the difference is the position
        // inside that sentence. Swift's own linear character offset is not used
        // here: the caller holds the text and `Heard` is what it maps.
        let Some(placed) = book.sentences.iter().find(|s| s.id == id) else {
            return Ok(Heard {
                sentence: id,
                position_ms: 0.0,
                duration_ms: 0.0,
            });
        };
        Ok(Heard {
            sentence: id,
            position_ms: (at.played_ms - placed.start_ms).clamp(0.0, placed.duration_ms),
            duration_ms: placed.duration_ms,
        })
    }
}

/// Where a turn's audio goes, asked for one turn at a time.
///
/// A player carries the utterance number for its whole life — Swift drops a
/// sentence whose utterance is not the one it is playing, which is how audio the
/// vendor finished after a barge-in is thrown away instead of spoken into the
/// next turn — so a new turn cannot reuse the last turn's player. The session
/// (session.rs) asks for one here each time it opens a turn, and the trait is
/// what lets its tests run against a player with no phone underneath it.
pub trait Speakers: Send + Sync + 'static {
    fn player(&self, utterance: u64) -> Arc<dyn Player>;
}

/// The phone's own speaker.
pub struct DeviceSpeakers<R: Runtime> {
    app: AppHandle<R>,
}

impl<R: Runtime> DeviceSpeakers<R> {
    pub fn new(app: AppHandle<R>) -> Self {
        Self { app }
    }
}

impl<R: Runtime> Speakers for DeviceSpeakers<R> {
    fn player(&self, utterance: u64) -> Arc<dyn Player> {
        Arc::new(DevicePlayer::new(self.app.clone(), utterance))
    }
}
