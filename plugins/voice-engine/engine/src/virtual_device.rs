// The Linux stand-in for Kotlin's VoiceAudio (docs/companion/89, 切片 4): a
// microphone fed from a buffer, a track that plays 24 kHz frames into memory,
// and a clock that moves only when the device steps. No sound card is opened.
//
// One `step` is one microphone buffer, 32 ms, in the order the two Kotlin
// threads would interleave it: the clock moves on, a pending flush empties the
// track, the track plays the 32 ms that just went by, the writer tops it up
// from `read_playback` and reports its frame count, then the microphone buffer
// goes in. A step waits for Smart Turn to judge whatever pause it raised
// (`Engine::quiesce`), so the fast-forward clock never outruns the model.

use std::collections::VecDeque;
use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant};

use crate::call::{Engine, Out};
use crate::host::{AudioHost, Clock, HostControl};

/// One microphone buffer: 512 samples at 16 kHz, one Silero frame.
pub const MIC_FRAME: usize = 512;
pub const STEP_NS: i64 = 32_000_000;
/// What the track plays in one step at 24 kHz.
pub const PLAY_FRAMES: usize = 768;
/// The track's own buffer, 100 ms.
const TRACK_FRAMES: usize = 2400;

pub struct VirtualClock(AtomicI64);

impl VirtualClock {
    pub fn new(start_ns: i64) -> Self {
        Self(AtomicI64::new(start_ns))
    }

    pub fn advance(&self, ns: i64) {
        self.0.fetch_add(ns, Ordering::SeqCst);
    }
}

impl Clock for VirtualClock {
    fn now_ns(&self) -> i64 {
        self.0.load(Ordering::SeqCst)
    }
}

#[derive(Default)]
struct HostState {
    controls: Vec<HostControl>,
    /// `Some(capture)` while the audio is open.
    open: Option<bool>,
    volume: f32,
    flush: bool,
}

/// Records every control and keeps the device's state from them.
pub struct VirtualHost {
    state: Mutex<HostState>,
}

impl VirtualHost {
    fn new() -> Self {
        Self { state: Mutex::new(HostState { volume: 1.0, ..HostState::default() }) }
    }

    pub fn controls(&self) -> Vec<HostControl> {
        self.state.lock().unwrap().controls.clone()
    }

    pub fn open(&self) -> Option<bool> {
        self.state.lock().unwrap().open
    }

    pub fn volume(&self) -> f32 {
        self.state.lock().unwrap().volume
    }

    fn take_flush(&self) -> bool {
        std::mem::take(&mut self.state.lock().unwrap().flush)
    }
}

impl AudioHost for VirtualHost {
    fn control(&self, control: HostControl) {
        let mut s = self.state.lock().unwrap();
        match &control {
            HostControl::OpenAudio { capture } => s.open = Some(*capture),
            HostControl::CloseAudio | HostControl::Exit => s.open = None,
            HostControl::Flush => s.flush = true,
            HostControl::SetVolume(v) => s.volume = *v,
        }
        s.controls.push(control);
    }
}

/// Every event the engine sent, with the virtual time it was sent at.
#[derive(Default)]
pub struct Events {
    list: Mutex<Vec<(i64, Out)>>,
    more: Condvar,
}

impl Events {
    pub fn all(&self) -> Vec<(i64, Out)> {
        self.list.lock().unwrap().clone()
    }

    /// Wait, in real time, until `done` holds for the events so far.
    pub fn wait_for(&self, timeout: Duration, done: impl Fn(&[(i64, Out)]) -> bool) -> Vec<(i64, Out)> {
        let deadline = Instant::now() + timeout;
        let mut list = self.list.lock().unwrap();
        while !done(&list) {
            let left = deadline.saturating_duration_since(Instant::now());
            assert!(!left.is_zero(), "timed out after {timeout:?}; events: {:#?}", *list);
            list = self.more.wait_timeout(list, left).unwrap().0;
        }
        list.clone()
    }
}

pub struct VirtualDevice {
    pub engine: Arc<Engine>,
    pub clock: Arc<VirtualClock>,
    pub host: Arc<VirtualHost>,
    pub events: Arc<Events>,
    /// Wait for Smart Turn after each step (the default).
    pub quiesce: bool,
    track: VecDeque<i16>,
    /// Frames played since the track's last flush, which is what it reports.
    played: i64,
    /// Every frame the track played, at its volume, flushes and all.
    pub heard: Vec<f32>,
    /// (time, frames since the flush) for every report.
    pub reports: Vec<(i64, i64)>,
}

impl Default for VirtualDevice {
    fn default() -> Self {
        Self::new()
    }
}

impl VirtualDevice {
    pub fn new() -> Self {
        let clock = Arc::new(VirtualClock::new(1_000_000_000));
        let host = Arc::new(VirtualHost::new());
        let events = Arc::new(Events::default());
        let (sink, at) = (Arc::clone(&events), Arc::clone(&clock));
        let engine = Engine::new(
            host.clone(),
            clock.clone(),
            Box::new(move |out| {
                sink.list.lock().unwrap().push((at.now_ns(), out));
                sink.more.notify_all();
            }),
        );
        Self {
            engine: Arc::new(engine),
            clock,
            host,
            events,
            quiesce: true,
            track: VecDeque::new(),
            played: 0,
            heard: Vec::new(),
            reports: Vec::new(),
        }
    }

    /// One microphone buffer of exactly `MIC_FRAME` samples. Returns the frame
    /// count the track reported in this step.
    pub fn step(&mut self, mic: &[i16]) -> i64 {
        assert_eq!(mic.len(), MIC_FRAME);
        self.clock.advance(STEP_NS);
        let now = self.clock.now_ns();
        if self.host.take_flush() {
            self.flush();
        }
        if self.host.open().is_some() {
            let volume = self.host.volume();
            let n = PLAY_FRAMES.min(self.track.len());
            self.heard.extend(self.track.drain(..n).map(|s| s as f32 / 32768.0 * volume));
            self.heard.extend(std::iter::repeat(0.0).take(PLAY_FRAMES - n));
            self.played += n as i64;
            self.fill();
            self.engine.playback_position(self.played, now);
            self.reports.push((now, self.played));
        }
        self.engine.capture(mic, now);
        if self.quiesce {
            self.engine.quiesce();
        }
        self.played
    }

    /// The writer thread's loop, without blocking: top the track up.
    fn fill(&mut self) {
        let mut buf = [0i16; TRACK_FRAMES];
        while self.track.len() < TRACK_FRAMES {
            let room = TRACK_FRAMES - self.track.len();
            match self.engine.read_playback(&mut buf[..room], Duration::ZERO) {
                -1 => self.flush(),
                0 => break,
                n => self.track.extend(&buf[..n as usize]),
            }
        }
    }

    fn flush(&mut self) {
        self.track.clear();
        self.played = 0;
    }

    /// Feed `samples` to the microphone, the last buffer padded with silence.
    pub fn feed(&mut self, samples: &[i16]) {
        for chunk in samples.chunks(MIC_FRAME) {
            let mut frame = [0i16; MIC_FRAME];
            frame[..chunk.len()].copy_from_slice(chunk);
            self.step(&frame);
        }
    }

    /// Silence for at least `ms`.
    pub fn idle(&mut self, ms: u64) {
        let steps = (ms as i64 * 1_000_000 + STEP_NS - 1) / STEP_NS;
        for _ in 0..steps {
            self.step(&[0; MIC_FRAME]);
        }
    }

    /// The frame count reported at `at_ns`, if the track reported then.
    pub fn reported_at(&self, at_ns: i64) -> Option<i64> {
        self.reports.iter().find(|(t, _)| *t == at_ns).map(|(_, f)| *f)
    }

    /// Frames still in the track.
    pub fn track_len(&self) -> usize {
        self.track.len()
    }
}
