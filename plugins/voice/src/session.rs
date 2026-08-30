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
// One relay per turn, never reused, and a turn ends its own relay: `stop` cuts
// the loop short and a `close` ends it as soon as the last sentence has been
// handed to the player (tts/relay.rs). Either way the handle left here is dead,
// which is why a turn keeps its player beside it — see `cut`.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex as StdMutex};

use tokio::sync::{mpsc, Mutex};

use crate::models::SpeechStopped;
use crate::speaker::Speakers;
use crate::tts::{Heard, Player, RelayConfig, SpeechRelay, TtsBackend};
use crate::{Error, Result};

/// The vendor key's fallback source: the process environment. A bench launch is
/// what sets it (`DEVICECTL_CHILD_MIMO_API_KEY`, live.rs), so it exists for the
/// length of that run and is on nobody's disk. It is the second source, not the
/// only one — see `effective_key`.
pub(crate) const KEY_VAR: &str = "MIMO_API_KEY";

/// What `begin` answers with when no key was found at either source. Names
/// neither key nor source: it is shown to the user, and the fix is the same
/// either way.
const NO_VOICE: &str = "There is no voice to speak with: set the speech API key in Settings.";

/// The key to build the vendor from, in priority order: the one saved in
/// Settings and handed over by the webview, then `MIMO_API_KEY` from the
/// process environment. Blank at either level counts as unset, so clearing the
/// field in Settings falls back to the environment rather than silencing a
/// bench build that was launched with a key.
fn effective_key(from_settings: Option<&str>, from_env: Option<&str>) -> Option<String> {
    [from_settings, from_env]
        .into_iter()
        .flatten()
        .map(str::trim)
        .find(|key| !key.is_empty())
        .map(str::to_string)
}

/// A turn of speech, from `begin` until it is stopped or replaced.
struct Turn {
    utterance: u64,
    relay: SpeechRelay,
    /// The same player the relay is speaking through. Kept because the relay
    /// ends on its own once the turn is closed and drained, and the audio it
    /// handed over is still playing after that: past that point the player is
    /// the only thing left that can be stopped.
    player: Arc<dyn Player>,
}

/// End a turn's audio, whatever state its relay is in.
///
/// While the loop is running it does both halves — kill the synthesis still in
/// flight, then stop the player — and answers with where the listener had got
/// to. Once the loop has ended there is no synthesis left and the stop goes
/// straight to the player. It has to be stopped either way: Swift drops any
/// sentence whose utterance is not the one it is playing (speaker.rs), so a new
/// turn opened under an old turn's tail would be dropped sentence by sentence
/// and say nothing at all.
async fn cut(turn: &Turn) -> Option<Heard> {
    match turn.relay.stop().await {
        Ok(heard) => Some(heard),
        Err(_) => turn.player.stop().await.ok(),
    }
}

pub struct SpeechSession {
    /// The vendor, when a key was found. A build without one still manages a
    /// session: the rejection has to reach the webview as a command that
    /// answered "no key", not as a command that does not exist.
    ///
    /// Behind a lock because Settings can replace it while the app runs. The
    /// key itself is not kept beside it: `use_key` builds the backend and lets
    /// the string go, so the only copy in this process is the one the client
    /// signs requests with. A turn already speaking keeps its own `Arc` and is
    /// not disturbed by a replacement.
    backend: StdMutex<Option<Arc<dyn TtsBackend>>>,
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
            backend: StdMutex::new(backend),
            speakers,
            config,
            turn: Mutex::new(None),
            utterances: AtomicU64::new(0),
        }
    }

    /// Build the session this plugin runs with: a player per turn on whatever
    /// host this is, and Mimo if the process was launched with a key. The key
    /// saved in Settings is not readable from here — it is in the webview's
    /// credential store — so it arrives afterwards through `use_key`.
    pub fn from_env(speakers: Arc<dyn Speakers>) -> Self {
        let session = Self::new(None, speakers, RelayConfig::default());
        session.use_key(None);
        session
    }

    /// Take the key saved in Settings and rebuild the vendor around it. `None`
    /// or blank clears it, after which `MIMO_API_KEY` is used again if the run
    /// was launched with one. Answers whether there is a voice afterwards.
    ///
    /// Called once when the app starts and again on every save, rather than
    /// per turn: the key belongs to the process, and carrying it on
    /// `speak_begin` would put it across the IPC boundary once per answer.
    pub fn use_key(&self, from_settings: Option<&str>) -> bool {
        self.use_key_with(from_settings, std::env::var(KEY_VAR).ok().as_deref())
    }

    /// `use_key` with the environment's half handed in, so the priority between
    /// the two sources can be exercised without a process environment. A test
    /// that read the real one would pass or fail by what the shell exported.
    fn use_key_with(&self, from_settings: Option<&str>, from_env: Option<&str>) -> bool {
        let backend = effective_key(from_settings, from_env)
            .and_then(|key| crate::tts::mimo::MimoBackend::new(key).ok())
            .map(|backend| Arc::new(backend) as Arc<dyn TtsBackend>);
        let speaking = backend.is_some();
        *self.backend.lock().expect("speech backend lock") = backend;
        speaking
    }

    /// The vendor to open a turn with, or the rejection to answer with. Not
    /// async on purpose: the lock is never held across an await.
    fn vendor(&self) -> Result<Arc<dyn TtsBackend>> {
        self.backend
            .lock()
            .expect("speech backend lock")
            .clone()
            .ok_or_else(|| Error::Speech(NO_VOICE.to_string()))
    }

    /// Open a turn and answer with its number.
    ///
    /// Whatever was still speaking is stopped first, in-flight synthesis
    /// included. A new turn only ever begins because the model is answering
    /// something the user just said, and the user saying it is what interrupted
    /// the last turn; letting the old audio run under the new one would speak
    /// two answers at once.
    pub async fn begin(&self) -> Result<u64> {
        let backend = self.vendor()?;

        let mut turn = self.turn.lock().await;
        if let Some(previous) = turn.take() {
            cut(&previous).await;
        }

        let utterance = self.utterances.fetch_add(1, Ordering::SeqCst) + 1;
        let player = self.speakers.player(utterance);
        // The timeline is dropped on the floor. It is what the bench reads, and
        // a turn of conversation has no reader for it; the relay is written to
        // carry on with the receiver gone.
        let (events, _timeline) = mpsc::unbounded_channel();
        let relay = SpeechRelay::start(backend, player.clone(), self.config.clone(), events);
        *turn = Some(Turn {
            utterance,
            relay,
            player,
        });
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
    /// synthesised and will still be spoken; the relay ends itself once the
    /// last of it has been handed over, which is not the same moment as the
    /// voice stopping. Only Swift knows that one, and it says so in the
    /// `speech` event.
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
    /// time the stop reaches the player there is nothing playing: the answer
    /// names the turn that was cut and carries sentence 0 and both times 0. The
    /// authority on where a turn was cut is the event Swift emits when it cuts
    /// it. Do not resume a turn from this return value.
    ///
    /// A turn whose relay has already finished — closed, every sentence handed
    /// over, the audio still playing — answers the same way, through the player
    /// the turn kept. Only a turn that is not there at all answers `UNKNOWN`.
    pub async fn stop(&self) -> Result<SpeechStopped> {
        let mut turn = self.turn.lock().await;
        let Some(turn) = turn.take() else {
            return Ok(SpeechStopped::UNKNOWN);
        };
        let Some(heard) = cut(&turn).await else {
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
        /// Times this turn was told to shut up. The count and not a flag: a
        /// turn silenced twice is a round trip to the phone nobody asked for.
        stops: AtomicUsize,
    }

    impl Recorder {
        fn sentences(&self) -> Vec<(u64, f64, bool)> {
            self.heard.lock().unwrap().clone()
        }

        fn stops(&self) -> usize {
            self.stops.load(Ordering::SeqCst)
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
            self.stops.fetch_add(1, Ordering::SeqCst);
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

    /// A turn whose relay has ended, with its audio still in the air. Both
    /// tests below start here: it is the state a turn that ran to the end of
    /// its sentences sits in until something stops the player.
    ///
    /// The count is what says the relay is gone: the stage holds one reference
    /// to that player, this test holds one, the session's turn holds a third,
    /// and the fourth was the relay's loop.
    async fn a_finished_turn(stage: &Arc<Stage>, session: &SpeechSession) -> (u64, Arc<Recorder>) {
        let utterance = session.begin().await.unwrap();
        session.push("a".to_string()).await.unwrap();
        session.close().await.unwrap();
        let player = stage.player_for(utterance);
        assert!(until(|| player.sentences().len() == 1).await);
        assert!(
            until(|| Arc::strong_count(&player) == 3).await,
            "the relay is still holding the player"
        );
        (utterance, player)
    }

    /// Opening a turn has to silence the one before it even when that one said
    /// everything it had to say: the audio is still playing, and Swift drops
    /// any sentence whose utterance is not the one it is playing, so a new turn
    /// speaking under an old turn's tail would be dropped sentence by sentence.
    /// The relay that used to carry the stop is gone by then.
    #[tokio::test]
    async fn opening_a_turn_silences_the_finished_one_before_it() {
        let stage = Arc::new(Stage::default());
        let session = session(stage.clone());
        let (_, before) = a_finished_turn(&stage, &session).await;

        let second = session.begin().await.unwrap();
        assert_eq!(before.stops(), 1);

        // And the new turn is heard rather than dropped.
        session.push("bb".to_string()).await.unwrap();
        session.close().await.unwrap();
        let after = stage.player_for(second);
        assert!(
            until(|| after.sentences().len() == 1).await,
            "{:?}",
            after.sentences()
        );
        assert_eq!(before.stops(), 1);
    }

    /// The same for a barge-in that lands after the model's last sentence: the
    /// user talking over the tail is exactly when there is no relay left, and
    /// the player is the only thing that can still be stopped.
    #[tokio::test]
    async fn stopping_a_finished_turn_still_stops_the_player() {
        let stage = Arc::new(Stage::default());
        let session = session(stage.clone());
        let (utterance, player) = a_finished_turn(&stage, &session).await;

        let stopped = session.stop().await.unwrap();
        assert_eq!(player.stops(), 1);
        assert_eq!(stopped.utterance, utterance);
        assert_eq!(stopped.sentence, 7);
        assert!(near(stopped.position_ms, 70.0), "{stopped:?}");
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

    // Where the key comes from. `effective_key` is the whole of that decision,
    // and it is pure, so the priority and the fallback are testable without a
    // process environment or a network. The strings below are shaped like keys
    // and are not: nothing here reaches a vendor.

    #[test]
    fn settings_wins_over_the_environment() {
        assert_eq!(
            effective_key(Some("from-settings-not-real"), Some("from-env-not-real")),
            Some("from-settings-not-real".to_string())
        );
    }

    #[test]
    fn a_blank_settings_key_falls_back_to_the_environment() {
        for blank in ["", "   "] {
            assert_eq!(
                effective_key(Some(blank), Some("from-env-not-real")),
                Some("from-env-not-real".to_string()),
                "{blank:?}"
            );
        }
        assert_eq!(
            effective_key(None, Some("from-env-not-real")),
            Some("from-env-not-real".to_string())
        );
    }

    #[test]
    fn settings_alone_is_enough() {
        assert_eq!(
            effective_key(Some("from-settings-not-real"), None),
            Some("from-settings-not-real".to_string())
        );
    }

    #[test]
    fn neither_source_means_no_voice() {
        assert_eq!(effective_key(None, None), None);
        assert_eq!(effective_key(Some("  "), Some("")), None);
    }

    #[test]
    fn a_key_is_taken_trimmed() {
        assert_eq!(
            effective_key(Some("  from-settings-not-real\n"), None),
            Some("from-settings-not-real".to_string())
        );
    }

    /// The session with no key at either source refuses to open a turn, and the
    /// refusal says where to fix it without naming a key or a variable.
    #[tokio::test]
    async fn a_session_with_no_key_refuses_to_begin() {
        let session = SpeechSession::new(None, Arc::new(Stage::default()), RelayConfig::default());
        let refused = session.begin().await;
        let Err(Error::Speech(message)) = refused else {
            panic!("{refused:?}");
        };
        assert_eq!(message, NO_VOICE);
    }

    /// Handing a key over builds a vendor; clearing it with nothing in the
    /// environment takes the vendor away again; clearing it with a key in the
    /// environment falls back to that one and keeps a voice.
    #[tokio::test]
    async fn a_key_handed_over_gives_the_session_a_voice() {
        let session = SpeechSession::new(None, Arc::new(Stage::default()), RelayConfig::default());
        assert!(session.use_key_with(Some("handed-over-not-real"), None));
        assert!(session.vendor().is_ok());
        assert!(!session.use_key_with(Some("   "), None));
        assert!(session.vendor().is_err());
        assert!(session.use_key_with(None, Some("from-env-not-real")));
        assert!(session.vendor().is_ok());
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
