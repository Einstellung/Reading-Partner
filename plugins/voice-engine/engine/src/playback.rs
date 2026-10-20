// The mouth (docs/companion/89, 出声): the port of SpeechOut.swift. Sentences
// of 24 kHz PCM queue up with the book SpeechClock.swift keeps, so a cut can
// say which sentence and which character the listener had reached; the duck
// and full volumes the call switches between; the envelope of every sentence
// in 25 ms windows; the refusal of a turn the user has talked over.
//
// What differs from iOS is the device. AVAudioPlayerNode pulls scheduled
// buffers; here the track's writer thread pulls samples (`read`) and reports
// what it has played (`report`, AudioTrack.getTimestamp). An AudioTrack that
// runs out stops counting until it is written to again, so a gap inside a
// sentence needs no padding in the book: the track's frames are the book's
// frames. The playhead is the last report carried forward at 24 kHz, never
// past what was handed out.
//
// No locks and no threads: the engine owns one `Playback` under its state lock
// and drains `effects` after each call.

use std::collections::VecDeque;

use voice_wire::{SpeechEnqueued, SpeechPosition};

use crate::host::HostControl;

pub const RATE: u32 = 24_000;
/// The envelope's window: 600 frames, 25 ms (SpeechOut.envelopeFrames).
pub const ENVELOPE_FRAMES: usize = 600;
pub const ENVELOPE_WINDOW_MS: f64 = 1000.0 * ENVELOPE_FRAMES as f64 / RATE as f64;
/// The output meter's window, 100 ms (SpeechOut.tapFrames).
const LEVEL_FRAMES: usize = 2400;
const QUIET_DB: f64 = -40.0;
const LOUD_DB: f64 = -9.0;
/// DEFAULT_VOICE_SESSION in src/soul/voice/voice-session.ts.
const FULL_VOLUME: f32 = 1.0;
const DUCK_VOLUME: f32 = 0.25;

/// dBFS to the 0..1 the webview draws (SpeechOut.mapLevel).
pub fn map_level(db: f64) -> f64 {
    ((db - QUIET_DB) / (LOUD_DB - QUIET_DB)).clamp(0.0, 1.0)
}

pub fn level_db(rms: f64) -> f64 {
    if rms > 0.0 {
        20.0 * rms.log10()
    } else {
        -160.0
    }
}

/// What a call into the playback asks of the engine, in order.
#[derive(Debug, Clone, PartialEq)]
pub enum Effect {
    /// A `speech` event: `speaking` 1/0 or the output `level`.
    Speech { kind: &'static str, value: f64, reason: Option<String> },
    /// A turn's playback ended (`spoken` on the call's stream).
    Spoken { utterance: u64, reason: String },
    /// One sentence's envelope, ahead of it being heard.
    Envelope { utterance: u64, index: i64, starts_in_ms: f64, values: Vec<f64> },
    Host(HostControl),
    /// A turn's playback began: the turn detector's immunity window opens.
    Started,
    /// It ended or was stopped: the window closes.
    Stopped,
}

#[derive(Debug, Clone, Copy, PartialEq)]
struct Segment {
    index: i64,
    chars: i64,
    start: i64,
    frames: i64,
}

/// SpeechClock.swift: which sentence a frame of the turn falls in.
#[derive(Debug, Clone, Default)]
pub struct SpeechClock {
    segments: Vec<Segment>,
    queued: i64,
}

impl SpeechClock {
    pub fn reset(&mut self) {
        self.segments.clear();
        self.queued = 0;
    }

    pub fn queued(&self) -> i64 {
        self.queued
    }

    /// A new sentence on the end; its first frame.
    pub fn append(&mut self, index: i64, chars: i64, frames: i64) -> i64 {
        let start = self.queued;
        self.segments.push(Segment { index, chars, start, frames });
        self.queued += frames;
        start
    }

    /// More of the last sentence; where the new frames start.
    pub fn extend(&mut self, frames: i64) -> i64 {
        let start = self.queued;
        if let Some(last) = self.segments.last_mut() {
            last.frames += frames;
            self.queued += frames;
        }
        start
    }

    /// The sentence and the character a frame is at, linearly interpolated.
    pub fn locate(&self, frame: i64) -> Option<(i64, i64)> {
        let first = self.segments.first()?;
        if frame < first.start {
            return Some((first.index, 0));
        }
        for s in &self.segments {
            if frame >= s.start && frame < s.start + s.frames {
                let offset = if s.frames > 0 { s.chars * (frame - s.start) / s.frames } else { 0 };
                return Some((s.index, offset.min(s.chars)));
            }
        }
        self.segments.last().map(|s| (s.index, s.chars))
    }

    pub fn ms_for(frame: i64) -> f64 {
        frame as f64 / RATE as f64 * 1000.0
    }
}

pub struct Playback {
    speaking: bool,
    utterance: u64,
    saw_last: bool,
    /// The sentence whose pieces are still arriving.
    open_index: Option<i64>,
    clock: SpeechClock,
    /// Samples not yet handed to the track.
    queue: VecDeque<i16>,
    /// Frames handed to the track since its last flush: the track's own count.
    handed: i64,
    /// The track frame this turn's frame 0 sits on.
    base: i64,
    /// The last (track frame, time) the track reported, or where it restarted.
    heard: Option<(i64, i64)>,
    /// The track has to be flushed before it is handed anything else; what
    /// it reports until then is from before the flush.
    flush_pending: bool,
    full_volume: f32,
    duck_volume: f32,
    ducked: bool,
    /// The last turn a barge-in cut, refused from then on.
    cut_utterance: Option<u64>,
    refusal: u64,
    refusing_since: u64,
    level_sum: f64,
    level_frames: usize,
    pub effects: Vec<Effect>,
}

impl Default for Playback {
    fn default() -> Self {
        Self::new()
    }
}

fn dropped() -> SpeechEnqueued {
    SpeechEnqueued { dropped: true, busy: false, queued_ms: 0.0, start_ms: 0.0 }
}

fn frames_ms(frames: i64) -> f64 {
    frames as f64 / RATE as f64 * 1000.0
}

impl Playback {
    pub fn new() -> Self {
        Self {
            speaking: false,
            utterance: 0,
            saw_last: false,
            open_index: None,
            clock: SpeechClock::default(),
            queue: VecDeque::new(),
            handed: 0,
            base: 0,
            heard: None,
            flush_pending: false,
            full_volume: FULL_VOLUME,
            duck_volume: DUCK_VOLUME,
            ducked: false,
            cut_utterance: None,
            refusal: 0,
            refusing_since: 0,
            level_sum: 0.0,
            level_frames: 0,
            effects: Vec::new(),
        }
    }

    pub fn is_speaking(&self) -> bool {
        self.speaking
    }

    /// Whether `read` has something to answer right now.
    pub fn readable(&self) -> bool {
        self.flush_pending || !self.queue.is_empty()
    }

    /// The track frame the listener is at: the last report carried forward.
    fn heard_track(&self, now_ns: i64) -> i64 {
        let Some((frames, at)) = self.heard else { return 0 };
        let ahead = (now_ns - at).max(0) as i128 * RATE as i128 / 1_000_000_000;
        (frames as i128 + ahead).min(self.handed as i128).max(0) as i64
    }

    /// Frames of this turn the listener has heard.
    fn played(&self, now_ns: i64) -> i64 {
        (self.heard_track(now_ns) - self.base).max(0)
    }

    fn position_at(&self, now_ns: i64) -> SpeechPosition {
        let frame = self.played(now_ns);
        let (index, char_offset) = self.clock.locate(frame).unwrap_or((-1, 0));
        SpeechPosition {
            speaking: self.speaking,
            utterance: self.utterance,
            index,
            char_offset,
            played_ms: SpeechClock::ms_for(frame),
        }
    }

    /// Where the voice is, or None when it is not speaking.
    pub fn position(&self, now_ns: i64) -> Option<SpeechPosition> {
        self.speaking.then(|| self.position_at(now_ns))
    }

    /// One sentence, or one piece of it, on the back of the queue
    /// (SpeechOut.enqueue: the same refusals in the same order).
    #[allow(clippy::too_many_arguments)]
    pub fn enqueue(
        &mut self,
        now_ns: i64,
        utterance: u64,
        index: u32,
        chars: u32,
        last: bool,
        part: u32,
        complete: bool,
        sample_rate: u32,
        pcm: &[i16],
    ) -> Result<SpeechEnqueued, String> {
        if sample_rate != RATE {
            return Err(format!(
                "This voice speaks at {sample_rate} Hz and the player is wired for {RATE} Hz."
            ));
        }
        if self.cut_utterance.is_some_and(|cut| utterance <= cut) {
            return Ok(dropped());
        }
        if self.refusing_since != 0 && utterance > self.utterance {
            self.cut_utterance = Some(utterance);
            return Ok(dropped());
        }
        if self.speaking && utterance > self.utterance {
            let ahead = (self.clock.queued() - self.played(now_ns)).max(0);
            return Ok(SpeechEnqueued { dropped: true, busy: true, queued_ms: frames_ms(ahead), start_ms: 0.0 });
        }
        if utterance < self.utterance || (!self.speaking && part > 0) {
            return Ok(dropped());
        }
        if pcm.is_empty() {
            return Err("That sentence arrived with no audio in it.".into());
        }

        let mut envelope = Vec::with_capacity(pcm.len() / ENVELOPE_FRAMES + 1);
        for window in pcm.chunks(ENVELOPE_FRAMES) {
            let sum: f64 = window.iter().map(|&s| (s as f64 / 32768.0).powi(2)).sum();
            envelope.push(map_level(level_db((sum / window.len() as f64).sqrt())));
        }

        if !self.speaking {
            self.begin(utterance);
        }
        let index = index as i64;
        let frames = pcm.len() as i64;
        let start = if self.open_index == Some(index) {
            self.clock.extend(frames)
        } else {
            self.clock.append(index, chars as i64, frames)
        };
        self.open_index = if complete { None } else { Some(index) };
        if last && complete {
            self.saw_last = true;
        }
        self.queue.extend(pcm.iter().copied());

        let played = self.played(now_ns);
        self.effects.push(Effect::Envelope {
            utterance,
            index,
            starts_in_ms: frames_ms((start - played).max(0)),
            values: envelope,
        });
        Ok(SpeechEnqueued {
            dropped: false,
            busy: false,
            queued_ms: frames_ms((self.clock.queued() - played).max(0)),
            start_ms: frames_ms(start),
        })
    }

    /// This turn has no more sentences.
    pub fn finish(&mut self, utterance: u64, now_ns: i64) {
        if self.speaking && utterance == self.utterance {
            self.saw_last = true;
            self.drain(now_ns);
        }
    }

    /// Cut the voice off: the position first, then the flush.
    pub fn stop(&mut self, reason: &str, now_ns: i64) -> SpeechPosition {
        if !self.speaking {
            return SpeechPosition { speaking: false, utterance: self.utterance, index: -1, char_offset: 0, played_ms: 0.0 };
        }
        let at = self.position_at(now_ns);
        self.queue.clear();
        self.handed = 0;
        self.base = 0;
        self.heard = None;
        self.flush_pending = true;
        self.effects.push(Effect::Host(HostControl::Flush));
        self.end(reason);
        at
    }

    /// The barge-in's own stop (SpeechOut.actLocked `.stop`): cut what plays,
    /// refuse turns opened before the user's ends, and lift the duck. The
    /// position is None when nothing was playing; the token goes back to
    /// `user_turn_ended`.
    pub fn cut(&mut self, now_ns: i64) -> (Option<SpeechPosition>, u64) {
        let at = if self.speaking {
            self.cut_utterance = Some(self.utterance);
            Some(self.stop("interrupted", now_ns))
        } else {
            None
        };
        self.refusal += 1;
        self.refusing_since = self.refusal;
        self.ducked = false;
        self.apply_volume();
        (at, self.refusal)
    }

    /// The user's turn that `cut` opened is over. A stale token changes nothing.
    pub fn user_turn_ended(&mut self, token: u64) {
        if self.refusing_since == token {
            self.refusing_since = 0;
        }
    }

    /// A call ended: no turn of it is refused any more, and the volume is full.
    pub fn detach(&mut self) {
        self.refusing_since = 0;
        if self.ducked {
            self.ducked = false;
            self.apply_volume();
        }
    }

    pub fn duck(&mut self, on: bool) {
        self.ducked = on;
        self.apply_volume();
    }

    /// `set_speech_volume`: the level the call is in right now, 0..1.
    pub fn set_volume(&mut self, value: f64) {
        let level = value.clamp(0.0, 1.0) as f32;
        if self.ducked {
            self.duck_volume = level;
        } else {
            self.full_volume = level;
        }
        self.apply_volume();
    }

    /// The device went away under the voice. Nothing is replayed.
    pub fn lost(&mut self) {
        if !self.speaking {
            return;
        }
        self.queue.clear();
        self.handed = 0;
        self.base = 0;
        self.heard = None;
        self.end("lost");
    }

    /// The audio was closed with nothing playing (`CloseAudio`): the track is
    /// gone, and the next one counts its frames from zero with nothing to
    /// flush.
    pub fn track_closed(&mut self) {
        self.queue.clear();
        self.handed = 0;
        self.base = 0;
        self.heard = None;
        self.flush_pending = false;
    }

    /// The writer thread asks for samples. -1: flush the track first.
    pub fn read(&mut self, buf: &mut [i16], now_ns: i64) -> i32 {
        if self.flush_pending {
            self.flush_pending = false;
            return -1;
        }
        self.drain(now_ns);
        if self.queue.is_empty() || buf.is_empty() {
            return 0;
        }
        // A track that ran out starts again with these samples, now.
        if self.heard_track(now_ns) >= self.handed {
            self.heard = Some((self.handed, now_ns));
        }
        let n = buf.len().min(self.queue.len());
        for (slot, s) in buf[..n].iter_mut().zip(self.queue.drain(..n)) {
            *slot = s;
            let v = s as f64 / 32768.0;
            self.level_sum += v * v;
            self.level_frames += 1;
            if self.level_frames == LEVEL_FRAMES {
                let db = level_db((self.level_sum / LEVEL_FRAMES as f64).sqrt());
                self.effects.push(Effect::Speech { kind: "level", value: map_level(db), reason: None });
                self.level_sum = 0.0;
                self.level_frames = 0;
            }
        }
        self.handed += n as i64;
        n as i32
    }

    /// AudioTrack.getTimestamp: `frames` of the track were heard at `at_ns`.
    pub fn report(&mut self, frames: i64, at_ns: i64, now_ns: i64) {
        if self.flush_pending {
            return;
        }
        self.heard = Some((frames.clamp(0, self.handed), at_ns));
        self.drain(now_ns);
    }

    fn begin(&mut self, utterance: u64) {
        self.speaking = true;
        self.utterance = utterance;
        self.saw_last = false;
        self.open_index = None;
        self.clock.reset();
        self.base = self.handed;
        self.level_sum = 0.0;
        self.level_frames = 0;
        self.effects.push(Effect::Started);
        self.apply_volume();
        self.effects.push(Effect::Speech { kind: "speaking", value: 1.0, reason: None });
    }

    /// Everything heard: the turn is done, or starved (SpeechOut.completed).
    fn drain(&mut self, now_ns: i64) {
        if !self.speaking || !self.queue.is_empty() || self.played(now_ns) < self.clock.queued() {
            return;
        }
        if self.open_index.is_some() && !self.saw_last {
            return;
        }
        let reason = if self.saw_last { "done" } else { "underrun" };
        self.end(reason);
    }

    fn end(&mut self, reason: &str) {
        self.speaking = false;
        self.open_index = None;
        self.effects.push(Effect::Stopped);
        self.effects.push(Effect::Speech { kind: "level", value: 0.0, reason: None });
        self.effects.push(Effect::Speech { kind: "speaking", value: 0.0, reason: Some(reason.into()) });
        self.effects.push(Effect::Spoken { utterance: self.utterance, reason: reason.into() });
    }

    fn apply_volume(&mut self) {
        let v = if self.ducked { self.duck_volume } else { self.full_volume };
        self.effects.push(Effect::Host(HostControl::SetVolume(v)));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const MS: i64 = 1_000_000;

    fn tone(frames: usize) -> Vec<i16> {
        (0..frames).map(|i| ((i as f32 * 0.05).sin() * 8000.0) as i16).collect()
    }

    fn spoken(p: &Playback) -> Vec<(u64, String)> {
        p.effects
            .iter()
            .filter_map(|e| match e {
                Effect::Spoken { utterance, reason } => Some((*utterance, reason.clone())),
                _ => None,
            })
            .collect()
    }

    #[test]
    fn the_clock_locates_sentences_and_characters() {
        let mut c = SpeechClock::default();
        assert_eq!(c.locate(0), None);
        assert_eq!(c.append(0, 10, 1000), 0);
        assert_eq!(c.append(1, 4, 400), 1000);
        assert_eq!(c.extend(400), 1400);
        assert_eq!(c.locate(0), Some((0, 0)));
        assert_eq!(c.locate(500), Some((0, 5)));
        assert_eq!(c.locate(1000), Some((1, 0)));
        assert_eq!(c.locate(1600), Some((1, 3)));
        assert_eq!(c.locate(5000), Some((1, 4)));
    }

    #[test]
    fn a_turn_plays_to_done_by_the_reported_playhead() {
        let mut p = Playback::new();
        let ack = p.enqueue(0, 1, 0, 5, false, 0, true, RATE, &tone(2400)).unwrap();
        assert!(!ack.dropped && ack.queued_ms == 100.0 && ack.start_ms == 0.0);
        let ack = p.enqueue(0, 1, 1, 5, true, 0, true, RATE, &tone(2400)).unwrap();
        assert_eq!(ack.start_ms, 100.0);
        let mut buf = vec![0i16; 6000];
        assert_eq!(p.read(&mut buf, 0), 4800);
        assert_eq!(p.read(&mut buf, 0), 0);
        // Half of it heard: still speaking, at sentence 1's start.
        p.report(2400, 100 * MS, 100 * MS);
        let at = p.position(100 * MS).unwrap();
        assert_eq!((at.index, at.char_offset, at.played_ms), (1, 0, 100.0));
        assert!(spoken(&p).is_empty());
        // Carried forward to the end without another report.
        assert_eq!(p.read(&mut buf, 200 * MS), 0);
        assert_eq!(spoken(&p), [(1, "done".to_string())]);
        assert!(!p.is_speaking());
    }

    #[test]
    fn a_turn_without_its_last_sentence_starves_unless_mid_sentence() {
        let mut p = Playback::new();
        let mut buf = vec![0i16; 6000];
        // Mid-sentence: the next piece is awaited with the track dry.
        p.enqueue(0, 1, 0, 5, false, 0, false, RATE, &tone(2400)).unwrap();
        p.read(&mut buf, 0);
        p.report(2400, 100 * MS, 300 * MS);
        assert!(p.is_speaking());
        // The rest arrives 200 ms late; the track restarts on it.
        p.enqueue(300 * MS, 1, 0, 5, false, 1, true, RATE, &tone(2400)).unwrap();
        assert_eq!(p.read(&mut buf, 300 * MS), 2400);
        let at = p.position(350 * MS).unwrap();
        assert_eq!((at.index, at.played_ms), (0, 150.0));
        p.report(4800, 400 * MS, 400 * MS);
        assert_eq!(spoken(&p), [(1, "underrun".to_string())]);
    }

    #[test]
    fn a_stop_reads_the_position_then_flushes() {
        let mut p = Playback::new();
        let mut buf = vec![0i16; 1200];
        p.enqueue(0, 3, 0, 24, true, 0, true, RATE, &tone(4800)).unwrap();
        assert_eq!(p.read(&mut buf, 0), 1200);
        p.report(600, 50 * MS, 50 * MS);
        // 600 frames reported, 600 more by the time of the stop, capped at 1200.
        let at = p.stop("interrupted", 100 * MS);
        assert_eq!((at.index, at.char_offset, at.played_ms), (0, 6, 50.0));
        assert!(p.effects.contains(&Effect::Host(HostControl::Flush)));
        // A report from before the flush is ignored; the writer flushes once.
        p.report(1200, 120 * MS, 120 * MS);
        assert_eq!(p.read(&mut buf, 120 * MS), -1);
        assert_eq!(p.read(&mut buf, 120 * MS), 0);
        assert_eq!(spoken(&p), [(3, "interrupted".to_string())]);
        // The next turn counts from the flushed track's zero.
        p.enqueue(130 * MS, 4, 0, 2, true, 0, true, RATE, &tone(240)).unwrap();
        assert_eq!(p.read(&mut buf, 130 * MS), 240);
        assert_eq!(p.position(130 * MS).unwrap().played_ms, 0.0);
    }

    #[test]
    fn a_cut_turn_and_turns_opened_over_the_user_are_refused() {
        let mut p = Playback::new();
        let mut buf = vec![0i16; 4800];
        p.enqueue(0, 2, 0, 5, false, 0, true, RATE, &tone(2400)).unwrap();
        p.read(&mut buf, 0);
        // Ahead of what plays: busy, with what is left.
        let ack = p.enqueue(0, 3, 0, 5, false, 0, true, RATE, &tone(240)).unwrap();
        assert!(ack.dropped && ack.busy && ack.queued_ms == 100.0);
        let (at, token) = p.cut(0);
        assert_eq!(at.unwrap().utterance, 2);
        // The cut turn, and a later turn while the user has the floor.
        assert!(p.enqueue(0, 2, 1, 5, true, 0, true, RATE, &tone(240)).unwrap().dropped);
        let ack = p.enqueue(0, 3, 0, 5, true, 0, true, RATE, &tone(240)).unwrap();
        assert!(ack.dropped && !ack.busy);
        p.user_turn_ended(token);
        // Turn 3 was remembered as cut; turn 4, asked for after, plays.
        assert!(p.enqueue(0, 3, 0, 5, true, 0, true, RATE, &tone(240)).unwrap().dropped);
        assert!(!p.enqueue(0, 4, 0, 5, true, 0, true, RATE, &tone(240)).unwrap().dropped);
        assert!(p.enqueue(0, 4, 0, 5, true, 0, true, 16_000, &tone(240)).is_err());
    }

    #[test]
    fn the_duck_and_set_volume_write_whichever_level_is_live() {
        let mut p = Playback::new();
        p.duck(true);
        p.set_volume(0.1);
        p.duck(false);
        p.set_volume(0.8);
        p.duck(true);
        let volumes: Vec<f32> = p
            .effects
            .iter()
            .filter_map(|e| match e {
                Effect::Host(HostControl::SetVolume(v)) => Some(*v),
                _ => None,
            })
            .collect();
        assert_eq!(volumes, [0.25, 0.1, 1.0, 0.8, 0.1]);
    }

    #[test]
    fn the_envelope_is_25_ms_windows_with_the_short_tail_kept() {
        let mut p = Playback::new();
        p.enqueue(0, 1, 0, 5, true, 0, true, RATE, &tone(1300)).unwrap();
        let env = p.effects.iter().find_map(|e| match e {
            Effect::Envelope { values, starts_in_ms, .. } => Some((values.clone(), *starts_in_ms)),
            _ => None,
        });
        let (values, starts) = env.unwrap();
        assert_eq!(values.len(), 3);
        assert_eq!(starts, 0.0);
        assert!(values.iter().all(|v| (0.0..=1.0).contains(v) && *v > 0.5));
    }
}
