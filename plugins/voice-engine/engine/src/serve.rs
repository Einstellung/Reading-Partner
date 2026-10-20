// The engine's end of the socket (docs/companion/89, 主进程和引擎之间). One
// `Server` lives as long as `:voice`, and the engine with it; `nativeAttach`
// hands it each connection the main process opens. When the attached
// connection ends nobody is left to hear the call or the voice, so the call
// is hung up and the voice stopped; the models stay.
//
// Threads per connection. The reader takes requests off the socket and
// answers the playback's four itself: they only take the engine's lock, so a
// barge-in's `StopSpeaking` is never held up. `Open` and `Close` go in order
// to a call worker, which may load models for a while; `Synthesize` goes to a
// synth worker, one sentence at a time, as Kokoro runs. Everything that
// leaves goes through one writer queue, events and answers alike, so an
// event the engine sent before an answer is read before it: `state opened`
// arrives ahead of `Open`'s `Done`.

use std::io::{self, Read, Write};
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::thread::{self, JoinHandle};

use voice_wire::{self as wire, ModelFiles, ToEngine, ToMain};

use crate::call::{Emit, Engine, ModelPaths, Out, Threads};
use crate::host::{AudioHost, Clock};

/// What `Open` and `Synthesize` run on. `OnDisk` is the device's; the tests
/// put fake models behind the same socket.
pub trait Models: Send + Sync + 'static {
    fn open(&self, engine: &Engine, paths: &ModelPaths, threads: Threads) -> Result<(), String>;
    fn synthesize(
        &self,
        engine: &Engine,
        model: &Path,
        phonemes: &str,
        style: &[f32],
        speed: f32,
    ) -> Result<Vec<f32>, String>;
}

/// The files `Open` names, Kokoro through `kokoro-onnx`.
pub struct OnDisk;

impl Models for OnDisk {
    fn open(&self, engine: &Engine, paths: &ModelPaths, threads: Threads) -> Result<(), String> {
        engine.open(paths, threads)
    }

    fn synthesize(
        &self,
        engine: &Engine,
        model: &Path,
        phonemes: &str,
        style: &[f32],
        speed: f32,
    ) -> Result<Vec<f32>, String> {
        let kokoro = engine.kokoro_at(model, Threads::default().kokoro)?;
        let mut kokoro = kokoro.lock().unwrap_or_else(|p| p.into_inner());
        kokoro.synthesize_style(phonemes, style, speed)
    }
}

impl From<&ModelFiles> for ModelPaths {
    fn from(f: &ModelFiles) -> Self {
        Self {
            silero: f.silero.clone().into(),
            smart_turn: f.smart_turn.clone().into(),
            asr_model: f.asr_model.clone().into(),
            asr_mmproj: f.asr_mmproj.clone().into(),
            kokoro_model: f.kokoro_model.clone().into(),
        }
    }
}

impl From<wire::Threads> for Threads {
    fn from(t: wire::Threads) -> Self {
        Self { smart_turn: t.smart_turn as usize, asr: t.asr as i32, kokoro: t.kokoro as usize }
    }
}

/// Kokoro's floats as the 16-bit samples the wire carries (the plugin's
/// `to_pcm16le`, which turns them back into the same samples).
pub fn to_i16(samples: &[f32]) -> Vec<i16> {
    samples.iter().map(|&s| (s.clamp(-1.0, 1.0) * 32767.0).round() as i16).collect()
}

type Queue = mpsc::Sender<Vec<u8>>;

fn encode(msg: &ToMain, pcm: Option<&[u8]>) -> io::Result<Vec<u8>> {
    let json = serde_json::to_vec(msg).map_err(io::Error::other)?;
    wire::message(&json, pcm)
}

fn send(out: &Queue, msg: ToMain) {
    if let Ok(bytes) = encode(&msg, None) {
        let _ = out.send(bytes);
    }
}

fn invalid(what: impl Into<String>) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, what.into())
}

/// Where the engine's events go: the attached connection, if there is one.
#[derive(Default)]
pub struct Outlet {
    current: Mutex<Option<(u64, Queue)>>,
}

impl Outlet {
    pub fn new() -> Arc<Self> {
        Arc::new(Self::default())
    }

    /// The engine's `Emit`. It never blocks; with nothing attached the event
    /// has nobody to go to and is dropped.
    pub fn emit(self: &Arc<Self>) -> Emit {
        let outlet = Arc::clone(self);
        Box::new(move |out| outlet.event(out))
    }

    fn event(&self, out: Out) {
        let msg = match out {
            Out::Conversation(event) => ToMain::Event { event },
            Out::Speech(event) => ToMain::Speech { event },
        };
        if let Some((_, queue)) = &*self.current.lock().unwrap() {
            send(queue, msg);
        }
    }
}

pub struct Server {
    engine: Arc<Engine>,
    outlet: Arc<Outlet>,
    models: Arc<dyn Models>,
    connections: AtomicU64,
}

impl Server {
    /// `engine` must emit through `outlet` (`Outlet::emit`).
    pub fn new(engine: Arc<Engine>, outlet: Arc<Outlet>, models: Arc<dyn Models>) -> Arc<Self> {
        Arc::new(Self { engine, outlet, models, connections: AtomicU64::new(0) })
    }

    /// The device's server: the engine on `host`, the models from disk.
    pub fn on_device(host: Arc<dyn AudioHost>, clock: Arc<dyn Clock>) -> Arc<Self> {
        let outlet = Outlet::new();
        let engine = Arc::new(Engine::new(host, clock, outlet.emit()));
        Self::new(engine, outlet, Arc::new(OnDisk))
    }

    pub fn engine(&self) -> &Arc<Engine> {
        &self.engine
    }

    /// Serve one connection until it ends. It becomes the one the events go
    /// to; one attached before it is left to end on its own.
    pub fn attach<R, W>(self: &Arc<Self>, reader: R, writer: W) -> JoinHandle<()>
    where
        R: Read + Send + 'static,
        W: Write + Send + 'static,
    {
        let n = self.connections.fetch_add(1, Ordering::SeqCst) + 1;
        let (out, frames) = mpsc::channel::<Vec<u8>>();
        *self.outlet.current.lock().unwrap() = Some((n, out.clone()));
        thread::Builder::new()
            .name("wire-write".into())
            .spawn(move || {
                let mut writer = writer;
                for bytes in frames {
                    if wire::write_frames(&mut writer, &bytes).is_err() {
                        return;
                    }
                }
            })
            .expect("spawn wire writer");
        let synth = self.worker("wire-synth", out.clone());
        let call = self.worker("wire-call", out.clone());
        let server = Arc::clone(self);
        thread::Builder::new()
            .name("wire-read".into())
            .spawn(move || {
                let mut reader = reader;
                // An error is a broken or garbled connection; either way it
                // ends here, like an EOF.
                let _ = server.read(&mut reader, &out, &synth, &call);
                drop((synth, call, out));
                server.detach(n);
            })
            .expect("spawn wire reader")
    }

    /// `attach` on a socket: what `nativeAttach(fd)` does.
    #[cfg(unix)]
    pub fn attach_stream(self: &Arc<Self>, stream: std::os::unix::net::UnixStream) -> io::Result<JoinHandle<()>> {
        let reader = stream.try_clone()?;
        Ok(self.attach(reader, stream))
    }

    fn worker(self: &Arc<Self>, name: &str, out: Queue) -> mpsc::Sender<ToEngine> {
        let (tx, rx) = mpsc::channel::<ToEngine>();
        let server = Arc::clone(self);
        thread::Builder::new()
            .name(name.into())
            .spawn(move || {
                for msg in rx {
                    server.slow(msg, &out);
                }
            })
            .expect("spawn wire worker");
        tx
    }

    /// `Open`, `Close` and `Synthesize`, on a worker.
    fn slow(&self, msg: ToEngine, out: &Queue) {
        match msg {
            ToEngine::Open { id, files, threads } => {
                let answer = self.models.open(&self.engine, &ModelPaths::from(&files), threads.into());
                send(out, done_or_error(id, answer));
            }
            ToEngine::Close { id } => {
                self.engine.close();
                send(out, ToMain::Done { id });
            }
            ToEngine::Synthesize { id, model, phonemes, style, speed } => {
                let pcm = self
                    .models
                    .synthesize(&self.engine, Path::new(&model), &phonemes, &style, speed)
                    .and_then(|samples| {
                        let pcm = wire::pcm_bytes(&to_i16(&samples));
                        encode(&ToMain::Pcm { id }, Some(&pcm)).map_err(|e| e.to_string())
                    });
                match pcm {
                    Ok(bytes) => {
                        let _ = out.send(bytes);
                    }
                    Err(message) => send(out, ToMain::Error { id, message }),
                }
            }
            other => unreachable!("the reader answers {other:?} itself"),
        }
    }

    fn read(
        &self,
        reader: &mut impl Read,
        out: &Queue,
        synth: &mpsc::Sender<ToEngine>,
        call: &mpsc::Sender<ToEngine>,
    ) -> io::Result<()> {
        loop {
            let Some((kind, body)) = wire::read_frame(reader)? else {
                return Ok(());
            };
            if kind != wire::CONTROL {
                return Err(invalid("PCM with no message before it"));
            }
            let msg: ToEngine = serde_json::from_slice(&body).map_err(|e| invalid(e.to_string()))?;
            let pcm = if msg.has_pcm() {
                match wire::read_frame(reader)? {
                    Some((wire::PCM, bytes)) => wire::pcm_samples(&bytes)?,
                    _ => return Err(invalid("a message that carries PCM came without it")),
                }
            } else {
                Vec::new()
            };
            let engine = &self.engine;
            match msg {
                ToEngine::Open { .. } | ToEngine::Close { .. } => {
                    let _ = call.send(msg);
                }
                ToEngine::Synthesize { .. } => {
                    let _ = synth.send(msg);
                }
                ToEngine::Enqueue { id, utterance, index, chars, last, part, complete, sample_rate, marks: _ } => {
                    let answer = engine.enqueue(utterance, index, chars, last, part, complete, sample_rate, &pcm);
                    send(
                        out,
                        match answer {
                            Ok(ack) => ToMain::Enqueued { id, ack },
                            Err(message) => ToMain::Error { id, message },
                        },
                    );
                }
                ToEngine::Finish { id, utterance } => {
                    engine.finish_speech(utterance);
                    send(out, ToMain::Done { id });
                }
                ToEngine::SetVolume { id, value } => {
                    engine.set_volume(value);
                    send(out, ToMain::Done { id });
                }
                ToEngine::StopSpeaking { id, reason } => {
                    let position = engine.stop_speaking(&reason);
                    send(out, ToMain::Position { id, position });
                }
            }
        }
    }

    /// Connection `n` ended. If it was the attached one, hang up and stop
    /// the voice: nobody can hear either any more.
    fn detach(&self, n: u64) {
        let current = {
            let mut c = self.outlet.current.lock().unwrap();
            if c.as_ref().map(|(k, _)| *k) == Some(n) {
                c.take();
                true
            } else {
                false
            }
        };
        if current {
            self.engine.close();
            self.engine.stop_speaking("closed");
        }
    }
}

fn done_or_error(id: u64, answer: Result<(), String>) -> ToMain {
    match answer {
        Ok(()) => ToMain::Done { id },
        Err(message) => ToMain::Error { id, message },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::call::{EndOfTurn, Listeners, Recognise, Vad, Waiter};
    use crate::virtual_device::VirtualDevice;
    use std::os::unix::net::UnixStream;
    use std::sync::Condvar;
    use std::time::Duration;

    struct Quiet;
    impl Vad for Quiet {
        fn reset(&mut self) {}
        fn probability(&mut self, _: &[f32]) -> Result<f32, String> {
            Ok(0.0)
        }
    }
    struct Done;
    impl EndOfTurn for Done {
        fn probability(&mut self, _: &[f32]) -> Result<f32, String> {
            Ok(1.0)
        }
    }
    struct Silent;
    impl Recognise for Silent {
        fn submit(&self, _: Vec<f32>) -> Waiter {
            Box::new(|| Ok(Some(String::new())))
        }
        fn cancel(&self) {}
    }

    /// Opens on fake listeners; synthesis waits until `release` and then
    /// answers a ramp as long as the phoneme string.
    #[derive(Default)]
    struct Fake {
        gate: Mutex<bool>,
        open: Condvar,
    }
    impl Fake {
        fn release(&self) {
            *self.gate.lock().unwrap() = true;
            self.open.notify_all();
        }
    }
    impl Models for Fake {
        fn open(&self, engine: &Engine, _: &ModelPaths, _: Threads) -> Result<(), String> {
            engine.open_with(Listeners {
                vad: Box::new(Quiet),
                end_of_turn: Box::new(Done),
                recogniser: Arc::new(Silent),
            })
        }
        fn synthesize(&self, _: &Engine, _: &Path, phonemes: &str, style: &[f32], _: f32) -> Result<Vec<f32>, String> {
            let mut g = self.gate.lock().unwrap();
            while !*g {
                g = self.open.wait(g).unwrap();
            }
            assert_eq!(style.len(), 256);
            Ok((0..phonemes.len()).map(|i| i as f32 / 1000.0).collect())
        }
    }

    fn files() -> ModelFiles {
        ModelFiles {
            silero: "/s".into(),
            smart_turn: "/t".into(),
            asr_model: "/a".into(),
            asr_mmproj: "/p".into(),
            kokoro_model: "/k".into(),
        }
    }

    fn put(w: &mut UnixStream, msg: &ToEngine, pcm: Option<&[i16]>) {
        let json = serde_json::to_vec(msg).unwrap();
        let pcm = pcm.map(wire::pcm_bytes);
        wire::write_frames(w, &wire::message(&json, pcm.as_deref()).unwrap()).unwrap();
    }

    fn take(r: &mut UnixStream) -> (ToMain, Option<Vec<i16>>) {
        let (kind, body) = wire::read_frame(r).unwrap().expect("a frame");
        assert_eq!(kind, wire::CONTROL);
        let msg: ToMain = serde_json::from_slice(&body).unwrap();
        let pcm = msg.has_pcm().then(|| {
            let (kind, body) = wire::read_frame(r).unwrap().unwrap();
            assert_eq!(kind, wire::PCM);
            wire::pcm_samples(&body).unwrap()
        });
        (msg, pcm)
    }

    /// The next answer, past any events.
    fn answer(r: &mut UnixStream) -> (ToMain, Option<Vec<i16>>) {
        loop {
            let got = take(r);
            if !matches!(got.0, ToMain::Event { .. } | ToMain::Speech { .. }) {
                return got;
            }
        }
    }

    fn rig() -> (Arc<Server>, Arc<Fake>, UnixStream, VirtualDevice) {
        let outlet = Outlet::new();
        let device = VirtualDevice::with_emit(outlet.emit());
        let fake = Arc::new(Fake::default());
        let server = Server::new(Arc::clone(&device.engine), outlet, fake.clone());
        let (main, engine_end) = UnixStream::pair().unwrap();
        server.attach_stream(engine_end).unwrap();
        main.set_read_timeout(Some(Duration::from_secs(10))).unwrap();
        (server, fake, main, device)
    }

    #[test]
    fn opened_comes_before_the_open_s_answer_and_a_stop_does_not_wait_for_synthesis() {
        let (_server, fake, mut main, _device) = rig();
        put(&mut main, &ToEngine::Open { id: 1, files: files(), threads: wire::Threads::default() }, None);
        let (first, _) = take(&mut main);
        match first {
            ToMain::Event { event } => {
                assert_eq!((event.kind.as_str(), event.reason.as_deref()), ("state", Some("opened")))
            }
            other => panic!("expected the opened event first, got {other:?}"),
        }
        assert_eq!(take(&mut main).0, ToMain::Done { id: 1 });

        // A synthesis held up in the model; a stop behind it is answered.
        let synth = ToEngine::Synthesize { id: 2, model: "/k".into(), phonemes: "abcd".into(), style: vec![0.0; 256], speed: 1.0 };
        put(&mut main, &synth, None);
        put(&mut main, &ToEngine::StopSpeaking { id: 3, reason: "interrupted".into() }, None);
        let (stop, _) = answer(&mut main);
        assert!(matches!(stop, ToMain::Position { id: 3, position } if !position.speaking && position.index == -1), "{stop:?}");
        fake.release();
        let (pcm, samples) = answer(&mut main);
        assert_eq!(pcm, ToMain::Pcm { id: 2 });
        assert_eq!(samples.unwrap(), to_i16(&[0.0, 0.001, 0.002, 0.003]));

        // Enqueue carries its PCM; the engine answers on its own timeline.
        let marks = wire::SentenceMarks::default();
        let enq = ToEngine::Enqueue { id: 4, utterance: 1, index: 0, chars: 3, last: true, part: 0, complete: true, sample_rate: 24_000, marks };
        put(&mut main, &enq, Some(&vec![1000; 2400]));
        loop {
            match take(&mut main).0 {
                ToMain::Enqueued { id: 4, ack } => {
                    assert!(!ack.dropped);
                    assert!((ack.queued_ms - 100.0).abs() < 1e-6, "{ack:?}");
                    break;
                }
                ToMain::Speech { .. } | ToMain::Event { .. } => {}
                other => panic!("{other:?}"),
            }
        }
    }

    #[test]
    fn a_connection_that_ends_hangs_up_and_the_next_one_is_served() {
        let (server, _fake, mut main, device) = rig();
        put(&mut main, &ToEngine::Open { id: 1, files: files(), threads: wire::Threads::default() }, None);
        while !matches!(take(&mut main).0, ToMain::Done { id: 1 }) {}
        assert_eq!(device.host.open(), Some(true));
        drop(main);
        let events = device.events.wait_for(Duration::from_secs(10), |all| {
            all.iter().any(|(_, o)| matches!(o, Out::Conversation(e) if e.kind == "state" && e.reason.as_deref() == Some("closed")))
        });
        assert!(!events.is_empty());

        let (mut again, engine_end) = UnixStream::pair().unwrap();
        again.set_read_timeout(Some(Duration::from_secs(10))).unwrap();
        server.attach_stream(engine_end).unwrap();
        put(&mut again, &ToEngine::SetVolume { id: 7, value: 0.5 }, None);
        assert_eq!(answer(&mut again).0, ToMain::Done { id: 7 });
        put(&mut again, &ToEngine::Close { id: 8 }, None);
        assert_eq!(answer(&mut again).0, ToMain::Done { id: 8 });
    }

    #[test]
    fn a_garbled_message_drops_the_connection() {
        let (_server, _fake, mut main, _device) = rig();
        wire::write_frames(&mut main, &wire::message(b"{\"type\":\"nope\"}", None).unwrap()).unwrap();
        assert!(wire::read_frame(&mut main).unwrap().is_none(), "the engine closed its end");
    }
}
