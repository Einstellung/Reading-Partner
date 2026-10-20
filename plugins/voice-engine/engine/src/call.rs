// The call (docs/companion/89, 判轮、识别、出声): the Android counterpart of
// ConversationRun.swift with SpeechOut.swift's turn half. The events that leave
// here are the ones Swift sends, same names and fields (voice_wire).
//
// A turn, as the A-onset run measured it:
//
//   1. On the first frame after the turn's last voiced one, a recognition job
//      starts on the turn's audio from 0.25 s before its first voiced frame.
//   2. At 250 ms of silence the machine pauses and Smart Turn is asked.
//   3. On `end` (Smart Turn's yes, or the hangover) the turn waits for that
//      job's text and `speech-end` carries it. There is no `final`.
//   4. A voiced frame in the silence voids the job; the next silence starts
//      over from the turn's start.
//
// Threads. The capture thread (`capture`, nativeCapture) runs Silero and steps
// the machine; Smart Turn has a worker; recognition has `asr::Recogniser`'s
// worker and the settler, which waits for a turn's text. The track's writer
// (`read_playback`, `playback_position`) and the main process's requests
// (`enqueue` and the rest) come in on threads of their own. Everything that
// decides is under one lock, `state`, so a verdict, the act on the playback and
// the cut position happen together; `front` is the capture thread's audio and
// is always taken before `state`. Events are emitted with `state` held, which
// is what keeps them in order; `Emit` must therefore not block or call back.
// No thread is ever joined with a lock held: the Smart Turn worker takes
// `state` to deliver its verdict, so replacing it (`install`) first takes its
// sender out under `state`, lets go, and only then waits for it to finish.
//
// Ordering across turns: a turn's `speech-end` waits for its text, and every
// event after its `end` waits behind that `speech-end`, so a turn never
// arrives after the one that followed it. A turn that starts while the one
// before it is still being recognised keeps its own job back until that one
// is done: the recogniser runs one job, and submitting voids the one before.

use std::collections::VecDeque;
use std::path::{Path, PathBuf};
use std::sync::{mpsc, Arc, Condvar, Mutex, Weak};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use voice_wire::{ConversationEvent, SpeechCut, SpeechEnqueued, SpeechEvent, SpeechPosition};

use crate::host::{AudioHost, Clock, HostControl};
use crate::playback::{Effect, Playback, ENVELOPE_WINDOW_MS};
use crate::turn::{trailing_level_db, TurnDetector, TurnEvent, TurnPhase, NEURAL_TURN_DETECT};
use crate::{asr, smart_turn, vad};

/// What `open` refuses with when a model file is missing. The plugin's
/// sentence for Kokoro (plugins/voice/src/tts/kokoro.rs NOT_DOWNLOADED) with
/// the section Android's settings show the download under
/// (`settings.optional.voiceCall`). It travels as the refusal of
/// `start_conversation`, which the webview shows; `state failed` carries no
/// text, as on iOS.
pub const NOT_DOWNLOADED: &str =
    "The on-device voice is not downloaded yet: download it in Settings → Optional → Voice call.";

const RATE: f64 = vad::RATE as f64;
const FRAME: usize = vad::FRAME;
/// Step 1's audio starts this far before the turn's first voiced frame.
const ASR_PREROLL: u64 = vad::RATE as u64 / 4;
/// Smart Turn's (NeuralFront.prerollMs).
const SMART_TURN_PREROLL: u64 = vad::RATE as u64 / 5;
/// The trailing level the gate reads (pitfall 652): 100 ms.
const LEVEL_SAMPLES: usize = vad::RATE as usize / 10;
/// The input meter: DictationRun's window, 10 Hz.
const QUIET_DB: f64 = -50.0;
const LOUD_DB: f64 = -10.0;
const LEVEL_INTERVAL_MS: f64 = 100.0;
/// No frame for this long: the ticker steps the machine with silence.
const STALL_MS: f64 = 500.0;
const TICK: Duration = Duration::from_millis(250);
/// Audio kept behind a quiet call, and how far it may grow before a trim.
const IDLE_KEEP: u64 = vad::RATE as u64;
const TRIM_SLACK: u64 = 5 * vad::RATE as u64;

/// A frame's speech probability (Silero, or a fake).
pub trait Vad: Send {
    fn reset(&mut self);
    fn probability(&mut self, frame: &[f32]) -> Result<f32, String>;
}

impl Vad for vad::Silero {
    fn reset(&mut self) {
        vad::Silero::reset(self)
    }
    fn probability(&mut self, frame: &[f32]) -> Result<f32, String> {
        vad::Silero::probability(self, frame)
    }
}

/// Whether a turn that went quiet is over (Smart Turn, or a fake).
pub trait EndOfTurn: Send {
    fn probability(&mut self, audio: &[f32]) -> Result<f32, String>;
}

impl EndOfTurn for smart_turn::SmartTurn {
    fn probability(&mut self, audio: &[f32]) -> Result<f32, String> {
        smart_turn::SmartTurn::probability(self, audio)
    }
}

/// A recognition job's answer, blocking: `Ok(None)` when it was voided.
pub type Waiter = Box<dyn FnOnce() -> Result<Option<String>, String> + Send>;

/// One job at a time; submitting voids the one before (`asr::Recogniser`).
pub trait Recognise: Send + Sync {
    fn submit(&self, pcm: Vec<f32>) -> Waiter;
    fn cancel(&self);
}

impl Recognise for asr::Recogniser {
    fn submit(&self, pcm: Vec<f32>) -> Waiter {
        let ticket = asr::Recogniser::submit(self, pcm);
        Box::new(move || ticket.wait())
    }
    fn cancel(&self) {
        asr::Recogniser::cancel(self)
    }
}

/// The listening half's three models.
pub struct Listeners {
    pub vad: Box<dyn Vad>,
    pub end_of_turn: Box<dyn EndOfTurn>,
    pub recogniser: Arc<dyn Recognise>,
}

/// Every file the engine loads, as `Open` carries them. Kokoro's voices are
/// not among them: the main process reads the style row and sends it with
/// each `Synthesize`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ModelPaths {
    pub silero: PathBuf,
    pub smart_turn: PathBuf,
    pub asr_model: PathBuf,
    pub asr_mmproj: PathBuf,
    pub kokoro_model: PathBuf,
}

impl ModelPaths {
    /// The download directory's layout (`getNoBackupFilesDir()/voice-models`).
    pub fn in_dir(dir: &Path) -> Self {
        use kokoro_onnx::manifest;
        let kokoro = dir
            .join(manifest::DIR.strip_prefix("voice-models/").unwrap_or(manifest::DIR))
            .join(manifest::REVISION);
        Self {
            silero: dir.join(vad::SILERO_FILE),
            smart_turn: dir.join(smart_turn::SMART_TURN_FILE),
            asr_model: dir.join(asr::MODEL_FILE),
            asr_mmproj: dir.join(asr::MMPROJ_FILE),
            kokoro_model: kokoro.join(manifest::Variant::Fp32.file().path),
        }
    }

    pub fn missing(&self) -> Vec<PathBuf> {
        [&self.silero, &self.smart_turn, &self.asr_model, &self.asr_mmproj, &self.kokoro_model]
            .into_iter()
            .filter(|p| !p.is_file())
            .cloned()
            .collect()
    }
}

/// Threads per model (docs/companion/89): Silero always runs on one.
#[derive(Clone, Copy, Debug)]
pub struct Threads {
    pub smart_turn: usize,
    pub asr: i32,
    pub kokoro: usize,
}

impl Default for Threads {
    fn default() -> Self {
        Self { smart_turn: 2, asr: 4, kokoro: 4 }
    }
}

/// What leaves the engine: the `conversation` and `speech` events.
#[derive(Clone, Debug, PartialEq)]
pub enum Out {
    Conversation(ConversationEvent),
    Speech(SpeechEvent),
}

pub type Emit = Box<dyn Fn(Out) + Send + Sync>;

pub type KokoroEngine = Arc<Mutex<kokoro_onnx::engine::Engine>>;

enum Kokoro {
    Empty,
    Loading,
    Ready(KokoroEngine),
    Failed(String),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Audio {
    Closed,
    Play,
    Capture,
}

struct OpenTurn {
    number: u64,
    /// Sample (on the call's audio) where the duck that opened it began.
    start: u64,
    refusal: u64,
}

/// A turn past its `end`, waiting for its text.
struct Ending {
    number: u64,
    silent_ms: f64,
    refusal: u64,
    waiter: Option<Waiter>,
    /// Its audio, when its job was held back behind an earlier turn's.
    pcm: Option<Vec<f32>>,
    in_flight: bool,
    /// Events sent after its `end`, out once its `speech-end` is.
    after: Vec<ConversationEvent>,
}

struct Call {
    id: u64,
    turn: TurnDetector,
    /// The last turn taken.
    number: u64,
    duck_start: u64,
    open: Option<OpenTurn>,
    prev_loud: bool,
    last_step_ms: f64,
    last_level_ms: f64,
    recogniser: Arc<dyn Recognise>,
    /// The open turn's latest job, or its audio while an earlier turn's job runs.
    job: Option<(u64, Waiter)>,
    deferred: Option<(u64, Vec<f32>)>,
    ending: VecDeque<Ending>,
}

struct State {
    playback: Playback,
    call: Option<Call>,
    next_call: u64,
    audio: Audio,
    /// The paths the kept models came from, and the recogniser among them.
    loaded: Option<ModelPaths>,
    recogniser: Option<Arc<dyn Recognise>>,
    /// The Smart Turn worker's queue.
    smart: Option<mpsc::Sender<SmartJob>>,
    shutdown: bool,
}

/// The capture thread's own: Silero and the call's audio.
struct Front {
    vad: Option<Box<dyn Vad>>,
    pending: Vec<f32>,
    audio: Vec<f32>,
    /// The call-sample index of `audio[0]`, and of its end.
    base: u64,
    total: u64,
}

impl Front {
    fn slice(&self, from: u64, to: u64) -> Vec<f32> {
        let from = from.max(self.base).min(to);
        self.audio[(from - self.base) as usize..(to - self.base) as usize].to_vec()
    }
}

struct SmartJob {
    call: u64,
    paused_at_ms: f64,
    audio: Vec<f32>,
}

struct Shared {
    host: Arc<dyn AudioHost>,
    clock: Arc<dyn Clock>,
    emit: Emit,
    front: Mutex<Front>,
    state: Mutex<State>,
    /// `read_playback` waits here for samples.
    samples: Condvar,
    /// The settler waits here for a turn to settle.
    settle: Condvar,
    /// Only `install` and `drop` touch it, never with another lock held.
    smart_worker: Mutex<Option<JoinHandle<()>>>,
    /// Smart Turn jobs not yet judged.
    judging: Mutex<usize>,
    judged: Condvar,
    kokoro: Mutex<Kokoro>,
    kokoro_ready: Condvar,
}

/// The engine `:voice` keeps for its life: the models, the playback, the call.
pub struct Engine {
    shared: Arc<Shared>,
    settler: Option<JoinHandle<()>>,
}

impl Engine {
    /// `host` gets the device controls, `clock` stamps what has no stamp of
    /// its own, `emit` takes every event (with the state locked: no blocking).
    pub fn new(host: Arc<dyn AudioHost>, clock: Arc<dyn Clock>, emit: Emit) -> Self {
        let shared = Arc::new(Shared {
            host,
            clock,
            emit,
            front: Mutex::new(Front { vad: None, pending: Vec::new(), audio: Vec::new(), base: 0, total: 0 }),
            state: Mutex::new(State {
                playback: Playback::new(),
                call: None,
                next_call: 1,
                audio: Audio::Closed,
                loaded: None,
                recogniser: None,
                smart: None,
                shutdown: false,
            }),
            samples: Condvar::new(),
            settle: Condvar::new(),
            smart_worker: Mutex::new(None),
            judging: Mutex::new(0),
            judged: Condvar::new(),
            kokoro: Mutex::new(Kokoro::Empty),
            kokoro_ready: Condvar::new(),
        });
        let weak = Arc::downgrade(&shared);
        let settler = thread::Builder::new().name("settler".into()).spawn(move || settler(weak)).expect("spawn settler");
        Self { shared, settler: Some(settler) }
    }

    /// `Open`: load what is not loaded yet and start a call. Silero and Smart
    /// Turn load here; Qwen and Kokoro load behind it, and a turn that ends
    /// before Qwen is up waits for it. A call still up is `released` first.
    /// A failure is `state failed` and the error (`NOT_DOWNLOADED` for a
    /// missing file), which the main process refuses `start_conversation`
    /// with, as ConversationRun's start does.
    pub fn open(&self, paths: &ModelPaths, threads: Threads) -> Result<(), String> {
        self.shared.end_call("released");
        if !paths.missing().is_empty() {
            return Err(self.fail(NOT_DOWNLOADED));
        }
        let kept = self.shared.state.lock().unwrap().loaded.as_ref() == Some(paths);
        if kept {
            return self.shared.begin_call();
        }
        let vad = vad::Silero::load(&paths.silero).map_err(|e| self.fail(&e))?;
        let end = smart_turn::SmartTurn::load(&paths.smart_turn, threads.smart_turn).map_err(|e| self.fail(&e))?;
        let recogniser = Arc::new(asr::Recogniser::spawn(&paths.asr_model, &paths.asr_mmproj, threads.asr));
        self.load_kokoro(paths.kokoro_model.clone(), threads.kokoro);
        self.shared.install(Listeners { vad: Box::new(vad), end_of_turn: Box::new(end), recogniser });
        self.shared.state.lock().unwrap().loaded = Some(paths.clone());
        self.shared.begin_call()
    }

    /// Start a call on models given here rather than loaded from files.
    pub fn open_with(&self, models: Listeners) -> Result<(), String> {
        self.shared.end_call("released");
        self.shared.install(models);
        self.shared.state.lock().unwrap().loaded = None;
        self.shared.begin_call()
    }

    /// `Close`: hang up and let the microphone go; the models stay.
    pub fn close(&self) {
        self.shared.end_call("closed");
    }

    /// The start did not complete: `state failed` on turn 0, as
    /// ConversationRun's `stop(reason: "failed")` sends it, without the
    /// message, which is the error's.
    fn fail(&self, message: &str) -> String {
        let _st = self.shared.state.lock().unwrap();
        let mut e = ConversationEvent::new("state", 0);
        e.running = Some(false);
        e.reason = Some("failed".into());
        (self.shared.emit)(Out::Conversation(e));
        message.to_string()
    }

    fn load_kokoro(&self, model: PathBuf, threads: usize) {
        *self.shared.kokoro.lock().unwrap() = Kokoro::Loading;
        let weak = Arc::downgrade(&self.shared);
        thread::Builder::new()
            .name("kokoro-load".into())
            .spawn(move || {
                let loaded = kokoro_onnx::engine::Engine::load(&model, threads);
                if let Some(sh) = weak.upgrade() {
                    *sh.kokoro.lock().unwrap() = match loaded {
                        Ok(e) => Kokoro::Ready(Arc::new(Mutex::new(e))),
                        Err(e) => Kokoro::Failed(e),
                    };
                    sh.kokoro_ready.notify_all();
                }
            })
            .expect("spawn kokoro loader");
    }

    /// Kokoro for `Synthesize`, once its background load is done.
    pub fn kokoro(&self) -> Result<KokoroEngine, String> {
        let mut k = self.shared.kokoro.lock().unwrap();
        loop {
            match &*k {
                Kokoro::Loading => k = self.shared.kokoro_ready.wait(k).unwrap(),
                Kokoro::Ready(e) => return Ok(Arc::clone(e)),
                Kokoro::Failed(e) => return Err(e.clone()),
                Kokoro::Empty => return Err("Kokoro is not loaded: no call has opened.".into()),
            }
        }
    }

    // --- The device side (host.rs's table) ---------------------------------

    /// One microphone buffer, 16 kHz mono; `time_ns` is when its last sample
    /// was captured.
    pub fn capture(&self, pcm: &[i16], time_ns: i64) {
        self.shared.capture(pcm, time_ns)
    }

    /// Up to `buf.len()` samples for the track, waiting at most `wait` for
    /// some. 0: none yet. -1: `pause()` + `flush()` the track first; it counts
    /// its frames from zero again after that.
    pub fn read_playback(&self, buf: &mut [i16], wait: Duration) -> i32 {
        self.shared.read_playback(buf, wait)
    }

    /// AudioTrack.getTimestamp: `frames` (since the last flush) heard at `time_ns`.
    pub fn playback_position(&self, frames: i64, time_ns: i64) {
        let sh = &self.shared;
        let mut st = sh.state.lock().unwrap();
        st.playback.report(frames, time_ns, sh.clock.now_ns());
        sh.effects(&mut st);
    }

    /// The system took something away: `focus-lost` (a phone call) ends the
    /// call as `interrupted`; `silenced`, `input-lost`, `app-stopped` as `lost`.
    pub fn audio_event(&self, kind: &str) {
        let reason = if kind == "focus-lost" { "interrupted" } else { "lost" };
        self.shared.end_call(reason);
        let sh = &self.shared;
        let mut st = sh.state.lock().unwrap();
        st.playback.lost();
        sh.effects(&mut st);
    }

    /// Step the machine with silence when the microphone has gone quiet
    /// (SpeechOut's clock timer). `start_ticker` calls it every 250 ms.
    pub fn tick(&self) {
        self.shared.tick()
    }

    pub fn start_ticker(&self) -> JoinHandle<()> {
        let weak = Arc::downgrade(&self.shared);
        thread::spawn(move || loop {
            thread::sleep(TICK);
            match weak.upgrade() {
                Some(sh) if !sh.state.lock().unwrap().shutdown => sh.tick(),
                _ => return,
            }
        })
    }

    /// Wait until Smart Turn has judged every pause sent to it. For a device
    /// on a fast-forward clock, which would otherwise outrun the model.
    pub fn quiesce(&self) {
        let mut n = self.shared.judging.lock().unwrap();
        while *n > 0 {
            n = self.shared.judged.wait(n).unwrap();
        }
    }

    // --- The main process's side -------------------------------------------

    /// `Enqueue` (`Voice::enqueue_speech`): 24 kHz PCM for one sentence or a
    /// piece of one. The marks are measurement and are not kept.
    #[allow(clippy::too_many_arguments)]
    pub fn enqueue(
        &self,
        utterance: u64,
        index: u32,
        chars: u32,
        last: bool,
        part: u32,
        complete: bool,
        sample_rate: u32,
        pcm: &[i16],
    ) -> Result<SpeechEnqueued, String> {
        let sh = &self.shared;
        let mut st = sh.state.lock().unwrap();
        let now = sh.clock.now_ns();
        let ack = st.playback.enqueue(now, utterance, index, chars, last, part, complete, sample_rate, pcm);
        sh.effects(&mut st);
        sh.samples.notify_all();
        ack
    }

    /// `Finish`: the turn has no more sentences.
    pub fn finish_speech(&self, utterance: u64) {
        let sh = &self.shared;
        let mut st = sh.state.lock().unwrap();
        st.playback.finish(utterance, sh.clock.now_ns());
        sh.effects(&mut st);
    }

    /// `StopSpeaking`: where the voice was, then silence.
    pub fn stop_speaking(&self, reason: &str) -> SpeechPosition {
        let sh = &self.shared;
        let mut st = sh.state.lock().unwrap();
        let at = st.playback.stop(reason, sh.clock.now_ns());
        sh.effects(&mut st);
        sh.samples.notify_all();
        at
    }

    /// `SetVolume`.
    pub fn set_volume(&self, value: f64) {
        let sh = &self.shared;
        let mut st = sh.state.lock().unwrap();
        st.playback.set_volume(value);
        sh.effects(&mut st);
    }

    pub fn position(&self) -> Option<SpeechPosition> {
        let st = self.shared.state.lock().unwrap();
        st.playback.position(self.shared.clock.now_ns())
    }
}

impl Drop for Engine {
    fn drop(&mut self) {
        self.shared.end_call("closed");
        let smart = {
            let mut st = self.shared.state.lock().unwrap();
            st.shutdown = true;
            st.smart.take()
        };
        drop(smart);
        self.shared.settle.notify_all();
        self.shared.samples.notify_all();
        let worker = self.shared.smart_worker.lock().unwrap().take();
        if let Some(w) = worker {
            let _ = w.join();
        }
        if let Some(s) = self.settler.take() {
            let _ = s.join();
        }
    }
}

fn settler(weak: Weak<Shared>) {
    let Some(sh) = weak.upgrade() else { return };
    let mut st = sh.state.lock().unwrap();
    loop {
        if st.shutdown {
            return;
        }
        let Some((call, number, waiter)) = take_settle(&mut st) else {
            st = sh.settle.wait(st).unwrap();
            continue;
        };
        drop(st);
        let result = waiter();
        st = sh.state.lock().unwrap();
        sh.settled(&mut st, call, number, result);
    }
}

/// The front ending turn's job, submitted now if it was held back.
fn take_settle(st: &mut State) -> Option<(u64, u64, Waiter)> {
    let call = st.call.as_mut()?;
    let front = call.ending.front_mut()?;
    if front.in_flight {
        return None;
    }
    front.in_flight = true;
    let waiter = match (front.waiter.take(), front.pcm.take()) {
        (Some(w), _) => w,
        (None, Some(pcm)) => call.recogniser.submit(pcm),
        (None, None) => Box::new(|| Ok(Some(String::new()))),
    };
    Some((call.id, front.number, waiter))
}

fn level_value(db: f64) -> f64 {
    let v = (db - QUIET_DB) / (LOUD_DB - QUIET_DB);
    if v.is_finite() {
        v.clamp(0.0, 1.0)
    } else {
        0.0
    }
}

impl Shared {
    fn now_ms(&self) -> f64 {
        self.clock.now_ns() as f64 / 1e6
    }

    /// A conversation event, or held behind the turn still being recognised.
    fn send(&self, st: &mut State, e: ConversationEvent) {
        if let Some(last) = st.call.as_mut().and_then(|c| c.ending.back_mut()) {
            last.after.push(e);
            return;
        }
        (self.emit)(Out::Conversation(e));
    }

    /// Act on what the playback asked for.
    fn effects(&self, st: &mut State) {
        let now_ms = self.now_ms();
        for effect in std::mem::take(&mut st.playback.effects) {
            match effect {
                Effect::Speech { kind, value, reason } => {
                    (self.emit)(Out::Speech(SpeechEvent { kind: kind.into(), value, reason }))
                }
                Effect::Host(c) => self.host.control(c),
                Effect::Started => {
                    if let Some(c) = st.call.as_mut() {
                        c.turn.playback_started(now_ms);
                    }
                }
                Effect::Stopped => {
                    if let Some(c) = st.call.as_mut() {
                        c.turn.playback_stopped(now_ms);
                    }
                }
                Effect::Spoken { utterance, reason } => {
                    let Some(turn) = st.call.as_ref().map(|c| c.number) else { continue };
                    let mut e = ConversationEvent::new("spoken", turn);
                    e.reason = Some(reason);
                    e.utterance = Some(utterance);
                    self.send(st, e);
                }
                Effect::Envelope { utterance, index, starts_in_ms, values } => {
                    let Some(turn) = st.call.as_ref().map(|c| c.number) else { continue };
                    let mut e = ConversationEvent::new("envelope", turn);
                    e.utterance = Some(utterance);
                    e.sentence = Some(index);
                    e.starts_in_ms = Some(starts_in_ms);
                    e.window_ms = Some(ENVELOPE_WINDOW_MS);
                    e.values = Some(values);
                    self.send(st, e);
                }
            }
        }
        self.sync_audio(st);
    }

    /// Open what the call or the voice needs, close what neither does.
    fn sync_audio(&self, st: &mut State) {
        let want = if st.call.is_some() {
            Audio::Capture
        } else if st.playback.is_speaking() {
            Audio::Play
        } else {
            Audio::Closed
        };
        if want == st.audio {
            return;
        }
        match want {
            Audio::Closed => {
                self.host.control(HostControl::CloseAudio);
                st.playback.track_closed();
            }
            Audio::Play => self.host.control(HostControl::OpenAudio { capture: false }),
            Audio::Capture => self.host.control(HostControl::OpenAudio { capture: true }),
        }
        st.audio = want;
    }

    /// Keep these models for this and later calls. The old Smart Turn worker
    /// may be judging, and so about to take `state`: its sender comes out
    /// under the lock, and the wait for it to finish holds none. The old
    /// recogniser goes the same way, since dropping it joins its thread.
    fn install(self: &Arc<Self>, models: Listeners) {
        self.end_call("closed");
        self.front.lock().unwrap().vad = Some(models.vad);
        let (tx, rx) = mpsc::channel::<SmartJob>();
        let weak = Arc::downgrade(self);
        let mut model = models.end_of_turn;
        let worker = thread::Builder::new()
            .name("smart-turn".into())
            .spawn(move || {
                while let Ok(job) = rx.recv() {
                    let p = model.probability(&job.audio).unwrap_or_else(|e| {
                        eprintln!("voice-engine: {e}");
                        f32::NAN
                    });
                    let Some(sh) = weak.upgrade() else { return };
                    {
                        let mut st = sh.state.lock().unwrap();
                        sh.judge(&mut st, &job, p);
                    }
                    *sh.judging.lock().unwrap() -= 1;
                    sh.judged.notify_all();
                }
            })
            .expect("spawn smart turn");
        let (old_tx, old_recogniser) = {
            let mut st = self.state.lock().unwrap();
            (st.smart.replace(tx), st.recogniser.replace(models.recogniser))
        };
        drop(old_tx);
        drop(old_recogniser);
        let old_worker = self.smart_worker.lock().unwrap().replace(worker);
        if let Some(w) = old_worker {
            let _ = w.join();
        }
    }

    fn begin_call(&self) -> Result<(), String> {
        self.end_call("released");
        let mut front = self.front.lock().unwrap();
        let mut st = self.state.lock().unwrap();
        let (Some(vad), Some(recogniser)) = (front.vad.as_mut(), st.recogniser.clone()) else {
            return Err("The voice models are not loaded.".into());
        };
        vad.reset();
        front.pending.clear();
        front.audio.clear();
        front.base = 0;
        front.total = 0;
        let id = st.next_call;
        st.next_call += 1;
        let mut turn = TurnDetector::new(&NEURAL_TURN_DETECT);
        let now_ms = self.now_ms();
        if st.playback.is_speaking() {
            turn.playback_started(now_ms);
        }
        st.call = Some(Call {
            id,
            turn,
            number: 0,
            duck_start: 0,
            open: None,
            prev_loud: false,
            last_step_ms: now_ms,
            last_level_ms: f64::NEG_INFINITY,
            recogniser,
            job: None,
            deferred: None,
            ending: VecDeque::new(),
        });
        self.sync_audio(&mut st);
        let mut e = ConversationEvent::new("state", 0);
        e.running = Some(true);
        e.reason = Some("opened".into());
        (self.emit)(Out::Conversation(e));
        Ok(())
    }

    /// Hang up. A turn on the floor or still being recognised goes down with
    /// the call; what was held behind it goes out, then `state` says why.
    fn end_call(&self, reason: &str) {
        let mut front = self.front.lock().unwrap();
        let mut st = self.state.lock().unwrap();
        let Some(call) = st.call.take() else { return };
        call.recogniser.cancel();
        for ending in call.ending {
            for e in ending.after {
                (self.emit)(Out::Conversation(e));
            }
        }
        st.playback.detach();
        self.effects(&mut st);
        let mut e = ConversationEvent::new("state", call.number);
        e.running = Some(false);
        e.reason = Some(reason.into());
        (self.emit)(Out::Conversation(e));
        front.pending.clear();
        front.audio.clear();
        front.base = 0;
        front.total = 0;
    }

    fn capture(&self, pcm: &[i16], time_ns: i64) {
        let mut front = self.front.lock().unwrap();
        let front = &mut *front;
        if front.vad.is_none() {
            return;
        }
        front.pending.extend(pcm.iter().map(|&s| s as f32 / 32768.0));
        let frames = front.pending.len() / FRAME;
        for k in 0..frames {
            let mut frame = [0f32; FRAME];
            frame.copy_from_slice(&front.pending[k * FRAME..(k + 1) * FRAME]);
            let speech = match front.vad.as_mut().map(|v| v.probability(&frame)) {
                Some(Ok(p)) => p as f64,
                _ => f64::NAN,
            };
            front.audio.extend_from_slice(&frame);
            front.total += FRAME as u64;
            let behind = front.pending.len() - (k + 1) * FRAME;
            let at_ms = time_ns as f64 / 1e6 - behind as f64 / RATE * 1000.0;
            let db = trailing_level_db(&front.audio, front.audio.len(), LEVEL_SAMPLES);
            let sum: f64 = frame.iter().map(|&s| s as f64 * s as f64).sum();
            let frame_db = 10.0 * (sum / FRAME as f64).log10();
            self.step(front, db, at_ms, speech, Some(frame_db));
        }
        front.pending.drain(..frames * FRAME);
    }

    fn tick(&self) {
        let mut front = self.front.lock().unwrap();
        let now = self.now_ms();
        let stale = {
            let st = self.state.lock().unwrap();
            st.call.as_ref().is_some_and(|c| now - c.last_step_ms >= STALL_MS)
        };
        if stale {
            self.step(&mut front, f64::NEG_INFINITY, now, f64::NAN, None);
        }
    }

    /// One frame (or a silent tick) into the machine, and everything it says.
    fn step(&self, front: &mut Front, db: f64, at_ms: f64, speech: f64, frame_db: Option<f64>) {
        let mut guard = self.state.lock().unwrap();
        let st = &mut *guard;
        let Some(call) = st.call.as_mut() else { return };
        let end = front.total;
        call.last_step_ms = at_ms;
        let event = call.turn.step_speech(db, at_ms, speech);
        let snap = call.turn.snapshot();
        let loud = snap.phase == TurnPhase::Speaking && snap.last_voice_ms == at_ms;

        // Steps 1 and 4, for a turn already on the floor.
        if let Some(open) = &call.open {
            if !loud && call.prev_loud {
                let pcm = front.slice(open.start.saturating_sub(ASR_PREROLL), end);
                if call.ending.is_empty() {
                    call.job = Some((open.number, call.recogniser.submit(pcm)));
                } else {
                    call.job = None;
                    call.deferred = Some((open.number, pcm));
                }
            } else if loud && !call.prev_loud {
                if call.deferred.as_ref().is_some_and(|d| d.0 == open.number) {
                    call.deferred = None;
                }
                if call.job.as_ref().is_some_and(|j| j.0 == open.number) {
                    call.recogniser.cancel();
                    call.job = None;
                }
            }
        }
        call.prev_loud = loud;

        if let Some(frame_db) = frame_db {
            if at_ms - call.last_level_ms >= LEVEL_INTERVAL_MS {
                call.last_level_ms = at_ms;
                let mut e = ConversationEvent::new("level", call.number);
                e.value = Some(level_value(frame_db));
                self.send(st, e);
            }
        }

        let call = st.call.as_mut().unwrap();
        match event {
            Some(TurnEvent::Duck) => call.duck_start = end.saturating_sub(FRAME as u64),
            Some(TurnEvent::Pause { .. }) => {
                if let Some(open) = &call.open {
                    let audio = front.slice(open.start.saturating_sub(SMART_TURN_PREROLL), end);
                    let job = SmartJob { call: call.id, paused_at_ms: at_ms, audio };
                    if let Some(tx) = &st.smart {
                        *self.judging.lock().unwrap() += 1;
                        if tx.send(job).is_err() {
                            *self.judging.lock().unwrap() -= 1;
                        }
                    }
                }
            }
            _ => {}
        }
        if let Some(event) = event {
            self.act(st, event);
        }

        // Keep the open turn's audio, or a second behind a quiet call.
        let call = st.call.as_ref().unwrap();
        let keep = match (&call.open, snap.phase) {
            (Some(open), _) => open.start.saturating_sub(ASR_PREROLL),
            (None, TurnPhase::Ducked) => call.duck_start.saturating_sub(ASR_PREROLL),
            _ => end.saturating_sub(IDLE_KEEP),
        };
        if keep > front.base + TRIM_SLACK {
            front.audio.drain(..(keep - front.base) as usize);
            front.base = keep;
        }
    }

    /// A verdict acts on the playback, then says so.
    fn act(&self, st: &mut State, event: TurnEvent) {
        let now = self.clock.now_ns();
        match event {
            TurnEvent::Duck => {
                st.playback.duck(true);
                self.effects(st);
                let turn = st.call.as_ref().map_or(0, |c| c.number);
                self.send(st, ConversationEvent::new("speech-duck", turn));
            }
            TurnEvent::Resume => {
                st.playback.duck(false);
                self.effects(st);
                let turn = st.call.as_ref().map_or(0, |c| c.number);
                self.send(st, ConversationEvent::new("speech-resume", turn));
            }
            TurnEvent::Stop => {
                let (cut, refusal) = st.playback.cut(now);
                let Some(call) = st.call.as_mut() else { return };
                call.number += 1;
                call.open = Some(OpenTurn { number: call.number, start: call.duck_start, refusal });
                call.prev_loud = true;
                let mut e = ConversationEvent::new("speech-stop", call.number);
                if let Some(c) = cut.filter(|c| c.index >= 0) {
                    e.cut = Some(SpeechCut {
                        utterance: c.utterance,
                        sentence: c.index,
                        char_offset: c.char_offset,
                        played_ms: c.played_ms,
                    });
                }
                self.send(st, e);
                self.effects(st);
                self.samples.notify_all();
            }
            TurnEvent::End { silent_ms } => {
                let Some(call) = st.call.as_mut() else { return };
                let Some(open) = call.open.take() else { return };
                let waiter = match call.job.take() {
                    Some((n, w)) if n == open.number => Some(w),
                    _ => None,
                };
                let pcm = match call.deferred.take() {
                    Some((n, p)) if n == open.number => Some(p),
                    _ => None,
                };
                call.ending.push_back(Ending {
                    number: open.number,
                    silent_ms,
                    refusal: open.refusal,
                    waiter,
                    pcm,
                    in_flight: false,
                    after: Vec::new(),
                });
                self.settle.notify_all();
            }
            TurnEvent::Pause { .. } => {}
        }
    }

    /// Smart Turn's answer about the pause announced at `paused_at_ms`.
    fn judge(&self, st: &mut State, job: &SmartJob, p: f32) {
        let now_ms = self.now_ms();
        let Some(call) = st.call.as_mut().filter(|c| c.id == job.call) else { return };
        if !(p > smart_turn::THRESHOLD) {
            return;
        }
        if let Some(event) = call.turn.complete(job.paused_at_ms, now_ms) {
            self.act(st, event);
        }
    }

    /// The front ending turn's text is in: its `speech-end`, then what was held.
    fn settled(&self, st: &mut State, call_id: u64, number: u64, result: Result<Option<String>, String>) {
        let Some(call) = st.call.as_mut().filter(|c| c.id == call_id) else { return };
        if call.ending.front().map(|e| e.number) != Some(number) {
            return;
        }
        let ending = call.ending.pop_front().unwrap();
        let text = match result {
            Ok(t) => t.unwrap_or_default(),
            Err(e) => {
                eprintln!("voice-engine: recognition failed: {e}");
                String::new()
            }
        };
        if call.ending.is_empty() {
            if let Some((n, pcm)) = call.deferred.take() {
                call.job = Some((n, call.recogniser.submit(pcm)));
            }
        }
        let mut e = ConversationEvent::new("speech-end", number);
        e.text = Some(text);
        e.silent_ms = Some(ending.silent_ms);
        (self.emit)(Out::Conversation(e));
        for e in ending.after {
            (self.emit)(Out::Conversation(e));
        }
        st.playback.user_turn_ended(ending.refusal);
        self.effects(st);
        self.settle.notify_all();
    }

    fn read_playback(&self, buf: &mut [i16], wait: Duration) -> i32 {
        let deadline = Instant::now() + wait;
        let mut st = self.state.lock().unwrap();
        while !st.playback.readable() && !st.shutdown {
            let left = deadline.saturating_duration_since(Instant::now());
            if left.is_zero() {
                break;
            }
            st = self.samples.wait_timeout(st, left).unwrap().0;
        }
        let n = st.playback.read(buf, self.clock.now_ns());
        self.effects(&mut st);
        n
    }
}
