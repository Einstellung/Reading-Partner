// The speaking half's state between commands (docs/33, M-voice-2).
//
// `live.rs` runs the whole pipeline in one call because a bench knows every
// sentence before it starts. Production does not: the model streams, the webview
// cuts the stream into sentences, and each one arrives as its own invoke. What
// that needs and nothing here had is an object that outlives a command — the
// turn's relay has to still be running when the next sentence shows up.
//
// So: one `SpeechSession` managed on the app, holding at most one turn. Four
// commands move it. `speak_begin` opens a turn, `speak_push` hands it a
// sentence, `speak_close` says no more are coming, `speak_stop` cuts it off.
//
// One relay per turn, never reused. `SpeechRelay::stop` makes its loop return
// (tts/relay.rs), so a stopped relay is a dead one; `close` is the other half of
// that pair and deliberately does not end the loop, because sentences pushed
// before it are still being synthesised. The session therefore keeps the handle
// after a close and only lets go of it when the next turn begins.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use tokio::sync::{mpsc, Mutex};

use crate::models::SpeechStopped;
use crate::speaker::Speakers;
use crate::tts::{RelayConfig, SpeechRelay, TtsBackend};
use crate::{Error, Result};

/// Where the vendor key is read from. The process environment and nowhere else:
/// the run is launched with it set, so it exists for the length of the run and
/// is not on the phone's disk, in the bundle, or in the repository.
pub(crate) const KEY_VAR: &str = "MIMO_API_KEY";

/// A turn of speech that has not finished yet.
struct Turn {
    utterance: u64,
    relay: SpeechRelay,
}

pub struct SpeechSession {
    /// The vendor, when the process was given a key. A build without one still
    /// manages a session: the rejection has to reach the webview as a command
    /// that answered "no key", not as a command that does not exist.
    backend: Option<Arc<dyn TtsBackend>>,
    speakers: Arc<dyn Speakers>,
    config: RelayConfig,
    /// The one turn, and the lock that serialises the four commands against
    /// each other. A push that overtook its own begin would be spoken into the
    /// turn before it.
    turn: Mutex<Option<Turn>>,
    /// Handed out by `begin`, starting at 1.
    ///
    /// Never 0: 0 is what every "nothing was playing" answer carries — Swift
    /// reports `index: -1` and `speaker.rs` turns that into sentence 0, and the
    /// sentinel below uses 0 for the utterance too. A real turn numbered 0 could
    /// not be told apart from an absent one.
    utterances: AtomicU64,
}

impl SpeechSession {
    pub fn new(
        backend: Option<Arc<dyn TtsBackend>>,
        speakers: Arc<dyn Speakers>,
        config: RelayConfig,
    ) -> Self {
        Self {
            backend,
            speakers,
            config,
            turn: Mutex::new(None),
            utterances: AtomicU64::new(0),
        }
    }

    /// Build the session this plugin runs with: Mimo if the key is there, and a
    /// player per turn on whatever host this is.
    pub fn from_env(speakers: Arc<dyn Speakers>) -> Self {
        let backend = std::env::var(KEY_VAR)
            .ok()
            .filter(|key| !key.is_empty())
            .and_then(|key| crate::tts::mimo::MimoBackend::new(key).ok())
            .map(|backend| Arc::new(backend) as Arc<dyn TtsBackend>);
        Self::new(backend, speakers, RelayConfig::default())
    }

    /// Open a turn and answer with its number.
    ///
    /// Whatever was still speaking is stopped first, in-flight synthesis
    /// included. A new turn only ever begins because the model is answering
    /// something the user just said, and the user saying it is what interrupted
    /// the last turn; letting the old audio run under the new one would speak
    /// two answers at once.
    pub async fn begin(&self) -> Result<u64> {
        let backend = self.backend.clone().ok_or_else(|| {
            Error::Speech(format!(
                "There is no voice to speak with: {KEY_VAR} is not in this process's environment."
            ))
        })?;

        let mut turn = self.turn.lock().await;
        if let Some(previous) = turn.take() {
            let _ = previous.relay.stop().await;
        }

        let utterance = self.utterances.fetch_add(1, Ordering::SeqCst) + 1;
        let player = self.speakers.player(utterance);
        // The timeline is dropped on the floor. It is what the bench reads, and
        // a turn of conversation has no reader for it; the relay is written to
        // carry on with the receiver gone.
        let (events, _timeline) = mpsc::unbounded_channel();
        let relay = SpeechRelay::start(backend, player, self.config.clone(), events);
        *turn = Some(Turn { utterance, relay });
        Ok(utterance)
    }

    /// Hand the open turn its next sentence, already split.
    pub async fn push(&self, text: String) -> Result<()> {
        let turn = self.turn.lock().await;
        let Some(turn) = turn.as_ref() else {
            return Err(Error::Speech(
                "There is no turn to speak into: speak_begin comes first.".to_string(),
            ));
        };
        if !turn.relay.push(text) {
            return Err(Error::Speech(
                "That turn has already stopped speaking.".to_string(),
            ));
        }
        Ok(())
    }

    /// No more sentences are coming in this turn. What was pushed is still being
    /// synthesised and will still be spoken.
    ///
    /// Silent when there is no turn, rather than an error. The webview closes a
    /// turn when the model's stream ends, and a barge-in stops the turn before
    /// that happens — so the ordinary interruption ends with a close on nothing,
    /// and it has nowhere to show a rejection.
    pub async fn close(&self) -> Result<()> {
        let turn = self.turn.lock().await;
        if let Some(turn) = turn.as_ref() {
            turn.relay.close();
        }
        Ok(())
    }

    /// Stop now: cancel what the vendor is still synthesising, drop what came
    /// back and was never queued, and tell the player to stop.
    ///
    /// The answer is NOT where the user interrupted, on the path that matters.
    /// Swift cuts the player itself the instant it hears the user start talking
    /// (docs/33), long before the webview notices and invokes this, so by the
    /// time the stop reaches the player there is nothing playing and what comes
    /// back is the sentinel — utterance 0, sentence 0, both times 0. The
    /// authority on where a turn was cut is the event Swift emits when it cuts
    /// it. Do not resume a turn from this return value.
    pub async fn stop(&self) -> Result<SpeechStopped> {
        let mut turn = self.turn.lock().await;
        let Some(turn) = turn.take() else {
            return Ok(SpeechStopped::UNKNOWN);
        };
        let Ok(heard) = turn.relay.stop().await else {
            return Ok(SpeechStopped::UNKNOWN);
        };
        Ok(SpeechStopped {
            utterance: turn.utterance,
            sentence: heard.sentence,
            position_ms: heard.position_ms,
            duration_ms: heard.duration_ms,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tts::{
        AudioFormat, Heard, PlaybackState, Player, SentenceAudio, SpeechRequest, TtsError,
    };
    use std::sync::atomic::AtomicUsize;
    use std::sync::Mutex as StdMutex;
    use std::time::Duration;

    const FORMAT: AudioFormat = AudioFormat::PCM16_24K_MONO;
    /// Long enough that nothing in these tests waits for it: every sentence
    /// asking for it is meant to be cancelled while it is still out.
    const SLOW_MS: u64 = 3_000;

    /// A vendor that answers with a square wave one tenth of a second long per
    /// character — loud everywhere, so the trim keeps all of it and the length
    /// that comes out says which sentence it was. A sentence starting with
    /// `slow` is held back instead.
    #[derive(Default)]
    struct Fake {
        /// Requests the relay admitted. Read by the tests that assert something
        /// was thrown away, so that "nothing was heard" cannot pass by nothing
        /// having been asked for.
        started: Arc<AtomicUsize>,
        /// Syntheses whose future was dropped before it finished, which is what
        /// a cancelled request looks like from in here.
        cancelled: Arc<AtomicUsize>,
    }

    struct Cancelled(Arc<AtomicUsize>, bool);

    impl Drop for Cancelled {
        fn drop(&mut self) {
            if !self.1 {
                self.0.fetch_add(1, Ordering::SeqCst);
            }
        }
    }

    #[async_trait::async_trait]
    impl TtsBackend for Fake {
        fn id(&self) -> &'static str {
            "fake"
        }
        fn model(&self) -> &str {
            "fake"
        }
        fn format(&self) -> AudioFormat {
            FORMAT
        }
        fn default_voice(&self) -> &str {
            "fake"
        }
        async fn synthesize(
            &self,
            request: &SpeechRequest,
            out: mpsc::Sender<Vec<u8>>,
        ) -> std::result::Result<(), TtsError> {
            self.started.fetch_add(1, Ordering::SeqCst);
            let mut guard = Cancelled(self.cancelled.clone(), false);
            if request.text.starts_with("slow") {
                tokio::time::sleep(Duration::from_millis(SLOW_MS)).await;
            }
            let samples = FORMAT.bytes_for_ms(tone_ms(&request.text)) / 2;
            let pcm: Vec<u8> = (0..samples)
                .flat_map(|i| (if i % 2 == 0 { 8000i16 } else { -8000 }).to_le_bytes())
                .collect();
            out.send(pcm).await.map_err(|_| TtsError::Cancelled)?;
            guard.1 = true;
            Ok(())
        }
    }

    fn tone_ms(text: &str) -> f64 {
        text.chars().count() as f64 * 100.0
    }

    /// A player that writes down what it was handed. Its margin is always zero,
    /// so admission never waits and the order below is the relay's own.
    #[derive(Default)]
    struct Recorder {
        heard: StdMutex<Vec<(u64, f64, bool)>>,
    }

    impl Recorder {
        fn sentences(&self) -> Vec<(u64, f64, bool)> {
            self.heard.lock().unwrap().clone()
        }
    }

    #[async_trait::async_trait]
    impl Player for Recorder {
        async fn enqueue(
            &self,
            sentence: SentenceAudio,
        ) -> std::result::Result<PlaybackState, TtsError> {
            self.heard.lock().unwrap().push((
                sentence.id,
                sentence.format.duration_ms(sentence.pcm.len()),
                sentence.last,
            ));
            Ok(PlaybackState {
                queued_ahead_ms: 0.0,
                playing: true,
            })
        }

        async fn state(&self) -> std::result::Result<PlaybackState, TtsError> {
            Ok(PlaybackState {
                queued_ahead_ms: 0.0,
                playing: true,
            })
        }

        async fn stop(&self) -> std::result::Result<Heard, TtsError> {
            Ok(Heard {
                sentence: 7,
                position_ms: 70.0,
                duration_ms: 700.0,
            })
        }
    }

    /// Keeps every player it made, so a test can ask what a finished turn heard
    /// and what the turn after it heard.
    #[derive(Default)]
    struct Stage {
        made: StdMutex<Vec<(u64, Arc<Recorder>)>>,
    }

    impl Stage {
        fn player_for(&self, utterance: u64) -> Arc<Recorder> {
            self.made
                .lock()
                .unwrap()
                .iter()
                .find(|(u, _)| *u == utterance)
                .map(|(_, p)| p.clone())
                .expect("that turn never asked for a player")
        }
    }

    impl Speakers for Stage {
        fn player(&self, utterance: u64) -> Arc<dyn Player> {
            let player = Arc::new(Recorder::default());
            self.made.lock().unwrap().push((utterance, player.clone()));
            player
        }
    }

    fn session(stage: Arc<Stage>) -> SpeechSession {
        let backend = Arc::new(Fake::default());
        SpeechSession::new(Some(backend), stage, RelayConfig::default())
    }

    fn session_with(stage: Arc<Stage>, backend: Arc<Fake>) -> SpeechSession {
        SpeechSession::new(Some(backend), stage, RelayConfig::default())
    }

    /// Poll until the condition holds or give up. The session keeps no timeline,
    /// so what a turn has spoken is read off the player.
    async fn until(mut done: impl FnMut() -> bool) -> bool {
        for _ in 0..200 {
            if done() {
                return true;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        done()
    }

    fn near(a: f64, b: f64) -> bool {
        (a - b).abs() < 20.0
    }

    /// Every sentence is trailed by the pause the relay puts between them.
    fn spoken_ms(text: &str) -> f64 {
        tone_ms(text) + RelayConfig::default().gap_ms
    }

    #[tokio::test]
    async fn a_turn_speaks_what_it_was_pushed_in_order() {
        let stage = Arc::new(Stage::default());
        let session = session(stage.clone());

        let utterance = session.begin().await.unwrap();
        for text in ["a", "bb", "ccc"] {
            session.push(text.to_string()).await.unwrap();
        }
        session.close().await.unwrap();

        let player = stage.player_for(utterance);
        assert!(
            until(|| player.sentences().len() == 3).await,
            "{:?}",
            player.sentences()
        );
        let heard = player.sentences();
        assert_eq!(
            heard.iter().map(|(id, _, _)| *id).collect::<Vec<_>>(),
            vec![0, 1, 2]
        );
        for (text, (_, ms, _)) in ["a", "bb", "ccc"].iter().zip(&heard) {
            assert!(near(*ms, spoken_ms(text)), "{text}: {ms} ms");
        }
        assert_eq!(
            heard.iter().map(|(_, _, last)| *last).collect::<Vec<_>>(),
            vec![false, false, true]
        );
    }

    #[tokio::test]
    async fn stopping_kills_what_is_in_flight_and_drops_what_was_never_queued() {
        let stage = Arc::new(Stage::default());
        let backend = Arc::new(Fake::default());
        let started = backend.started.clone();
        let cancelled = backend.cancelled.clone();
        let session = session_with(stage.clone(), backend);

        let utterance = session.begin().await.unwrap();
        // The first sentence is still out when the second comes back, so the
        // second is synthesised, held for its turn in the order, and never
        // reaches the player.
        session.push("slow one".to_string()).await.unwrap();
        session.push("bb".to_string()).await.unwrap();
        let player = stage.player_for(utterance);
        // Long enough for both to be admitted and the second to come back.
        tokio::time::sleep(Duration::from_millis(150)).await;

        // Both went out, and only the held-back one is still out.
        assert_eq!(started.load(Ordering::SeqCst), 2);
        assert_eq!(cancelled.load(Ordering::SeqCst), 0);

        let stopped = session.stop().await.unwrap();
        assert_eq!(stopped.utterance, utterance);
        assert!(player.sentences().is_empty(), "{:?}", player.sentences());
        // The one in flight was killed; the one that came back and was waiting
        // its turn in the order went with it, unheard.
        assert_eq!(cancelled.load(Ordering::SeqCst), 1);

        // The relay's loop returned. The references left are the stage's and
        // this test's; the one the loop held is gone with it.
        assert!(until(|| Arc::strong_count(&player) == 2).await);
        // Long past the point the held-back synthesis would have finished.
        tokio::time::sleep(Duration::from_millis(200)).await;
        assert!(player.sentences().is_empty(), "{:?}", player.sentences());
        assert!(session.push("late".to_string()).await.is_err());
    }

    #[tokio::test]
    async fn the_next_turn_is_numbered_higher_and_hears_none_of_the_last_one() {
        let stage = Arc::new(Stage::default());
        let backend = Arc::new(Fake::default());
        let started = backend.started.clone();
        let session = session_with(stage.clone(), backend);

        let first = session.begin().await.unwrap();
        session.push("slow one".to_string()).await.unwrap();
        assert!(until(|| started.load(Ordering::SeqCst) == 1).await);

        let second = session.begin().await.unwrap();
        assert!(second > first, "{first} then {second}");
        session.push("a".to_string()).await.unwrap();
        session.push("bb".to_string()).await.unwrap();
        session.close().await.unwrap();

        let before = stage.player_for(first);
        let after = stage.player_for(second);
        assert!(
            until(|| after.sentences().len() == 2).await,
            "{:?}",
            after.sentences()
        );
        // Sentence numbering is per turn, and the audio is this turn's: the
        // first turn's sentence was longer than either of these.
        let heard = after.sentences();
        assert_eq!(
            heard.iter().map(|(id, _, _)| *id).collect::<Vec<_>>(),
            vec![0, 1]
        );
        assert!(near(heard[0].1, spoken_ms("a")), "{:?}", heard);
        assert!(near(heard[1].1, spoken_ms("bb")), "{:?}", heard);
        // Well past the moment the abandoned synthesis would have come back.
        tokio::time::sleep(Duration::from_millis(200)).await;
        assert!(before.sentences().is_empty(), "{:?}", before.sentences());
    }

    #[tokio::test]
    async fn pushing_with_no_turn_open_is_an_error() {
        let session = session(Arc::new(Stage::default()));
        let refused = session.push("a".to_string()).await;
        assert!(matches!(refused, Err(Error::Speech(_))), "{refused:?}");
        // And closing one is not: an interrupted turn ends with exactly this.
        session.close().await.unwrap();
    }

    #[tokio::test]
    async fn stopping_with_no_turn_open_answers_the_sentinel() {
        let session = session(Arc::new(Stage::default()));
        assert_eq!(session.stop().await.unwrap(), SpeechStopped::UNKNOWN);
    }

    #[tokio::test]
    async fn utterance_numbers_start_at_one_and_only_go_up() {
        let session = session(Arc::new(Stage::default()));
        let mut numbers = Vec::new();
        for _ in 0..4 {
            numbers.push(session.begin().await.unwrap());
        }
        assert_eq!(numbers, vec![1, 2, 3, 4]);
    }
}
