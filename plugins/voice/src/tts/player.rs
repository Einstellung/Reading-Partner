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

/// One trimmed sentence, ready to be heard.
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
    /// dry, and this is the only thing that tells them apart.
    pub last: bool,
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
    /// That sentence's whole length, so the caller can turn the pair into a
    /// character offset without holding the audio.
    pub duration_ms: f64,
}

#[async_trait]
pub trait Player: Send + Sync + 'static {
    /// Queue one sentence. Returns when it is queued, never when it is played.
    async fn enqueue(&self, sentence: SentenceAudio) -> Result<PlaybackState, TtsError>;

    /// The same answer without adding anything.
    async fn state(&self) -> Result<PlaybackState, TtsError>;

    /// Drop everything not yet heard and stop.
    async fn stop(&self) -> Result<Heard, TtsError>;
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
    /// (id, when it starts, how long it lasts)
    queue: VecDeque<(u64, Instant, f64)>,
    /// When the last queued sentence finishes.
    ends_at: Option<Instant>,
    /// Every time the queue ran dry before the next sentence arrived, and by how
    /// much. This is the thing the relay exists to keep empty.
    underruns: Vec<(u64, f64)>,
    played_ms: f64,
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
                ends_at: None,
                underruns: Vec::new(),
                played_ms: 0.0,
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
        let ends_at = starts_at + std::time::Duration::from_secs_f64(duration / 1000.0);
        state.queue.push_back((sentence.id, starts_at, duration));
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
        for (id, starts_at, duration) in state.queue.iter() {
            if *starts_at <= now {
                let into = now.duration_since(*starts_at).as_secs_f64() * 1000.0;
                heard = Heard {
                    sentence: *id,
                    position_ms: into.min(*duration),
                    duration_ms: *duration,
                };
            }
        }
        state.queue.clear();
        state.ends_at = None;
        Ok(heard)
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
    async fn stopping_says_which_sentence_was_playing_and_how_far_in() {
        let p = VirtualPlayer::new();
        p.enqueue(sentence(1, 100.0)).await.unwrap();
        p.enqueue(sentence(2, 1000.0)).await.unwrap();
        tokio::time::sleep(std::time::Duration::from_millis(150)).await;
        let heard = p.stop().await.unwrap();
        assert_eq!(heard.sentence, 2);
        assert!(heard.position_ms > 10.0 && heard.position_ms < 200.0, "{heard:?}");
        assert!((heard.duration_ms - 1000.0).abs() < 20.0);
    }
}
