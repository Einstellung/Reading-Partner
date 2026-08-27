// The first sentence, made before anyone asks for it.
//
// Every other sentence in a turn is covered by the relay working ahead of the
// speaker; the first one has nothing in front of it, so the user waits the whole
// 853 ms (736 ms to the first PCM plus 117 ms of leading silence, docs/33). The
// opening line of a session is the one case where the text is known before the
// user acts — it is written when the briefing is, and the orb is on screen for
// seconds before it is tapped — so it can be synthesised in that window and the
// wait becomes zero.
//
// One slot, not a store. There is exactly one sentence that is known in advance;
// a keyed cache of many would be a cache of one entry with extra machinery, and
// a second entry would mean guessing what the user will say.

use std::sync::Mutex;
use std::time::{Duration, Instant};

use super::format::AudioFormat;

/// Everything that has to match for stored audio to be the right audio.
///
/// It is compared whole rather than hashed: the text is one sentence and
/// comparing it is cheaper than any hash worth trusting, and an exact comparison
/// cannot collide.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OpeningKey {
    /// Which vendor made it. A backend switch invalidates everything it made.
    pub backend: String,
    /// The model behind that vendor's name. The same vendor on a new model is
    /// new audio.
    pub model: String,
    pub voice: String,
    /// The exact text that was spoken, after normalisation — the string that was
    /// sent, not the string it came from.
    pub text: String,
}

#[derive(Debug, Clone)]
pub struct PrimedOpening {
    pub format: AudioFormat,
    /// Already trimmed and already carrying its trailing gap: what comes out of
    /// here goes straight to the player.
    pub pcm: Vec<u8>,
    pub made_at: Instant,
}

impl PrimedOpening {
    pub fn duration_ms(&self) -> f64 {
        self.format.duration_ms(self.pcm.len())
    }
}

/// How long a primed opening is worth keeping.
///
/// Not about correctness: identical text through the same voice is identical
/// audio however old it is, and every way the audio could become wrong — the
/// text changed, the voice changed, the day rolled over into a different opening
/// line — changes the key and is caught by the comparison. What expiry bounds is
/// holding half a megabyte for a session the user never opened.
pub const DEFAULT_TTL: Duration = Duration::from_secs(30 * 60);

#[derive(Default)]
pub struct OpeningCache {
    slot: Mutex<Option<(OpeningKey, PrimedOpening)>>,
}

impl OpeningCache {
    pub fn new() -> Self {
        Self::default()
    }

    /// Keep this audio for the sentence described by `key`, replacing whatever
    /// was there.
    pub fn store(&self, key: OpeningKey, opening: PrimedOpening) {
        *self.slot.lock().unwrap() = Some((key, opening));
    }

    /// Take the audio if it is for exactly this sentence and not stale.
    ///
    /// Taking rather than borrowing: a primed opening is spoken once. Leaving it
    /// in place would mean a second session opening with audio made for the
    /// first, at whatever the text was then.
    pub fn take(&self, key: &OpeningKey, ttl: Duration) -> Option<PrimedOpening> {
        let mut slot = self.slot.lock().unwrap();
        let (stored_key, opening) = slot.take()?;
        if &stored_key != key {
            return None;
        }
        if opening.made_at.elapsed() > ttl {
            return None;
        }
        Some(opening)
    }

    /// Drop what is held. Called when the voice or the backend changes under
    /// everything, where waiting for the next `take` to notice would keep the
    /// memory for nothing.
    pub fn clear(&self) {
        *self.slot.lock().unwrap() = None;
    }

    pub fn is_primed(&self) -> bool {
        self.slot.lock().unwrap().is_some()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn key(text: &str, voice: &str) -> OpeningKey {
        OpeningKey {
            backend: "mimo".into(),
            model: "mimo-v2.5-tts".into(),
            voice: voice.into(),
            text: text.into(),
        }
    }

    fn opening() -> PrimedOpening {
        PrimedOpening {
            format: AudioFormat::PCM16_24K_MONO,
            pcm: vec![0; 4800],
            made_at: Instant::now(),
        }
    }

    #[test]
    fn the_same_sentence_comes_back_once() {
        let cache = OpeningCache::new();
        cache.store(key("早上好", "冰糖"), opening());
        assert!(cache.take(&key("早上好", "冰糖"), DEFAULT_TTL).is_some());
        assert!(cache.take(&key("早上好", "冰糖"), DEFAULT_TTL).is_none());
    }

    #[test]
    fn changed_text_voice_or_model_does_not_come_back() {
        for wrong in [
            key("早上好，今天有三条", "冰糖"),
            key("早上好", "茉莉"),
            OpeningKey {
                model: "mimo-v3-tts".into(),
                ..key("早上好", "冰糖")
            },
            OpeningKey {
                backend: "dashscope".into(),
                ..key("早上好", "冰糖")
            },
        ] {
            let cache = OpeningCache::new();
            cache.store(key("早上好", "冰糖"), opening());
            assert!(cache.take(&wrong, DEFAULT_TTL).is_none(), "{wrong:?}");
            // A miss drops the slot: what was stored is now known to be for a
            // sentence nobody is going to say.
            assert!(!cache.is_primed());
        }
    }

    #[test]
    fn audio_older_than_the_ttl_does_not_come_back() {
        let cache = OpeningCache::new();
        cache.store(key("早上好", "冰糖"), opening());
        assert!(cache
            .take(&key("早上好", "冰糖"), Duration::from_nanos(1))
            .is_none());
    }
}
