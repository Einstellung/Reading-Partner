// The call on the virtual device (docs/companion/89, 切片 4): a fast-forward
// clock, a microphone fed from buffers, a track that plays at 24 kHz into
// memory. Two groups. The fake models run everywhere: a VAD that is the
// level, an end-of-turn model that is a closure, a recogniser on its own
// thread that says one word per tone. The real models run when `VOICE_MODELS`
// holds the download directory's layout, on the Kokoro clips in
// fixtures/call/ (make_call_fixtures.py).

use std::path::PathBuf;
use std::sync::mpsc;
use std::sync::{Arc, Condvar, Mutex};
use std::thread::{self, JoinHandle};
use std::time::Duration;

use voice_wire::{ConversationEvent, SpeechCut};

use crate::call::{EndOfTurn, Listeners, ModelPaths, Out, Recognise, Threads, Vad, Waiter, NOT_DOWNLOADED};
use crate::host::HostControl;
use crate::playback::RATE as PLAY_RATE;
use crate::virtual_device::{VirtualDevice, MIC_FRAME};

const MIC_RATE: usize = 16_000;
const WAIT: Duration = Duration::from_secs(20);
const WORDS: [&str; 8] = ["one", "two", "three", "four", "five", "six", "seven", "eight"];

// --- Fake models ------------------------------------------------------------

/// Speech is anything above -40 dBFS.
struct LevelVad;

impl Vad for LevelVad {
    fn reset(&mut self) {}
    fn probability(&mut self, frame: &[f32]) -> Result<f32, String> {
        let ms = frame.iter().map(|&s| s * s).sum::<f32>() / frame.len() as f32;
        Ok(if 10.0 * ms.log10() > -40.0 { 0.99 } else { 0.01 })
    }
}

struct Judge(Box<dyn FnMut(&[f32]) -> f32 + Send>);

impl EndOfTurn for Judge {
    fn probability(&mut self, audio: &[f32]) -> Result<f32, String> {
        Ok((self.0)(audio))
    }
}

/// The tones in `pcm`: runs above 0.05 with at least 50 ms between them.
fn tones(pcm: &[f32]) -> usize {
    let (mut n, mut quiet, mut inside) = (0, usize::MAX, false);
    for &s in pcm {
        if s.abs() > 0.05 {
            if !inside && quiet >= MIC_RATE / 20 {
                n += 1;
            }
            inside = true;
            quiet = 0;
        } else {
            quiet = quiet.saturating_add(1);
            if quiet >= MIC_RATE / 20 {
                inside = false;
            }
        }
    }
    n
}

fn words(n: usize) -> String {
    WORDS[..n].join(" ")
}

#[derive(Default)]
struct AsrBook {
    current: u64,
    submits: u64,
    cancels: u64,
    /// Jobs answered `None`: voided before they were done.
    voided: u64,
    held: bool,
}

struct Job {
    id: u64,
    pcm: Vec<f32>,
    reply: mpsc::Sender<Result<Option<String>, String>>,
}

/// One word per tone, on a thread of its own, one job at a time; a submit or
/// a cancel voids what came before. `hold` keeps every answer back.
struct FakeAsr {
    book: Arc<(Mutex<AsrBook>, Condvar)>,
    tx: Mutex<Option<mpsc::Sender<Job>>>,
    worker: Mutex<Option<JoinHandle<()>>>,
}

impl FakeAsr {
    fn new() -> Arc<Self> {
        let book = Arc::new((Mutex::new(AsrBook::default()), Condvar::new()));
        let (tx, rx) = mpsc::channel::<Job>();
        let b = Arc::clone(&book);
        let worker = thread::spawn(move || {
            while let Ok(job) = rx.recv() {
                let mut s = b.0.lock().unwrap();
                while s.held && s.current == job.id {
                    s = b.1.wait(s).unwrap();
                }
                let out = if s.current == job.id {
                    Some(words(tones(&job.pcm)))
                } else {
                    s.voided += 1;
                    None
                };
                drop(s);
                let _ = job.reply.send(Ok(out));
            }
        });
        Arc::new(Self { book, tx: Mutex::new(Some(tx)), worker: Mutex::new(Some(worker)) })
    }

    fn hold(&self, on: bool) {
        self.book.0.lock().unwrap().held = on;
        self.book.1.notify_all();
    }

    /// (submits, cancels, voided).
    fn counts(&self) -> (u64, u64, u64) {
        let s = self.book.0.lock().unwrap();
        (s.submits, s.cancels, s.voided)
    }
}

impl Recognise for FakeAsr {
    fn submit(&self, pcm: Vec<f32>) -> Waiter {
        let id = {
            let mut s = self.book.0.lock().unwrap();
            s.current += 1;
            s.submits += 1;
            s.current
        };
        self.book.1.notify_all();
        let (reply, rx) = mpsc::channel();
        if let Some(tx) = &*self.tx.lock().unwrap() {
            let _ = tx.send(Job { id, pcm, reply });
        }
        Box::new(move || rx.recv().unwrap_or_else(|_| Err("fake recogniser stopped".into())))
    }

    fn cancel(&self) {
        let mut s = self.book.0.lock().unwrap();
        s.current += 1;
        s.cancels += 1;
        self.book.1.notify_all();
    }
}

impl Drop for FakeAsr {
    fn drop(&mut self) {
        self.cancel();
        self.tx.lock().unwrap().take();
        if let Some(w) = self.worker.lock().unwrap().take() {
            let _ = w.join();
        }
    }
}

// --- Sound ------------------------------------------------------------------

/// `n` words: 300 ms of a 220 Hz tone, then 100 ms of silence, each.
fn speech(n: usize) -> Vec<i16> {
    let tone = MIC_RATE * 3 / 10;
    let gap = MIC_RATE / 10;
    let mut out = Vec::new();
    for _ in 0..n {
        out.extend((0..tone).map(|i| {
            ((i as f32 / MIC_RATE as f32 * 220.0 * std::f32::consts::TAU).sin() * 0.3 * 32767.0) as i16
        }));
        out.extend(std::iter::repeat(0).take(gap));
    }
    out
}

/// `ms` of a 24 kHz tone, the companion's voice.
fn voice(ms: usize) -> Vec<i16> {
    let n = PLAY_RATE as usize * ms / 1000;
    (0..n).map(|i| ((i as f32 * 0.07).sin() * 9000.0) as i16).collect()
}

// --- Reading the events -----------------------------------------------------

fn conversation(events: &[(i64, Out)]) -> Vec<(i64, ConversationEvent)> {
    events
        .iter()
        .filter_map(|(t, o)| match o {
            Out::Conversation(e) if e.kind != "level" => Some((*t, e.clone())),
            _ => None,
        })
        .collect()
}

fn kinds(events: &[(i64, Out)]) -> Vec<String> {
    conversation(events).into_iter().map(|(_, e)| format!("{}:{}", e.kind, e.turn)).collect()
}

fn count(events: &[(i64, Out)], kind: &str) -> usize {
    conversation(events).iter().filter(|(_, e)| e.kind == kind).count()
}

fn position(events: &[(i64, Out)], kind: &str, turn: u64) -> usize {
    conversation(events)
        .iter()
        .position(|(_, e)| e.kind == kind && e.turn == turn)
        .unwrap_or_else(|| panic!("no {kind} for turn {turn} in {:?}", kinds(events)))
}

fn speech_kinds(events: &[(i64, Out)]) -> Vec<(String, f64, Option<String>)> {
    events
        .iter()
        .filter_map(|(_, o)| match o {
            Out::Speech(s) if s.kind == "speaking" => Some((s.kind.clone(), s.value, s.reason.clone())),
            _ => None,
        })
        .collect()
}

fn volumes(dev: &VirtualDevice) -> Vec<f32> {
    dev.host
        .controls()
        .into_iter()
        .filter_map(|c| match c {
            HostControl::SetVolume(v) => Some(v),
            _ => None,
        })
        .collect()
}

fn fake_call(judge: impl FnMut(&[f32]) -> f32 + Send + 'static) -> (VirtualDevice, Arc<FakeAsr>) {
    let dev = VirtualDevice::new();
    let asr = FakeAsr::new();
    let recogniser: Arc<dyn Recognise> = asr.clone();
    dev.engine
        .open_with(Listeners { vad: Box::new(LevelVad), end_of_turn: Box::new(Judge(Box::new(judge))), recogniser })
        .unwrap();
    (dev, asr)
}

/// The sentence and character a turn's frame is at, for sentences of
/// (frames, chars) laid end to end: SpeechClock's interpolation.
fn locate(layout: &[(i64, i64)], frame: i64) -> (i64, i64) {
    let mut start = 0;
    for (i, &(frames, chars)) in layout.iter().enumerate() {
        if frame < start + frames {
            return (i as i64, chars * (frame - start) / frames);
        }
        start += frames;
    }
    let last = layout.len() - 1;
    (last as i64, layout[last].1)
}

/// Queue `layout`'s sentences of `voice` as utterance `utterance`.
fn speak(dev: &VirtualDevice, utterance: u64, layout: &[(usize, u32)]) -> Vec<(i64, i64)> {
    for (i, &(ms, chars)) in layout.iter().enumerate() {
        let last = i + 1 == layout.len();
        let ack = dev.engine.enqueue(utterance, i as u32, chars, last, 0, true, PLAY_RATE, &voice(ms)).unwrap();
        assert!(!ack.dropped, "sentence {i} dropped: {ack:?}");
    }
    dev.engine.finish_speech(utterance);
    layout.iter().map(|&(ms, chars)| ((PLAY_RATE as usize * ms / 1000) as i64, chars as i64)).collect()
}

/// The barge-in's cut against the device: the frames the track reported at
/// the moment of the stop are the playhead the cut must name.
fn check_cut(dev: &VirtualDevice, events: &[(i64, Out)], layout: &[(i64, i64)], utterance: u64) -> SpeechCut {
    let (at, stop) = conversation(events).into_iter().find(|(_, e)| e.kind == "speech-stop").unwrap();
    let cut = stop.cut.expect("speech-stop without a cut while speaking");
    let frames = dev.reported_at(at).expect("the track reported at the stop");
    let (sentence, chars) = locate(layout, frames);
    assert_eq!(cut.utterance, utterance);
    assert_eq!((cut.sentence, cut.char_offset), (sentence, chars), "playhead {frames} frames");
    assert_eq!(cut.played_ms, frames as f64 * 1000.0 / PLAY_RATE as f64);
    cut
}

// --- Fake models ------------------------------------------------------------

#[test]
fn f1_one_sentence_is_one_turn_and_one_speech_end() {
    let (mut dev, asr) = fake_call(|_| 0.9);
    dev.idle(300);
    dev.feed(&speech(3));
    dev.idle(1200);
    dev.events.wait_for(WAIT, |e| count(e, "speech-end") > 0);
    dev.idle(1500);
    let events = dev.events.all();
    assert_eq!(kinds(&events), ["state:0", "speech-duck:0", "speech-stop:1", "speech-end:1"]);
    let (_, end) = conversation(&events).pop().unwrap();
    assert_eq!(end.text.as_deref(), Some("one two three"));
    let silent = end.silent_ms.unwrap();
    assert!((250.0..400.0).contains(&silent), "silentMs {silent}");
    assert!(asr.counts().0 >= 1);
    dev.engine.close();
    let events = dev.events.all();
    let (_, last) = conversation(&events).pop().unwrap();
    assert_eq!((last.kind.as_str(), last.running, last.reason.as_deref()), ("state", Some(false), Some("closed")));
    assert_eq!(dev.host.controls().first(), Some(&HostControl::OpenAudio { capture: true }));
    assert_eq!(dev.host.open(), None);
}

#[test]
fn f2_a_pause_judged_unfinished_waits_and_the_text_is_the_whole_sentence() {
    // Unfinished until five tones are in.
    // The recogniser sits on the job the pause started until the user is
    // talking again, which voids it.
    let (mut dev, asr) = fake_call(|audio| if tones(audio) < 5 { 0.1 } else { 0.9 });
    asr.hold(true);
    dev.idle(300);
    dev.feed(&speech(3));
    dev.idle(700);
    assert_eq!(count(&dev.events.all(), "speech-end"), 0);
    dev.feed(&speech(2));
    asr.hold(false);
    dev.idle(1200);
    dev.events.wait_for(WAIT, |e| count(e, "speech-end") > 0);
    dev.idle(3000);
    let events = dev.events.all();
    assert_eq!(kinds(&events), ["state:0", "speech-duck:0", "speech-stop:1", "speech-end:1"]);
    let (_, end) = conversation(&events).pop().unwrap();
    assert_eq!(end.text.as_deref(), Some("one two three four five"));
    let (submits, cancels, voided) = asr.counts();
    assert!(cancels > 0 && voided > 0 && submits > voided, "submits {submits}, cancels {cancels}, voided {voided}");
}

#[test]
fn f3_wait_a_moment_over_the_voice_ducks_then_stops_and_cuts_at_the_playhead() {
    let (mut dev, _asr) = fake_call(|_| 0.9);
    let layout = speak(&dev, 1, &[(1000, 10), (2000, 20), (1000, 8)]);
    // Past the 2 s immunity window, inside the second sentence.
    dev.idle(2200);
    dev.feed(&speech(3));
    dev.idle(1200);
    let events = dev.events.wait_for(WAIT, |e| count(e, "speech-end") > 0);
    assert_eq!(
        kinds(&events),
        ["state:0", "envelope:0", "envelope:0", "envelope:0", "speech-duck:0", "speech-stop:1", "spoken:1", "speech-end:1"]
    );
    let cut = check_cut(&dev, &events, &layout, 1);
    assert_eq!(cut.sentence, 1);
    let spoken = conversation(&events).into_iter().find(|(_, e)| e.kind == "spoken").unwrap().1;
    assert_eq!((spoken.utterance, spoken.reason.as_deref()), (Some(1), Some("interrupted")));
    assert_eq!(speech_kinds(&events).last().unwrap().2.as_deref(), Some("interrupted"));
    // Ducked to 0.25 on the duck, back to full when the stop lifted it.
    assert_eq!(volumes(&dev), [1.0, 0.25, 1.0]);
    let controls = dev.host.controls();
    let duck = controls.iter().position(|c| *c == HostControl::SetVolume(0.25)).unwrap();
    let flush = controls.iter().position(|c| *c == HostControl::Flush).unwrap();
    assert!(flush > duck);
    // Nothing of the cut turn is heard after the stop, and nothing more of it
    // is taken.
    let stop_at = conversation(&events).into_iter().find(|(_, e)| e.kind == "speech-stop").unwrap().0;
    let steps_after = dev.reports.iter().filter(|(t, _)| *t > stop_at).count();
    assert!(steps_after > 10);
    let tail = &dev.heard[dev.heard.len() - steps_after * 768..];
    assert!(tail.iter().all(|&s| s == 0.0), "the track played on after the stop");
    assert!(dev.engine.enqueue(1, 3, 5, true, 0, true, PLAY_RATE, &voice(200)).unwrap().dropped);
    assert_eq!(dev.track_len(), 0);
    let (_, end) = conversation(&events).pop().unwrap();
    assert_eq!(end.text.as_deref(), Some("one two three"));
}

#[test]
fn f4_a_false_alarm_ducks_and_resumes_and_the_voice_plays_on() {
    let (mut dev, _asr) = fake_call(|_| 0.9);
    speak(&dev, 1, &[(1500, 10), (1500, 10)]);
    dev.idle(2200);
    // 128 ms: four frames, short of the 300 ms that confirms a turn.
    dev.feed(&speech(1)[..4 * MIC_FRAME]);
    dev.idle(1500);
    let events = dev.events.all();
    assert_eq!(
        kinds(&events),
        ["state:0", "envelope:0", "envelope:0", "speech-duck:0", "speech-resume:0", "spoken:0"]
    );
    assert_eq!(count(&events, "speech-stop"), 0);
    assert_eq!(volumes(&dev), [1.0, 0.25, 1.0]);
    let spoken = conversation(&events).pop().unwrap().1;
    assert_eq!((spoken.utterance, spoken.reason.as_deref()), (Some(1), Some("done")));
    assert!(!dev.host.controls().contains(&HostControl::Flush));
    // Every frame of the voice was played, the ones after the duck and up to
    // the resume at a quarter.
    assert_eq!(dev.reports.last().unwrap().1, 3 * PLAY_RATE as i64);
    let at = |kind: &str| conversation(&events).into_iter().find(|(_, e)| e.kind == kind).unwrap().0;
    // Step k (from 1) played heard[(k - 1) * 768..k * 768] at 1 s + k * 32 ms.
    let step = |t: i64| ((t - 1_000_000_000) / 32_000_000) as usize;
    let peak = |from: usize, to: usize| dev.heard[from * 768..to * 768].iter().fold(0f32, |m, s| m.max(s.abs()));
    let (duck, resume) = (step(at("speech-duck")), step(at("speech-resume")));
    let full = peak(0, duck);
    assert!(full > 0.27, "peak {full}");
    assert!((peak(duck, resume) - full * 0.25).abs() < 1e-3, "{} while ducked", peak(duck, resume));
    assert!((peak(resume, resume + 10) - full).abs() < 1e-3);
}

#[test]
fn f5_missing_files_refuse_the_call_as_ios_refuses_a_failed_start() {
    let dev = VirtualDevice::new();
    let dir = std::env::temp_dir().join(format!("voice-engine-empty-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let paths = ModelPaths::in_dir(&dir);
    assert_eq!(paths.missing().len(), 5);
    let err = dev.engine.open(&paths, Threads::default()).unwrap_err();
    assert_eq!(err, NOT_DOWNLOADED);
    let events = dev.events.all();
    assert_eq!(events.len(), 1);
    let Out::Conversation(state) = &events[0].1 else { panic!("{events:?}") };
    // The download hint is the refusal's; the event is ConversationRun's own.
    assert_eq!(
        serde_json::to_value(state).unwrap(),
        serde_json::json!({"kind": "state", "turn": 0, "running": false, "reason": "failed"})
    );
    assert!(dev.host.controls().is_empty());
    std::fs::remove_dir_all(&dir).ok();

    // The plugin's iOS sentence, with the section Android shows the download
    // under.
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../..");
    let kokoro = std::fs::read_to_string(root.join("plugins/voice/src/tts/kokoro.rs")).unwrap();
    let ios = kokoro.split("pub const NOT_DOWNLOADED: &str =").nth(1).unwrap().split("} else {").nth(1).unwrap();
    let plugin = ios.split('"').nth(1).unwrap();
    let en = std::fs::read_to_string(root.join("src/i18n/messages/settings/en.ts")).unwrap();
    let label = |key: &str| en.split(&format!("\"{key}\": \"")).nth(1).unwrap().split('"').next().unwrap().to_string();
    assert_eq!(NOT_DOWNLOADED, plugin.replace(&label("optional.voiceOutput"), &label("optional.voiceCall")));
}

#[test]
fn f6_new_models_while_smart_turn_is_judging_do_not_deadlock() {
    // Smart Turn blocks inside its first judgement until the gate opens.
    let gate = Arc::new((Mutex::new((false, false)), Condvar::new()));
    let g = Arc::clone(&gate);
    let (mut dev, _asr) = fake_call(move |_| {
        let mut s = g.0.lock().unwrap();
        s.0 = true;
        g.1.notify_all();
        while !s.1 {
            s = g.1.wait(s).unwrap();
        }
        0.9
    });
    dev.quiesce = false;
    dev.idle(300);
    dev.feed(&speech(2));
    dev.idle(300);
    {
        let mut s = gate.0.lock().unwrap();
        while !s.0 {
            s = gate.1.wait_timeout(s, WAIT).unwrap().0;
        }
    }
    // The microphone keeps coming in on its thread while new models go in.
    let engine = Arc::clone(&dev.engine);
    let feeding = Arc::new(Mutex::new(true));
    let f = Arc::clone(&feeding);
    let capture = thread::spawn(move || {
        let mut t = 10_000_000_000i64;
        while *f.lock().unwrap() {
            t += 32_000_000;
            engine.capture(&speech(1)[..MIC_FRAME], t);
        }
    });
    let (done_tx, done_rx) = mpsc::channel();
    let engine = Arc::clone(&dev.engine);
    let install = thread::spawn(move || {
        let recogniser: Arc<dyn Recognise> = FakeAsr::new();
        engine
            .open_with(Listeners { vad: Box::new(LevelVad), end_of_turn: Box::new(Judge(Box::new(|_| 0.9))), recogniser })
            .unwrap();
        done_tx.send(()).unwrap();
    });
    thread::sleep(Duration::from_millis(100));
    {
        let mut s = gate.0.lock().unwrap();
        s.1 = true;
        gate.1.notify_all();
    }
    done_rx.recv_timeout(Duration::from_secs(10)).expect("open_with deadlocked against the Smart Turn worker");
    install.join().unwrap();
    *feeding.lock().unwrap() = false;
    capture.join().unwrap();
    // The first call was released for the second; the second is up.
    let states: Vec<_> = conversation(&dev.events.all())
        .into_iter()
        .filter(|(_, e)| e.kind == "state")
        .map(|(_, e)| e.reason.unwrap())
        .collect();
    assert_eq!(states, ["opened", "released", "opened"]);
}

#[test]
fn f7_a_turn_still_being_recognised_comes_out_before_the_next() {
    let (mut dev, asr) = fake_call(|_| 0.9);
    asr.hold(true);
    dev.idle(300);
    dev.feed(&speech(2));
    dev.idle(500);
    // Turn 1 has ended and waits for its text; turn 2 starts over it.
    dev.feed(&speech(3));
    dev.idle(500);
    let events = dev.events.all();
    assert_eq!(kinds(&events), ["state:0", "speech-duck:0", "speech-stop:1"]);
    asr.hold(false);
    let events = dev.events.wait_for(WAIT, |e| count(e, "speech-end") == 2);
    assert_eq!(
        kinds(&events),
        ["state:0", "speech-duck:0", "speech-stop:1", "speech-end:1", "speech-duck:1", "speech-stop:2", "speech-end:2"]
    );
    let ends: Vec<_> =
        conversation(&events).into_iter().filter(|(_, e)| e.kind == "speech-end").map(|(_, e)| e.text.unwrap()).collect();
    assert_eq!(ends, ["one two", "one two three"]);
}

#[test]
fn f8_a_microphone_that_stalls_still_ends_the_turn_on_the_ticker() {
    // Smart Turn never agrees: only the hangover can end it.
    let (mut dev, _asr) = fake_call(|_| 0.1);
    dev.idle(300);
    dev.feed(&speech(2));
    for _ in 0..12 {
        dev.clock.advance(250_000_000);
        dev.engine.tick();
        dev.engine.quiesce();
    }
    let events = dev.events.wait_for(WAIT, |e| count(e, "speech-end") > 0);
    let (_, end) = conversation(&events).pop().unwrap();
    assert_eq!(end.kind, "speech-end");
    assert_eq!(end.text.as_deref(), Some("one two"));
    assert!(end.silent_ms.unwrap() >= 2500.0);
}

// --- Real models ------------------------------------------------------------

/// The download directory's layout under `VOICE_MODELS`, or None.
fn real_models() -> Option<ModelPaths> {
    let Some(dir) = std::env::var_os("VOICE_MODELS") else {
        println!("skipped: VOICE_MODELS is not set");
        return None;
    };
    let paths = ModelPaths::in_dir(&PathBuf::from(dir));
    let missing = paths.missing();
    if missing.is_empty() {
        Some(paths)
    } else {
        println!("skipped: missing {missing:?}");
        None
    }
}

/// A clip from fixtures/call/, 16 kHz mono 16-bit.
fn clip(name: &str) -> Vec<i16> {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("fixtures/call").join(format!("{name}.wav"));
    let b = std::fs::read(path).unwrap();
    assert_eq!(&b[36..40], b"data");
    assert_eq!(u32::from_le_bytes(b[24..28].try_into().unwrap()), MIC_RATE as u32);
    b[44..].chunks_exact(2).map(|c| i16::from_le_bytes([c[0], c[1]])).collect()
}

fn ends(events: &[(i64, Out)]) -> Vec<String> {
    conversation(events).into_iter().filter(|(_, e)| e.kind == "speech-end").map(|(_, e)| e.text.unwrap()).collect()
}

/// One engine, the models loaded once, a call per scenario.
#[test]
fn real_models_on_kokoro_clips() {
    let Some(paths) = real_models() else { return };
    let real_wait = Duration::from_secs(180);
    let mut dev = VirtualDevice::new();

    // R1: one sentence, one turn.
    dev.engine.open(&paths, Threads::default()).unwrap();
    dev.idle(300);
    dev.feed(&clip("one"));
    dev.idle(1500);
    let events = dev.events.wait_for(real_wait, |e| count(e, "speech-end") == 1);
    dev.idle(2000);
    let said = ends(&dev.events.all());
    println!("R1 {said:?}");
    assert_eq!(said.len(), 1);
    assert!(said[0].contains("天气"), "{said:?}");
    assert_eq!(kinds(&events), ["state:0", "speech-duck:0", "speech-stop:1", "speech-end:1"]);

    // R2: 然后， judged unfinished; the rest follows 700 ms later. The models
    // are kept: the second open only starts a call.
    let mark = dev.events.all().len();
    dev.engine.open(&paths, Threads::default()).unwrap();
    dev.idle(300);
    dev.feed(&clip("then"));
    dev.idle(700);
    dev.feed(&clip("when"));
    dev.idle(1500);
    dev.events.wait_for(real_wait, |e| count(&e[mark..], "speech-end") == 1);
    dev.idle(3000);
    let events = dev.events.all()[mark..].to_vec();
    let said = ends(&events);
    println!("R2 {said:?}");
    assert_eq!(said.len(), 1, "{:?}", kinds(&events));
    assert!(said[0].contains("然后") && said[0].contains("会议"), "{said:?}");

    // R3: 等一下 over the voice: duck, stop, the cut at the playhead.
    let mark = dev.events.all().len();
    dev.engine.open(&paths, Threads::default()).unwrap();
    let layout = speak(&dev, 1, &[(1000, 10), (2000, 20), (1000, 8)]);
    dev.idle(2200);
    dev.feed(&clip("wait"));
    dev.idle(1500);
    dev.events.wait_for(real_wait, |e| count(&e[mark..], "speech-end") >= 1);
    let events = dev.events.all()[mark..].to_vec();
    let order = kinds(&events);
    println!("R3 {order:?} {:?}", ends(&events));
    let (duck, stop) = (position(&events, "speech-duck", 0), position(&events, "speech-stop", 1));
    assert!(duck < stop && stop < position(&events, "speech-end", 1));
    assert_eq!(count(&events, "speech-resume"), 0);
    let cut = check_cut(&dev, &events, &layout, 1);
    println!("R3 cut {cut:?}");
    assert!(ends(&events)[0].contains("等一下"), "{:?}", ends(&events));

    // R4: 啊 for 160 ms over the voice: a duck and a resume, the voice plays on.
    let mark = dev.events.all().len();
    dev.engine.open(&paths, Threads::default()).unwrap();
    speak(&dev, 2, &[(1500, 10), (1500, 10)]);
    dev.idle(2200);
    dev.feed(&clip("ah"));
    dev.idle(1500);
    let events = dev.events.all()[mark..].to_vec();
    println!("R4 {:?}", kinds(&events));
    assert!(position(&events, "speech-duck", 0) < position(&events, "speech-resume", 0));
    assert_eq!(count(&events, "speech-stop"), 0);
    let spoken = conversation(&events).into_iter().find(|(_, e)| e.kind == "spoken").unwrap().1;
    assert_eq!((spoken.utterance, spoken.reason.as_deref()), (Some(2), Some("done")));

    dev.engine.close();
    assert!(dev.engine.kokoro().is_ok(), "Kokoro did not load");
}
