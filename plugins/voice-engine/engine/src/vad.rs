// Silero VAD v6.0 on ONNX Runtime (docs/companion/89): whether each 32 ms of
// the microphone is speech. The Android counterpart of `SileroVAD` in
// NeuralFront.swift, and the same loop as the official silero-vad package's
// `OnnxWrapper`: 512 new samples behind the last 64 of the previous frame, the
// LSTM state `[2,1,128]` carried from frame to frame, `sr` 16000, one thread.

use std::path::Path;

use ort::session::builder::GraphOptimizationLevel;
use ort::session::Session;
use ort::value::Tensor;

/// The model's path inside the voice-models directory.
pub const SILERO_FILE: &str = "silero-vad-v6.0/silero_vad.onnx";
/// The rate every model in the listening half runs at.
pub const RATE: u32 = 16_000;
/// New samples per frame: 32 ms.
pub const FRAME: usize = 512;
/// Samples of the previous frame the model sees in front of the new ones.
const CONTEXT: usize = 64;
const STATE: usize = 2 * 128;

fn err(e: impl std::fmt::Display) -> String {
    format!("Silero: {e}")
}

pub struct Silero {
    session: Session,
    window: Vec<f32>,
    state: Vec<f32>,
}

impl Silero {
    pub fn load(model: &Path) -> Result<Self, String> {
        let session = Session::builder()
            .map_err(err)?
            .with_optimization_level(GraphOptimizationLevel::Level3)
            .map_err(err)?
            .with_intra_threads(1)
            .map_err(err)?
            .with_inter_threads(1)
            .map_err(err)?
            .commit_from_file(model)
            .map_err(err)?;
        Ok(Self { session, window: vec![0.0; CONTEXT + FRAME], state: vec![0.0; STATE] })
    }

    /// Back to the start of a stream: zero context, zero state.
    pub fn reset(&mut self) {
        self.window.fill(0.0);
        self.state.fill(0.0);
    }

    /// The speech probability of one frame of exactly `FRAME` samples in
    /// [-1, 1]. The model carries its own state to the next call.
    pub fn probability(&mut self, frame: &[f32]) -> Result<f32, String> {
        if frame.len() != FRAME {
            return Err(err(format!("takes {FRAME} samples, got {}", frame.len())));
        }
        // The previous frame's tail is the new window's head.
        self.window.copy_within(FRAME.., 0);
        self.window[CONTEXT..].copy_from_slice(frame);
        let window = Tensor::from_array(([1usize, CONTEXT + FRAME], self.window.clone()));
        let state = Tensor::from_array(([2usize, 1, 128], self.state.clone()));
        let rate = Tensor::from_array(([0usize; 0], vec![RATE as i64]));
        let inputs = ort::inputs! {
            "input" => window.map_err(err)?,
            "state" => state.map_err(err)?,
            "sr" => rate.map_err(err)?,
        };
        let outputs = self.session.run(inputs).map_err(err)?;
        let (_, p) = outputs["output"].try_extract_tensor::<f32>().map_err(err)?;
        let p = *p.first().ok_or_else(|| err("empty output"))?;
        let (_, state) = outputs["stateN"].try_extract_tensor::<f32>().map_err(err)?;
        if state.len() != STATE {
            return Err(err(format!("stateN has {} floats", state.len())));
        }
        self.state.copy_from_slice(state);
        Ok(p)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::fixture;

    /// Every whole frame of the fixture against the official package's
    /// probabilities (fixtures/make_fixture.py).
    #[test]
    fn matches_the_official_package_frame_by_frame() {
        let Some(path) = fixture::model(SILERO_FILE) else { return };
        let clip = fixture::clip();
        let want = fixture::reference()["silero"].as_array().unwrap().clone();
        let mut vad = Silero::load(&path).unwrap();
        assert_eq!(want.len(), clip.len() / FRAME);
        let mut worst = 0f32;
        for (i, frame) in clip.chunks_exact(FRAME).enumerate() {
            let p = vad.probability(frame).unwrap();
            worst = worst.max((p - want[i].as_f64().unwrap() as f32).abs());
        }
        println!("silero: {} frames, max |diff| {worst:e}", want.len());
        assert!(worst < 1e-3, "max |diff| {worst}");

        // A reset starts the stream over: the first frame again.
        vad.reset();
        let p = vad.probability(&clip[..FRAME]).unwrap();
        assert!((p - want[0].as_f64().unwrap() as f32).abs() < 1e-3);
        assert!(vad.probability(&clip[..10]).is_err());
    }
}
