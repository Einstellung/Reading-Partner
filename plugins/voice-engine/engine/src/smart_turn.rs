// Smart Turn v3.2 on ONNX Runtime (docs/companion/89): whether a turn that went
// quiet is over. The input is pipecat's `inference.py`: the turn's last 8 s,
// zeros in front when it is shorter, the whole window normalised to zero mean
// and unit variance, the Whisper log-mel of it (`mel.rs`) as `[1,80,800]`. The
// fp32 model ends in a Sigmoid, so its output is already the probability.

use std::path::Path;

use ort::session::builder::GraphOptimizationLevel;
use ort::session::Session;
use ort::value::Tensor;

use crate::mel::{LogMel, N_MELS};

/// The model's path inside the voice-models directory.
pub const SMART_TURN_FILE: &str = "smart-turn-v3.2-gpu.onnx";
/// 8 s at 16 kHz.
pub const WINDOW: usize = 128_000;
/// The model card's line: above it, the turn is complete.
pub const THRESHOLD: f32 = 0.5;
const FRAMES: usize = WINDOW / crate::mel::HOP;

fn err(e: impl std::fmt::Display) -> String {
    format!("Smart Turn: {e}")
}

/// The model's input for a turn's audio (16 kHz, oldest first; only the last
/// 8 s are read): `N_MELS * 800` floats, mel-major.
pub fn features(mel: &LogMel, audio: &[f32]) -> Vec<f32> {
    let tail = &audio[audio.len().saturating_sub(WINDOW)..];
    let mut window = vec![0.0f32; WINDOW];
    window[WINDOW - tail.len()..].copy_from_slice(tail);
    // transformers' zero_mean_unit_var_norm over the whole padded window.
    let mean = window.iter().map(|&x| x as f64).sum::<f64>() / WINDOW as f64;
    let var = window.iter().map(|&x| (x as f64 - mean).powi(2)).sum::<f64>() / WINDOW as f64;
    let scale = 1.0 / (var + 1e-7).sqrt();
    for x in window.iter_mut() {
        *x = ((*x as f64 - mean) * scale) as f32;
    }
    mel.compute(&window)
}

pub struct SmartTurn {
    session: Session,
    mel: LogMel,
}

impl SmartTurn {
    pub fn load(model: &Path, threads: usize) -> Result<Self, String> {
        let session = Session::builder()
            .map_err(err)?
            .with_optimization_level(GraphOptimizationLevel::Level3)
            .map_err(err)?
            .with_intra_threads(threads.max(1))
            .map_err(err)?
            .with_inter_threads(1)
            .map_err(err)?
            .commit_from_file(model)
            .map_err(err)?;
        Ok(Self { session, mel: LogMel::new() })
    }

    /// The probability that the speaker has finished, for the turn's audio.
    pub fn probability(&mut self, audio: &[f32]) -> Result<f32, String> {
        let input = features(&self.mel, audio);
        let inputs = ort::inputs! {
            "input_features" => Tensor::from_array(([1usize, N_MELS, FRAMES], input)).map_err(err)?,
        };
        let outputs = self.session.run(inputs).map_err(err)?;
        let (_, p) = outputs["logits"].try_extract_tensor::<f32>().map_err(err)?;
        p.first().copied().ok_or_else(|| err("empty output"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::fixture;

    /// The full fixture clip's features against `WhisperFeatureExtractor`
    /// as `inference.py` calls it, at the frames the reference kept.
    #[test]
    fn features_match_whisper_feature_extractor() {
        let clip = fixture::clip();
        let got = features(&LogMel::new(), &clip);
        assert_eq!(got.len(), N_MELS * FRAMES);
        let frames: Vec<usize> = fixture::reference()["mel_frames"]
            .as_array()
            .unwrap()
            .iter()
            .map(|f| f.as_u64().unwrap() as usize)
            .collect();
        let want = fixture::f32s("mel-ref.f32");
        assert_eq!(want.len(), frames.len() * N_MELS);
        let mut worst = 0f32;
        for (i, &t) in frames.iter().enumerate() {
            for m in 0..N_MELS {
                worst = worst.max((got[m * FRAMES + t] - want[i * N_MELS + m]).abs());
            }
        }
        println!("mel: {} frames x {N_MELS}, max |diff| {worst:e}", frames.len());
        assert!(worst < 1e-4, "max |diff| {worst}");
    }

    #[test]
    fn short_audio_is_padded_in_front_and_long_audio_keeps_its_end() {
        let mel = LogMel::new();
        let clip = fixture::clip();
        let mut padded = vec![0.0; WINDOW - clip.len()];
        padded.extend_from_slice(&clip);
        assert_eq!(features(&mel, &clip), features(&mel, &padded));
        let mut long = vec![0.25; 3 * WINDOW];
        long.extend_from_slice(&padded);
        assert_eq!(features(&mel, &long), features(&mel, &padded));
    }

    /// Three cuts of the fixture against `inference.py`'s `predict_endpoint`:
    /// the first utterance and 300 ms after it, the whole clip, and the clip
    /// three times over (longer than the window).
    #[test]
    fn matches_pipecat_inference() {
        let Some(path) = fixture::model(SMART_TURN_FILE) else { return };
        let clip = fixture::clip();
        let r = &fixture::reference()["smart_turn"];
        let mid = r["mid_samples"].as_u64().unwrap() as usize;
        let long: Vec<f32> = clip.iter().chain(&clip).chain(&clip).copied().collect();
        let mut model = SmartTurn::load(&path, 2).unwrap();
        for (name, audio) in [("mid", &clip[..mid]), ("full", &clip[..]), ("long", &long[..])] {
            let p = model.probability(audio).unwrap();
            let want = r[name].as_f64().unwrap() as f32;
            println!("smart turn {name}: {p} (reference {want}, |diff| {:e})", (p - want).abs());
            assert!((p - want).abs() < 1e-3, "{name}: {p} vs {want}");
        }
    }
}
