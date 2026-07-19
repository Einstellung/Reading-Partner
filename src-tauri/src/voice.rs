// Push-to-talk microphone capture (docs/15). getUserMedia/MediaRecorder is
// unreliable on WebKitGTK (the app's primary desktop is Linux), so we record in
// Rust with cpal and hand the frontend a 16 kHz mono WAV that SenseVoice/whisper
// class STT models expect.
//
// cpal's Stream is !Send, so it can't be stored in shared state and touched from
// another command's thread. The pattern: a dedicated thread builds and owns the
// stream, an AtomicBool signals it to stop, and the audio callback pushes samples
// into a shared buffer. start/stop/cancel drive that thread through a Recorder
// handle in managed state.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};

// Safety stop: an unattended press won't record forever.
const MAX_SECONDS: u64 = 90;
const TARGET_RATE: u32 = 16_000;

struct RecordedAudio {
    samples: Vec<f32>,
    sample_rate: u32,
    channels: u16,
}

struct Recorder {
    stop: Arc<AtomicBool>,
    handle: JoinHandle<Result<RecordedAudio, String>>,
}

#[derive(Default)]
pub struct VoiceState(Mutex<Option<Recorder>>);

// Drain any in-progress recording so a fresh start (or app teardown) can't leave
// an orphaned capture thread holding the mic.
fn drain(state: &VoiceState) {
    if let Some(rec) = state.0.lock().unwrap().take() {
        rec.stop.store(true, Ordering::Relaxed);
        let _ = rec.handle.join();
    }
}

#[tauri::command]
pub fn start_voice_recording(state: tauri::State<'_, VoiceState>) -> Result<(), String> {
    drain(&state);

    let stop = Arc::new(AtomicBool::new(false));
    let stop_thread = stop.clone();
    // The thread builds the stream (cpal work must all happen on one thread) and
    // reports readiness back so device/permission errors surface at start, not at
    // stop.
    let (ready_tx, ready_rx) = mpsc::channel::<Result<(), String>>();

    let handle = std::thread::spawn(move || -> Result<RecordedAudio, String> {
        let host = cpal::default_host();
        let device = match host.default_input_device() {
            Some(d) => d,
            None => {
                let _ = ready_tx.send(Err(
                    "No microphone found. Connect an input device and try again.".into(),
                ));
                return Err("no input device".into());
            }
        };
        let default_config = match device.default_input_config() {
            Ok(c) => c,
            Err(e) => {
                let _ = ready_tx.send(Err(format!("Microphone is unavailable: {e}")));
                return Err("no input config".into());
            }
        };

        let sample_format = default_config.sample_format();
        let config: cpal::StreamConfig = default_config.into();
        let channels = config.channels;
        let sample_rate = config.sample_rate.0;

        let buffer = Arc::new(Mutex::new(Vec::<f32>::new()));
        let err_fn = |err| eprintln!("voice input stream error: {err}");

        let stream_result = match sample_format {
            cpal::SampleFormat::F32 => {
                let buf = buffer.clone();
                device.build_input_stream(
                    &config,
                    move |data: &[f32], _: &_| buf.lock().unwrap().extend_from_slice(data),
                    err_fn,
                    None,
                )
            }
            cpal::SampleFormat::I16 => {
                let buf = buffer.clone();
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
                let buf = buffer.clone();
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
                let _ = ready_tx.send(Err(format!("Unsupported microphone sample format: {other:?}")));
                return Err("unsupported sample format".into());
            }
        };

        let stream = match stream_result {
            Ok(s) => s,
            Err(e) => {
                let _ = ready_tx.send(Err(format!("Failed to open the microphone: {e}")));
                return Err("stream build failed".into());
            }
        };
        if let Err(e) = stream.play() {
            let _ = ready_tx.send(Err(format!("Failed to start the microphone: {e}")));
            return Err("stream play failed".into());
        }

        let _ = ready_tx.send(Ok(()));

        let start = Instant::now();
        while !stop_thread.load(Ordering::Relaxed) {
            if start.elapsed() >= Duration::from_secs(MAX_SECONDS) {
                break;
            }
            std::thread::sleep(Duration::from_millis(50));
        }

        drop(stream); // stop capture before reading the buffer
        let samples = std::mem::take(&mut *buffer.lock().unwrap());
        Ok(RecordedAudio {
            samples,
            sample_rate,
            channels,
        })
    });

    match ready_rx.recv() {
        Ok(Ok(())) => {
            *state.0.lock().unwrap() = Some(Recorder { stop, handle });
            Ok(())
        }
        Ok(Err(e)) => {
            let _ = handle.join();
            Err(e)
        }
        Err(_) => Err("Recorder thread exited before it started".into()),
    }
}

#[tauri::command]
pub fn stop_voice_recording(state: tauri::State<'_, VoiceState>) -> Result<Vec<u8>, String> {
    let rec = state
        .0
        .lock()
        .unwrap()
        .take()
        .ok_or("No active recording")?;
    rec.stop.store(true, Ordering::Relaxed);
    let audio = rec
        .handle
        .join()
        .map_err(|_| "Recorder thread panicked".to_string())??;

    if audio.samples.is_empty() {
        return Err("No audio was captured. Check that the microphone isn't muted.".into());
    }
    encode_wav_16k_mono(&audio)
}

#[tauri::command]
pub fn cancel_voice_recording(state: tauri::State<'_, VoiceState>) -> Result<(), String> {
    drain(&state);
    Ok(())
}

// Mix to mono, resample to 16 kHz, encode a 16-bit PCM WAV in memory.
fn encode_wav_16k_mono(audio: &RecordedAudio) -> Result<Vec<u8>, String> {
    let channels = audio.channels.max(1) as usize;
    let mono: Vec<f32> = if channels == 1 {
        audio.samples.clone()
    } else {
        audio
            .samples
            .chunks(channels)
            .map(|frame| frame.iter().sum::<f32>() / channels as f32)
            .collect()
    };

    let resampled = resample_linear(&mono, audio.sample_rate, TARGET_RATE);

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
        for s in resampled {
            let v = (s.clamp(-1.0, 1.0) * 32767.0) as i16;
            writer
                .write_sample(v)
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
