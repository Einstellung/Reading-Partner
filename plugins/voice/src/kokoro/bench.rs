// The device bench behind `kokoro_bench` (debug builds only): for each model
// variant that is downloaded and each thread count, load the model, then say
// every given sentence and time it. One Kokoro call produces the whole
// sentence at once, so a sentence's time to first audio is its synthesis time.
//
// Synchronous and long (minutes for the full grid on a phone); the command
// runs it on a blocking thread.

use std::path::Path;
use std::time::Instant;

use serde::{Deserialize, Serialize};

use super::engine::Engine;
use super::manifest::{self, Variant};
use super::tokens::phoneme_len;
use super::voice::{zh_speed, VoicePack};
use super::SAMPLE_RATE_HZ;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BenchArgs {
    /// One misaki phoneme string per sentence.
    pub phonemes: Vec<String>,
    #[serde(default = "default_voice")]
    pub voice: String,
    #[serde(default = "default_variants")]
    pub variants: Vec<Variant>,
    #[serde(default = "default_threads")]
    pub threads: Vec<usize>,
    /// A fixed speed; absent means the Chinese sample's rule for a `z` voice
    /// and 1.0 otherwise.
    #[serde(default)]
    pub speed: Option<f32>,
    /// Warm passes over the sentences after the cold first call.
    #[serde(default = "default_reps")]
    pub reps: usize,
}

fn default_voice() -> String {
    "zf_001".into()
}
fn default_variants() -> Vec<Variant> {
    Variant::ALL.to_vec()
}
fn default_threads() -> Vec<usize> {
    vec![1, 2, 4]
}
fn default_reps() -> usize {
    1
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SentenceTiming {
    pub index: usize,
    pub phonemes: usize,
    /// Time to the sentence's audio, which is all of it.
    pub first_audio_ms: f64,
    pub audio_ms: f64,
    pub rtf: f64,
    /// NaN or infinite samples. The fp16 export gives nothing but NaN on the
    /// x86 CPU provider (docs/pitfall 655); this is how a device run shows
    /// whether ARM does the same.
    pub non_finite: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunTiming {
    pub variant: Variant,
    pub threads: usize,
    pub load_ms: f64,
    /// The first sentence straight after loading, which pays for whatever the
    /// runtime does lazily on its first run.
    pub cold_first_audio_ms: f64,
    /// Warm passes, `reps` times over every sentence.
    pub sentences: Vec<SentenceTiming>,
    pub p50_first_audio_ms: f64,
    pub max_first_audio_ms: f64,
    pub median_rtf: f64,
    /// Sentences with any NaN or infinite sample.
    pub broken_sentences: usize,
    /// Total synthesis time over total audio, warm passes only.
    pub overall_rtf: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Skipped {
    pub variant: Variant,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BenchReport {
    pub revision: String,
    pub voice: String,
    pub parallelism: usize,
    pub runs: Vec<RunTiming>,
    pub skipped: Vec<Skipped>,
    pub total_ms: f64,
}

pub fn median(xs: &[f64]) -> f64 {
    if xs.is_empty() {
        return 0.0;
    }
    let mut v = xs.to_vec();
    v.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let m = v.len() / 2;
    if v.len() % 2 == 1 {
        v[m]
    } else {
        (v[m - 1] + v[m]) / 2.0
    }
}

pub fn summarize(
    variant: Variant,
    threads: usize,
    load_ms: f64,
    cold_first_audio_ms: f64,
    sentences: Vec<SentenceTiming>,
) -> RunTiming {
    let firsts: Vec<f64> = sentences.iter().map(|s| s.first_audio_ms).collect();
    let rtfs: Vec<f64> = sentences.iter().map(|s| s.rtf).collect();
    let audio: f64 = sentences.iter().map(|s| s.audio_ms).sum();
    let synth: f64 = firsts.iter().sum();
    RunTiming {
        variant,
        threads,
        load_ms,
        cold_first_audio_ms,
        p50_first_audio_ms: median(&firsts),
        max_first_audio_ms: firsts.iter().cloned().fold(0.0, f64::max),
        median_rtf: median(&rtfs),
        broken_sentences: sentences.iter().filter(|s| s.non_finite > 0).count(),
        overall_rtf: if audio > 0.0 { synth / audio } else { 0.0 },
        sentences,
    }
}

fn timed(
    engine: &mut Engine,
    index: usize,
    ps: &str,
    voice: &VoicePack,
    speed: f32,
) -> Result<SentenceTiming, String> {
    let t0 = Instant::now();
    let wav = engine.synthesize(ps, voice, speed)?;
    let first_audio_ms = t0.elapsed().as_secs_f64() * 1000.0;
    let audio_ms = wav.len() as f64 * 1000.0 / SAMPLE_RATE_HZ as f64;
    Ok(SentenceTiming {
        index,
        phonemes: phoneme_len(ps),
        first_audio_ms,
        audio_ms,
        rtf: if audio_ms > 0.0 { first_audio_ms / audio_ms } else { 0.0 },
        non_finite: wav.iter().filter(|s| !s.is_finite()).count(),
    })
}

/// `root` is the revision directory the downloader fills.
pub fn run(root: &Path, args: &BenchArgs) -> Result<BenchReport, String> {
    let t_all = Instant::now();
    if args.phonemes.is_empty() {
        return Err("The bench needs at least one phoneme string.".into());
    }
    let vf = manifest::voice_file(&args.voice)
        .ok_or_else(|| format!("No voice called {}.", args.voice))?;
    let voice = VoicePack::load(&root.join(vf.path))?;
    let speed_for = |ps: &str| {
        args.speed.unwrap_or_else(|| {
            if args.voice.starts_with('z') {
                zh_speed(phoneme_len(ps))
            } else {
                1.0
            }
        })
    };
    let mut runs = Vec::new();
    let mut skipped = Vec::new();
    for &variant in &args.variants {
        let file = variant.file();
        let path = root.join(file.path);
        let present = std::fs::metadata(&path).map(|m| m.len() == file.size).unwrap_or(false);
        if !present {
            skipped.push(Skipped { variant, reason: "not downloaded".into() });
            continue;
        }
        for &threads in &args.threads {
            let mut engine = match Engine::load(&path, threads) {
                Ok(e) => e,
                Err(e) => {
                    skipped.push(Skipped { variant, reason: e });
                    break;
                }
            };
            let first = &args.phonemes[0];
            let cold = timed(&mut engine, 0, first, &voice, speed_for(first))?.first_audio_ms;
            let mut sentences = Vec::new();
            for _ in 0..args.reps.max(1) {
                for (i, ps) in args.phonemes.iter().enumerate() {
                    sentences.push(timed(&mut engine, i, ps, &voice, speed_for(ps))?);
                }
            }
            runs.push(summarize(variant, threads, engine.load_ms, cold, sentences));
        }
    }
    Ok(BenchReport {
        revision: manifest::REVISION.into(),
        voice: args.voice.clone(),
        parallelism: std::thread::available_parallelism().map(|n| n.get()).unwrap_or(0),
        runs,
        skipped,
        total_ms: t_all.elapsed().as_secs_f64() * 1000.0,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn args_default_to_the_full_grid() {
        let a: BenchArgs = serde_json::from_str(r#"{"phonemes":["a"]}"#).unwrap();
        assert_eq!(a.variants, Variant::ALL.to_vec());
        assert_eq!(a.threads, vec![1, 2, 4]);
        assert_eq!((a.voice.as_str(), a.reps, a.speed), ("zf_001", 1, None));
    }

    #[test]
    fn summary_takes_medians_and_overall() {
        let s = |i, ms, audio| SentenceTiming {
            index: i,
            phonemes: 1,
            first_audio_ms: ms,
            audio_ms: audio,
            rtf: ms / audio,
            non_finite: 0,
        };
        let r = summarize(
            Variant::Int8,
            2,
            100.0,
            900.0,
            vec![s(0, 100.0, 1000.0), s(1, 300.0, 1000.0), s(2, 200.0, 2000.0)],
        );
        assert_eq!(r.p50_first_audio_ms, 200.0);
        assert_eq!(r.max_first_audio_ms, 300.0);
        assert_eq!(r.median_rtf, 0.1);
        assert_eq!(r.overall_rtf, 600.0 / 4000.0);
        assert_eq!(median(&[1.0, 2.0, 3.0, 4.0]), 2.5);
    }

    #[test]
    fn missing_models_are_skipped_not_fatal() {
        let root = std::env::temp_dir().join(format!("kokoro-bench-{}", std::process::id()));
        let vf = manifest::voice_file("zf_001").unwrap();
        std::fs::create_dir_all(root.join("voices")).unwrap();
        std::fs::write(root.join(vf.path), vec![0u8; vf.size as usize]).unwrap();
        let args: BenchArgs =
            serde_json::from_str(r#"{"phonemes":["a"],"variants":["int8"]}"#).unwrap();
        let r = run(&root, &args).unwrap();
        assert!(r.runs.is_empty());
        assert_eq!(r.skipped.len(), 1);
        let _ = std::fs::remove_dir_all(&root);
    }
}
