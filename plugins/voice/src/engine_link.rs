// The main process's end of the socket to the Android voice engine
// (docs/companion/89, 主进程和引擎之间). Nothing here is Android's: it runs over
// any Read + Write pair, which is how the Linux tests put it against the real
// engine over a UnixStream pair. android.rs is the glue that gets the socket
// from Kotlin's `openEngine` and hands `Voice`'s methods to this.
//
// The connection is made the first time something needs it, the call or
// `RemoteSynth`, and kept. When it ends every request still waiting is
// answered with `EXITED`, a call that was up gets `state failed`, and the next
// request makes a new connection (Kotlin brings `:voice` back up).
//
// Event order. The engine sends `state opened` while it handles `Open`, ahead
// of its answer. ConversationRun.swift sends it after `start_conversation`
// has resolved. So the call's events are held from the moment `Open` goes out
// until `begin_emitting`, which android.rs calls once the start has resolved;
// a start that fails lets them go before its error, as Swift's does.

use std::collections::HashMap;
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Mutex, Weak};

use async_trait::async_trait;
use serde::Serialize;
use tauri::ipc::{Channel, InvokeResponseBody};
use tokio::sync::oneshot;
use voice_wire::{self as wire, ConversationEvent, ModelFiles, Threads, ToEngine, ToMain};

use crate::kokoro::voice::VoicePack;
use crate::models::{SpeechEnqueued, SpeechPosition};
use crate::speaker::SpeechOut;
use crate::tts::kokoro::Synthesizer;
use crate::tts::SentenceMarks;
use crate::{Error, Result};

/// What every request still waiting is answered with when `:voice` goes.
pub const EXITED: &str = "The voice process exited.";

/// The two halves of a connection.
pub struct Pipe {
    reader: Box<dyn Read + Send>,
    writer: Box<dyn Write + Send>,
}

impl Pipe {
    pub fn new(reader: impl Read + Send + 'static, writer: impl Write + Send + 'static) -> Self {
        Self { reader: Box::new(reader), writer: Box::new(writer) }
    }

    #[cfg(unix)]
    pub fn unix(stream: std::os::unix::net::UnixStream) -> io::Result<Self> {
        Ok(Self::new(stream.try_clone()?, stream))
    }
}

/// Makes a connection: on Android, `openEngine`. Blocking.
pub type Connect = Box<dyn Fn() -> std::result::Result<Pipe, String> + Send + Sync>;

enum Answer {
    Done,
    Pcm(Vec<i16>),
    Enqueued(wire::SpeechEnqueued),
    Position(wire::SpeechPosition),
}

type Reply = std::result::Result<Answer, String>;

struct Conn {
    /// The writer thread's queue; None once the connection is over.
    out: Mutex<Option<mpsc::Sender<Vec<u8>>>>,
    /// Requests waiting for their answer; None once the connection is over.
    pending: Mutex<Option<HashMap<u64, oneshot::Sender<Reply>>>>,
    next: AtomicU64,
}

impl Conn {
    fn is_open(&self) -> bool {
        self.pending.lock().unwrap().is_some()
    }

    /// Send a request (its id filled in by `make`) and the receiver its
    /// answer will come to.
    fn request(
        &self,
        make: impl FnOnce(u64) -> ToEngine,
        pcm: Option<&[u8]>,
    ) -> std::result::Result<oneshot::Receiver<Reply>, String> {
        let id = self.next.fetch_add(1, Ordering::Relaxed) + 1;
        let json = serde_json::to_vec(&make(id)).map_err(|e| e.to_string())?;
        let bytes = wire::message(&json, pcm).map_err(|e| e.to_string())?;
        let (tx, rx) = oneshot::channel();
        match self.pending.lock().unwrap().as_mut() {
            Some(waiting) => waiting.insert(id, tx),
            None => return Err(EXITED.into()),
        };
        let sent = self.out.lock().unwrap().as_ref().is_some_and(|out| out.send(bytes).is_ok());
        if !sent {
            self.answer(id, Err(EXITED.into()));
        }
        Ok(rx)
    }

    fn answer(&self, id: u64, reply: Reply) {
        let waiter = self.pending.lock().unwrap().as_mut().and_then(|w| w.remove(&id));
        if let Some(tx) = waiter {
            let _ = tx.send(reply);
        }
    }

    /// The connection is over: every waiter gets `EXITED`, and so does every
    /// request after this.
    fn end(&self) {
        let waiting = self.pending.lock().unwrap().take();
        self.out.lock().unwrap().take();
        for (_, tx) in waiting.into_iter().flatten() {
            let _ = tx.send(Err(EXITED.into()));
        }
    }
}

async fn wait(rx: oneshot::Receiver<Reply>) -> Reply {
    rx.await.unwrap_or_else(|_| Err(EXITED.into()))
}

/// The channels `register_listener` handed over, by event name.
#[derive(Default)]
pub struct Listeners {
    channels: Mutex<Vec<(String, Channel)>>,
}

impl Listeners {
    pub fn register(&self, event: String, channel: Channel) {
        self.channels.lock().unwrap().push((event, channel));
    }

    pub fn remove(&self, event: &str, channel_id: u32) {
        self.channels.lock().unwrap().retain(|(e, c)| !(e == event && c.id() == channel_id));
    }

    /// One event to every channel listening for it, as the JSON Swift's
    /// `trigger` sends.
    pub fn emit(&self, event: &str, payload: &impl Serialize) {
        let Ok(json) = serde_json::to_string(payload) else { return };
        for (name, channel) in self.channels.lock().unwrap().iter() {
            if name == event {
                let _ = channel.send(InvokeResponseBody::Json(json.clone()));
            }
        }
    }
}

/// The call as the main process sees it.
#[derive(Default)]
struct Call {
    /// From `Open` going out until `begin_emitting`: events wait in `held`.
    holding: bool,
    held: Vec<ConversationEvent>,
    /// Between a successful `Open` and the call's `state` with `running: false`.
    live: bool,
    /// The last turn an event carried, for the `state failed` sent on EOF.
    turn: u64,
}

pub struct EngineLink {
    connect: Connect,
    /// Held while connecting, so two that need it at once share one.
    conn: Mutex<Option<Arc<Conn>>>,
    listeners: Listeners,
    call: Mutex<Call>,
    me: Weak<EngineLink>,
}

impl EngineLink {
    pub fn new(connect: Connect) -> Arc<Self> {
        Arc::new_cyclic(|me| Self {
            connect,
            conn: Mutex::new(None),
            listeners: Listeners::default(),
            call: Mutex::new(Call::default()),
            me: me.clone(),
        })
    }

    pub fn listeners(&self) -> &Listeners {
        &self.listeners
    }

    fn existing(&self) -> Option<Arc<Conn>> {
        self.conn.lock().unwrap().as_ref().filter(|c| c.is_open()).cloned()
    }

    /// The connection, made now if there is none. Blocking.
    fn conn(&self) -> std::result::Result<Arc<Conn>, String> {
        let mut slot = self.conn.lock().unwrap();
        if let Some(conn) = slot.as_ref().filter(|c| c.is_open()) {
            return Ok(Arc::clone(conn));
        }
        let pipe = (self.connect)()?;
        let conn = self.start(pipe);
        *slot = Some(Arc::clone(&conn));
        Ok(conn)
    }

    async fn conn_async(&self) -> std::result::Result<Arc<Conn>, String> {
        if let Some(conn) = self.existing() {
            return Ok(conn);
        }
        let me = self.me.upgrade().ok_or(EXITED)?;
        tokio::task::spawn_blocking(move || me.conn()).await.map_err(|e| e.to_string())?
    }

    fn start(&self, pipe: Pipe) -> Arc<Conn> {
        let (out, frames) = mpsc::channel::<Vec<u8>>();
        let conn = Arc::new(Conn {
            out: Mutex::new(Some(out)),
            pending: Mutex::new(Some(HashMap::new())),
            next: AtomicU64::new(0),
        });
        let Pipe { reader, mut writer } = pipe;
        std::thread::Builder::new()
            .name("engine-write".into())
            .spawn(move || {
                for bytes in frames {
                    if wire::write_frames(&mut writer, &bytes).is_err() {
                        return;
                    }
                }
            })
            .expect("spawn engine writer");
        let (me, reading) = (self.me.clone(), Arc::clone(&conn));
        std::thread::Builder::new()
            .name("engine-read".into())
            .spawn(move || read(me, reading, reader))
            .expect("spawn engine reader");
        conn
    }

    /// A `conversation` event from the engine: held while a start is open,
    /// sent otherwise.
    fn conversation(&self, event: ConversationEvent) {
        let mut call = self.call.lock().unwrap();
        if call.holding {
            call.held.push(event);
        } else {
            self.forward(&mut call, event);
        }
    }

    /// Emitted with `call` locked, which keeps the events in order.
    fn forward(&self, call: &mut Call, event: ConversationEvent) {
        call.turn = event.turn;
        if event.kind == "state" && event.running == Some(false) {
            call.live = false;
        }
        self.listeners.emit("conversation", &event);
    }

    fn release(&self) {
        let mut call = self.call.lock().unwrap();
        call.holding = false;
        for event in std::mem::take(&mut call.held) {
            self.forward(&mut call, event);
        }
    }

    /// The connection ended: a call that was up, or opening, failed. Runs
    /// before the waiters are answered, so a start that was waiting lets
    /// this go ahead of its error.
    fn ended(&self, conn: &Arc<Conn>) {
        {
            let mut call = self.call.lock().unwrap();
            if call.live || call.holding {
                let mut failed = ConversationEvent::new("state", call.turn);
                failed.running = Some(false);
                failed.reason = Some("failed".into());
                call.live = false;
                if call.holding {
                    call.held.push(failed);
                } else {
                    self.forward(&mut call, failed);
                }
            }
        }
        conn.end();
        let mut slot = self.conn.lock().unwrap();
        if slot.as_ref().is_some_and(|c| Arc::ptr_eq(c, conn)) {
            slot.take();
        }
    }

    // --- The call ------------------------------------------------------------

    /// `Open`. The call's events are held until `begin_emitting`; on an error
    /// they are let go first (`state failed` among them), then it is returned.
    pub async fn open(&self, files: ModelFiles, threads: Threads) -> std::result::Result<(), String> {
        let conn = match self.conn_async().await {
            Ok(conn) => conn,
            Err(e) => {
                let mut failed = ConversationEvent::new("state", 0);
                failed.running = Some(false);
                failed.reason = Some("failed".into());
                self.listeners.emit("conversation", &failed);
                return Err(e);
            }
        };
        {
            let mut call = self.call.lock().unwrap();
            call.holding = true;
            call.live = false;
        }
        let reply = match conn.request(|id| ToEngine::Open { id, files, threads }, None) {
            Ok(rx) => wait(rx).await,
            Err(e) => Err(e),
        };
        match reply {
            Ok(_) => {
                self.call.lock().unwrap().live = true;
                Ok(())
            }
            Err(e) => {
                self.release();
                Err(e)
            }
        }
    }

    /// Let the call's events through: call once the start has resolved.
    pub fn begin_emitting(&self) {
        self.release();
    }

    /// `Close`. Nothing to close (no connection, or it is gone) is fine.
    pub async fn close(&self) -> std::result::Result<(), String> {
        let Some(conn) = self.existing() else { return Ok(()) };
        let reply = match conn.request(|id| ToEngine::Close { id }, None) {
            Ok(rx) => wait(rx).await,
            Err(e) => Err(e),
        };
        self.call.lock().unwrap().live = false;
        match reply {
            Ok(_) => Ok(()),
            Err(e) if e == EXITED => Ok(()),
            Err(e) => Err(e),
        }
    }

    // --- Speech --------------------------------------------------------------

    /// `Synthesize`, blocking: `RemoteSynth` runs on the backend's blocking
    /// thread.
    pub fn synthesize(
        &self,
        model: &Path,
        phonemes: &str,
        style: &[f32],
        speed: f32,
    ) -> std::result::Result<Vec<i16>, String> {
        let conn = self.conn()?;
        let rx = conn.request(
            |id| ToEngine::Synthesize {
                id,
                model: model.display().to_string(),
                phonemes: phonemes.to_string(),
                style: style.to_vec(),
                speed,
            },
            None,
        )?;
        match rx.blocking_recv().unwrap_or_else(|_| Err(EXITED.into()))? {
            Answer::Pcm(pcm) => Ok(pcm),
            _ => Err("The engine answered a synthesis with something else.".into()),
        }
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn enqueue(
        &self,
        utterance: u64,
        index: u32,
        chars: u32,
        last: bool,
        part: u32,
        complete: bool,
        marks: SentenceMarks,
        sample_rate: u32,
        pcm: &[u8],
    ) -> std::result::Result<SpeechEnqueued, String> {
        let conn = self.conn_async().await?;
        let marks = wire::SentenceMarks {
            requested_ms: marks.requested_ms,
            first_audio_ms: marks.first_audio_ms,
            handed_ms: marks.handed_ms,
        };
        let rx = conn.request(
            |id| ToEngine::Enqueue { id, utterance, index, chars, last, part, complete, sample_rate, marks },
            Some(pcm),
        )?;
        match wait(rx).await? {
            Answer::Enqueued(a) => Ok(SpeechEnqueued {
                dropped: a.dropped,
                busy: a.busy,
                queued_ms: a.queued_ms,
                start_ms: a.start_ms,
            }),
            _ => Err("The engine answered an enqueue with something else.".into()),
        }
    }

    pub async fn finish(&self, utterance: u64) -> std::result::Result<(), String> {
        let conn = self.existing().ok_or(EXITED)?;
        wait(conn.request(|id| ToEngine::Finish { id, utterance }, None)?).await.map(|_| ())
    }

    /// Nothing to set a level on without a connection.
    pub async fn set_volume(&self, value: f64) -> std::result::Result<(), String> {
        let Some(conn) = self.existing() else { return Ok(()) };
        wait(conn.request(|id| ToEngine::SetVolume { id, value }, None)?).await.map(|_| ())
    }

    /// Where the voice was. With no engine, or one that has gone, nothing is
    /// playing: the answer `fallback.rs` gives.
    pub async fn stop_speaking(&self, reason: String) -> std::result::Result<SpeechPosition, String> {
        let silent = SpeechPosition { speaking: false, utterance: 0, index: -1, char_offset: 0, played_ms: 0.0 };
        let Some(conn) = self.existing() else { return Ok(silent) };
        let rx = match conn.request(|id| ToEngine::StopSpeaking { id, reason }, None) {
            Ok(rx) => rx,
            Err(e) if e == EXITED => return Ok(silent),
            Err(e) => return Err(e),
        };
        match wait(rx).await {
            Ok(Answer::Position(p)) => Ok(SpeechPosition {
                speaking: p.speaking,
                utterance: p.utterance,
                index: p.index,
                char_offset: p.char_offset,
                played_ms: p.played_ms,
            }),
            Ok(_) => Err("The engine answered a stop with something else.".into()),
            Err(e) if e == EXITED => Ok(silent),
            Err(e) => Err(e),
        }
    }
}

fn read(link: Weak<EngineLink>, conn: Arc<Conn>, mut reader: Box<dyn Read + Send>) {
    let _ = (|| -> io::Result<()> {
        loop {
            let Some((kind, body)) = wire::read_frame(&mut reader)? else { return Ok(()) };
            if kind != wire::CONTROL {
                return Err(io::Error::new(io::ErrorKind::InvalidData, "PCM with no message before it"));
            }
            let msg: ToMain = serde_json::from_slice(&body).map_err(io::Error::other)?;
            let pcm = if msg.has_pcm() {
                match wire::read_frame(&mut reader)? {
                    Some((wire::PCM, bytes)) => wire::pcm_samples(&bytes)?,
                    _ => return Err(io::Error::new(io::ErrorKind::InvalidData, "a PCM answer came without its PCM")),
                }
            } else {
                Vec::new()
            };
            match msg {
                ToMain::Event { event } => {
                    if let Some(link) = link.upgrade() {
                        link.conversation(event);
                    }
                }
                ToMain::Speech { event } => {
                    if let Some(link) = link.upgrade() {
                        link.listeners.emit("speech", &event);
                    }
                }
                ToMain::Done { id } => conn.answer(id, Ok(Answer::Done)),
                ToMain::Pcm { id } => conn.answer(id, Ok(Answer::Pcm(pcm))),
                ToMain::Enqueued { id, ack } => conn.answer(id, Ok(Answer::Enqueued(ack))),
                ToMain::Position { id, position } => conn.answer(id, Ok(Answer::Position(position))),
                ToMain::Error { id, message } => conn.answer(id, Err(message)),
            }
        }
    })();
    match link.upgrade() {
        Some(link) => link.ended(&conn),
        None => conn.end(),
    }
}

/// The playback half over the socket, for `DevicePlayer`.
#[async_trait]
impl SpeechOut for Arc<EngineLink> {
    async fn enqueue_speech(
        &self,
        utterance: u64,
        index: u32,
        chars: u32,
        last: bool,
        part: u32,
        complete: bool,
        marks: SentenceMarks,
        sample_rate: u32,
        pcm: Vec<u8>,
    ) -> Result<SpeechEnqueued> {
        self.enqueue(utterance, index, chars, last, part, complete, marks, sample_rate, &pcm)
            .await
            .map_err(Error::Speech)
    }

    async fn finish_speech(&self, utterance: u64) -> Result<()> {
        self.finish(utterance).await.map_err(Error::Speech)
    }

    async fn stop_speaking(&self, reason: String) -> Result<SpeechPosition> {
        EngineLink::stop_speaking(self, reason).await.map_err(Error::Speech)
    }
}

/// Kokoro in `:voice`: the phonemes, the sentence's style row and the speed
/// go over the socket, the samples come back.
pub struct RemoteSynth {
    link: Arc<EngineLink>,
    /// The fp32 model, which the engine loads if no `Open` has.
    model: PathBuf,
}

impl RemoteSynth {
    pub fn new(link: Arc<EngineLink>, model: PathBuf) -> Self {
        Self { link, model }
    }
}

impl Synthesizer for RemoteSynth {
    fn synthesize(&mut self, phonemes: &str, voice: &VoicePack, speed: f32) -> std::result::Result<Vec<f32>, String> {
        let pcm = self.link.synthesize(&self.model, phonemes, voice.style_for(phonemes), speed)?;
        // `to_pcm16le` turns these back into the very samples the engine sent.
        Ok(pcm.into_iter().map(|s| s as f32 / 32767.0).collect())
    }
}
