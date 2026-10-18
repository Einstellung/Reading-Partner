// The short lines the program says on its own (docs/companion/136,
// "级联前台的一次回复"): a front reply that only handed something off is
// followed by "我去想想", and one that failed before it said anything by
// "刚才没连上，你再说一遍".
// The text is fixed, so the audio is made once when a call opens and played from
// memory each time it is wanted, with no vendor round trip in front of it.
//
// Unlike the opening line (opening.rs), a cue is spoken many times, so reading
// one copies it out and leaves it in place. The key is the same: audio is only
// the right audio for the vendor, model, voice and text it was made with.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Instant;

use tokio::sync::mpsc;

use super::backend::{SpeechRequest, TtsBackend};
use super::error::TtsError;
use super::opening::{OpeningKey, PrimedOpening};
use super::synthesize_with_retry;
use super::trim::{silence, SilenceTrimmer, TrimConfig};

/// One line, by the id the webview asks for it with.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Cue {
    pub id: &'static str,
    /// The language prefix a call primes with: `zh` or `en`.
    pub lang: &'static str,
    pub text: &'static str,
}

/// Every cue there is. The ids are mirrored in src/soul/voice/front/filler.ts.
pub const CUES: &[Cue] = &[
    Cue {
        id: "zh/think",
        lang: "zh",
        text: "我去想想。",
    },
    Cue {
        id: "zh/look",
        lang: "zh",
        text: "我查一下，你接着说。",
    },
    Cue {
        id: "zh/moment",
        lang: "zh",
        text: "稍等，我想一想。",
    },
    Cue {
        id: "zh/lost",
        lang: "zh",
        text: "刚才没连上，你再说一遍。",
    },
    Cue {
        id: "en/think",
        lang: "en",
        text: "Let me think about that.",
    },
    Cue {
        id: "en/look",
        lang: "en",
        text: "Let me look into that.",
    },
    Cue {
        id: "en/moment",
        lang: "en",
        text: "Give me a moment, keep going.",
    },
    Cue {
        id: "en/lost",
        lang: "en",
        text: "Sorry, I lost that. Could you say it again?",
    },
];

pub fn cue(id: &str) -> Option<&'static Cue> {
    CUES.iter().find(|c| c.id == id)
}

pub fn cues_for(lang: &str) -> impl Iterator<Item = &'static Cue> + '_ {
    CUES.iter().filter(move |c| c.lang == lang)
}

/// Made cues, by id.
#[derive(Default)]
pub struct CueStore {
    held: Mutex<HashMap<&'static str, (OpeningKey, PrimedOpening)>>,
}

impl CueStore {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn store(&self, id: &'static str, key: OpeningKey, audio: PrimedOpening) {
        self.held.lock().unwrap().insert(id, (key, audio));
    }

    /// A copy of the audio held for `id`, if it was made for exactly `key`.
    pub fn get(&self, id: &str, key: &OpeningKey) -> Option<Vec<u8>> {
        let held = self.held.lock().unwrap();
        let (stored, audio) = held.get(id)?;
        (stored == key).then(|| audio.pcm.clone())
    }

    pub fn has(&self, id: &str, key: &OpeningKey) -> bool {
        self.held
            .lock()
            .unwrap()
            .get(id)
            .is_some_and(|(stored, _)| stored == key)
    }

    /// Drop everything. Called when the vendor is replaced.
    pub fn clear(&self) {
        self.held.lock().unwrap().clear();
    }
}

/// Synthesise one line whole, trimmed the way the relay trims a sentence and
/// carrying the same trailing pause, ready for `SpeechRelay::push_audio`.
pub async fn make(
    backend: &dyn TtsBackend,
    request: &SpeechRequest,
    trim: TrimConfig,
    gap_ms: f64,
) -> Result<PrimedOpening, TtsError> {
    let format = backend.format();
    let (tx, mut rx) = mpsc::channel::<Vec<u8>>(8);
    let collect = async move {
        let mut trimmer = SilenceTrimmer::new(format, trim);
        let mut pcm = Vec::new();
        while let Some(chunk) = rx.recv().await {
            pcm.extend(trimmer.push(&chunk));
        }
        pcm.extend(trimmer.finish());
        pcm
    };
    let (made, mut pcm) = tokio::join!(synthesize_with_retry(backend, request, tx), collect);
    made?;
    pcm.extend(silence(format, gap_ms));
    Ok(PrimedOpening {
        format,
        pcm,
        made_at: Instant::now(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tts::AudioFormat;

    fn key(text: &str) -> OpeningKey {
        OpeningKey {
            backend: "kokoro".into(),
            model: "kokoro-82m-v1.1-zh".into(),
            voice: "冰糖".into(),
            text: text.into(),
        }
    }

    fn audio() -> PrimedOpening {
        PrimedOpening {
            format: AudioFormat::PCM16_24K_MONO,
            pcm: vec![1; 4800],
            made_at: Instant::now(),
        }
    }

    #[test]
    fn every_language_has_the_same_cues() {
        let ids = |lang| {
            cues_for(lang)
                .map(|c| c.id.split_once('/').unwrap().1)
                .collect::<Vec<_>>()
        };
        assert_eq!(ids("zh"), ids("en"));
        assert_eq!(ids("zh").len(), 4);
        for c in CUES {
            assert!(c.id.starts_with(&format!("{}/", c.lang)), "{c:?}");
        }
    }

    #[test]
    fn a_cue_is_read_as_often_as_it_is_wanted() {
        let store = CueStore::new();
        store.store("zh/think", key("我去想想。"), audio());
        assert_eq!(
            store.get("zh/think", &key("我去想想。")).unwrap().len(),
            4800
        );
        assert!(store.get("zh/think", &key("我去想想。")).is_some());
        assert!(store.has("zh/think", &key("我去想想。")));
    }

    #[test]
    fn audio_made_for_another_voice_or_text_is_not_returned() {
        let store = CueStore::new();
        store.store("zh/think", key("我去想想。"), audio());
        assert!(store.get("zh/think", &key("我想想。")).is_none());
        let other = OpeningKey {
            voice: "茉莉".into(),
            ..key("我去想想。")
        };
        assert!(store.get("zh/think", &other).is_none());
        assert!(store.get("zh/look", &key("我去想想。")).is_none());
        store.clear();
        assert!(!store.has("zh/think", &key("我去想想。")));
    }
}
