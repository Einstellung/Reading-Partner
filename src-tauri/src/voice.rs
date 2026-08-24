// Microphone capture (docs/15). getUserMedia/MediaRecorder is unreliable on
// WebKitGTK (the app's primary desktop is Linux), so we record in Rust with cpal
// and hand the frontend a 16 kHz mono WAV that SenseVoice/whisper class STT
// models expect.
//
// cpal's Stream is !Send, so it can't be stored in shared state and touched from
// another command's thread. The pattern: a dedicated thread builds and owns the
// stream, an AtomicBool signals it to stop, and the audio callback pushes samples
// into a shared buffer. One `start_capture` builds that thread for both users
// below; the caller only supplies a tick closure that the capture thread runs
// every 50 ms.
//
// Two users, two independent slots in VoiceState:
//
// Push-to-talk (start/stop/cancel_voice_recording): one press is one recording.
// The tick stops the stream after MAX_SECONDS so an unattended press can't record
// forever; stop joins the thread, then encodes everything the callback wrote.
//
// Recording session (start/cut/stop/cancel_voice_session), for rehearsal
// (docs/43): one stream stays open for the whole session and the callback never
// pauses. Cutting a segment only swaps the buffer the callback writes into, so
// nothing is lost between segments and the seam is sample-exact.
//
//   start_voice_session { maxSegmentSeconds } opens the stream. The argument is
//     the fallback auto-cut interval (default DEFAULT_SEGMENT_SECONDS, clamped to
//     SEGMENT_SECONDS_MIN..=SEGMENT_SECONDS_MAX); a session never stops itself.
//   cut_voice_session returns a WAV of everything captured since the previous cut
//     (or since start) and leaves the stream running.
//   stop_voice_session returns the final segment and closes the stream.
//   cancel_voice_session closes the stream and throws the audio away.
//
// The locks, because the point of the session is that the callback is never held
// up:
//
//   `live` (Mutex<Vec<f32>>) is the buffer the audio callback appends to. Anyone
//     cutting holds it for exactly one `mem::take` — a pointer swap — and nothing
//     else. No conversion, no encoding, no allocation of the outgoing WAV happens
//     under it.
//   `cut` (Mutex<CutState>) serialises cut operations: the auto-cut on the capture
//     thread against a cut/stop command. Without it a segment taken by one could
//     be appended to `pending` after the other had already drained `pending`, and
//     older audio would come back in a later segment. The audio callback never
//     touches this lock, so holding it across the mono/16 kHz conversion costs the
//     capture nothing. WAV encoding still happens after it is released.
//
// A cut with no audio in it returns a valid, empty (header-only) WAV rather than
// an error: a silent slide must not break the rehearsal loop. Push-to-talk keeps
// its "No audio was captured" error.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};

// Safety stop: an unattended press won't record forever.
const MAX_SECONDS: u64 = 90;
const TARGET_RATE: u32 = 16_000;
// How often the capture thread wakes to check the stop flag and run its tick.
const TICK: Duration = Duration::from_millis(50);

// Fallback segmenting for a session: the caller cuts on every slide change, this
// is what keeps a ten-minute slide from growing the raw buffer without bound.
// The ceiling matters because `live` holds interleaved f32 at the device rate
// (~384 KB/s at 48 kHz stereo).
const DEFAULT_SEGMENT_SECONDS: u64 = 60;
const SEGMENT_SECONDS_MIN: u64 = 1;
const SEGMENT_SECONDS_MAX: u64 = 120;

// What a cut needs to know about the running capture. Holds no cpal type, so the
// cutting logic is testable without a microphone.
#[derive(Clone)]
struct CaptureCtx {
    live: Arc<Mutex<Vec<f32>>>,
    sample_rate: u32,
    channels: u16,
}

struct Capture {
    ctx: CaptureCtx,
    stop: Arc<AtomicBool>,
    handle: JoinHandle<()>,
}

impl Capture {
    // Stop the stream, wait for the thread to drop it, then take what is left.
    // Joining first is what guarantees no sample arrives after the last take.
    fn finish(self) -> Result<(Vec<f32>, u32, u16), String> {
        self.stop.store(true, Ordering::Relaxed);
        self.handle
            .join()
            .map_err(|_| "Recorder thread panicked".to_string())?;
        let samples = take_live(&self.ctx);
        Ok((samples, self.ctx.sample_rate, self.ctx.channels))
    }

    fn abort(self) {
        self.stop.store(true, Ordering::Relaxed);
        let _ = self.handle.join();
    }
}

#[derive(Default)]
pub struct VoiceState {
    press: Mutex<Option<Capture>>,
    session: Mutex<Option<Session>>,
}

// Builds the capture thread and waits for it to report that the stream is live,
// so device/permission errors surface at start, not at stop. `tick` runs on the
// capture thread every TICK; returning false closes the stream.
fn start_capture<F>(mut tick: F) -> Result<Capture, String>
where
    F: FnMut(&CaptureCtx, Duration) -> bool + Send + 'static,
{
    let live = Arc::new(Mutex::new(Vec::<f32>::new()));
    let live_thread = live.clone();
    let stop = Arc::new(AtomicBool::new(false));
    let stop_thread = stop.clone();
    let (ready_tx, ready_rx) = mpsc::channel::<Result<(u32, u16), String>>();

    let handle = std::thread::spawn(move || {
        let host = cpal::default_host();
        let device = match host.default_input_device() {
            Some(d) => d,
            None => {
                let _ = ready_tx.send(Err(
                    "No microphone found. Connect an input device and try again.".into(),
                ));
                return;
            }
        };
        let default_config = match device.default_input_config() {
            Ok(c) => c,
            Err(e) => {
                let _ = ready_tx.send(Err(format!("Microphone is unavailable: {e}")));
                return;
            }
        };

        let sample_format = default_config.sample_format();
        let config: cpal::StreamConfig = default_config.into();
        let channels = config.channels;
        let sample_rate = config.sample_rate.0;

        let err_fn = |err| eprintln!("voice input stream error: {err}");

        let stream_result = match sample_format {
            cpal::SampleFormat::F32 => {
                let buf = live_thread.clone();
                device.build_input_stream(
                    &config,
                    move |data: &[f32], _: &_| buf.lock().unwrap().extend_from_slice(data),
                    err_fn,
                    None,
                )
            }
            cpal::SampleFormat::I16 => {
                let buf = live_thread.clone();
                device.build_input_stream(
                    &config,
                    move |data: &[i16], _: &_| {
                        let mut b = buf.lock().unwrap();
                        b.extend(data.iter().map(|&s| s as f32 / 32768.0));
                    },
                    err_fn,
                    None,
                )
            }
            cpal::SampleFormat::U16 => {
                let buf = live_thread.clone();
                device.build_input_stream(
                    &config,
                    move |data: &[u16], _: &_| {
                        let mut b = buf.lock().unwrap();
                        b.extend(data.iter().map(|&s| (s as f32 - 32768.0) / 32768.0));
                    },
                    err_fn,
                    None,
                )
            }
            other => {
                let _ = ready_tx.send(Err(format!(
                    "Unsupported microphone sample format: {other:?}"
                )));
                return;
            }
        };

        let stream = match stream_result {
            Ok(s) => s,
            Err(e) => {
                let _ = ready_tx.send(Err(format!("Failed to open the microphone: {e}")));
                return;
            }
        };
        if let Err(e) = stream.play() {
            let _ = ready_tx.send(Err(format!("Failed to start the microphone: {e}")));
            return;
        }

        let _ = ready_tx.send(Ok((sample_rate, channels)));

        let ctx = CaptureCtx {
            live: live_thread,
            sample_rate,
            channels,
        };
        let start = Instant::now();
        while !stop_thread.load(Ordering::Relaxed) {
            if !tick(&ctx, start.elapsed()) {
                break;
            }
            std::thread::sleep(TICK);
        }

        drop(stream); // stop capture before anyone reads the buffer
    });

    match ready_rx.recv() {
        Ok(Ok((sample_rate, channels))) => Ok(Capture {
            ctx: CaptureCtx {
                live,
                sample_rate,
                channels,
            },
            stop,
            handle,
        }),
        Ok(Err(e)) => {
            let _ = handle.join();
            Err(e)
        }
        Err(_) => Err("Recorder thread exited before it started".into()),
    }
}

// The whole of what a cut does to the audio callback: swap its buffer out. The
// lock covers this call and nothing more.
fn take_live(ctx: &CaptureCtx) -> Vec<f32> {
    std::mem::take(&mut *ctx.live.lock().unwrap())
}

// ---------------------------------------------------------------------------
// Push-to-talk
// ---------------------------------------------------------------------------

// Drain any in-progress recording so a fresh start (or app teardown) can't leave
// an orphaned capture thread holding the mic.
fn drain(state: &VoiceState) {
    if let Some(capture) = state.press.lock().unwrap().take() {
        capture.abort();
    }
}

#[tauri::command]
pub fn start_voice_recording(state: tauri::State<'_, VoiceState>) -> Result<(), String> {
    drain(&state);

    let capture = start_capture(|_ctx, elapsed| elapsed < Duration::from_secs(MAX_SECONDS))?;
    *state.press.lock().unwrap() = Some(capture);
    Ok(())
}

#[tauri::command]
pub fn stop_voice_recording(state: tauri::State<'_, VoiceState>) -> Result<Vec<u8>, String> {
    let capture = state
        .press
        .lock()
        .unwrap()
        .take()
        .ok_or("No active recording")?;
    let (samples, sample_rate, channels) = capture.finish()?;

    if samples.is_empty() {
        return Err("No audio was captured. Check that the microphone isn't muted.".into());
    }
    encode_wav_pcm16(&to_pcm16_mono_16k(&samples, sample_rate, channels))
}

#[tauri::command]
pub fn cancel_voice_recording(state: tauri::State<'_, VoiceState>) -> Result<(), String> {
    drain(&state);
    Ok(())
}

// ---------------------------------------------------------------------------
// Recording session
// ---------------------------------------------------------------------------

struct CutState {
    // Audio already cut off the live buffer, converted to the output format and
    // waiting for the next cut/stop to collect it. Converting on the way in is
    // what keeps a long silent stretch from costing device-rate f32.
    pending: Vec<i16>,
    last_cut: Instant,
}

struct Session {
    capture: Capture,
    cut: Arc<Mutex<CutState>>,
}

// Move everything the callback has written into `pending`. Callers hold the cut
// lock; the live lock is taken here, for one swap.
fn fold_live(ctx: &CaptureCtx, state: &mut CutState) {
    let raw = take_live(ctx);
    state
        .pending
        .extend_from_slice(&to_pcm16_mono_16k(&raw, ctx.sample_rate, ctx.channels));
    state.last_cut = Instant::now();
}

fn auto_cut_due(since_last_cut: Duration, max_segment: Duration) -> bool {
    !max_segment.is_zero() && since_last_cut >= max_segment
}

fn resolve_max_segment_seconds(requested: Option<u64>) -> u64 {
    requested
        .unwrap_or(DEFAULT_SEGMENT_SECONDS)
        .clamp(SEGMENT_SECONDS_MIN, SEGMENT_SECONDS_MAX)
}

fn drain_session(state: &VoiceState) {
    if let Some(session) = state.session.lock().unwrap().take() {
        session.capture.abort();
    }
}

#[tauri::command]
pub fn start_voice_session(
    state: tauri::State<'_, VoiceState>,
    max_segment_seconds: Option<u64>,
) -> Result<(), String> {
    drain_session(&state);

    let max_segment = Duration::from_secs(resolve_max_segment_seconds(max_segment_seconds));
    let cut = Arc::new(Mutex::new(CutState {
        pending: Vec::new(),
        last_cut: Instant::now(),
    }));

    let cut_thread = cut.clone();
    let capture = start_capture(move |ctx, _elapsed| {
        let mut state = cut_thread.lock().unwrap();
        if auto_cut_due(state.last_cut.elapsed(), max_segment) {
            fold_live(ctx, &mut state);
        }
        true // a session runs until the frontend stops it
    })?;

    *state.session.lock().unwrap() = Some(Session { capture, cut });
    Ok(())
}

#[tauri::command]
pub fn cut_voice_session(state: tauri::State<'_, VoiceState>) -> Result<Vec<u8>, String> {
    let pcm = {
        let guard = state.session.lock().unwrap();
        let session = guard.as_ref().ok_or("No active recording session")?;
        let mut cut = session.cut.lock().unwrap();
        fold_live(&session.capture.ctx, &mut cut);
        std::mem::take(&mut cut.pending)
    };
    encode_wav_pcm16(&pcm) // every lock is released by here
}

#[tauri::command]
pub fn stop_voice_session(state: tauri::State<'_, VoiceState>) -> Result<Vec<u8>, String> {
    let session = state
        .session
        .lock()
        .unwrap()
        .take()
        .ok_or("No active recording session")?;
    let Session { capture, cut } = session;

    // Close the stream first, then fold what the callback wrote last; nothing can
    // arrive after the join, so the tail is complete.
    let (samples, sample_rate, channels) = capture.finish()?;
    let pcm = {
        let mut state = cut.lock().unwrap();
        state
            .pending
            .extend_from_slice(&to_pcm16_mono_16k(&samples, sample_rate, channels));
        std::mem::take(&mut state.pending)
    };
    encode_wav_pcm16(&pcm)
}

#[tauri::command]
pub fn cancel_voice_session(state: tauri::State<'_, VoiceState>) -> Result<(), String> {
    drain_session(&state);
    Ok(())
}

// ---------------------------------------------------------------------------
// Encoding
// ---------------------------------------------------------------------------

// Mix to mono, resample to 16 kHz, quantise to 16-bit PCM. Interleaved input, so
// a cut only ever splits on a frame boundary (cpal hands the callback whole
// frames, and a cut takes whatever whole callbacks have written).
fn to_pcm16_mono_16k(samples: &[f32], sample_rate: u32, channels: u16) -> Vec<i16> {
    let channels = channels.max(1) as usize;
    let mono: Vec<f32> = if channels == 1 {
        samples.to_vec()
    } else {
        samples
            .chunks(channels)
            .map(|frame| frame.iter().sum::<f32>() / channels as f32)
            .collect()
    };

    resample_linear(&mono, sample_rate, TARGET_RATE)
        .into_iter()
        .map(|s| (s.clamp(-1.0, 1.0) * 32767.0) as i16)
        .collect()
}

// 16-bit PCM WAV in memory, at TARGET_RATE mono.
fn encode_wav_pcm16(pcm: &[i16]) -> Result<Vec<u8>, String> {
    let spec = hound::WavSpec {
        channels: 1,
        sample_rate: TARGET_RATE,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };
    let mut cursor = std::io::Cursor::new(Vec::<u8>::new());
    {
        let mut writer =
            hound::WavWriter::new(&mut cursor, spec).map_err(|e| format!("WAV init failed: {e}"))?;
        for &s in pcm {
            writer
                .write_sample(s)
                .map_err(|e| format!("WAV write failed: {e}"))?;
        }
        writer
            .finalize()
            .map_err(|e| format!("WAV finalize failed: {e}"))?;
    }
    Ok(cursor.into_inner())
}

// Linear interpolation resample. Good enough for speech; STT models don't need
// an anti-aliased downsample.
fn resample_linear(input: &[f32], from: u32, to: u32) -> Vec<f32> {
    if input.is_empty() || from == 0 {
        return Vec::new();
    }
    if from == to {
        return input.to_vec();
    }
    let ratio = to as f64 / from as f64;
    let out_len = ((input.len() as f64) * ratio).round() as usize;
    let last = input.len() - 1;
    let mut out = Vec::with_capacity(out_len);
    for i in 0..out_len {
        let src = i as f64 / ratio;
        let idx = src.floor() as usize;
        let frac = (src - idx as f64) as f32;
        let a = input[idx.min(last)];
        let b = input[(idx + 1).min(last)];
        out.push(a + (b - a) * frac);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ctx_with(sample_rate: u32, channels: u16) -> CaptureCtx {
        CaptureCtx {
            live: Arc::new(Mutex::new(Vec::new())),
            sample_rate,
            channels,
        }
    }

    fn empty_cut_state() -> CutState {
        CutState {
            pending: Vec::new(),
            last_cut: Instant::now(),
        }
    }

    fn wav_frames(bytes: &[u8]) -> usize {
        let reader = hound::WavReader::new(std::io::Cursor::new(bytes)).expect("valid wav");
        assert_eq!(reader.spec().channels, 1);
        assert_eq!(reader.spec().sample_rate, TARGET_RATE);
        assert_eq!(reader.spec().bits_per_sample, 16);
        reader.len() as usize
    }

    #[test]
    fn mono_at_target_rate_passes_through() {
        let pcm = to_pcm16_mono_16k(&[0.0, 0.5, -0.5, 1.0], TARGET_RATE, 1);
        assert_eq!(pcm, vec![0, 16383, -16383, 32767]);
    }

    #[test]
    fn stereo_is_averaged_into_one_channel() {
        // Frames: (1, -1) -> 0, (0.5, 0.5) -> 0.5.
        let pcm = to_pcm16_mono_16k(&[1.0, -1.0, 0.5, 0.5], TARGET_RATE, 2);
        assert_eq!(pcm, vec![0, 16383]);
    }

    #[test]
    fn out_of_range_samples_are_clamped() {
        let pcm = to_pcm16_mono_16k(&[2.0, -2.0], TARGET_RATE, 1);
        assert_eq!(pcm, vec![32767, -32767]);
    }

    #[test]
    fn downsampling_shortens_by_the_rate_ratio() {
        let input: Vec<f32> = (0..4800).map(|i| (i % 10) as f32 / 10.0).collect();
        let pcm = to_pcm16_mono_16k(&input, 48_000, 1);
        assert_eq!(pcm.len(), 1600);
    }

    #[test]
    fn stereo_downsampling_counts_frames_not_samples() {
        let input = vec![0.25f32; 9600]; // 4800 frames at 48 kHz = 100 ms
        let pcm = to_pcm16_mono_16k(&input, 48_000, 2);
        assert_eq!(pcm.len(), 1600);
        assert!(pcm.iter().all(|&s| s == 8191));
    }

    #[test]
    fn empty_input_encodes_a_valid_header_only_wav() {
        let bytes = encode_wav_pcm16(&[]).expect("encode");
        assert_eq!(&bytes[0..4], b"RIFF");
        assert_eq!(&bytes[8..12], b"WAVE");
        assert_eq!(wav_frames(&bytes), 0);
    }

    #[test]
    fn encoded_wav_round_trips_the_samples() {
        let pcm = vec![0i16, 1000, -1000, 32767];
        let bytes = encode_wav_pcm16(&pcm).expect("encode");
        assert_eq!(wav_frames(&bytes), pcm.len());
        let mut reader = hound::WavReader::new(std::io::Cursor::new(bytes)).expect("valid wav");
        let back: Vec<i16> = reader.samples::<i16>().map(|s| s.unwrap()).collect();
        assert_eq!(back, pcm);
    }

    #[test]
    fn folding_empties_the_live_buffer_and_appends_to_pending() {
        let ctx = ctx_with(TARGET_RATE, 1);
        let mut state = empty_cut_state();

        ctx.live.lock().unwrap().extend_from_slice(&[1.0, 1.0]);
        fold_live(&ctx, &mut state);
        assert!(ctx.live.lock().unwrap().is_empty());
        assert_eq!(state.pending, vec![32767, 32767]);

        // A second fold appends; it does not replace what the first one took.
        ctx.live.lock().unwrap().extend_from_slice(&[-1.0]);
        fold_live(&ctx, &mut state);
        assert_eq!(state.pending, vec![32767, 32767, -32767]);
    }

    #[test]
    fn taking_pending_leaves_the_next_segment_starting_empty() {
        let ctx = ctx_with(TARGET_RATE, 1);
        let mut state = empty_cut_state();

        ctx.live.lock().unwrap().extend_from_slice(&[1.0]);
        fold_live(&ctx, &mut state);
        let first = std::mem::take(&mut state.pending);
        assert_eq!(first, vec![32767]);

        ctx.live.lock().unwrap().extend_from_slice(&[-1.0]);
        fold_live(&ctx, &mut state);
        assert_eq!(state.pending, vec![-32767]);
    }

    #[test]
    fn a_fold_resets_the_auto_cut_clock() {
        let ctx = ctx_with(TARGET_RATE, 1);
        let mut state = empty_cut_state();
        state.last_cut = Instant::now() - Duration::from_secs(300);
        assert!(auto_cut_due(
            state.last_cut.elapsed(),
            Duration::from_secs(60)
        ));

        fold_live(&ctx, &mut state);
        assert!(!auto_cut_due(
            state.last_cut.elapsed(),
            Duration::from_secs(60)
        ));
    }

    // What the session promises: cutting while the callback is writing loses
    // nothing, because the live lock is only ever held for the swap.
    #[test]
    fn concurrent_cuts_lose_no_samples() {
        let ctx = ctx_with(TARGET_RATE, 1);
        let writer_ctx = ctx.clone();
        const CALLBACKS: usize = 2_000;
        const FRAMES: usize = 32;

        let writer = std::thread::spawn(move || {
            for _ in 0..CALLBACKS {
                writer_ctx
                    .live
                    .lock()
                    .unwrap()
                    .extend_from_slice(&[1.0f32; FRAMES]);
            }
        });

        let mut state = empty_cut_state();
        let mut cuts = 0usize;
        while !writer.is_finished() {
            fold_live(&ctx, &mut state);
            cuts += 1;
        }
        writer.join().unwrap();
        fold_live(&ctx, &mut state);

        assert_eq!(state.pending.len(), CALLBACKS * FRAMES);
        assert!(state.pending.iter().all(|&s| s == 32767));
        assert!(cuts > 0);
    }

    #[test]
    fn auto_cut_fires_only_once_the_interval_has_passed() {
        let max = Duration::from_secs(60);
        assert!(!auto_cut_due(Duration::from_secs(59), max));
        assert!(auto_cut_due(Duration::from_secs(60), max));
        assert!(auto_cut_due(Duration::from_secs(61), max));
        // A zero interval would cut on every tick; treat it as no auto-cut.
        assert!(!auto_cut_due(Duration::from_secs(60), Duration::ZERO));
    }

    #[test]
    fn segment_seconds_default_and_clamp() {
        assert_eq!(resolve_max_segment_seconds(None), DEFAULT_SEGMENT_SECONDS);
        assert_eq!(resolve_max_segment_seconds(Some(30)), 30);
        assert_eq!(resolve_max_segment_seconds(Some(0)), SEGMENT_SECONDS_MIN);
        assert_eq!(
            resolve_max_segment_seconds(Some(100_000)),
            SEGMENT_SECONDS_MAX
        );
    }

    // -----------------------------------------------------------------------
    // Real-device measurements
    //
    // Ignored: they hold the microphone and spend a few seconds of wall clock
    // each, so `cargo test` and CI never run them. To run them:
    //
    //   cargo test --lib voice:: -- --ignored --nocapture
    //
    // They count samples and never look at them. What is measured is whether the
    // device kept feeding the buffer across a segment boundary, not what was said
    // into it, so a silent room measures exactly as well as a spoken one.
    // -----------------------------------------------------------------------

    use tauri::Manager as _; // `manage` and `state` on the mock app

    // Both measurements own the input device and time themselves against the wall
    // clock, so they must not overlap.
    static MIC: Mutex<()> = Mutex::new(());

    const MEASURE_SEGMENTS: usize = 10;
    const MEASURE_SEGMENT: Duration = Duration::from_millis(300);

    // A `tauri::State` can only be handed out by a running App, so the
    // measurements reach the commands through a headless mock one: the path the
    // frontend takes, minus the IPC.
    fn mock_voice_app() -> tauri::App<tauri::test::MockRuntime> {
        let app = tauri::test::mock_app();
        app.manage(VoiceState::default());
        app
    }

    fn describe_default_input() -> String {
        let host = cpal::default_host();
        let Some(device) = host.default_input_device() else {
            return "<no default input device>".into();
        };
        let name = device.name().unwrap_or_else(|_| "<unnamed>".into());
        match device.default_input_config() {
            Ok(config) => format!(
                "{name} ({:?}, {} ch @ {} Hz, {:?})",
                host.id(),
                config.channels(),
                config.sample_rate().0,
                config.sample_format()
            ),
            Err(e) => format!("{name}: no default input config ({e})"),
        }
    }

    // How much of the elapsed wall clock did not make it into the audio.
    fn shortfall_ms(frames: usize, elapsed: Duration) -> f64 {
        elapsed.as_secs_f64() * 1000.0 - frames as f64 * 1000.0 / TARGET_RATE as f64
    }

    // The claim the session design rests on: cutting a segment costs no audio,
    // because the stream never stops and a cut is one `mem::take`.
    #[test]
    #[ignore = "needs a real input device; takes about 3 s of wall clock"]
    fn cutting_a_live_session_captures_the_whole_wall_clock() {
        let _mic = MIC.lock().unwrap_or_else(|e| e.into_inner());
        let app = mock_voice_app();
        let state = app.state::<VoiceState>();

        // Auto-cut parked at the ceiling: this measures explicit cuts.
        start_voice_session(state.clone(), Some(SEGMENT_SECONDS_MAX)).expect("session starts");
        let began = Instant::now();
        let stream = {
            let guard = state.session.lock().unwrap();
            let ctx = &guard.as_ref().expect("session is live").capture.ctx;
            format!("{} ch @ {} Hz", ctx.channels, ctx.sample_rate)
        };

        let mut frames = 0usize;
        for _ in 0..MEASURE_SEGMENTS {
            std::thread::sleep(MEASURE_SEGMENT);
            frames += wav_frames(&cut_voice_session(state.clone()).expect("cut"));
        }
        frames += wav_frames(&stop_voice_session(state.clone()).expect("stop"));
        let elapsed = began.elapsed();

        let expected = elapsed.as_secs_f64() * TARGET_RATE as f64;
        let missing = shortfall_ms(frames, elapsed);
        println!(
            "live session: {}, stream {stream}\n\
             live session: {MEASURE_SEGMENTS} cuts over {:.1} ms wall clock, captured {frames} \
             frames of {expected:.0} expected ({:.2}%), missing {missing:.1} ms total, \
             {:.1} ms per cut",
            describe_default_input(),
            elapsed.as_secs_f64() * 1000.0,
            frames as f64 / expected * 100.0,
            missing / MEASURE_SEGMENTS as f64,
        );

        // The clock starts after the stream is already playing, so a run that
        // loses nothing lands at or just above 1.00 — only the resampler's
        // per-chunk rounding is unaccounted for. Cutting by stopping and
        // restarting the stream instead measures around 0.97 (the other test),
        // and losing 100 ms at each of ten cuts would land near 0.67, so the bar
        // sits above both.
        assert!(
            frames as f64 >= expected * 0.98,
            "the session lost audio across cuts: captured {frames} frames, expected about \
             {expected:.0} for {:.1} ms of wall clock ({missing:.1} ms missing, {:.1} ms per cut)",
            elapsed.as_secs_f64() * 1000.0,
            missing / MEASURE_SEGMENTS as f64,
        );
    }

    // The alternative that was turned down, measured: segmenting by stopping and
    // restarting the recording instead of cutting a live one. Prints what one
    // seam costs.
    #[test]
    #[ignore = "needs a real input device; takes about 3 s of wall clock"]
    fn stop_and_start_segmenting_loses_audio_at_every_seam() {
        let _mic = MIC.lock().unwrap_or_else(|e| e.into_inner());
        let app = mock_voice_app();
        let state = app.state::<VoiceState>();

        // The clock starts once the first stream is live, so what it measures is
        // the seams between segments, not the cost of opening the first stream.
        start_voice_recording(state.clone()).expect("first recording starts");
        let began = Instant::now();

        let mut frames = 0usize;
        for i in 0..MEASURE_SEGMENTS {
            std::thread::sleep(MEASURE_SEGMENT);
            frames += wav_frames(&stop_voice_recording(state.clone()).expect("stop"));
            if i + 1 < MEASURE_SEGMENTS {
                start_voice_recording(state.clone()).expect("restart");
            }
        }
        let elapsed = began.elapsed();

        let seams = MEASURE_SEGMENTS - 1;
        let expected = elapsed.as_secs_f64() * TARGET_RATE as f64;
        let missing = shortfall_ms(frames, elapsed);
        println!(
            "stop/start: {}\n\
             stop/start: {MEASURE_SEGMENTS} segments over {:.1} ms wall clock, captured {frames} \
             frames of {expected:.0} expected ({:.2}%), missing {missing:.1} ms across {seams} \
             seams, {:.1} ms per seam",
            describe_default_input(),
            elapsed.as_secs_f64() * 1000.0,
            frames as f64 / expected * 100.0,
            missing / seams as f64,
        );

        // Only that the run was real; the number above is the point.
        assert!(frames > 0, "no audio captured, nothing to measure");
    }
}
