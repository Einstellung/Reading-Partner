// Where a finished sentence goes, and the one thing it says back.
//
// On the phone this is an AVAudioPlayerNode on the same voice-processing engine
// AudioFront already holds (docs/33, 形态：全原生); `speaker::DevicePlayer` is the
// implementation that reaches it. What the trait fixes is what the two sides owe
// each other, and it is deliberately a trait: the scheduler above is measured
// against VirtualPlayer, on a desktop, with nothing audible happening.
//
// The answer to an enqueue is how much audio is queued ahead of the playhead.
// That number, and not a sentence count, is what tells the relay whether it is
// far enough ahead: sentences run from three characters to thirty, so a count
// says nothing about how long the player can go on without more. It also removes
// the need for the relay to poll — every enqueue refreshes it, and between
// enqueues it decays with the wall clock, which is exactly what playback does.

use async_trait::async_trait;
use std::collections::VecDeque;
use std::sync::Mutex;
use std::time::Instant;

use super::error::TtsError;
use super::format::AudioFormat;

/// When a sentence passed each stage on its way to the speaker, in monotonic
/// milliseconds (`mono_ms`). The same clock Swift reads with
/// `clock_gettime_nsec_np(CLOCK_MONOTONIC_RAW)`, so the native side can line its
/// own marks up with these without reconciling anything.
#[derive(Debug, Clone, Copy, Default, PartialEq)]
pub struct SentenceMarks {
    /// The request to the vendor went out.
    pub requested_ms: f64,
    /// The vendor's first bytes arrived.
    pub first_audio_ms: f64,
    /// This piece left the relay for the player.
    pub handed_ms: f64,
}

/// Milliseconds on CLOCK_MONOTONIC_RAW: mach_continuous_time on Apple
/// platforms, the raw monotonic clock on Linux and Android. Comparable across
/// Rust and Swift in one process, and across processes on one device.
#[cfg(unix)]
pub fn mono_ms() -> f64 {
    let mut ts = libc::timespec {
        tv_sec: 0,
        tv_nsec: 0,
    };
    // SAFETY: `ts` is a valid, writable timespec for the call's duration.
    unsafe { libc::clock_gettime(libc::CLOCK_MONOTONIC_RAW, &mut ts) };
    ts.tv_sec as f64 * 1000.0 + ts.tv_nsec as f64 / 1_000_000.0
}

/// Off unix there is no native side to line up with; this keeps the field
/// monotonic within the process.
#[cfg(not(unix))]
pub fn mono_ms() -> f64 {
    use std::sync::OnceLock;
    static EPOCH: OnceLock<Instant> = OnceLock::new();
    EPOCH.get_or_init(Instant::now).elapsed().as_secs_f64() * 1000.0
}

/// One piece of a trimmed sentence, ready to be heard.
///
/// A sentence reaches the player in pieces, in order, as the vendor streams it:
/// `part` counts them from 0 and `complete` marks the one that ends the
/// sentence. Every piece carries the sentence's `id` and `chars`, so a player
/// that has seen only some of them can still say where in the text it is.
#[derive(Debug, Clone)]
pub struct SentenceAudio {
    pub id: u64,
    pub format: AudioFormat,
    pub pcm: Vec<u8>,
    /// Characters in the sentence this was made from. Carried so that the
    /// playhead can be turned back into a position in the text when the user
    /// interrupts (docs/33, TTS): Chinese is spoken at an even enough rate that
    /// linear interpolation lands within a character or two.
    pub chars: usize,
    /// The turn's final sentence. A player cannot work this out for itself: a
    /// turn that ended and a turn that starved both look like a queue running
    /// dry, and this is the only thing that tells them apart. Only ever set on
    /// the `complete` piece.
    pub last: bool,
    /// Which piece of the sentence this is, from 0.
    pub part: u32,
    /// This piece ends the sentence, and carries the pause that follows it.
    /// Until it arrives the sentence is open: a player that runs out of audio
    /// before it has run out mid-sentence, not between sentences.
    pub complete: bool,
    pub marks: SentenceMarks,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PlaybackState {
    /// Audio queued and not yet heard, in milliseconds. Zero means the next
    /// sentence to arrive will be late.
    pub queued_ahead_ms: f64,
    pub playing: bool,
}

/// Where the user was interrupted.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Heard {
    /// The sentence that was playing, or the last one played.
    pub sentence: u64,
    /// How far into that sentence the playhead had got.
    pub position_ms: f64,
    /// That sentence's whole length, so the pair says how far through it the
    /// voice was without the caller holding the audio. How far in is not turned
    /// into a character offset: an interruption is recorded a sentence at a
    /// time.
    pub duration_ms: f64,
}

#[async_trait]
pub trait Player: Send + Sync + 'static {
    /// Queue one sentence. Returns when it is queued, never when it is played.
    ///
    /// Two of the errors are about the turn rather than the sentence.
    /// `TtsError::Cancelled` says this player's turn is behind the one being
    /// spoken, so everything after this sentence would be refused too and the
    /// relay winds the turn up on it. `TtsError::Busy` says the opposite: the
    /// player is still finishing an earlier turn and this one is only early, so
    /// the relay waits out the tail the error carries and offers the same
    /// sentence again. Every other error is one sentence lost, with playback
    /// carrying on into the next.
    async fn enqueue(&self, sentence: SentenceAudio) -> Result<PlaybackState, TtsError>;

    /// The same answer without adding anything.
    async fn state(&self) -> Result<PlaybackState, TtsError>;

    /// Drop everything not yet heard and stop.
    async fn stop(&self) -> Result<Heard, TtsError>;

    /// No more audio is coming in this turn. Nothing is queued and nothing is
    /// stopped: what is already queued still plays, and the player falls silent
    /// on its own when it runs out.
    ///
    /// `SentenceAudio::last` is what normally says this, and it rides on the
    /// audio, which is why it is the one to prefer. It has nothing to ride on
    /// when the turn's final sentence never came back — a synthesis that failed
    /// leaves the flag on a sentence that is never sent — and this is how the
    /// player is told anyway. Called at most once per turn, and only when no
    /// sentence carried the flag.
    async fn finish(&self) -> Result<(), TtsError>;
}

/// A player that keeps the clock and throws the audio away.
///
/// Not a stub: it is how the relay is measured. A queue of PCM buffers played
/// back to back has a completely determined timeline, so running the real
/// scheduler against real synthesis with this underneath produces the same
/// arrival times and the same margins as a real speaker would, and can be run on
/// a desktop with nothing audible happening.
pub struct VirtualPlayer {
    state: Mutex<Virtual>,
}

struct Virtual {
    /// (id, when it starts, how long it lasts), one row per piece.
    queue: VecDeque<(u64, Instant, f64)>,
    /// Per sentence: when its first piece starts, and its length so far.
    sentences: std::collections::BTreeMap<u64, (Instant, f64)>,
    /// When the last queued sentence finishes.
    ends_at: Option<Instant>,
    /// Every time the queue ran dry before the next sentence arrived, and by how
    /// much. This is the thing the relay exists to keep empty.
    underruns: Vec<(u64, f64)>,
    played_ms: f64,
    /// Whether the turn was ever said to be over — by the last sentence's flag
    /// or by `finish`. A player that is never told cannot tell a turn that
    /// ended from a turn that starved, so the tests read this.
    told_the_end: bool,
}

impl Default for VirtualPlayer {
    fn default() -> Self {
        Self::new()
    }
}

impl VirtualPlayer {
    pub fn new() -> Self {
        Self {
            state: Mutex::new(Virtual {
                queue: VecDeque::new(),
                sentences: std::collections::BTreeMap::new(),
                ends_at: None,
                underruns: Vec::new(),
                played_ms: 0.0,
                told_the_end: false,
            }),
        }
    }

    /// Every gap in playback: which sentence was late, and by how many
    /// milliseconds of silence.
    pub fn underruns(&self) -> Vec<(u64, f64)> {
        self.state.lock().unwrap().underruns.clone()
    }

    pub fn played_ms(&self) -> f64 {
        self.state.lock().unwrap().played_ms
    }

    /// Whether anything ever said this turn was over.
    pub fn told_the_end(&self) -> bool {
        self.state.lock().unwrap().told_the_end
    }
}

#[async_trait]
impl Player for VirtualPlayer {
    async fn enqueue(&self, sentence: SentenceAudio) -> Result<PlaybackState, TtsError> {
        let duration = sentence.format.duration_ms(sentence.pcm.len());
        let now = Instant::now();
        let mut state = self.state.lock().unwrap();

        let starts_at = match state.ends_at {
            Some(ends) if ends > now => ends,
            Some(ends) => {
                let gap = now.duration_since(ends).as_secs_f64() * 1000.0;
                // A gap of exactly zero is the queue emptying at the instant the
                // next sentence lands; anything above it was audible silence.
                if gap > 0.0 {
                    state.underruns.push((sentence.id, gap));
                }
                now
            }
            None => now,
        };
        state.told_the_end |= sentence.last;
        let ends_at = starts_at + std::time::Duration::from_secs_f64(duration / 1000.0);
        state.queue.push_back((sentence.id, starts_at, duration));
        let row = state
            .sentences
            .entry(sentence.id)
            .or_insert((starts_at, 0.0));
        // A gap inside a sentence is part of it on the timeline, the way the
        // phone's clock counts it.
        row.1 = ends_at.duration_since(row.0).as_secs_f64() * 1000.0;
        state.ends_at = Some(ends_at);
        state.played_ms += duration;

        Ok(PlaybackState {
            queued_ahead_ms: ends_at.duration_since(now).as_secs_f64() * 1000.0,
            playing: true,
        })
    }

    async fn state(&self) -> Result<PlaybackState, TtsError> {
        let now = Instant::now();
        let state = self.state.lock().unwrap();
        let queued_ahead_ms = match state.ends_at {
            Some(ends) if ends > now => ends.duration_since(now).as_secs_f64() * 1000.0,
            _ => 0.0,
        };
        Ok(PlaybackState {
            queued_ahead_ms,
            playing: state.ends_at.is_some(),
        })
    }

    async fn stop(&self) -> Result<Heard, TtsError> {
        let now = Instant::now();
        let mut state = self.state.lock().unwrap();
        let mut heard = Heard {
            sentence: 0,
            position_ms: 0.0,
            duration_ms: 0.0,
        };
        for (id, starts_at, _) in state.queue.iter() {
            if *starts_at <= now {
                let (began, length) = state.sentences[id];
                let into = now.duration_since(began).as_secs_f64() * 1000.0;
                heard = Heard {
                    sentence: *id,
                    position_ms: into.min(length),
                    duration_ms: length,
                };
            }
        }
        state.queue.clear();
        state.sentences.clear();
        state.ends_at = None;
        Ok(heard)
    }

    async fn finish(&self) -> Result<(), TtsError> {
        self.state.lock().unwrap().told_the_end = true;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sentence(id: u64, ms: f64) -> SentenceAudio {
        let format = AudioFormat::PCM16_24K_MONO;
        SentenceAudio {
            id,
            format,
            pcm: vec![0; format.bytes_for_ms(ms)],
            chars: 10,
            last: false,
            part: 0,
            complete: true,
            marks: SentenceMarks::default(),
        }
    }

    #[tokio::test]
    async fn queued_audio_stacks_up_ahead_of_the_playhead() {
        let p = VirtualPlayer::new();
        let a = p.enqueue(sentence(1, 1000.0)).await.unwrap();
        assert!((a.queued_ahead_ms - 1000.0).abs() < 20.0);
        let b = p.enqueue(sentence(2, 1000.0)).await.unwrap();
        assert!((b.queued_ahead_ms - 2000.0).abs() < 20.0);
        assert!(p.underruns().is_empty());
    }

    #[tokio::test]
    async fn a_sentence_that_arrives_after_the_queue_ran_dry_is_recorded() {
        let p = VirtualPlayer::new();
        p.enqueue(sentence(1, 30.0)).await.unwrap();
        tokio::time::sleep(std::time::Duration::from_millis(80)).await;
        p.enqueue(sentence(2, 30.0)).await.unwrap();
        let underruns = p.underruns();
        assert_eq!(underruns.len(), 1, "{underruns:?}");
        assert_eq!(underruns[0].0, 2);
        assert!(underruns[0].1 > 20.0, "{underruns:?}");
    }

    #[tokio::test]
    async fn a_sentence_in_pieces_is_one_sentence_to_the_listener() {
        let p = VirtualPlayer::new();
        p.enqueue(SentenceAudio {
            complete: false,
            ..sentence(1, 100.0)
        })
        .await
        .unwrap();
        p.enqueue(SentenceAudio {
            part: 1,
            ..sentence(1, 400.0)
        })
        .await
        .unwrap();
        tokio::time::sleep(std::time::Duration::from_millis(150)).await;
        let heard = p.stop().await.unwrap();
        assert_eq!(heard.sentence, 1);
        assert!(
            heard.position_ms > 120.0 && heard.position_ms < 300.0,
            "{heard:?}"
        );
        assert!((heard.duration_ms - 500.0).abs() < 20.0, "{heard:?}");
    }

    #[tokio::test]
    async fn stopping_says_which_sentence_was_playing_and_how_far_in() {
        let p = VirtualPlayer::new();
        p.enqueue(sentence(1, 100.0)).await.unwrap();
        p.enqueue(sentence(2, 1000.0)).await.unwrap();
        tokio::time::sleep(std::time::Duration::from_millis(150)).await;
        let heard = p.stop().await.unwrap();
        assert_eq!(heard.sentence, 2);
        assert!(
            heard.position_ms > 10.0 && heard.position_ms < 200.0,
            "{heard:?}"
        );
        assert!((heard.duration_ms - 1000.0).abs() < 20.0);
    }
}
