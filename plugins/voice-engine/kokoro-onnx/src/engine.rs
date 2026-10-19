// One Kokoro ONNX session on the CPU. Synchronous and CPU-bound: callers run
// it on a blocking thread (`tauri::async_runtime::spawn_blocking`), one
// sentence per call.
//
// CPU only, by decision: iOS takes the GPU away from a backgrounded app, and a
// locked screen is where a call keeps talking. No execution provider is
// registered, so ONNX Runtime uses its default CPU provider.

use std::path::Path;
use std::time::Instant;

use ort::session::builder::GraphOptimizationLevel;
use ort::session::Session;
use ort::value::Tensor;

use super::tokens::tokenize;
use super::voice::{VoicePack, STYLE_DIM};

pub struct Engine {
    session: Session,
    /// Wall time `load` took: reading the file, optimizing the graph, building
    /// the session.
    pub load_ms: f64,
}

fn err(e: impl std::fmt::Display) -> String {
    format!("Kokoro: {e}")
}

impl Engine {
    /// Load one model file. `threads` is ONNX Runtime's intra-op pool size;
    /// the inter-op pool stays at one (the graph runs sequentially).
    pub fn load(model: &Path, threads: usize) -> Result<Self, String> {
        let t0 = Instant::now();
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
        Ok(Self { session, load_ms: t0.elapsed().as_secs_f64() * 1000.0 })
    }

    /// The model's input and output names, for diagnostics.
    pub fn signature(&self) -> (Vec<String>, Vec<String>) {
        (
            self.session.inputs().iter().map(|o| o.name().to_string()).collect(),
            self.session.outputs().iter().map(|o| o.name().to_string()).collect(),
        )
    }

    /// One sentence: misaki phonemes, the voice, the speed (1.0 is the
    /// model's own pace; see `voice::zh_speed` for the Chinese sample's rule).
    /// Returns 24 kHz mono float samples.
    pub fn synthesize(
        &mut self,
        phonemes: &str,
        voice: &VoicePack,
        speed: f32,
    ) -> Result<Vec<f32>, String> {
        self.synthesize_style(phonemes, voice.style_for(phonemes), speed)
    }

    /// One sentence with the voice's style row already chosen (`STYLE_DIM`
    /// floats, `VoicePack::style_for`): the Android engine gets the row over
    /// the socket from the main process, which holds the voice tables.
    pub fn synthesize_style(
        &mut self,
        phonemes: &str,
        style: &[f32],
        speed: f32,
    ) -> Result<Vec<f32>, String> {
        if style.len() != STYLE_DIM {
            return Err(err(format!("style row has {} floats, not {STYLE_DIM}", style.len())));
        }
        let ids = tokenize(phonemes)?;
        let n = ids.len();
        let style = style.to_vec();
        let inputs = ort::inputs! {
            "input_ids" => Tensor::from_array(([1usize, n], ids)).map_err(err)?,
            "style" => Tensor::from_array(([1usize, STYLE_DIM], style)).map_err(err)?,
            "speed" => Tensor::from_array(([1usize], vec![speed])).map_err(err)?,
        };
        let outputs = self.session.run(inputs).map_err(err)?;
        let (_, wav) = outputs[0].try_extract_tensor::<f32>().map_err(err)?;
        Ok(wav.to_vec())
    }
}

#[cfg(test)]
mod tests {
    use super::super::manifest::{self, Variant};
    use super::super::voice::zh_speed;
    use super::*;
    use std::path::PathBuf;

    /// The Linux comparison run (docs/pitfall 655-656 came out of it). Needs
    /// `KOKORO_MODELS` (a directory laid out like the repo: onnx/, voices/),
    /// `KOKORO_MANIFEST` (items with phonemes and voice) and `KOKORO_OUT`.
    /// Writes `<variant>/<index>.f32` and `<variant>.json` with timings.
    /// `cargo test --features kokoro -- --ignored linux_compare --nocapture`
    #[test]
    #[ignore]
    fn linux_compare() {
        let models = PathBuf::from(std::env::var("KOKORO_MODELS").expect("KOKORO_MODELS"));
        let out = PathBuf::from(std::env::var("KOKORO_OUT").expect("KOKORO_OUT"));
        let man: serde_json::Value = serde_json::from_slice(
            &std::fs::read(std::env::var("KOKORO_MANIFEST").expect("KOKORO_MANIFEST")).unwrap(),
        )
        .unwrap();
        let threads: usize =
            std::env::var("KOKORO_THREADS").ok().and_then(|t| t.parse().ok()).unwrap_or(4);
        for variant in Variant::ALL {
            let model = models.join(variant.file().path);
            if !model.exists() {
                continue;
            }
            let mut engine = Engine::load(&model, threads).unwrap();
            println!("{} load {:.0} ms, io {:?}", variant.name(), engine.load_ms, engine.signature());
            let dir = out.join(variant.name());
            std::fs::create_dir_all(&dir).unwrap();
            let mut rows = Vec::new();
            for item in man["items"].as_array().unwrap() {
                let ps = item["phonemes"].as_str().unwrap();
                let name = item["voice"].as_str().unwrap();
                let voice =
                    VoicePack::load(&models.join(manifest::voice_file(name).unwrap().path)).unwrap();
                let speed = if name.starts_with('z') { zh_speed(ps.chars().count()) } else { 1.0 };
                let t0 = Instant::now();
                let wav = engine.synthesize(ps, &voice, speed).unwrap();
                let ms = t0.elapsed().as_secs_f64() * 1000.0;
                let idx = item["index"].as_u64().unwrap();
                let bytes: Vec<u8> = wav.iter().flat_map(|s| s.to_le_bytes()).collect();
                std::fs::write(dir.join(format!("{idx:02}.f32")), bytes).unwrap();
                let audio_ms = wav.len() as f64 / 24.0;
                println!("  {idx:02} {} samples {ms:.0} ms rtf {:.3}", wav.len(), ms / audio_ms);
                rows.push(serde_json::json!({
                    "index": idx, "samples": wav.len(), "ms": ms, "rtf": ms / audio_ms,
                }));
            }
            std::fs::write(
                out.join(format!("{}.json", variant.name())),
                serde_json::to_vec_pretty(&serde_json::json!({
                    "threads": threads, "load_ms": engine.load_ms, "items": rows,
                }))
                .unwrap(),
            )
            .unwrap();
        }
    }
}
