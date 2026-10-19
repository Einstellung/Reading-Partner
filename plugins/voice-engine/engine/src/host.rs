// The device side of the engine (docs/companion/89, 主进程和引擎之间): what
// the engine asks of whoever owns the microphone and the speaker, and the
// clock both sides stamp audio with.
//
// Kotlin's `VoiceAudio` in `:voice` is one host, the Linux virtual device
// (`virtual_device.rs`) the other. Kotlin only ever calls into Rust, so the
// engine's half of each JNI call is a method and the host's half is this
// trait:
//
//   nativeNextControl()            ControlQueue::next_json, the JNI's AudioHost
//   nativeCapture(buf, n, timeNs)  Engine::capture
//   nativeReadPlayback(buf)        Engine::read_playback(buf, PLAYBACK_WAIT)
//   nativePlaybackPosition(f, t)   Engine::playback_position
//   nativeAudioEvent(kind)         Engine::audio_event

use std::collections::VecDeque;
use std::sync::{Condvar, Mutex};
use std::time::Duration;

/// How long `nativeReadPlayback` waits for samples before answering 0.
pub const PLAYBACK_WAIT: Duration = Duration::from_millis(20);

/// One instruction for the device side.
#[derive(Clone, Debug, PartialEq)]
pub enum HostControl {
    /// Open the player, and the microphone when `capture`: communication
    /// mode, routing, focus, AudioRecord at 16 kHz, AudioTrack at 24 kHz.
    /// Sent again with `capture: true` when a call starts over speech that
    /// was playing without one.
    OpenAudio { capture: bool },
    /// Put everything `OpenAudio` changed back.
    CloseAudio,
    /// `pause()` + `flush()` the track now: what it holds is not to be heard.
    /// `read_playback` answers -1 once as well, for a writer that was not
    /// blocked when this was sent.
    Flush,
    /// The track's volume, 0..1.
    SetVolume(f32),
    /// The service is going away; `nativeNextControl` answers null after this.
    Exit,
}

impl HostControl {
    /// What `nativeNextControl` hands Kotlin.
    pub fn to_json(&self) -> String {
        match self {
            HostControl::OpenAudio { capture } => format!("{{\"kind\":\"open\",\"capture\":{capture}}}"),
            HostControl::CloseAudio => "{\"kind\":\"close\"}".into(),
            HostControl::Flush => "{\"kind\":\"flush\"}".into(),
            HostControl::SetVolume(v) => format!("{{\"kind\":\"volume\",\"value\":{v}}}"),
            HostControl::Exit => "{\"kind\":\"exit\"}".into(),
        }
    }
}

/// Whoever owns the audio devices. `control` must not block and must not call
/// back into the engine: the engine calls it with its state locked.
pub trait AudioHost: Send + Sync {
    fn control(&self, control: HostControl);
}

/// The JNI's host: controls queue up until Kotlin's control thread takes them.
#[derive(Default)]
pub struct ControlQueue {
    queue: Mutex<(VecDeque<HostControl>, bool)>,
    ready: Condvar,
}

impl ControlQueue {
    pub fn new() -> Self {
        Self::default()
    }

    /// Block until the next control. None once `Exit` has been handed out.
    pub fn next(&self) -> Option<HostControl> {
        let mut q = self.queue.lock().unwrap();
        loop {
            if q.1 {
                return None;
            }
            if let Some(c) = q.0.pop_front() {
                if c == HostControl::Exit {
                    q.1 = true;
                }
                return Some(c);
            }
            q = self.ready.wait(q).unwrap();
        }
    }

    pub fn next_json(&self) -> Option<String> {
        self.next().map(|c| c.to_json())
    }
}

impl AudioHost for ControlQueue {
    fn control(&self, control: HostControl) {
        self.queue.lock().unwrap().0.push_back(control);
        self.ready.notify_all();
    }
}

/// The clock capture and playback stamps are on: CLOCK_MONOTONIC on device,
/// which is `System.nanoTime()` and `AudioTimestamp.nanoTime`.
pub trait Clock: Send + Sync {
    fn now_ns(&self) -> i64;
}

pub struct MonotonicClock;

impl Clock for MonotonicClock {
    fn now_ns(&self) -> i64 {
        let mut ts = libc::timespec { tv_sec: 0, tv_nsec: 0 };
        // SAFETY: a valid pointer to a timespec; CLOCK_MONOTONIC always exists.
        unsafe { libc::clock_gettime(libc::CLOCK_MONOTONIC, &mut ts) };
        ts.tv_sec as i64 * 1_000_000_000 + ts.tv_nsec as i64
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    #[test]
    fn controls_queue_in_order_and_end_at_exit() {
        let q = Arc::new(ControlQueue::new());
        let reader = {
            let q = Arc::clone(&q);
            std::thread::spawn(move || std::iter::from_fn(|| q.next_json()).collect::<Vec<_>>())
        };
        q.control(HostControl::OpenAudio { capture: true });
        q.control(HostControl::SetVolume(0.25));
        q.control(HostControl::Flush);
        q.control(HostControl::CloseAudio);
        q.control(HostControl::Exit);
        let got = reader.join().unwrap();
        assert_eq!(
            got,
            [
                r#"{"kind":"open","capture":true}"#,
                r#"{"kind":"volume","value":0.25}"#,
                r#"{"kind":"flush"}"#,
                r#"{"kind":"close"}"#,
                r#"{"kind":"exit"}"#,
            ]
        );
        assert_eq!(q.next(), None);
    }

    #[test]
    fn the_monotonic_clock_moves_forward() {
        let a = MonotonicClock.now_ns();
        let b = MonotonicClock.now_ns();
        assert!(a > 0 && b >= a);
    }
}
