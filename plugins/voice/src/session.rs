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
use std::sync::Arc;

use tokio::sync::{mpsc, Mutex};

use crate::models::SpeechStopped;
use crate::speaker::Speakers;
use crate::tts::cues::{self, CueStore};
use crate::tts::{
    Heard, OnDeviceVoice, OpeningKey, Player, RelayConfig, SpeechRelay, SpeechRequest, TtsBackend,
};
use crate::{Error, Result};

/// What `begin` answers with when this host has no voice at all: a build
/// without the `kokoro` feature.
const NO_VOICE: &str = "There is no voice to speak with on this device.";

/// Which voice speaks on this host: the one switch between the two engines.
///
/// With the `kokoro` feature, which src-tauri turns on for iOS only, it is
/// on-device Kokoro. Without it there is none: desktop and Android have no
/// player either (fallback.rs). The network vendor that used to sit beside it,
/// Xiaomi MiMo, was removed on 2026-10-18.
fn on_device_voice(
    models: &Arc<crate::kokoro::download::Downloader>,
) -> Option<Arc<dyn OnDeviceVoice>> {
    #[cfg(feature = "kokoro")]
    {
        Some(Arc::new(crate::tts::kokoro::KokoroVoice::on_disk(models.clone())))
    }
    #[cfg(not(feature = "kokoro"))]
    {
        let _ = models;
        None
    }
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
/// straight to the player. It has to be stopped either way: Swift will not
/// speak a turn while an earlier one's tail is still running (speaker.rs), so a
/// turn opened over one starts as late as that tail is long.
///
/// `None` is the one thing this cannot promise: the player would not stop, on
/// both the path through the relay and the one straight to it. The audio is
/// still playing, and the caller is the only one that can say what that costs.
async fn cut(turn: &Turn) -> Option<Heard> {
    match turn.relay.stop().await {
        Ok(heard) => Some(heard),
        // Either there is no loop left to carry the stop, or the loop carried it
        // and the player refused. Both leave the player to be stopped from here:
        // the relay is gone in the first and has let go in the second.
        Err(_) => turn.player.stop().await.ok(),
    }
}

pub struct SpeechSession {
    /// A fixed backend handed in by whoever built the session: the tests'
    /// stand-ins. A session with neither this nor `on_device` still exists, so
    /// the rejection reaches the webview as a command that answered "no
    /// voice", not as a command that does not exist.
    backend: Option<Arc<dyn TtsBackend>>,
    /// The voice on this device, when this host speaks with one
    /// (`on_device_voice`). Present means it is the only voice: `backend`
    /// above is never asked.
    on_device: Option<Arc<dyn OnDeviceVoice>>,
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
    /// The program's own short lines, made by `prime_cues` (tts/cues.rs).
    cues: CueStore,
}

impl SpeechSession {
    pub fn new(
        backend: Option<Arc<dyn TtsBackend>>,
        speakers: Arc<dyn Speakers>,
        config: RelayConfig,
    ) -> Self {
        Self {
            backend,
            on_device: None,
            speakers,
            config,
            turn: Mutex::new(None),
            utterances: AtomicU64::new(0),
            cues: CueStore::new(),
        }
    }

    /// Speak with this on-device voice and nothing else.
    pub fn with_on_device(mut self, voice: Arc<dyn OnDeviceVoice>) -> Self {
        self.on_device = Some(voice);
        self
    }

    /// Build the session this plugin runs with: a player per turn on whatever
    /// host this is, the on-device voice where this host has one
    /// (`on_device_voice`), and otherwise no voice.
    pub fn from_env(
        speakers: Arc<dyn Speakers>,
        models: &Arc<crate::kokoro::download::Downloader>,
    ) -> Self {
        let mut session = Self::new(None, speakers, RelayConfig::default());
        session.on_device = on_device_voice(models);
        session
    }

    /// The vendor to open a turn with, or the rejection to answer with. Not
    /// async on purpose: the lock is never held across an await.
    ///
    /// With an on-device voice there is no fallback: until its files are on
    /// disk the answer is the rejection telling the user to download them, and
    /// it is asked again on every turn, so a download that finishes during the
    /// session speaks from the next turn on.
    pub(crate) fn vendor(&self) -> Result<Arc<dyn TtsBackend>> {
        if let Some(voice) = &self.on_device {
            return voice.backend().map_err(Error::Speech);
        }
        self.backend
            .clone()
            .ok_or_else(|| Error::Speech(NO_VOICE.to_string()))
    }

    /// Get the voice ready for a call that is opening: an on-device model is
    /// loaded in the background, so the first answer does not wait for it.
    /// Nothing for a vendor, and nothing when there is no voice yet; the turn
    /// will say so.
    pub fn warm(&self) {
        if self.on_device.is_some() {
            let _ = self.vendor();
        }
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
        Ok(self.open(&mut turn, backend).await)
    }

    /// `begin` with the turn lock already held, so that a cue can open, fill
    /// and close its turn without another command landing in between.
    async fn open(&self, turn: &mut Option<Turn>, backend: Arc<dyn TtsBackend>) -> u64 {
        if let Some(previous) = turn.take() {
            // A player that will not stop does not stop a turn from opening. The
            // new turn's first sentence is refused for as long as the old tail
            // runs and offered again after it (tts/relay.rs), which is late
            // rather than silent; the timeline's `Waiting` is where it shows.
            let _ = cut(&previous).await;
        }

        let utterance = self.utterances.fetch_add(1, Ordering::SeqCst) + 1;
        let player = self.speakers.player(utterance);
        // The timeline is dropped on the floor. It is what the bench reads, and
        // a turn of conversation has no reader for it; the relay is written to
        // carry on with the receiver gone.
        // The silent bench (src/harness.rs) is the one reader it has.
        let (events, timeline) = mpsc::unbounded_channel();
        crate::harness::watch_relay(timeline);
        let mut config = self.config.clone();
        if let Some(most) = backend.max_in_flight() {
            config.concurrency = config.concurrency.min(most.max(1));
        }
        let relay = SpeechRelay::start(backend, player.clone(), config, events);
        *turn = Some(Turn {
            utterance,
            relay,
            player,
        });
        utterance
    }

    /// What a cue's audio has to have been made with to be played for it now.
    fn cue_key(&self, backend: &dyn TtsBackend, text: &str) -> OpeningKey {
        OpeningKey {
            backend: backend.id().to_string(),
            model: backend.model().to_string(),
            voice: self.cue_voice(backend),
            text: text.to_string(),
        }
    }

    fn cue_voice(&self, backend: &dyn TtsBackend) -> String {
        if self.config.voice.is_empty() {
            backend.default_voice().to_string()
        } else {
            self.config.voice.clone()
        }
    }

    /// Make every cue in `lang` (`zh`, `en`) that is not already held, one after
    /// another, and answer how many are held afterwards. Called when a call
    /// opens; a cue that failed to be made is spoken from its text instead.
    pub async fn prime_cues(&self, lang: &str) -> Result<usize> {
        let backend = self.vendor()?;
        let mut held = 0;
        for cue in cues::cues_for(lang) {
            let key = self.cue_key(backend.as_ref(), cue.text);
            if !self.cues.has(cue.id, &key) {
                let request = SpeechRequest {
                    text: cue.text.to_string(),
                    voice: key.voice.clone(),
                };
                let audio = cues::make(
                    backend.as_ref(),
                    &request,
                    self.config.trim.clone(),
                    self.config.gap_ms,
                )
                .await
                .map_err(|e| Error::Speech(e.to_string()))?;
                self.cues.store(cue.id, key, audio);
            }
            held += 1;
        }
        crate::harness::mark("cues-primed", serde_json::json!({ "lang": lang, "held": held }));
        Ok(held)
    }

    /// Say one cue as a turn of its own and answer with the turn's number. The
    /// audio made by `prime_cues` goes straight to the player; a cue that was
    /// not made is synthesised from its text like any sentence. Whatever was
    /// speaking stops, as with `begin`.
    pub async fn speak_cue(&self, id: &str) -> Result<u64> {
        let cue =
            cues::cue(id).ok_or_else(|| Error::Speech(format!("There is no cue called {id}.")))?;
        let backend = self.vendor()?;
        let audio = self
            .cues
            .get(cue.id, &self.cue_key(backend.as_ref(), cue.text));
        let mut turn = self.turn.lock().await;
        let utterance = self.open(&mut turn, backend).await;
        let open = turn.as_ref().expect("the turn just opened");
        crate::harness::mark(
            "cue",
            serde_json::json!({ "id": id, "utterance": utterance, "premade": audio.is_some() }),
        );
        match audio {
            Some(pcm) => open.relay.push_audio(pcm, cue.text.chars().count()),
            None => open.relay.push(cue.text),
        };
        open.relay.close();
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
            // Not `UNKNOWN`: there was a turn, it is still audible, and saying
            // "nothing was playing" would be the one answer that is certainly
            // wrong.
            return Err(Error::Speech(
                "The voice would not stop; it is still speaking.".to_string(),
            ));
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
    use std::sync::atomic::{AtomicBool, AtomicUsize};
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
        /// Answers `max_in_flight` with one, the way an on-device engine does.
        serial: bool,
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
        fn max_in_flight(&self) -> Option<usize> {
            self.serial.then_some(1)
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
        /// A player that will not shut up, which is the failure `cut` is there
        /// for and the one it used to swallow.
        refuse_stop: bool,
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
            // A sentence arrives in pieces; the record is one row per
            // sentence, its pieces summed.
            let ms = sentence.format.duration_ms(sentence.pcm.len());
            let mut heard = self.heard.lock().unwrap();
            match heard.last_mut() {
                Some(row) if row.0 == sentence.id && sentence.part > 0 => {
                    row.1 += ms;
                    row.2 |= sentence.last;
                }
                _ => heard.push((sentence.id, ms, sentence.last)),
            }
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
            if self.refuse_stop {
                return Err(TtsError::Player("the node would not stop".to_string()));
            }
            Ok(Heard {
                sentence: 7,
                position_ms: 70.0,
                duration_ms: 700.0,
            })
        }

        async fn finish(&self) -> std::result::Result<(), TtsError> {
            Ok(())
        }
    }

    /// Keeps every player it made, so a test can ask what a finished turn heard
    /// and what the turn after it heard.
    #[derive(Default)]
    struct Stage {
        made: StdMutex<Vec<(u64, Arc<Recorder>)>>,
        /// Every player it makes refuses to stop.
        refuse_stop: bool,
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
            let player = Arc::new(Recorder {
                refuse_stop: self.refuse_stop,
                ..Default::default()
            });
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

    /// Wait for the open turn's relay to have ended. Asking it to close is what
    /// asks: it is the one command that costs nothing to repeat — the turn is
    /// closed already, so a loop that is still running only sets the flag it has
    /// already set — and a loop that has ended is a channel that answers false.
    async fn relay_ended(session: &SpeechSession) -> bool {
        for _ in 0..200 {
            {
                let turn = session.turn.lock().await;
                let Some(turn) = turn.as_ref() else {
                    return true;
                };
                if !turn.relay.close() {
                    return true;
                }
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        false
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

        // That cancellation is also the loop having returned: nothing else kills
        // a synthesis in flight.
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
    async fn a_finished_turn(stage: &Arc<Stage>, session: &SpeechSession) -> (u64, Arc<Recorder>) {
        let utterance = session.begin().await.unwrap();
        session.push("a".to_string()).await.unwrap();
        session.close().await.unwrap();
        let player = stage.player_for(utterance);
        assert!(until(|| player.sentences().len() == 1).await);
        assert!(relay_ended(session).await, "the relay is still running");
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

    /// The failure `cut` exists for. A player that will not stop used to be
    /// reported through the relay as a turn that had been silenced, so the one
    /// caller written for this case never saw it.
    #[tokio::test]
    async fn a_player_that_will_not_stop_is_not_reported_as_a_silenced_turn() {
        let stage = Arc::new(Stage {
            refuse_stop: true,
            ..Default::default()
        });
        let session = session(stage.clone());

        let utterance = session.begin().await.unwrap();
        session.push("slow one".to_string()).await.unwrap();
        let player = stage.player_for(utterance);

        // The relay is still running, so the stop goes through it — the path
        // that used to answer with a position of its own making.
        let refused = session.stop().await;
        assert!(matches!(refused, Err(Error::Speech(_))), "{refused:?}");
        // Both halves tried: the relay's own stop, then the fallback straight to
        // the player.
        assert_eq!(player.stops(), 2);
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

    /// A session with no voice refuses to open a turn.
    #[tokio::test]
    async fn a_session_with_no_voice_refuses_to_begin() {
        let session = SpeechSession::new(None, Arc::new(Stage::default()), RelayConfig::default());
        let refused = session.begin().await;
        let Err(Error::Speech(message)) = refused else {
            panic!("{refused:?}");
        };
        assert_eq!(message, NO_VOICE);
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

    #[tokio::test]
    async fn a_primed_cue_is_played_from_memory_every_time_it_is_asked_for() {
        let stage = Arc::new(Stage::default());
        let backend = Arc::new(Fake::default());
        let started = backend.started.clone();
        let session = session_with(stage.clone(), backend);

        assert_eq!(session.prime_cues("zh").await.unwrap(), 4);
        assert_eq!(started.load(Ordering::SeqCst), 4);
        // Priming again makes nothing new.
        assert_eq!(session.prime_cues("zh").await.unwrap(), 4);
        assert_eq!(started.load(Ordering::SeqCst), 4);

        for _ in 0..2 {
            let utterance = session.speak_cue("zh/think").await.unwrap();
            let player = stage.player_for(utterance);
            assert!(until(|| player.sentences().len() == 1).await);
            let (id, ms, _) = player.sentences()[0];
            assert_eq!(id, 0);
            assert!(near(ms, spoken_ms("我去想想。")), "{ms} ms");
        }
        assert_eq!(started.load(Ordering::SeqCst), 4);
    }

    #[tokio::test]
    async fn a_cue_that_was_not_made_is_synthesised_from_its_text() {
        let stage = Arc::new(Stage::default());
        let backend = Arc::new(Fake::default());
        let started = backend.started.clone();
        let session = session_with(stage.clone(), backend);

        let utterance = session.speak_cue("en/look").await.unwrap();
        let player = stage.player_for(utterance);
        assert!(until(|| player.sentences().len() == 1).await);
        assert!(near(
            player.sentences()[0].1,
            spoken_ms("Let me look into that.")
        ));
        assert_eq!(started.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn a_cue_cuts_off_the_turn_that_was_speaking() {
        let stage = Arc::new(Stage::default());
        let session = session(stage.clone());
        let first = session.begin().await.unwrap();
        session.push("slow one".to_string()).await.unwrap();

        let second = session.speak_cue("zh/moment").await.unwrap();
        assert_eq!(second, first + 1);
        assert_eq!(stage.player_for(first).stops(), 1);
    }

    #[tokio::test]
    async fn an_unknown_cue_is_refused() {
        let session = session(Arc::new(Stage::default()));
        assert!(session.speak_cue("zh/nope").await.is_err());
    }
    /// An on-device voice whose files appear when the test says so.
    struct Local {
        ready: AtomicBool,
        backend: Arc<Fake>,
        /// Times `backend` was asked for, which is also times it was warmed.
        asked: AtomicUsize,
    }

    const NOT_HERE: &str = "download the on-device voice";

    impl OnDeviceVoice for Local {
        fn ready(&self) -> bool {
            self.ready.load(Ordering::SeqCst)
        }
        fn backend(&self) -> std::result::Result<Arc<dyn TtsBackend>, String> {
            self.asked.fetch_add(1, Ordering::SeqCst);
            if self.ready() {
                Ok(self.backend.clone())
            } else {
                Err(NOT_HERE.to_string())
            }
        }
    }

    fn local(ready: bool) -> Arc<Local> {
        Arc::new(Local {
            ready: AtomicBool::new(ready),
            backend: Arc::new(Fake { serial: true, ..Default::default() }),
            asked: AtomicUsize::new(0),
        })
    }

    /// A fixed backend beside it changes nothing: until the files are there
    /// the turn is refused with the download message, and the backend is
    /// never asked.
    #[tokio::test]
    async fn an_on_device_voice_not_downloaded_yet_refuses_and_never_falls_back() {
        let other = Arc::new(Fake::default());
        let started = other.started.clone();
        let voice = local(false);
        let session = session_with(Arc::new(Stage::default()), other).with_on_device(voice.clone());

        let refused = session.begin().await;
        let Err(Error::Speech(message)) = refused else {
            panic!("{refused:?}");
        };
        assert_eq!(message, NOT_HERE);
        assert!(session.prime_cues("zh").await.is_err());
        assert!(session.speak_cue("zh/think").await.is_err());
        assert_eq!(started.load(Ordering::SeqCst), 0);
    }

    #[tokio::test]
    async fn a_download_that_finishes_mid_session_speaks_from_the_next_turn() {
        let stage = Arc::new(Stage::default());
        let other = Arc::new(Fake::default());
        let other_started = other.started.clone();
        let voice = local(false);
        let session = session_with(stage.clone(), other).with_on_device(voice.clone());
        assert!(session.begin().await.is_err());

        voice.ready.store(true, Ordering::SeqCst);
        let utterance = session.begin().await.unwrap();
        session.push("a".to_string()).await.unwrap();
        session.close().await.unwrap();
        let player = stage.player_for(utterance);
        assert!(until(|| player.sentences().len() == 1).await);
        assert_eq!(voice.backend.started.load(Ordering::SeqCst), 1);
        assert_eq!(other_started.load(Ordering::SeqCst), 0);
    }

    /// Building the session must not load a model; a call opening does,
    /// through `backend`.
    #[tokio::test]
    async fn warming_asks_the_on_device_voice_and_building_does_not() {
        let voice = local(true);
        let session = SpeechSession::new(None, Arc::new(Stage::default()), RelayConfig::default())
            .with_on_device(voice.clone());
        assert_eq!(voice.asked.load(Ordering::SeqCst), 0);
        session.warm();
        assert_eq!(voice.asked.load(Ordering::SeqCst), 1);
        // Without one there is nothing to warm and nothing to fail.
        session_with(Arc::new(Stage::default()), Arc::new(Fake::default())).warm();
    }

    /// A backend that runs one sentence at a time gets one at a time: the
    /// second sentence is not even asked for while the first is out, so it
    /// cannot overtake it for the CPU.
    #[tokio::test]
    async fn a_serial_backend_has_one_sentence_in_flight() {
        let stage = Arc::new(Stage::default());
        let backend = Arc::new(Fake { serial: true, ..Default::default() });
        let started = backend.started.clone();
        let session = session_with(stage.clone(), backend);

        let utterance = session.begin().await.unwrap();
        session.push("slow one".to_string()).await.unwrap();
        session.push("bb".to_string()).await.unwrap();
        tokio::time::sleep(Duration::from_millis(150)).await;
        assert_eq!(started.load(Ordering::SeqCst), 1);
        session.stop().await.unwrap();
        assert!(stage.player_for(utterance).sentences().is_empty());
    }
}
