// The Android socket end to end (docs/companion/89, 切片 5), in one process:
// the plugin's half (SpeechSession, RemoteSynth, EngineLink) on one end of a
// UnixStream pair, the engine's serve loop on a virtual device on the other.
// Channels stand in for the webview. The fake group runs everywhere; the real
// group loads the models from `VOICE_MODELS` (the download directory's layout)
// and is skipped when that is unset or incomplete.

#![cfg(unix)]

use std::fs;
use std::net::Shutdown;
use std::os::unix::net::UnixStream;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant};

use tauri::ipc::{Channel, InvokeResponseBody};
use tauri_plugin_voice::engine_link::{EngineLink, Pipe, EXITED};
use tauri_plugin_voice::kokoro::download::{self, Downloader};
use tauri_plugin_voice::kokoro::manifest::{self, Variant};
use tauri_plugin_voice::tts::kokoro::NOT_DOWNLOADED_CALL;
use tauri_plugin_voice::{DeviceSpeakers, SpeechSession};
use voice_engine::call::{
    self, EndOfTurn, Engine, Listeners, ModelPaths, Out, Recognise, Threads as EngineThreads, Vad, Waiter,
};
use voice_engine::serve::{Models, OnDisk, Outlet, Server};
use voice_engine::virtual_device::{VirtualDevice, MIC_FRAME};
use voice_wire::{ConversationEvent, SpeechEvent, Threads};

const WAIT: Duration = Duration::from_secs(20);
/// What the fake recogniser hears in anything.
const SAID: &str = "你好";
/// The relay's pause after a sentence (RelayConfig::default).
const GAP_MS: f64 = 160.0;

// --- The engine's fake models ---------------------------------------------------

/// Holds whoever passes until it is opened.
struct Gate {
    open: Mutex<bool>,
    opened: Condvar,
    arrived: AtomicUsize,
    passed: AtomicUsize,
}

impl Gate {
    fn new(open: bool) -> Self {
        Self { open: Mutex::new(open), opened: Condvar::new(), arrived: AtomicUsize::new(0), passed: AtomicUsize::new(0) }
    }

    fn pass(&self) {
        self.arrived.fetch_add(1, Ordering::SeqCst);
        let mut open = self.open.lock().unwrap();
        while !*open {
            open = self.opened.wait(open).unwrap();
        }
        self.passed.fetch_add(1, Ordering::SeqCst);
    }

    fn release(&self) {
        *self.open.lock().unwrap() = true;
        self.opened.notify_all();
    }
}

/// A tone is speech and a pause ends the turn.
struct Loud;
impl Vad for Loud {
    fn reset(&mut self) {}
    fn probability(&mut self, frame: &[f32]) -> Result<f32, String> {
        let rms = (frame.iter().map(|s| s * s).sum::<f32>() / frame.len().max(1) as f32).sqrt();
        Ok(if rms > 0.05 { 1.0 } else { 0.0 })
    }
}
struct Finished;
impl EndOfTurn for Finished {
    fn probability(&mut self, _: &[f32]) -> Result<f32, String> {
        Ok(1.0)
    }
}
struct Says;
impl Recognise for Says {
    fn submit(&self, _: Vec<f32>) -> Waiter {
        Box::new(|| Ok(Some(SAID.to_string())))
    }
    fn cancel(&self) {}
}

/// Kokoro's stand-in answers a square wave, 100 ms per phoneme character.
fn square(n: usize) -> Vec<f32> {
    (0..n).map(|i| if (i / 27) % 2 == 0 { 0.5 } else { -0.5 }).collect()
}

struct Fake {
    open: Gate,
    synth: Gate,
    /// The model path and sample count of every synthesis.
    synthesized: Mutex<Vec<(PathBuf, usize)>>,
}

impl Fake {
    fn new(open: bool) -> Arc<Self> {
        Arc::new(Self { open: Gate::new(open), synth: Gate::new(open), synthesized: Mutex::new(Vec::new()) })
    }
}

impl Models for Fake {
    fn open(&self, engine: &Engine, _: &ModelPaths, _: EngineThreads) -> Result<(), String> {
        self.open.pass();
        engine.open_with(Listeners { vad: Box::new(Loud), end_of_turn: Box::new(Finished), recogniser: Arc::new(Says) })
    }

    fn synthesize(&self, _: &Engine, model: &Path, phonemes: &str, style: &[f32], _: f32) -> Result<Vec<f32>, String> {
        self.synth.pass();
        assert_eq!(style.len(), 256);
        let n = phonemes.chars().count() * 2400;
        self.synthesized.lock().unwrap().push((model.to_path_buf(), n));
        Ok(square(n))
    }
}

// --- The webview's end -----------------------------------------------------------

/// Every channel message as (event, JSON), and the test's own marks, in the
/// order they happened.
#[derive(Default)]
struct Webview {
    log: Mutex<Vec<(String, String)>>,
    more: Condvar,
}

impl Webview {
    fn listen(self: &Arc<Self>, link: &EngineLink, event: &str) {
        let (me, name) = (Arc::clone(self), event.to_string());
        let channel = Channel::new(move |body| {
            let json = match body {
                InvokeResponseBody::Json(json) => json,
                InvokeResponseBody::Raw(bytes) => String::from_utf8(bytes).unwrap(),
            };
            me.push(&name, json);
            Ok(())
        });
        link.listeners().register(event.to_string(), channel);
    }

    fn push(&self, event: &str, body: String) {
        self.log.lock().unwrap().push((event.to_string(), body));
        self.more.notify_all();
    }

    fn mark(&self, what: &str) {
        self.push("mark", what.to_string());
    }

    fn log(&self) -> Vec<(String, String)> {
        self.log.lock().unwrap().clone()
    }

    fn conversation(&self) -> Vec<ConversationEvent> {
        self.of("conversation")
    }

    fn speech(&self) -> Vec<SpeechEvent> {
        self.of("speech")
    }

    fn of<T: serde::de::DeserializeOwned>(&self, event: &str) -> Vec<T> {
        self.log().iter().filter(|(e, _)| e == event).map(|(_, j)| serde_json::from_str(j).unwrap()).collect()
    }

    fn wait(&self, what: &str, done: impl Fn(&Webview) -> bool) {
        let deadline = Instant::now() + WAIT;
        let mut log = self.log.lock().unwrap();
        loop {
            drop(log);
            if done(self) {
                return;
            }
            log = self.log.lock().unwrap();
            let left = deadline.saturating_duration_since(Instant::now());
            assert!(!left.is_zero(), "timed out waiting for {what}; the webview got {:#?}", *log);
            log = self.more.wait_timeout(log, left.min(Duration::from_millis(50))).unwrap().0;
        }
    }
}

fn is_state(e: &ConversationEvent, reason: &str) -> bool {
    e.kind == "state" && e.reason.as_deref() == Some(reason)
}

fn failed(turn: u64) -> ConversationEvent {
    let mut e = ConversationEvent::new("state", turn);
    e.running = Some(false);
    e.reason = Some("failed".into());
    e
}

fn engine_conversation(device: &VirtualDevice) -> Vec<ConversationEvent> {
    device.events.all().into_iter().filter_map(|(_, o)| if let Out::Conversation(e) = o { Some(e) } else { None }).collect()
}

fn engine_speech(device: &VirtualDevice) -> Vec<SpeechEvent> {
    device.events.all().into_iter().filter_map(|(_, o)| if let Out::Speech(e) = o { Some(e) } else { None }).collect()
}

// --- The rig ---------------------------------------------------------------------

/// A directory removed when the test ends.
struct Scratch(PathBuf);

impl Scratch {
    fn new(name: &str) -> Self {
        let dir = std::env::temp_dir().join(format!("voice-e2e-{}-{name}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        Self(dir)
    }
}

impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

/// The Kokoro pack as `is_ready` sees it, sparse: the fake synthesiser never
/// reads the model, and an all-zero voice is a valid style table.
fn fake_kokoro(models: &Downloader) {
    let files = std::iter::once(Variant::Fp32.file()).chain(manifest::VOICES.iter().map(|(_, f)| *f));
    for file in files {
        let path = models.path_of(&file);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::File::create(&path).unwrap().set_len(file.size).unwrap();
    }
    assert!(models.is_ready(Variant::Fp32));
}

struct Rig {
    device: VirtualDevice,
    link: Arc<EngineLink>,
    session: SpeechSession,
    models: Arc<Downloader>,
    webview: Arc<Webview>,
    /// Connections the link has made; Kotlin's `openEngine` calls.
    connects: Arc<AtomicUsize>,
    /// The engine's end of the current connection, to cut it as `:voice`
    /// dying would.
    engine_end: Arc<Mutex<Option<UnixStream>>>,
    rt: tokio::runtime::Runtime,
    _scratch: Option<Scratch>,
}

impl Rig {
    /// `models` behind the engine; `dir` the download directory.
    fn new(engine_models: Arc<dyn Models>, dir: &Path, scratch: Option<Scratch>) -> Self {
        let outlet = Outlet::new();
        let device = VirtualDevice::with_emit(outlet.emit());
        let server = Server::new(Arc::clone(&device.engine), outlet, engine_models);
        let connects = Arc::new(AtomicUsize::new(0));
        let engine_end: Arc<Mutex<Option<UnixStream>>> = Arc::default();
        let (n, end) = (Arc::clone(&connects), Arc::clone(&engine_end));
        let link = EngineLink::new(Box::new(move || {
            let (main, engine) = UnixStream::pair().map_err(|e| e.to_string())?;
            *end.lock().unwrap() = Some(engine.try_clone().map_err(|e| e.to_string())?);
            server.attach_stream(engine).map_err(|e| e.to_string())?;
            n.fetch_add(1, Ordering::SeqCst);
            Pipe::unix(main).map_err(|e| e.to_string())
        }));
        let models = Arc::new(Downloader::at(dir, download::listen_files()));
        let session =
            SpeechSession::from_env(Arc::new(DeviceSpeakers::new(Arc::clone(&link))), &models, Some(Arc::clone(&link)));
        let rt = tokio::runtime::Builder::new_multi_thread().worker_threads(2).enable_all().build().unwrap();
        Self { device, link, session, models, webview: Arc::default(), connects, engine_end, rt, _scratch: scratch }
    }

    fn fake(name: &str, fake: &Arc<Fake>) -> Self {
        let scratch = Scratch::new(name);
        let dir = scratch.0.join("voice-models");
        let rig = Self::new(fake.clone(), &dir, Some(scratch));
        fake_kokoro(&rig.models);
        rig
    }

    /// `:voice` goes: the socket closes under both ends.
    fn kill(&self) {
        let end = self.engine_end.lock().unwrap().take().expect("a connection to cut");
        end.shutdown(Shutdown::Both).unwrap();
    }

    /// One turn through the four commands' session calls.
    fn say(&self, text: &str) -> u64 {
        self.rt.block_on(async {
            let utterance = self.session.begin().await.unwrap();
            self.session.push(text.to_string()).await.unwrap();
            self.session.close().await.unwrap();
            utterance
        })
    }
}

/// Step the device in real time until `done`.
fn play_until(device: &mut VirtualDevice, what: &str, timeout: Duration, mut done: impl FnMut(&VirtualDevice) -> bool) {
    let deadline = Instant::now() + timeout;
    while !done(device) {
        assert!(Instant::now() < deadline, "timed out playing until {what}");
        device.step(&[0; MIC_FRAME]);
        std::thread::sleep(Duration::from_millis(1));
    }
}

/// Samples the square wave put through the track: every one is loud.
fn loud(heard: &[f32]) -> usize {
    heard.iter().filter(|s| s.abs() > 0.25).count()
}

fn ms(samples: usize) -> f64 {
    samples as f64 / 24.0
}

/// A square tone for the microphone, 16 kHz.
fn mic_tone(ms: usize) -> Vec<i16> {
    (0..ms * 16).map(|i| if (i / 20) % 2 == 0 { 8000 } else { -8000 }).collect()
}

fn speaking(webview: &Webview, value: f64) -> usize {
    webview.speech().iter().filter(|e| e.kind == "speaking" && e.value == value).count()
}

// --- The fake group --------------------------------------------------------------

#[test]
fn a_turn_synthesised_over_the_socket_is_heard_and_its_speech_events_reach_the_webview() {
    let fake = Fake::new(true);
    let mut rig = Rig::fake("speak", &fake);
    rig.webview.listen(&rig.link, "speech");

    assert_eq!(rig.say("你好，今天天气不错。"), 1);
    let webview = Arc::clone(&rig.webview);
    play_until(&mut rig.device, "the voice stops", WAIT, |_| speaking(&webview, 0.0) == 1);

    // Synthesize carried the fp32 model's path, and the engine was opened
    // once, by RemoteSynth: no call was needed to speak.
    let synthesized = fake.synthesized.lock().unwrap().clone();
    let model = rig.models.path_of(&Variant::Fp32.file());
    assert!(!synthesized.is_empty() && synthesized.iter().all(|(m, _)| *m == model), "{synthesized:?}");
    assert_eq!(rig.connects.load(Ordering::SeqCst), 1);
    assert_eq!(fake.open.arrived.load(Ordering::SeqCst), 0);
    // The wave was played whole (the trim may soften its edges).
    let n: usize = synthesized.iter().map(|(_, n)| n).sum();
    let heard = loud(&rig.device.heard);
    assert!(heard <= n && n - heard <= 240, "heard {heard} of {n}");

    let engine = engine_speech(&rig.device);
    rig.webview.wait("every speech event", |w| w.speech().len() == engine.len());
    assert_eq!(rig.webview.speech(), engine);
    let first = &engine[0];
    let last = engine.last().unwrap();
    assert_eq!((first.kind.as_str(), first.value), ("speaking", 1.0));
    assert_eq!((last.kind.as_str(), last.value, last.reason.as_deref()), ("speaking", 0.0, Some("done")));
}

#[test]
fn stop_speaking_answers_where_the_voice_was() {
    let fake = Fake::new(true);
    let mut rig = Rig::fake("stop", &fake);
    rig.webview.listen(&rig.link, "speech");

    // The `stop_speaking` command's path: the link's answer as it is.
    rig.say("这一句话说得很长，长到它说到一半的时候可以被打断。");
    play_until(&mut rig.device, "a second of the first turn", WAIT, |d| loud(&d.heard) >= 24_000);
    let heard = ms(loud(&rig.device.heard));
    let at = rig.rt.block_on(rig.link.stop_speaking("interrupted".into())).unwrap();
    assert!(at.speaking && at.utterance == 1 && at.index == 0, "{at:?}");
    assert!((at.played_ms - heard).abs() <= 32.0, "played {} ms, heard {heard} ms", at.played_ms);
    // Flushed: nothing more is heard.
    let before = loud(&rig.device.heard);
    rig.device.idle(320);
    assert_eq!(loud(&rig.device.heard), before);
    let webview = Arc::clone(&rig.webview);
    rig.webview.wait("the cut", |w| speaking(w, 0.0) == 1);
    assert_eq!(webview.speech().last().unwrap().reason.as_deref(), Some("interrupted"));

    // `speak_stop`'s path: the session turns the answer into a sentence and a
    // position in it.
    let first = fake.synthesized.lock().unwrap().len();
    rig.say("第二轮也说得足够长，长到能在中间停下来看看位置。");
    play_until(&mut rig.device, "half a second of the second turn", WAIT, |d| loud(&d.heard) >= before + 12_000);
    let heard = ms(loud(&rig.device.heard) - before);
    let stopped = rig.rt.block_on(rig.session.stop()).unwrap();
    let n: usize = fake.synthesized.lock().unwrap()[first..].iter().map(|(_, n)| n).sum();
    assert_eq!((stopped.utterance, stopped.sentence), (2, 0), "{stopped:?}");
    assert!((stopped.position_ms - heard).abs() <= 32.0, "{stopped:?}, heard {heard} ms");
    assert!((stopped.duration_ms - (ms(n) + GAP_MS)).abs() <= 32.0, "{stopped:?}, {} ms synthesised", ms(n));

    // Nothing is playing now, and the link says so.
    let idle = rig.rt.block_on(rig.link.stop_speaking("interrupted".into())).unwrap();
    assert!(!idle.speaking && idle.index == -1, "{idle:?}");
}

#[test]
fn call_events_reach_the_webview_unchanged_and_opened_follows_the_start() {
    let fake = Fake::new(true);
    let mut rig = Rig::fake("call", &fake);
    rig.webview.listen(&rig.link, "conversation");

    rig.rt.block_on(rig.link.open(rig.models.engine_files(), Threads::default())).unwrap();
    // The engine sent `state opened` ahead of its answer; the webview has not
    // heard it: it waits for the start to resolve.
    assert!(is_state(&engine_conversation(&rig.device)[0], "opened"));
    assert!(rig.webview.conversation().is_empty());
    rig.webview.mark("start resolved");
    rig.link.begin_emitting();

    rig.device.idle(300);
    rig.device.feed(&mic_tone(800));
    rig.device.idle(1500);
    rig.device.events.wait_for(WAIT, |all| {
        all.iter().any(|(_, o)| matches!(o, Out::Conversation(e) if e.kind == "speech-end"))
    });
    rig.rt.block_on(rig.link.close()).unwrap();
    rig.webview.wait("the call to close", |w| w.conversation().iter().any(|e| is_state(e, "closed")));

    let engine = engine_conversation(&rig.device);
    assert_eq!(rig.webview.conversation(), engine);
    let end = engine.iter().find(|e| e.kind == "speech-end").unwrap();
    assert_eq!(end.text.as_deref(), Some(SAID));
    let log = rig.webview.log();
    assert_eq!(log[0], ("mark".to_string(), "start resolved".to_string()));
    let opened: ConversationEvent = serde_json::from_str(&log[1].1).unwrap();
    assert!(is_state(&opened, "opened"), "{log:?}");
    // The raw JSON is the engine's own: the fields a kind does not carry are
    // absent, as Swift sends them.
    assert_eq!(log[1].1, serde_json::to_string(&engine[0]).unwrap());
}

#[test]
fn when_the_engine_goes_waiting_requests_fail_and_the_call_reports_failed() {
    let fake = Fake::new(false);
    let rig = Rig::fake("exit", &fake);
    rig.webview.listen(&rig.link, "conversation");

    // A start and a synthesis are out when `:voice` dies.
    let link = Arc::clone(&rig.link);
    let files = rig.models.engine_files();
    let open = rig.rt.spawn(async move { link.open(files, Threads::default()).await });
    let link = Arc::clone(&rig.link);
    let model = rig.models.path_of(&Variant::Fp32.file());
    let synth = std::thread::spawn(move || link.synthesize(&model, "ni2hao3", &[0.0; 256], 1.0));
    let deadline = Instant::now() + WAIT;
    while fake.open.arrived.load(Ordering::SeqCst) == 0 || fake.synth.arrived.load(Ordering::SeqCst) == 0 {
        assert!(Instant::now() < deadline, "both requests reach the engine");
        std::thread::sleep(Duration::from_millis(2));
    }
    rig.kill();
    assert_eq!(rig.rt.block_on(open).unwrap(), Err(EXITED.to_string()));
    assert_eq!(synth.join().unwrap(), Err(EXITED.to_string()));
    // `state failed` came before the start's error.
    assert_eq!(rig.webview.conversation(), [failed(0)]);

    // The engine outlived its socket here, which `:voice` does not: let its
    // workers finish and hang up the call they started.
    fake.open.release();
    fake.synth.release();
    rig.device.events.wait_for(WAIT, |all| all.iter().any(|(_, o)| matches!(o, Out::Conversation(e) if is_state(e, "opened"))));
    rig.device.engine.close();

    // The next start connects again, and a live call that loses the engine
    // fails too.
    rig.rt.block_on(rig.link.open(rig.models.engine_files(), Threads::default())).unwrap();
    assert_eq!(rig.connects.load(Ordering::SeqCst), 2);
    rig.link.begin_emitting();
    rig.webview.wait("opened", |w| w.conversation().iter().any(|e| is_state(e, "opened")));
    rig.kill();
    rig.webview.wait("the second failure", |w| w.conversation().iter().filter(|e| is_state(e, "failed")).count() == 2);
    let after: Vec<_> = rig.webview.conversation().into_iter().skip(1).collect();
    assert_eq!(after.len(), 2, "{after:?}");
    assert!(is_state(&after[0], "opened") && after[1] == failed(after[0].turn), "{after:?}");

    // With no engine, nothing is playing and a hang-up is fine.
    let idle = rig.rt.block_on(rig.link.stop_speaking("interrupted".into())).unwrap();
    assert!(!idle.speaking && idle.index == -1);
    rig.rt.block_on(rig.link.close()).unwrap();
}

#[test]
fn a_call_without_the_downloads_is_refused_with_the_settings_sentence() {
    let scratch = Scratch::new("missing");
    let dir = scratch.0.join("voice-models");
    let rig = Rig::new(Arc::new(OnDisk), &dir, Some(scratch));
    rig.webview.listen(&rig.link, "conversation");
    let refused = rig.rt.block_on(rig.link.open(rig.models.engine_files(), Threads::default())).unwrap_err();
    assert_eq!(refused, NOT_DOWNLOADED_CALL);
    assert_eq!(rig.webview.conversation(), [failed(0)]);
}

#[test]
fn the_plugin_names_the_files_the_engine_opens() {
    assert_eq!(download::QWEN_FILE, voice_engine::asr::MODEL_FILE);
    assert_eq!(download::MMPROJ_FILE, voice_engine::asr::MMPROJ_FILE);
    assert_eq!(download::SILERO_FILE, voice_engine::vad::SILERO_FILE);
    assert_eq!(download::SMART_TURN_FILE, voice_engine::smart_turn::SMART_TURN_FILE);
    assert_eq!(NOT_DOWNLOADED_CALL, call::NOT_DOWNLOADED);
    let dir = Path::new("/data/user/0/app/no_backup/voice-models");
    let models = Downloader::at(dir, download::listen_files());
    assert_eq!(ModelPaths::from(&models.engine_files()), ModelPaths::in_dir(dir));
}

// --- The real group --------------------------------------------------------------

/// `VOICE_MODELS`, when it holds every file the call and the voice load.
fn real_dir() -> Option<PathBuf> {
    let Some(dir) = std::env::var_os("VOICE_MODELS") else {
        println!("skipped: VOICE_MODELS is not set");
        return None;
    };
    let dir = PathBuf::from(dir);
    let missing = ModelPaths::in_dir(&dir).missing();
    if !missing.is_empty() || !Downloader::at(&dir, Vec::new()).is_ready(Variant::Fp32) {
        println!("skipped: {} is missing {missing:?} or the Kokoro voices", dir.display());
        return None;
    }
    Some(dir)
}

fn clip(name: &str) -> Vec<i16> {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../voice-engine/engine/fixtures/call").join(format!("{name}.wav"));
    let b = fs::read(path).unwrap();
    assert_eq!(&b[36..40], b"data");
    assert_eq!(u32::from_le_bytes(b[24..28].try_into().unwrap()), 16_000);
    b[44..].chunks_exact(2).map(|c| i16::from_le_bytes([c[0], c[1]])).collect()
}

#[test]
fn real_models_speak_and_hear_over_the_socket() {
    let Some(dir) = real_dir() else { return };
    let real_wait = Duration::from_secs(180);
    let mut rig = Rig::new(Arc::new(OnDisk), &dir, None);
    rig.webview.listen(&rig.link, "conversation");
    rig.webview.listen(&rig.link, "speech");

    // RemoteSynth is Kokoro: the samples that come back are the ones the
    // model gives here.
    #[cfg(feature = "kokoro")]
    {
        use tauri_plugin_voice::kokoro::voice::VoicePack;
        use tauri_plugin_voice::tts::kokoro::{phonemize, speed_for, Script, VOICE};
        let model = rig.models.path_of(&Variant::Fp32.file());
        let phonemes = phonemize(Script::Chinese, "今天天气不错。").remove(0);
        let pack = VoicePack::load(&rig.models.path_of(&manifest::voice_file(VOICE).unwrap())).unwrap();
        let (style, speed) = (pack.style_for(&phonemes), speed_for(Script::Chinese, &phonemes));
        let remote = rig.link.synthesize(&model, &phonemes, style, speed).unwrap();
        let mut here = tauri_plugin_voice::kokoro::engine::Engine::load(&model, 4).unwrap();
        let local = voice_engine::serve::to_i16(&here.synthesize_style(&phonemes, style, speed).unwrap());
        assert!(remote.len() > 24_000, "{} samples", remote.len());
        assert_eq!(remote, local);
    }

    // A turn through the session is heard.
    rig.say("今天天气不错，我们出去走走吧。");
    let webview = Arc::clone(&rig.webview);
    play_until(&mut rig.device, "the voice stops", real_wait, |_| speaking(&webview, 0.0) == 1);
    let voiced = rig.device.heard.iter().filter(|s| s.abs() > 0.02).count();
    assert!(voiced > 24_000, "{voiced} voiced samples");
    assert_eq!(rig.webview.speech().last().unwrap().reason.as_deref(), Some("done"));

    // A call hears the clip, and the webview gets the engine's events.
    rig.rt.block_on(rig.link.open(rig.models.engine_files(), Threads::default())).unwrap();
    rig.link.begin_emitting();
    rig.device.idle(300);
    rig.device.feed(&clip("one"));
    rig.device.idle(1500);
    rig.device.events.wait_for(real_wait, |all| {
        all.iter().any(|(_, o)| matches!(o, Out::Conversation(e) if e.kind == "speech-end"))
    });
    rig.rt.block_on(rig.link.close()).unwrap();
    rig.webview.wait("the call to close", |w| w.conversation().iter().any(|e| is_state(e, "closed")));
    let engine = engine_conversation(&rig.device);
    assert_eq!(rig.webview.conversation(), engine);
    let said: Vec<_> = engine.iter().filter(|e| e.kind == "speech-end").filter_map(|e| e.text.clone()).collect();
    println!("heard {said:?}");
    assert!(said.len() == 1 && said[0].contains("天气"), "{said:?}");
}
