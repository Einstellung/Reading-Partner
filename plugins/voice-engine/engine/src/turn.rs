// Who is talking, decided from one number per audio step (docs/33, docs/45,
// docs/companion/89). A line-by-line port of src/soul/voice/turn-detect.ts,
// the third copy beside plugins/voice/ios/Sources/VoiceTurn.swift; the
// reasoning behind every rule and default lives in the TypeScript and is not
// repeated here. Keep the three in step.
//
// Two edges are found in the stream: the user started (duck the playback,
// escalate to a stop if the voice holds past `confirm_ms`) and the user
// stopped (a `pause` for the end-of-turn model on the neural path, `end` on
// its yes or after the hangover). Pure: no clock, no I/O; `at_ms` is a
// monotonic wall clock the caller passes in.

/// What one step can announce. At most one per step.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum TurnEvent {
    /// Someone crossed the line and it looks like the user: drop the volume.
    Duck,
    /// The voice held past `confirm_ms`: stop the playback, the turn is theirs.
    Stop,
    /// It went quiet before `confirm_ms`: the duck was a false alarm.
    Resume,
    /// The user stopped; `silent_ms` is the measured gap since their last
    /// voiced step. Only ever follows a `Stop`.
    End { silent_ms: f64 },
    /// Mid-turn silence reached `pause_ms`: ask the end-of-turn model, and
    /// hand `complete` the stamp of the step that announced this.
    Pause { silent_ms: f64 },
}

/// What counts as voice: the level (`Energy`) or a VAD's probability, gated
/// on the level while the companion plays (`Neural`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Vad {
    Energy,
    Neural,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct TurnDetectConfig {
    pub start_db: f64,
    pub start_frames: u32,
    pub confirm_ms: f64,
    pub resume_ms: f64,
    pub hangover_ms: f64,
    pub resume_guard_ms: f64,
    pub immunity_ms: f64,
    pub vad: Vad,
    pub speech_threshold: f64,
    /// None announces no `pause`: the hangover alone ends the turn.
    pub pause_ms: Option<f64>,
}

pub const DEFAULT_TURN_DETECT: TurnDetectConfig = TurnDetectConfig {
    start_db: -35.0,
    start_frames: 1,
    confirm_ms: 300.0,
    resume_ms: 300.0,
    hangover_ms: 1250.0,
    resume_guard_ms: 300.0,
    immunity_ms: 2000.0,
    vad: Vad::Energy,
    speech_threshold: 0.5,
    pause_ms: None,
};

/// A partial config, `Partial<TurnDetectConfig>` in the TypeScript.
/// `start_frames` is a float there and is floored on resolve.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct TurnDetectPatch {
    pub start_db: Option<f64>,
    pub start_frames: Option<f64>,
    pub confirm_ms: Option<f64>,
    pub resume_ms: Option<f64>,
    pub hangover_ms: Option<f64>,
    pub resume_guard_ms: Option<f64>,
    pub immunity_ms: Option<f64>,
    pub vad: Option<Vad>,
    pub speech_threshold: Option<f64>,
    pub pause_ms: Option<Option<f64>>,
}

impl TurnDetectPatch {
    pub const NONE: TurnDetectPatch = TurnDetectPatch {
        start_db: None,
        start_frames: None,
        confirm_ms: None,
        resume_ms: None,
        hangover_ms: None,
        resume_guard_ms: None,
        immunity_ms: None,
        vad: None,
        speech_threshold: None,
        pause_ms: None,
    };
}

impl Default for TurnDetectPatch {
    fn default() -> Self {
        Self::NONE
    }
}

/// The neural path's patch over the defaults (docs/136 starting values).
pub const NEURAL_TURN_DETECT: TurnDetectPatch = TurnDetectPatch {
    vad: Some(Vad::Neural),
    pause_ms: Some(Some(250.0)),
    hangover_ms: Some(2500.0),
    ..TurnDetectPatch::NONE
};

/// Fill in the defaults and clamp what a caller can get wrong: fewer than one
/// frame is one frame, negative durations are zero.
pub fn resolve_turn_detect_config(patch: &TurnDetectPatch) -> TurnDetectConfig {
    let d = DEFAULT_TURN_DETECT;
    let ms = |v: Option<f64>, default: f64| v.unwrap_or(default).max(0.0);
    TurnDetectConfig {
        start_db: patch.start_db.unwrap_or(d.start_db),
        start_frames: patch.start_frames.map_or(d.start_frames, |f| f.floor().max(1.0) as u32),
        confirm_ms: ms(patch.confirm_ms, d.confirm_ms),
        resume_ms: ms(patch.resume_ms, d.resume_ms),
        hangover_ms: ms(patch.hangover_ms, d.hangover_ms),
        resume_guard_ms: ms(patch.resume_guard_ms, d.resume_guard_ms),
        immunity_ms: ms(patch.immunity_ms, d.immunity_ms),
        vad: patch.vad.unwrap_or(d.vad),
        speech_threshold: patch.speech_threshold.unwrap_or(d.speech_threshold),
        pause_ms: patch.pause_ms.unwrap_or(d.pause_ms).map(|p| p.max(0.0)),
    }
}

/// `Idle`: the companion talks unimpeded. `Ducked`: volume down pending a
/// verdict. `Speaking`: the user holds the turn, playback stopped.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TurnPhase {
    Idle,
    Ducked,
    Speaking,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct TurnDetectState {
    pub phase: TurnPhase,
    /// Consecutive loud steps seen while idle, capped at `start_frames`.
    pub loud_frames: u32,
    /// Stamp of the most recent loud step of the current duck or turn.
    pub last_voice_ms: f64,
    /// Stamp of the duck that opened the current `Ducked` phase.
    pub ducked_at_ms: f64,
    /// Stamp of the last `Resume`.
    pub last_resume_ms: Option<f64>,
    /// Stamp of the playback whose immunity window is open.
    pub playback_started_ms: Option<f64>,
    /// Stamp of the step that announced the standing `Pause`.
    pub paused_at_ms: Option<f64>,
}

pub const INITIAL_TURN_DETECT_STATE: TurnDetectState = TurnDetectState {
    phase: TurnPhase::Idle,
    loud_frames: 0,
    last_voice_ms: 0.0,
    ducked_at_ms: 0.0,
    last_resume_ms: None,
    playback_started_ms: None,
    paused_at_ms: None,
};

/// The playback of one turn began: open the immunity window at `at_ms`.
pub fn mark_playback_started(state: &TurnDetectState, at_ms: f64) -> TurnDetectState {
    TurnDetectState { playback_started_ms: Some(at_ms), ..*state }
}

/// The playback ended or was stopped: close the window now.
pub fn mark_playback_stopped(state: &TurnDetectState) -> TurnDetectState {
    TurnDetectState { playback_started_ms: None, ..*state }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct TurnDetectStep {
    pub state: TurnDetectState,
    pub event: Option<TurnEvent>,
}

fn step(state: TurnDetectState, event: Option<TurnEvent>) -> TurnDetectStep {
    TurnDetectStep { state, event }
}

/// One step: a buffer's level in dBFS (`-inf` for digital silence) at
/// `at_ms`, and for `Vad::Neural` a frame's speech probability (NaN is not
/// speech) with `db` the trailing level at the frame's end. Driving time with
/// `db = -inf` and no audio is how a turn still ends when the input stalls.
pub fn step_turn_detect(
    state: &TurnDetectState,
    config: &TurnDetectConfig,
    db: f64,
    at_ms: f64,
    speech: f64,
) -> TurnDetectStep {
    let loud = match config.vad {
        Vad::Neural => {
            speech >= config.speech_threshold
                && (state.playback_started_ms.is_none() || db >= config.start_db)
        }
        Vad::Energy => db >= config.start_db,
    };

    match state.phase {
        TurnPhase::Idle => {
            let immune = state.playback_started_ms.is_some_and(|p| at_ms - p < config.immunity_ms);
            let loud_frames =
                if loud && !immune { (state.loud_frames + 1).min(config.start_frames) } else { 0 };
            let guarded = state.last_resume_ms.is_some_and(|r| at_ms - r < config.resume_guard_ms);
            if loud_frames >= config.start_frames && !guarded {
                return step(
                    TurnDetectState {
                        phase: TurnPhase::Ducked,
                        loud_frames: 0,
                        last_voice_ms: at_ms,
                        ducked_at_ms: at_ms,
                        ..*state
                    },
                    Some(TurnEvent::Duck),
                );
            }
            step(TurnDetectState { loud_frames, ..*state }, None)
        }
        TurnPhase::Ducked => {
            if loud {
                if at_ms - state.ducked_at_ms >= config.confirm_ms {
                    return step(
                        TurnDetectState {
                            phase: TurnPhase::Speaking,
                            loud_frames: 0,
                            last_voice_ms: at_ms,
                            ..*state
                        },
                        Some(TurnEvent::Stop),
                    );
                }
                return step(
                    TurnDetectState { loud_frames: 0, last_voice_ms: at_ms, ..*state },
                    None,
                );
            }
            if at_ms - state.last_voice_ms >= config.resume_ms {
                return step(
                    TurnDetectState {
                        phase: TurnPhase::Idle,
                        loud_frames: 0,
                        last_resume_ms: Some(at_ms),
                        ..*state
                    },
                    Some(TurnEvent::Resume),
                );
            }
            step(*state, None)
        }
        TurnPhase::Speaking => {
            if loud {
                return step(
                    TurnDetectState {
                        loud_frames: 0,
                        last_voice_ms: at_ms,
                        paused_at_ms: None,
                        ..*state
                    },
                    None,
                );
            }
            let silent_ms = at_ms - state.last_voice_ms;
            if silent_ms >= config.hangover_ms {
                return step(
                    TurnDetectState {
                        phase: TurnPhase::Idle,
                        loud_frames: 0,
                        paused_at_ms: None,
                        ..*state
                    },
                    Some(TurnEvent::End { silent_ms }),
                );
            }
            if let Some(pause_ms) = config.pause_ms {
                if state.paused_at_ms.is_none() && silent_ms >= pause_ms {
                    return step(
                        TurnDetectState { paused_at_ms: Some(at_ms), ..*state },
                        Some(TurnEvent::Pause { silent_ms }),
                    );
                }
            }
            step(*state, None)
        }
    }
}

/// The end-of-turn model said the user is done about the pause announced at
/// `paused_at_ms`. Ends the turn if that pause is still the one standing;
/// announces nothing otherwise.
pub fn complete_turn(state: &TurnDetectState, paused_at_ms: f64, at_ms: f64) -> TurnDetectStep {
    if state.phase != TurnPhase::Speaking || state.paused_at_ms != Some(paused_at_ms) {
        return step(*state, None);
    }
    step(
        TurnDetectState { phase: TurnPhase::Idle, loud_frames: 0, paused_at_ms: None, ..*state },
        Some(TurnEvent::End { silent_ms: at_ms - state.last_voice_ms }),
    )
}

/// How much audio the neural path's level covers (pitfall 161, 652).
pub const NEURAL_LEVEL_WINDOW_MS: f64 = 100.0;

/// RMS dBFS of the `count` samples ending just before `end`, fewer at the
/// very start; `-inf` when there are none.
pub fn trailing_level_db(samples: &[f32], end: usize, count: usize) -> f64 {
    let to = end.min(samples.len());
    let from = to.saturating_sub(count);
    if to <= from {
        return f64::NEG_INFINITY;
    }
    let sum: f64 = samples[from..to].iter().map(|&s| s as f64 * s as f64).sum();
    10.0 * (sum / (to - from) as f64).log10()
}

/// The stateful wrapper a call holds. The logic is `step_turn_detect`.
#[derive(Clone, Debug)]
pub struct TurnDetector {
    pub config: TurnDetectConfig,
    state: TurnDetectState,
}

impl TurnDetector {
    pub fn new(patch: &TurnDetectPatch) -> Self {
        Self { config: resolve_turn_detect_config(patch), state: INITIAL_TURN_DETECT_STATE }
    }

    /// One buffer's level (the energy path, or a silent timer step).
    pub fn step(&mut self, db: f64, at_ms: f64) -> Option<TurnEvent> {
        self.step_speech(db, at_ms, f64::NAN)
    }

    /// One VAD frame's probability with the trailing level at its end.
    pub fn step_speech(&mut self, db: f64, at_ms: f64, speech: f64) -> Option<TurnEvent> {
        let next = step_turn_detect(&self.state, &self.config, db, at_ms, speech);
        self.state = next.state;
        next.event
    }

    /// The end-of-turn model's yes for the pause announced at `paused_at_ms`.
    pub fn complete(&mut self, paused_at_ms: f64, at_ms: f64) -> Option<TurnEvent> {
        let next = complete_turn(&self.state, paused_at_ms, at_ms);
        self.state = next.state;
        next.event
    }

    /// The playback of one turn began. Opens the immunity window.
    pub fn playback_started(&mut self, at_ms: f64) {
        self.state = mark_playback_started(&self.state, at_ms);
    }

    /// The playback ended or was stopped. Closes the window; the stamp is not
    /// read, it keeps both ends of one playback on one clock.
    pub fn playback_stopped(&mut self, _at_ms: f64) {
        self.state = mark_playback_stopped(&self.state);
    }

    pub fn snapshot(&self) -> TurnDetectState {
        self.state
    }

    /// Back to silence without announcing anything.
    pub fn reset(&mut self) {
        self.state = INITIAL_TURN_DETECT_STATE;
    }
}

// The 49 cases of tests/soul/voice/turn-detect.test.ts, one test each, same
// names, same fixtures (docs/assets/voice-probe, docs/assets/voice-device-run).
#[cfg(test)]
mod tests {
    use super::TurnEvent::*;
    use super::*;
    use std::path::PathBuf;

    const VPIO_ON: &str = "voice-probe-aec-vpio-on.json";
    const VPIO_OFF: &str = "voice-probe-aec-vpio-off.json";
    const NEG: f64 = f64::NEG_INFINITY;

    fn assets() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../docs/assets")
    }

    fn json(path: PathBuf) -> serde_json::Value {
        serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap()
    }

    #[derive(Clone, Copy, Debug)]
    struct Frame {
        at_ms: f64,
        db: f64,
    }

    fn db_of(rms: f64) -> f64 {
        if rms > 0.0 {
            20.0 * rms.log10()
        } else {
            NEG
        }
    }

    fn stage_frames(file: &str, stage: &str) -> Vec<Frame> {
        let probe = json(assets().join("voice-probe").join(file));
        let span =
            probe["stages"].as_array().unwrap().iter().find(|s| s["stage"] == stage).unwrap();
        let (from, to) =
            (span["sinceStartMs"].as_f64().unwrap(), span["endedSinceStartMs"].as_f64().unwrap());
        probe["events"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|e| e["kind"] == "level")
            .map(|e| {
                (e["sinceStartMs"].as_f64().unwrap(), e["payload"]["inputRms"].as_f64().unwrap())
            })
            .filter(|&(at, _)| at >= from && at < to)
            .map(|(at_ms, rms)| Frame { at_ms, db: db_of(rms) })
            .collect()
    }

    fn device_stage(stage: &str) -> (f64, Vec<Frame>) {
        let run = json(assets().join("voice-device-run/turn-result-2026-09-05.json"));
        let events = run["passes"][0]["report"]["events"].as_array().unwrap();
        let marks: Vec<_> = events.iter().filter(|e| e["kind"] == "stage").collect();
        let from = marks.iter().find(|e| e["payload"]["stage"] == stage).unwrap();
        let start = from["sinceStartMs"].as_f64().unwrap();
        let until = marks
            .iter()
            .map(|e| e["sinceStartMs"].as_f64().unwrap())
            .find(|&at| at > start)
            .unwrap_or(f64::INFINITY);
        let frames = events
            .iter()
            .filter(|e| e["kind"] == "level")
            .map(|e| {
                (e["sinceStartMs"].as_f64().unwrap(), e["payload"]["inputRms"].as_f64().unwrap())
            })
            .filter(|&(at, _)| at >= start && at < until)
            .map(|(at_ms, rms)| Frame { at_ms, db: db_of(rms) })
            .collect();
        (start, frames)
    }

    type Log = Vec<(f64, TurnEvent)>;

    fn feed(frames: &[Frame], patch: TurnDetectPatch) -> Log {
        let mut d = TurnDetector::new(&patch);
        frames.iter().filter_map(|f| d.step(f.db, f.at_ms).map(|e| (f.at_ms, e))).collect()
    }

    fn feed_default(frames: &[Frame]) -> Log {
        feed(frames, TurnDetectPatch::NONE)
    }

    fn kind(e: &TurnEvent) -> &'static str {
        match e {
            Duck => "duck",
            Stop => "stop",
            Resume => "resume",
            End { .. } => "end",
            Pause { .. } => "pause",
        }
    }

    fn only(log: &Log, k: &str) -> Log {
        log.iter().filter(|(_, e)| kind(e) == k).copied().collect()
    }
    fn ducks(log: &Log) -> Log {
        only(log, "duck")
    }
    fn stops(log: &Log) -> Log {
        only(log, "stop")
    }
    fn resumes(log: &Log) -> Log {
        only(log, "resume")
    }
    fn ends(log: &Log) -> Log {
        only(log, "end")
    }
    fn at(log: &Log) -> Vec<f64> {
        log.iter().map(|(t, _)| *t).collect()
    }
    fn kinds(log: &Log) -> Vec<&'static str> {
        log.iter().map(|(_, e)| kind(e)).collect()
    }

    fn p(f: impl FnOnce(&mut TurnDetectPatch)) -> TurnDetectPatch {
        let mut patch = TurnDetectPatch::NONE;
        f(&mut patch);
        patch
    }
    fn start_db(db: f64) -> TurnDetectPatch {
        p(|c| c.start_db = Some(db))
    }
    fn hangover(ms: f64) -> TurnDetectPatch {
        p(|c| c.hangover_ms = Some(ms))
    }
    fn detector() -> TurnDetector {
        TurnDetector::new(&TurnDetectPatch::NONE)
    }
    fn neural() -> TurnDetector {
        TurnDetector::new(&NEURAL_TURN_DETECT)
    }

    fn nearest_rank(sorted: &[f64], pct: f64) -> f64 {
        sorted[((pct / 100.0 * sorted.len() as f64).ceil() as usize).max(1) - 1]
    }

    fn close(a: f64, b: f64, digits: i32) -> bool {
        (a - b).abs() < 10f64.powi(-digits) / 2.0
    }

    fn sorted_db(frames: &[Frame]) -> Vec<f64> {
        let mut v: Vec<f64> = frames.iter().map(|f| f.db).collect();
        v.sort_by(|a, b| a.partial_cmp(b).unwrap());
        v
    }

    #[test]
    fn the_probes_echo_and_barge_stages_are_the_levels_the_defaults_were_picked_from() {
        let echo = sorted_db(&stage_frames(VPIO_ON, "echo"));
        let barge = sorted_db(&stage_frames(VPIO_ON, "barge"));
        assert_eq!(echo.len(), 99);
        assert_eq!(barge.len(), 104);
        assert!(close(nearest_rank(&echo, 90.0), -74.2, 1));
        assert!(close(*echo.last().unwrap(), -38.5, 1));
        assert!(close(nearest_rank(&barge, 90.0), -19.1, 1));
        assert!(close(*barge.last().unwrap(), -12.5, 1));
        assert!(DEFAULT_TURN_DETECT.start_db > *echo.last().unwrap());
        assert!(DEFAULT_TURN_DETECT.start_db < nearest_rank(&barge, 90.0));
    }

    #[test]
    fn the_taps_delivery_interval_is_what_the_millisecond_windows_are_sized_against() {
        let barge = stage_frames(VPIO_ON, "barge");
        let gaps: Vec<f64> = barge.windows(2).map(|w| w[1].at_ms - w[0].at_ms).collect();
        let min = gaps.iter().cloned().fold(f64::INFINITY, f64::min);
        let max = gaps.iter().cloned().fold(f64::NEG_INFINITY, f64::max);
        assert_eq!(min, 113.0);
        assert_eq!(max, 208.0);
        assert!(DEFAULT_TURN_DETECT.confirm_ms > max);
        assert!(DEFAULT_TURN_DETECT.resume_ms > max);
    }

    #[test]
    fn with_vpio_on_15_s_of_the_companions_own_voice_never_even_ducks() {
        assert_eq!(feed_default(&stage_frames(VPIO_ON, "echo")), vec![]);
    }

    #[test]
    fn the_barge_in_ducks_once_and_escalates_to_a_stop_at_the_buffer_the_person_crosses() {
        let log = feed_default(&stage_frames(VPIO_ON, "barge"));
        assert_eq!(at(&ducks(&log)), vec![36278.0]);
        assert_eq!(at(&stops(&log)), vec![36694.0]);
        assert_eq!(resumes(&log), vec![]);
        assert!(36694.0 - 36278.0 >= DEFAULT_TURN_DETECT.confirm_ms);
    }

    #[test]
    fn the_turn_closes_one_hangover_after_the_last_loud_buffer_with_the_gap_it_measured() {
        let log = feed_default(&stage_frames(VPIO_ON, "barge"));
        assert_eq!(ends(&log), vec![(45478.0, End { silent_ms: 1288.0 })]);
    }

    #[test]
    fn silent_ms_is_the_measured_gap_not_the_configured_one() {
        let mut d = TurnDetector::new(&hangover(700.0));
        assert_eq!(d.step(-10.0, 0.0), Some(Duck));
        assert_eq!(d.step(-10.0, 200.0), None);
        assert_eq!(d.step(-10.0, 400.0), Some(Stop));
        let seen: Vec<_> = (0..=5).filter_map(|i| d.step(NEG, 600.0 + 200.0 * i as f64)).collect();
        assert_eq!(seen, vec![End { silent_ms: 800.0 }]);
    }

    #[test]
    fn at_a_threshold_the_echo_crosses_the_confirm_window_turns_every_cut_into_a_wobble() {
        let loose = feed(&stage_frames(VPIO_ON, "echo"), start_db(-50.0));
        assert_eq!(at(&ducks(&loose)), vec![18593.0, 19582.0, 23789.0]);
        assert_eq!(stops(&loose), vec![]);
        assert_eq!(resumes(&loose).len(), 3);
    }

    #[test]
    fn two_consecutive_frames_hold_the_echo_out_at_minus_50_dbfs_where_one_frame_does_not() {
        let echo = stage_frames(VPIO_ON, "echo");
        let two = |db: f64, n: f64| {
            p(|c| {
                c.start_db = Some(db);
                c.start_frames = Some(n)
            })
        };
        assert_eq!(feed(&echo, two(-50.0, 2.0)), vec![]);
        assert_eq!(ducks(&feed(&echo, two(-50.0, 1.0))).len(), 3);
        let too_low = feed(&echo, two(-55.0, 2.0));
        assert_eq!(ducks(&too_low).len(), 1);
        assert_eq!(stops(&too_low), vec![]);
        assert!(!stops(&feed(&stage_frames(VPIO_ON, "barge"), two(-50.0, 2.0))).is_empty());
    }

    #[test]
    fn the_calibration_does_not_survive_vpio_being_off() {
        let echo = stage_frames(VPIO_OFF, "echo");
        let barge = stage_frames(VPIO_OFF, "barge");
        assert_eq!(feed_default(&barge), vec![]);
        let loudest = barge.iter().map(|f| f.db).fold(NEG, f64::max);
        assert!(close(loudest, -35.46, 1));
        assert_eq!(stops(&feed(&barge, start_db(-60.0))).len(), 1);
        assert_eq!(stops(&feed(&echo, start_db(-60.0))).len(), 2);
        let two = p(|c| {
            c.start_db = Some(-60.0);
            c.start_frames = Some(2.0)
        });
        assert_eq!(stops(&feed(&echo, two)).len(), 2);
    }

    #[test]
    fn a_single_frame_spike_ducks_and_resumes_without_ever_stopping_the_playback() {
        let mut d = detector();
        assert_eq!(d.step(-10.0, 0.0), Some(Duck));
        assert_eq!(d.step(-90.0, 180.0), None);
        assert_eq!(d.step(NEG, 360.0), Some(Resume));
        let mut after = vec![];
        let mut t = 5000.0;
        while t <= 9000.0 {
            after.extend(d.step(-90.0, t));
            t += 180.0;
        }
        assert_eq!(after, vec![]);
    }

    #[test]
    fn a_resume_puts_the_machine_back_where_a_real_onset_ducks_again() {
        let mut d = detector();
        assert_eq!(d.step(-10.0, 0.0), Some(Duck));
        assert_eq!(d.step(-90.0, 360.0), Some(Resume));
        assert_eq!(d.snapshot().phase, TurnPhase::Idle);
        assert_eq!(d.step(-10.0, 700.0), Some(Duck));
        assert_eq!(d.step(-10.0, 1000.0), Some(Stop));
        assert_eq!(d.step(NEG, 2300.0), Some(End { silent_ms: 1300.0 }));
    }

    #[test]
    fn the_resume_guard_keeps_a_marginal_source_from_fluttering_the_volume() {
        let mut d = detector();
        assert_eq!(d.step(-10.0, 0.0), Some(Duck));
        assert_eq!(d.step(-90.0, 360.0), Some(Resume));
        assert_eq!(d.step(-10.0, 475.0), None);
        assert_eq!(d.step(-10.0, 600.0), None);
        assert_eq!(d.step(-10.0, 680.0), Some(Duck));

        let mut open = TurnDetector::new(&p(|c| c.resume_guard_ms = Some(0.0)));
        open.step(-10.0, 0.0);
        open.step(-90.0, 360.0);
        assert_eq!(open.step(-10.0, 475.0), Some(Duck));
    }

    #[test]
    fn the_resume_guard_collapses_a_real_burst_of_echo_crossings_into_one_wobble() {
        let echo = stage_frames(VPIO_ON, "echo");
        assert_eq!(at(&ducks(&feed(&echo, start_db(-45.0)))), vec![18593.0, 23789.0]);
        let unguarded = p(|c| {
            c.start_db = Some(-45.0);
            c.resume_guard_ms = Some(0.0)
        });
        assert_eq!(at(&ducks(&feed(&echo, unguarded))), vec![18593.0, 23789.0, 24295.0]);
        assert_eq!(at(&resumes(&feed(&echo, start_db(-45.0)))), vec![19074.0, 24180.0]);
    }

    #[test]
    fn a_turn_cannot_end_before_it_starts() {
        let mut d = detector();
        for i in 0..=25 {
            assert_eq!(d.step(-90.0, 200.0 * i as f64), None);
        }
        assert_eq!(d.snapshot().phase, TurnPhase::Idle);
    }

    #[test]
    fn staying_loud_announces_the_duck_and_the_stop_once_each_and_nothing_after() {
        let mut d = detector();
        assert_eq!(d.step(-10.0, 0.0), Some(Duck));
        assert_eq!(d.step(-10.0, 150.0), None);
        assert_eq!(d.step(-10.0, 300.0), Some(Stop));
        let mut t = 450.0;
        while t <= 3000.0 {
            assert_eq!(d.step(-10.0, t), None);
            t += 150.0;
        }
    }

    #[test]
    fn no_frames_at_all_is_no_events_and_no_state() {
        assert_eq!(detector().snapshot(), INITIAL_TURN_DETECT_STATE);
        assert_eq!(feed_default(&[]), vec![]);
    }

    #[test]
    fn one_frame_is_enough_to_duck_and_never_enough_to_stop() {
        assert_eq!(feed_default(&[Frame { at_ms: 12345.0, db: -20.0 }]), vec![(12345.0, Duck)]);
        assert_eq!(feed_default(&[Frame { at_ms: 12345.0, db: -90.0 }]), vec![]);
    }

    #[test]
    fn digital_silence_is_quiet_not_an_exception() {
        let mut d = detector();
        assert_eq!(d.step(NEG, 0.0), None);
        assert_eq!(d.step(-10.0, 100.0), Some(Duck));
        assert_eq!(d.step(-10.0, 400.0), Some(Stop));
        assert_eq!(d.step(NEG, 500.0), None);
        assert_eq!(d.step(NEG, 1650.0), Some(End { silent_ms: 1250.0 }));
        assert!(d.snapshot().last_voice_ms.is_finite());
    }

    #[test]
    fn a_stalled_tap_is_measured_in_wall_clock_not_in_buffers() {
        let mut d = detector();
        assert_eq!(d.step(-10.0, 1000.0), Some(Duck));
        assert_eq!(d.step(-10.0, 1400.0), Some(Stop));
        assert_eq!(d.step(-90.0, 61400.0), Some(End { silent_ms: 60000.0 }));
    }

    #[test]
    fn a_stalled_tap_resumes_a_stale_duck_instead_of_leaving_the_volume_down() {
        let mut d = detector();
        assert_eq!(d.step(-10.0, 0.0), Some(Duck));
        assert_eq!(d.step(NEG, 30000.0), Some(Resume));
    }

    #[test]
    fn a_loud_buffer_after_a_delivery_gap_extends_the_turn_instead_of_splitting_it() {
        let mut d = detector();
        assert_eq!(d.step(-10.0, 0.0), Some(Duck));
        assert_eq!(d.step(-10.0, 400.0), Some(Stop));
        assert_eq!(d.step(-10.0, 5400.0), None);
        assert_eq!(d.snapshot().phase, TurnPhase::Speaking);
    }

    #[test]
    fn the_threshold_is_inclusive_at_the_line() {
        assert_eq!(TurnDetector::new(&start_db(-35.0)).step(-35.0, 0.0), Some(Duck));
        assert_eq!(TurnDetector::new(&start_db(-35.0)).step(-35.0001, 0.0), None);
    }

    #[test]
    fn the_config_is_all_defaults_all_overridable_and_clamped_where_it_can_be_wrong() {
        assert_eq!(resolve_turn_detect_config(&TurnDetectPatch::NONE), DEFAULT_TURN_DETECT);
        assert_eq!(
            resolve_turn_detect_config(&start_db(-42.0)),
            TurnDetectConfig { start_db: -42.0, ..DEFAULT_TURN_DETECT }
        );
        let wrong = p(|c| {
            c.start_frames = Some(0.0);
            c.confirm_ms = Some(-1.0);
            c.resume_ms = Some(-1.0);
            c.hangover_ms = Some(-1.0);
            c.resume_guard_ms = Some(-1.0);
            c.immunity_ms = Some(-1.0);
        });
        assert_eq!(
            resolve_turn_detect_config(&wrong),
            TurnDetectConfig {
                start_db: -35.0,
                start_frames: 1,
                confirm_ms: 0.0,
                resume_ms: 0.0,
                hangover_ms: 0.0,
                resume_guard_ms: 0.0,
                immunity_ms: 0.0,
                vad: Vad::Energy,
                speech_threshold: 0.5,
                pause_ms: None,
            }
        );
        assert_eq!(
            resolve_turn_detect_config(&p(|c| c.pause_ms = Some(Some(-1.0)))).pause_ms,
            Some(0.0)
        );
        assert_eq!(
            DEFAULT_TURN_DETECT,
            TurnDetectConfig {
                start_db: -35.0,
                start_frames: 1,
                confirm_ms: 300.0,
                resume_ms: 300.0,
                hangover_ms: 1250.0,
                resume_guard_ms: 300.0,
                immunity_ms: 2000.0,
                vad: Vad::Energy,
                speech_threshold: 0.5,
                pause_ms: None,
            }
        );
    }

    #[test]
    fn confirm_ms_at_zero_still_takes_a_second_buffer_to_stop() {
        let mut d = TurnDetector::new(&p(|c| c.confirm_ms = Some(0.0)));
        assert_eq!(d.step(-10.0, 0.0), Some(Duck));
        assert_eq!(d.step(-10.0, 1.0), Some(Stop));
    }

    #[test]
    fn the_step_function_does_not_touch_the_state_it_was_handed() {
        let config = resolve_turn_detect_config(&TurnDetectPatch::NONE);
        let state = INITIAL_TURN_DETECT_STATE;
        let a = step_turn_detect(&state, &config, -10.0, 0.0, f64::NAN);
        let b = step_turn_detect(&state, &config, -10.0, 0.0, f64::NAN);
        assert_eq!(state, INITIAL_TURN_DETECT_STATE);
        assert_eq!(a, b);
    }

    #[test]
    fn reset_puts_the_machine_back_to_silence_without_announcing_anything() {
        let mut d = detector();
        d.step(-10.0, 0.0);
        assert_eq!(d.snapshot().phase, TurnPhase::Ducked);
        d.reset();
        assert_eq!(d.snapshot(), INITIAL_TURN_DETECT_STATE);
        assert_eq!(d.step(-10.0, 50.0), Some(Duck));
    }

    #[test]
    fn the_event_sequence_is_always_duck_then_resume_or_stop_then_end() {
        let mut grids = vec![];
        for start_db in [-35.0, -50.0, -60.0] {
            for start_frames in [1.0, 2.0] {
                for confirm_ms in [0.0, 300.0, 1200.0] {
                    for resume_ms in [0.0, 300.0, 1500.0] {
                        for hangover_ms in [0.0, 1250.0, 2000.0] {
                            grids.push(TurnDetectPatch {
                                start_db: Some(start_db),
                                start_frames: Some(start_frames),
                                confirm_ms: Some(confirm_ms),
                                resume_ms: Some(resume_ms),
                                hangover_ms: Some(hangover_ms),
                                ..TurnDetectPatch::NONE
                            });
                        }
                    }
                }
            }
        }
        let mut saw = std::collections::HashMap::<&str, usize>::new();
        for file in [VPIO_ON, VPIO_OFF] {
            for stage in ["echo", "barge"] {
                let frames = stage_frames(file, stage);
                for patch in &grids {
                    let mut phase = TurnPhase::Idle;
                    for (_, event) in feed(&frames, *patch) {
                        *saw.entry(kind(&event)).or_default() += 1;
                        match event {
                            Duck => {
                                assert_eq!(phase, TurnPhase::Idle);
                                phase = TurnPhase::Ducked;
                            }
                            Stop => {
                                assert_eq!(phase, TurnPhase::Ducked);
                                phase = TurnPhase::Speaking;
                            }
                            Resume => {
                                assert_eq!(phase, TurnPhase::Ducked);
                                phase = TurnPhase::Idle;
                            }
                            Pause { .. } => panic!("the energy defaults never pause"),
                            End { .. } => {
                                assert_eq!(phase, TurnPhase::Speaking);
                                phase = TurnPhase::Idle;
                            }
                        }
                    }
                }
            }
        }
        for k in ["duck", "stop", "resume", "end"] {
            assert!(saw.get(k).copied().unwrap_or(0) > 0, "never saw {k}");
        }
    }

    #[test]
    fn the_default_hangover_holds_this_real_barge_in_together_as_one_turn() {
        assert_eq!(
            feed_default(&stage_frames(VPIO_ON, "barge")),
            vec![(36278.0, Duck), (36694.0, Stop), (45478.0, End { silent_ms: 1288.0 })]
        );
    }

    #[test]
    fn the_800_ms_this_default_replaced_split_that_barge_in_in_two() {
        assert_eq!(
            feed(&stage_frames(VPIO_ON, "barge"), hangover(800.0)),
            vec![
                (36278.0, Duck),
                (36694.0, Stop),
                (42074.0, End { silent_ms: 897.0 }),
                (42580.0, Duck),
                (42993.0, Stop),
                (43892.0, End { silent_ms: 899.0 }),
                (44076.0, Duck),
                (44490.0, Resume),
            ]
        );
    }

    #[test]
    fn what_the_hangover_costs_on_this_recording_at_the_values_worth_considering() {
        let frames = stage_frames(VPIO_ON, "barge");
        let summarise = |h: f64| {
            let log = feed(&frames, hangover(h));
            let latency: Vec<f64> = ends(&log)
                .iter()
                .map(|(t, _)| {
                    let last =
                        frames.iter().filter(|f| f.db >= -35.0 && f.at_ms < *t).last().unwrap();
                    t - last.at_ms
                })
                .collect();
            (stops(&log).len(), resumes(&log).len(), latency)
        };
        assert_eq!(summarise(800.0), (2, 1, vec![897.0, 899.0]));
        assert_eq!(summarise(1000.0), (2, 0, vec![1011.0, 1103.0]));
        assert_eq!(summarise(1200.0), (2, 0, vec![1219.0, 1288.0]));
        assert_eq!(summarise(1250.0), (1, 0, vec![1288.0]));
        assert_eq!(summarise(1500.0), (1, 0, vec![1587.0]));
        assert_eq!(summarise(2000.0), (1, 0, vec![2003.0]));

        assert_eq!(summarise(1219.0).0, 2);
        assert_eq!(summarise(1220.0).0, 1);

        assert!(DEFAULT_TURN_DETECT.hangover_ms > 1220.0);
        assert_eq!(summarise(1250.0).2, summarise(1220.0).2);
        assert!(summarise(1500.0).2[0] > summarise(1250.0).2[0]);

        let last_word = frames.iter().filter(|f| f.db >= -35.0).last().unwrap().at_ms;
        assert_eq!(last_word, 44190.0);
        assert_eq!(ends(&feed(&frames, hangover(800.0))).last().unwrap().0 - last_word, -298.0);
        assert_eq!(ends(&feed_default(&frames)).last().unwrap().0 - last_word, 1288.0);
    }

    #[test]
    fn the_played_stages_leak_is_what_the_immunity_window_is_sized_against() {
        let (started, frames) = device_stage("played");
        assert_eq!(frames.len(), 217);
        let leaks: Vec<Frame> =
            frames.iter().filter(|f| f.db >= DEFAULT_TURN_DETECT.start_db).copied().collect();
        let since: Vec<f64> = leaks.iter().map(|f| (f.at_ms - started).round()).collect();
        assert_eq!(since, vec![591.0, 1280.0, 1396.0, 1578.0]);
        let tenths: Vec<i64> = leaks.iter().map(|f| (f.db * 10.0).round() as i64).collect();
        assert_eq!(tenths, vec![-287, -339, -317, -336]);

        let last = leaks.last().unwrap().at_ms;
        let after: Vec<&Frame> = frames.iter().filter(|f| f.at_ms > last).collect();
        assert_eq!(after.len(), 201);
        assert!(after.iter().map(|f| f.db).fold(NEG, f64::max) < -45.0);

        let last_leak = last - started;
        assert_eq!(last_leak.round(), 1578.0);
        assert!(DEFAULT_TURN_DETECT.immunity_ms > last_leak);
        assert_eq!((DEFAULT_TURN_DETECT.immunity_ms - last_leak).round(), 422.0);
    }

    #[test]
    fn with_the_window_open_the_played_stage_says_nothing_and_without_it_it_ducks() {
        let (started, frames) = device_stage("played");
        let run = |patch: TurnDetectPatch| -> Log {
            let mut d = TurnDetector::new(&patch);
            d.playback_started(started);
            frames.iter().filter_map(|f| d.step(f.db, f.at_ms).map(|e| (f.at_ms, e))).collect()
        };
        assert_eq!(run(TurnDetectPatch::NONE), vec![]);

        let without = run(p(|c| c.immunity_ms = Some(0.0)));
        let rounded = |log: &Log| at(log).into_iter().map(f64::round).collect::<Vec<_>>();
        assert_eq!(rounded(&ducks(&without)), vec![4200.0, 5006.0]);
        assert_eq!(stops(&without), vec![]);

        let short = run(p(|c| c.immunity_ms = Some(1500.0)));
        assert_eq!(rounded(&ducks(&short)), vec![5188.0]);
    }

    #[test]
    fn the_window_is_over_at_immunity_ms_exactly_and_not_one_buffer_before() {
        let mut d = detector();
        d.playback_started(1000.0);
        assert_eq!(d.step(-10.0, 1000.0 + DEFAULT_TURN_DETECT.immunity_ms - 1.0), None);
        assert_eq!(d.step(-10.0, 1000.0 + DEFAULT_TURN_DETECT.immunity_ms), Some(Duck));
    }

    #[test]
    fn a_machine_never_told_about_a_playback_has_no_window_at_all() {
        assert_eq!(detector().step(-10.0, 0.0), Some(Duck));
        assert_eq!(
            TurnDetector::new(&p(|c| c.immunity_ms = Some(0.0))).step(-10.0, 0.0),
            Some(Duck)
        );
    }

    #[test]
    fn frames_inside_the_window_do_not_count_toward_start_frames() {
        let mut d = TurnDetector::new(&p(|c| c.start_frames = Some(2.0)));
        d.playback_started(0.0);
        assert_eq!(d.step(-10.0, 1900.0), None);
        assert_eq!(d.step(-10.0, 1950.0), None);
        assert_eq!(d.snapshot().loud_frames, 0);
        assert_eq!(d.step(-10.0, 2000.0), None);
        assert_eq!(d.snapshot().loud_frames, 1);
        assert_eq!(d.step(-10.0, 2050.0), Some(Duck));
    }

    #[test]
    fn stopping_the_playback_closes_the_window_and_so_does_a_reset() {
        let mut stopped = detector();
        stopped.playback_started(0.0);
        assert_eq!(stopped.step(-10.0, 500.0), None);
        stopped.playback_stopped(600.0);
        assert_eq!(stopped.snapshot().playback_started_ms, None);
        assert_eq!(stopped.step(-10.0, 700.0), Some(Duck));

        let mut reset = detector();
        reset.playback_started(0.0);
        reset.reset();
        assert_eq!(reset.snapshot(), INITIAL_TURN_DETECT_STATE);
        assert_eq!(reset.step(-10.0, 500.0), Some(Duck));
    }

    #[test]
    fn opening_the_window_mid_duck_and_mid_turn_announces_nothing() {
        let mut d = detector();
        assert_eq!(d.step(-10.0, 0.0), Some(Duck));
        d.playback_started(50.0);
        assert_eq!(d.snapshot().phase, TurnPhase::Ducked);
        assert_eq!(d.step(-10.0, 400.0), Some(Stop));
        assert_eq!(d.step(NEG, 1700.0), Some(End { silent_ms: 1300.0 }));
    }

    // The neural path: a VAD's probability per 32 ms frame.

    const FRAME_MS: f64 = 32.0;

    #[derive(Clone, Copy)]
    struct Step {
        at_ms: f64,
        db: f64,
        p: f64,
    }

    fn frames(from_ms: f64, ms: f64, p: f64, db: f64) -> Vec<Step> {
        let mut out = vec![];
        let mut at = from_ms;
        while at < from_ms + ms {
            out.push(Step { at_ms: at, db, p });
            at += FRAME_MS;
        }
        out
    }

    fn feed_neural(d: &mut TurnDetector, run: &[Step]) -> Log {
        run.iter().filter_map(|f| d.step_speech(f.db, f.at_ms, f.p).map(|e| (f.at_ms, e))).collect()
    }

    fn cat(parts: &[Vec<Step>]) -> Vec<Step> {
        parts.concat()
    }

    #[test]
    fn the_neural_starting_values_are_docs_136s() {
        assert_eq!(
            resolve_turn_detect_config(&NEURAL_TURN_DETECT),
            TurnDetectConfig {
                vad: Vad::Neural,
                pause_ms: Some(250.0),
                hangover_ms: 2500.0,
                ..DEFAULT_TURN_DETECT
            }
        );
    }

    #[test]
    fn neural_the_probability_is_the_voice_not_the_level() {
        let mut d = neural();
        assert_eq!(d.step_speech(-10.0, 0.0, 0.2), None);
        assert_eq!(d.step_speech(-60.0, 32.0, 0.5), Some(Duck));
        assert_eq!(neural().step(-10.0, 0.0), None);
    }

    #[test]
    fn neural_while_the_companion_plays_speech_also_has_to_clear_start_db() {
        let mut d = neural();
        d.playback_started(0.0);
        assert_eq!(d.step_speech(-40.0, 2100.0, 0.9), None);
        assert_eq!(d.step_speech(-30.0, 2132.0, 0.9), Some(Duck));
        let mut quiet = neural();
        quiet.playback_started(0.0);
        quiet.playback_stopped(500.0);
        assert_eq!(quiet.step_speech(-40.0, 600.0, 0.9), Some(Duck));
    }

    #[test]
    fn neural_a_0_35_s_utterance_stops_pauses_at_250_ms_and_a_yes_ends_it() {
        let mut d = neural();
        let log = feed_neural(
            &mut d,
            &cat(&[frames(0.0, 352.0, 0.9, -30.0), frames(352.0, 600.0, 0.05, NEG)]),
        );
        assert_eq!(kinds(&log), vec!["duck", "stop", "pause"]);
        let (pause_at, pause) = log[2];
        let last_voice = 320.0;
        assert!(pause_at - last_voice >= 250.0);
        assert_eq!(pause, Pause { silent_ms: pause_at - last_voice });
        assert_eq!(
            d.complete(pause_at, pause_at + 20.0),
            Some(End { silent_ms: pause_at + 20.0 - last_voice })
        );
        assert_eq!(d.snapshot().phase, TurnPhase::Idle);
        assert_eq!(d.snapshot().paused_at_ms, None);
    }

    #[test]
    fn neural_one_pause_per_silent_run_and_voice_clears_it_for_the_next() {
        let mut d = neural();
        let log = feed_neural(
            &mut d,
            &cat(&[
                frames(0.0, 640.0, 0.9, -30.0),
                frames(640.0, 800.0, 0.1, -30.0),
                frames(1440.0, 320.0, 0.9, -30.0),
                frames(1760.0, 400.0, 0.1, -30.0),
            ]),
        );
        assert_eq!(kinds(&log), vec!["duck", "stop", "pause", "pause"]);
        assert_eq!(d.complete(log[2].0, 2200.0), None);
        assert_eq!(d.snapshot().phase, TurnPhase::Speaking);
        assert!(matches!(d.complete(log[3].0, 2200.0), Some(End { .. })));
    }

    #[test]
    fn neural_a_no_from_the_model_leaves_the_hangover_to_end_the_turn() {
        let mut d = neural();
        let log = feed_neural(
            &mut d,
            &cat(&[frames(0.0, 640.0, 0.9, -30.0), frames(640.0, 3000.0, 0.1, -30.0)]),
        );
        assert_eq!(kinds(&log), vec!["duck", "stop", "pause", "end"]);
        let (end_at, end) = log[3];
        assert_eq!(end, End { silent_ms: end_at - 608.0 });
        assert!(end_at - 608.0 >= 2500.0);
        assert_eq!(d.complete(log[2].0, end_at + 10.0), None);
    }

    #[test]
    fn complete_turn_answers_nothing_outside_a_standing_pause() {
        let idle = INITIAL_TURN_DETECT_STATE;
        assert_eq!(complete_turn(&idle, 0.0, 10.0).event, None);
        let speaking = TurnDetectState {
            phase: TurnPhase::Speaking,
            last_voice_ms: 100.0,
            paused_at_ms: Some(400.0),
            ..idle
        };
        assert_eq!(complete_turn(&speaking, 399.0, 500.0).event, None);
        assert_eq!(
            complete_turn(&TurnDetectState { paused_at_ms: None, ..speaking }, 400.0, 500.0).event,
            None
        );
        let done = complete_turn(&speaking, 400.0, 500.0);
        assert_eq!(done.event, Some(End { silent_ms: 400.0 }));
        assert_eq!(speaking.paused_at_ms, Some(400.0));
    }

    #[test]
    fn the_energy_path_is_unchanged_by_a_speech_probability() {
        let mut d = detector();
        assert_eq!(d.step_speech(-60.0, 0.0, 1.0), None);
        assert_eq!(d.step_speech(-30.0, 100.0, 0.0), Some(Duck));
    }

    // The bench's 「等一下」 and 「嗯」 clips as Silero v6 saw them: per frame its
    // end in ms, the probability, the tap buffer's level, and the trailing
    // 100 ms level.
    const WAIT: &[(f64, f64, f64, f64)] = &[
        (-84.0, 0.0, -75.0, -80.0),
        (-52.0, 0.0, -75.0, -80.0),
        (-20.0, 0.0, -75.0, -80.0),
        (12.0, 0.0, -75.0, -80.0),
        (44.0, 0.0, -75.0, -80.0),
        (76.0, 0.0, -75.0, -80.0),
        (108.0, 0.0, -25.0, -80.0),
        (140.0, 0.0, -25.0, -80.0),
        (172.0, 0.43, -25.0, -34.0),
        (204.0, 0.84, -25.0, -25.0),
        (236.0, 0.9, -25.0, -24.0),
        (268.0, 0.9, -25.0, -23.0),
        (300.0, 0.93, -25.0, -25.0),
        (332.0, 0.93, -25.0, -24.0),
        (364.0, 0.94, -25.0, -25.0),
        (396.0, 0.95, -25.0, -25.0),
        (428.0, 0.96, -22.0, -24.0),
        (460.0, 0.97, -22.0, -22.0),
        (492.0, 0.97, -22.0, -22.0),
        (524.0, 0.95, -38.0, -23.0),
        (556.0, 0.89, -38.0, -29.0),
        (588.0, 0.61, -38.0, -35.0),
        (620.0, 0.22, -75.0, -44.0),
        (652.0, 0.12, -75.0, -70.0),
        (684.0, 0.07, -75.0, -80.0),
        (716.0, 0.05, -75.0, -80.0),
        (748.0, 0.04, -75.0, -80.0),
        (780.0, 0.03, -75.0, -80.0),
        (812.0, 0.03, -75.0, -80.0),
        (844.0, 0.02, -75.0, -80.0),
        (876.0, 0.02, -75.0, -80.0),
        (908.0, 0.02, -75.0, -80.0),
        (940.0, 0.02, -75.0, -80.0),
        (972.0, 0.02, -75.0, -80.0),
    ];
    const UH_HUH: &[(f64, f64, f64, f64)] = &[
        (-84.0, 0.0, -75.0, -80.0),
        (-52.0, 0.0, -75.0, -80.0),
        (-20.0, 0.0, -75.0, -80.0),
        (12.0, 0.0, -75.0, -80.0),
        (44.0, 0.0, -75.0, -80.0),
        (76.0, 0.0, -75.0, -80.0),
        (108.0, 0.0, -31.0, -80.0),
        (140.0, 0.0, -31.0, -80.0),
        (172.0, 0.31, -31.0, -39.0),
        (204.0, 0.81, -23.0, -30.0),
        (236.0, 0.87, -23.0, -26.0),
        (268.0, 0.86, -23.0, -24.0),
        (300.0, 0.83, -23.0, -23.0),
        (332.0, 0.77, -24.0, -23.0),
        (364.0, 0.74, -24.0, -23.0),
        (396.0, 0.78, -24.0, -23.0),
        (428.0, 0.83, -75.0, -25.0),
        (460.0, 0.44, -75.0, -30.0),
        (492.0, 0.19, -75.0, -51.0),
        (524.0, 0.1, -75.0, -80.0),
        (556.0, 0.06, -75.0, -80.0),
        (588.0, 0.04, -75.0, -80.0),
        (620.0, 0.03, -75.0, -80.0),
        (652.0, 0.02, -75.0, -80.0),
        (684.0, 0.02, -75.0, -80.0),
        (716.0, 0.02, -75.0, -80.0),
        (748.0, 0.02, -75.0, -80.0),
        (780.0, 0.01, -75.0, -80.0),
        (812.0, 0.01, -75.0, -80.0),
        (844.0, 0.01, -75.0, -80.0),
        (876.0, 0.01, -75.0, -80.0),
        (908.0, 0.01, -75.0, -80.0),
        (940.0, 0.01, -75.0, -80.0),
        (972.0, 0.01, -75.0, -80.0),
    ];

    fn over_playback(clip: &[(f64, f64, f64, f64)], buffer_level: bool) -> Vec<&'static str> {
        let mut d = neural();
        d.playback_started(-10_000.0);
        let run: Vec<Step> = clip
            .iter()
            .map(|&(at_ms, p, buffer, frame)| Step {
                at_ms,
                p,
                db: if buffer_level { buffer } else { frame },
            })
            .collect();
        kinds(&feed_neural(&mut d, &run))
    }

    #[test]
    fn neural_wait_gated_on_its_tap_buffers_level_never_confirms() {
        assert_eq!(over_playback(WAIT, true), vec!["duck", "resume"]);
    }

    #[test]
    fn neural_wait_gated_on_its_own_last_100_ms_stops_the_companion() {
        assert_eq!(over_playback(WAIT, false), vec!["duck", "stop", "pause"]);
    }

    #[test]
    fn neural_uh_huh_over_the_companion_ducks_and_resumes_never_stops() {
        assert_eq!(over_playback(UH_HUH, false), vec!["duck", "resume"]);
        assert_eq!(over_playback(UH_HUH, true), vec!["duck", "resume"]);
    }

    #[test]
    fn trailing_level_db_is_the_rms_of_the_window_ending_at_the_frame() {
        let mut samples = vec![0f32; 3200];
        samples[1600..].fill(0.1);
        assert!(close(trailing_level_db(&samples, 3200, 1600), -20.0, 5));
        assert!(close(trailing_level_db(&samples, 2400, 1600), -23.0103, 3));
        assert_eq!(trailing_level_db(&samples, 1600, 1600), NEG);
        assert!(close(trailing_level_db(&samples[1600..], 800, 1600), -20.0, 5));
        assert_eq!(trailing_level_db(&samples, 0, 1600), NEG);
    }
}
