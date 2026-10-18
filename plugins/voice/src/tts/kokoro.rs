// On-device Kokoro as a `TtsBackend` (docs/companion/136): the only voice.
// Linked on iOS only (src-tauri/Cargo.toml); other hosts have no player.
//
// A sentence goes text -> misaki phonemes (kokoro_g2p) -> the model (kokoro::
// engine) -> 24 kHz float samples -> 16-bit PCM, the format the relay, the trim
// and the player already speak. Nothing above this line knows the difference
// from a vendor except `max_in_flight`.
//
// The model is loaded once per process, the first time it is needed, and kept:
// a load is 0.5-0.7 s on an A16 and a call cannot pay that per sentence. The
// session asks for it early (`OnDeviceVoice::backend` warms it) so the first
// sentence of a call finds it in memory. Synthesis is CPU-bound and blocking,
// so every call runs on a blocking thread, never on the async runtime.
//
// The engine itself needs ONNX Runtime and is behind the `kokoro` feature. The
// rest of this file builds everywhere, so the backend's behaviour is tested
// against a stand-in model on any host.

#[cfg(feature = "kokoro")]
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Instant;

use async_trait::async_trait;
use tokio::sync::mpsc;

use super::backend::{OnDeviceVoice, SpeechRequest, TtsBackend};
use super::error::TtsError;
use super::format::AudioFormat;
use crate::kokoro::manifest::{self, Variant};
use crate::kokoro::to_pcm16le;
use crate::kokoro::tokens::phoneme_len;
use crate::kokoro::voice::{zh_speed, VoicePack};
use crate::kokoro_g2p;

/// The voice that speaks. One constant until the listening page lets the user
/// pick one.
pub const VOICE: &str = "zf_001";
/// The voice for a sentence with no Chinese in it: v1.1-zh's English voice,
/// the one its samples pair with zf_001 (kokoro/manifest.rs). English phonemes
/// through a Chinese voice come out accented.
pub const EN_VOICE: &str = "af_maple";
/// The only variant that speaks: fp16 gives NaN on iOS (docs/pitfall 655) and
/// int8 is out.
pub const VARIANT: Variant = Variant::Fp32;
/// ONNX Runtime's intra-op pool. Measured on an A16 iPad: RTF 0.45.
pub const THREADS: usize = 4;

/// What a turn is refused with before the files are on disk. Shown to the user.
pub const NOT_DOWNLOADED: &str =
    "The on-device voice is not downloaded yet: download it in Settings → Optional → Voice output.";

/// Which front end a sentence goes through.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Script {
    /// Any Chinese at all, English words inside included: misaki's zh G2P
    /// hands Latin runs to its English callable itself.
    Chinese,
    /// No Chinese and some Latin letters or digits.
    English,
}

fn is_han(c: char) -> bool {
    matches!(c,
        '\u{3400}'..='\u{4DBF}' | '\u{4E00}'..='\u{9FFF}' | '\u{F900}'..='\u{FAFF}'
        | '\u{20000}'..='\u{2FFFF}')
}

pub fn script_of(text: &str) -> Script {
    if text.chars().any(is_han) {
        Script::Chinese
    } else if text.chars().any(|c| c.is_ascii_alphanumeric()) {
        Script::English
    } else {
        // Punctuation, or a script the model has no front end for: the zh
        // front end drops what it cannot read, and nothing comes out.
        Script::Chinese
    }
}

/// The phoneme strings for one sentence, one per model call. A sentence from
/// the splitter is one; only text past the model's context comes out as more.
pub fn phonemize(script: Script, text: &str) -> Vec<String> {
    let chunks = match script {
        Script::Chinese => kokoro_g2p::phonemize_zh(text),
        Script::English => kokoro_g2p::phonemize_en(text),
    };
    chunks
        .into_iter()
        .filter(|p| !p.trim().is_empty())
        .collect()
}

/// The pace for this voice: the Chinese sample's rule for a Chinese voice,
/// the model's own for an English one.
pub fn speed_for(script: Script, phonemes: &str) -> f32 {
    match script {
        Script::Chinese => zh_speed(phoneme_len(phonemes)),
        Script::English => 1.0,
    }
}

/// The model, as far as this backend needs it: one phoneme string and a voice
/// in, 24 kHz mono float samples out.
pub trait Synthesizer: Send + 'static {
    fn synthesize(
        &mut self,
        phonemes: &str,
        voice: &VoicePack,
        speed: f32,
    ) -> Result<Vec<f32>, String>;
}

#[cfg(feature = "kokoro")]
impl Synthesizer for crate::kokoro::engine::Engine {
    fn synthesize(
        &mut self,
        phonemes: &str,
        voice: &VoicePack,
        speed: f32,
    ) -> Result<Vec<f32>, String> {
        crate::kokoro::engine::Engine::synthesize(self, phonemes, voice, speed)
    }
}

/// What a sentence needs in memory: the model and both voices.
pub struct Loaded {
    pub synth: Box<dyn Synthesizer>,
    pub zh: VoicePack,
    pub en: VoicePack,
}

pub type Loader = Box<dyn Fn() -> Result<Loaded, String> + Send + Sync>;

struct Inner {
    load: Loader,
    /// The model once loaded. The lock is held for the whole of a synthesis:
    /// one model, one sentence at a time.
    state: Mutex<Option<Loaded>>,
    /// True once `state` holds the model, readable without the lock.
    loaded: AtomicBool,
    /// A warm-up load is queued or running.
    warming: AtomicBool,
}

impl Inner {
    /// Load the model into `state` if it is not there yet.
    fn ensure<'a>(&self, state: &'a mut Option<Loaded>) -> Result<&'a mut Loaded, String> {
        if state.is_none() {
            let t0 = Instant::now();
            *state = Some((self.load)()?);
            self.loaded.store(true, Ordering::Release);
            crate::harness::mark(
                "kokoro-loaded",
                serde_json::json!({ "ms": t0.elapsed().as_secs_f64() * 1000.0 }),
            );
        }
        Ok(state.as_mut().expect("loaded above"))
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Option<Loaded>> {
        // A panic inside the model leaves the lock poisoned and the model
        // either whole or never stored; both are safe to go on with.
        self.state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// One model call, blocking: the PCM for one phoneme string.
    fn run(&self, script: Script, phonemes: &str) -> Result<Vec<u8>, String> {
        let mut state = self.lock();
        let Loaded { synth, zh, en } = self.ensure(&mut state)?;
        let voice = match script {
            Script::Chinese => &*zh,
            Script::English => &*en,
        };
        let samples = synth.synthesize(phonemes, voice, speed_for(script, phonemes))?;
        Ok(to_pcm16le(&samples))
    }
}

pub struct KokoroBackend {
    inner: Arc<Inner>,
    model: String,
}

impl KokoroBackend {
    /// `model` names what `load` loads; it is part of the cue cache's key.
    pub fn new(model: String, load: Loader) -> Self {
        Self {
            inner: Arc::new(Inner {
                load,
                state: Mutex::new(None),
                loaded: AtomicBool::new(false),
                warming: AtomicBool::new(false),
            }),
            model,
        }
    }

    /// The real model and voices from a verified download (`root` is the
    /// revision's directory).
    #[cfg(feature = "kokoro")]
    pub fn from_files(root: &Path) -> Self {
        let root = root.to_path_buf();
        Self::new(
            model_name(),
            Box::new(move || {
                let engine =
                    crate::kokoro::engine::Engine::load(&root.join(VARIANT.file().path), THREADS)?;
                Ok(Loaded {
                    synth: Box::new(engine),
                    zh: VoicePack::load(&voice_path(&root, VOICE))?,
                    en: VoicePack::load(&voice_path(&root, EN_VOICE))?,
                })
            }),
        )
    }

    /// Load the model and the text front end's tables on a thread of their
    /// own, unless that is done or under way. Returns at once.
    pub fn warm(&self) {
        if self.inner.loaded.load(Ordering::Acquire)
            || self.inner.warming.swap(true, Ordering::AcqRel)
        {
            return;
        }
        let inner = self.inner.clone();
        let spawned = std::thread::Builder::new()
            .name("kokoro-warm".into())
            .spawn(move || {
                kokoro_g2p::preload();
                // A failure here is the same failure the first sentence will
                // report, through the relay, with the sentence attached.
                let _ = inner.ensure(&mut inner.lock());
                inner.warming.store(false, Ordering::Release);
            });
        if spawned.is_err() {
            self.inner.warming.store(false, Ordering::Release);
        }
    }

    pub fn is_loaded(&self) -> bool {
        self.inner.loaded.load(Ordering::Acquire)
    }
}

/// `kokoro-v1.1-zh@<revision>/fp32`: a new revision or variant is new audio.
pub fn model_name() -> String {
    format!(
        "kokoro-v1.1-zh@{}/{}",
        &manifest::REVISION[..8],
        VARIANT.name()
    )
}

#[cfg(feature = "kokoro")]
fn voice_path(root: &Path, name: &str) -> PathBuf {
    let file = manifest::voice_file(name).expect("the voice constants are in the manifest");
    root.join(file.path)
}

fn joined(e: tokio::task::JoinError) -> TtsError {
    TtsError::Engine(e.to_string())
}

#[async_trait]
impl TtsBackend for KokoroBackend {
    fn id(&self) -> &'static str {
        "kokoro"
    }

    fn model(&self) -> &str {
        &self.model
    }

    /// Kokoro's 24 kHz floats, converted to the layout every backend hands
    /// the relay.
    fn format(&self) -> AudioFormat {
        AudioFormat::PCM16_24K_MONO
    }

    fn default_voice(&self) -> &str {
        VOICE
    }

    fn max_in_flight(&self) -> Option<usize> {
        Some(1)
    }

    /// The voice in the request is not consulted: the voice is `VOICE` (and
    /// `EN_VOICE` for English) until the user can pick one, and those are the
    /// only packs downloaded.
    async fn synthesize(
        &self,
        request: &SpeechRequest,
        out: mpsc::Sender<Vec<u8>>,
    ) -> Result<(), TtsError> {
        let text = request.text.clone();
        let script = script_of(&text);
        let chunks = tokio::task::spawn_blocking(move || phonemize(script, &text))
            .await
            .map_err(joined)?;
        for phonemes in chunks {
            // Barge-in drops this future; a dropped reader is the same thing
            // seen from here. Either way the next chunk is not worth the CPU.
            if out.is_closed() {
                return Err(TtsError::Cancelled);
            }
            let inner = self.inner.clone();
            let pcm = tokio::task::spawn_blocking(move || inner.run(script, &phonemes))
                .await
                .map_err(joined)?
                .map_err(TtsError::Engine)?;
            out.send(pcm).await.map_err(|_| TtsError::Cancelled)?;
        }
        Ok(())
    }
}

/// Kokoro from the files a `Downloader` verified.
pub struct KokoroVoice {
    ready: Box<dyn Fn() -> bool + Send + Sync>,
    build: Box<dyn Fn() -> KokoroBackend + Send + Sync>,
    /// Built the first time the files were found, and kept: files that were
    /// verified once are not checked again.
    backend: OnceLock<Arc<KokoroBackend>>,
}

impl KokoroVoice {
    pub fn new(
        ready: Box<dyn Fn() -> bool + Send + Sync>,
        build: Box<dyn Fn() -> KokoroBackend + Send + Sync>,
    ) -> Self {
        Self {
            ready,
            build,
            backend: OnceLock::new(),
        }
    }

    /// The production voice. Readiness is the downloader's: every file at its
    /// final name and full size, which it only gets after its sha256 matched,
    /// so the check is two `stat`s and a download that completes mid-session
    /// is picked up by the next turn.
    #[cfg(feature = "kokoro")]
    pub fn on_disk(models: Arc<crate::kokoro::download::Downloader>) -> Self {
        let root = models.root().to_path_buf();
        Self::new(
            Box::new(move || models.is_ready(VARIANT)),
            Box::new(move || KokoroBackend::from_files(&root)),
        )
    }
}

impl OnDeviceVoice for KokoroVoice {
    fn ready(&self) -> bool {
        self.backend.get().is_some() || (self.ready)()
    }

    fn backend(&self) -> Result<Arc<dyn TtsBackend>, String> {
        let backend = match self.backend.get() {
            Some(backend) => backend,
            None if (self.ready)() => self.backend.get_or_init(|| Arc::new((self.build)())),
            None => return Err(NOT_DOWNLOADED.to_string()),
        };
        backend.warm();
        Ok(backend.clone())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::kokoro::voice::BYTES;
    use std::sync::atomic::AtomicUsize;
    use std::time::Duration;

    /// A model that answers with one loud sample per phoneme char times 100,
    /// and writes down what it was asked.
    struct Stand {
        calls: Arc<Mutex<Vec<(String, f32, f32)>>>,
    }

    impl Synthesizer for Stand {
        fn synthesize(
            &mut self,
            phonemes: &str,
            voice: &VoicePack,
            speed: f32,
        ) -> Result<Vec<f32>, String> {
            // The pack's first value says which voice it was.
            let which = voice.style_for("a")[0];
            self.calls
                .lock()
                .unwrap()
                .push((phonemes.to_string(), which, speed));
            Ok(vec![0.5; phonemes.chars().count() * 100])
        }
    }

    fn pack(value: f32) -> VoicePack {
        let bytes: Vec<u8> = (0..BYTES / 4).flat_map(|_| value.to_le_bytes()).collect();
        VoicePack::from_bytes(&bytes).unwrap()
    }

    const ZH: f32 = 1.0;
    const EN: f32 = 2.0;

    struct Rig {
        backend: KokoroBackend,
        loads: Arc<AtomicUsize>,
        calls: Arc<Mutex<Vec<(String, f32, f32)>>>,
    }

    fn rig_with(fail_first: bool, load_ms: u64) -> Rig {
        let loads = Arc::new(AtomicUsize::new(0));
        let calls = Arc::new(Mutex::new(Vec::new()));
        let (l, c) = (loads.clone(), calls.clone());
        let backend = KokoroBackend::new(
            "stand".into(),
            Box::new(move || {
                let n = l.fetch_add(1, Ordering::SeqCst);
                std::thread::sleep(Duration::from_millis(load_ms));
                if fail_first && n == 0 {
                    return Err("no model".into());
                }
                Ok(Loaded {
                    synth: Box::new(Stand { calls: c.clone() }),
                    zh: pack(ZH),
                    en: pack(EN),
                })
            }),
        );
        Rig {
            backend,
            loads,
            calls,
        }
    }

    fn rig() -> Rig {
        rig_with(false, 0)
    }

    async fn say(backend: &KokoroBackend, text: &str) -> Result<Vec<u8>, TtsError> {
        let (tx, mut rx) = mpsc::channel(8);
        let request = SpeechRequest {
            text: text.into(),
            voice: String::new(),
        };
        backend.synthesize(&request, tx).await?;
        let mut pcm = Vec::new();
        while let Some(chunk) = rx.recv().await {
            pcm.extend(chunk);
        }
        Ok(pcm)
    }

    #[test]
    fn chinese_anywhere_goes_through_the_chinese_front_end() {
        assert_eq!(script_of("你好。"), Script::Chinese);
        assert_eq!(script_of("我用 OpenAI 的模型。"), Script::Chinese);
        assert_eq!(script_of("Let me think about that."), Script::English);
        assert_eq!(script_of("GPT 4"), Script::English);
        assert_eq!(script_of("……"), Script::Chinese);
    }

    #[test]
    fn the_pace_is_the_chinese_samples_for_chinese_and_one_for_english() {
        assert!((speed_for(Script::Chinese, "ㄋㄧ2") - 1.1).abs() < 1e-6);
        assert_eq!(speed_for(Script::English, "hˈɛlO"), 1.0);
    }

    #[test]
    fn the_constants_are_downloaded_files() {
        assert!(manifest::voice_file(VOICE).is_some());
        assert!(manifest::voice_file(EN_VOICE).is_some());
        assert_eq!(VARIANT, Variant::Fp32);
        assert!(model_name().ends_with("/fp32"), "{}", model_name());
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn a_sentence_comes_out_as_pcm16_at_24k_in_the_voice_its_script_needs() {
        let r = rig();
        assert_eq!(r.backend.format(), AudioFormat::PCM16_24K_MONO);

        let pcm = say(&r.backend, "你好。").await.unwrap();
        let pcm_en = say(&r.backend, "Hello there.").await.unwrap();
        let calls = r.calls.lock().unwrap().clone();
        assert_eq!(calls.len(), 2, "{calls:?}");
        let (zh_ps, zh_voice, zh_speed_used) = &calls[0];
        let (en_ps, en_voice, en_speed_used) = &calls[1];
        assert_eq!(*zh_voice, ZH);
        assert!((*zh_speed_used - speed_for(Script::Chinese, zh_ps)).abs() < 1e-6);
        assert_eq!(*en_voice, EN);
        assert_eq!(*en_speed_used, 1.0);
        // Two bytes per sample, 0.5 as 16-bit.
        assert_eq!(pcm.len(), zh_ps.chars().count() * 100 * 2);
        assert_eq!(i16::from_le_bytes([pcm[0], pcm[1]]), 16384);
        assert_eq!(pcm_en.len(), en_ps.chars().count() * 100 * 2);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn the_model_is_loaded_once_and_kept() {
        let r = rig();
        for text in ["你好。", "我去想想。", "Let me look into that."] {
            say(&r.backend, text).await.unwrap();
        }
        assert_eq!(r.loads.load(Ordering::SeqCst), 1);
        assert!(r.backend.is_loaded());
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn warming_loads_ahead_of_the_first_sentence_once() {
        let r = rig_with(false, 50);
        for _ in 0..5 {
            r.backend.warm();
        }
        for _ in 0..100 {
            if r.backend.is_loaded() {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        assert!(r.backend.is_loaded());
        say(&r.backend, "你好。").await.unwrap();
        r.backend.warm();
        assert_eq!(r.loads.load(Ordering::SeqCst), 1);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn a_failed_load_is_an_engine_error_and_the_next_sentence_tries_again() {
        let r = rig_with(true, 0);
        let first = say(&r.backend, "你好。").await;
        assert!(matches!(first, Err(TtsError::Engine(_))), "{first:?}");
        assert!(!first.unwrap_err().is_retryable());
        say(&r.backend, "你好。").await.unwrap();
        assert_eq!(r.loads.load(Ordering::SeqCst), 2);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn a_reader_that_went_away_is_a_cancel() {
        let r = rig();
        let (tx, rx) = mpsc::channel(8);
        drop(rx);
        let request = SpeechRequest {
            text: "你好。".into(),
            voice: String::new(),
        };
        let got = r.backend.synthesize(&request, tx).await;
        assert!(matches!(got, Err(TtsError::Cancelled)), "{got:?}");
        assert!(r.calls.lock().unwrap().is_empty());
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn nothing_to_say_sends_nothing_and_loads_nothing() {
        let r = rig();
        for text in ["", "  "] {
            assert!(say(&r.backend, text).await.unwrap().is_empty());
        }
        assert_eq!(r.loads.load(Ordering::SeqCst), 0);
    }

    #[test]
    fn one_sentence_at_a_time_in_the_models_own_rate() {
        let r = rig();
        assert_eq!(r.backend.max_in_flight(), Some(1));
        assert_eq!(
            r.backend.format().sample_rate_hz,
            crate::kokoro::SAMPLE_RATE_HZ
        );
    }

    fn voice(
        ready: Arc<AtomicBool>,
        built: Arc<AtomicUsize>,
        checks: Arc<AtomicUsize>,
    ) -> KokoroVoice {
        KokoroVoice::new(
            Box::new(move || {
                checks.fetch_add(1, Ordering::SeqCst);
                ready.load(Ordering::SeqCst)
            }),
            Box::new(move || {
                built.fetch_add(1, Ordering::SeqCst);
                rig().backend
            }),
        )
    }

    #[test]
    fn no_files_is_the_download_message_and_a_finished_download_is_picked_up() {
        let ready = Arc::new(AtomicBool::new(false));
        let built = Arc::new(AtomicUsize::new(0));
        let checks = Arc::new(AtomicUsize::new(0));
        let v = voice(ready.clone(), built.clone(), checks.clone());

        assert!(!v.ready());
        assert_eq!(v.backend().err().as_deref(), Some(NOT_DOWNLOADED));
        assert_eq!(built.load(Ordering::SeqCst), 0);

        // The download finished while the app ran.
        ready.store(true, Ordering::SeqCst);
        let a = v.backend().unwrap();
        let b = v.backend().unwrap();
        assert!(Arc::ptr_eq(&a, &b));
        assert_eq!(a.id(), "kokoro");
        assert_eq!(built.load(Ordering::SeqCst), 1);
        // Found once, never looked for again.
        let looked = checks.load(Ordering::SeqCst);
        v.backend().unwrap();
        assert!(v.ready());
        assert_eq!(checks.load(Ordering::SeqCst), looked);
    }

    /// The whole path on the real model: text, phonemes, ONNX Runtime, PCM, a
    /// WAV per sentence. Never played. `KOKORO_MODELS` is a directory laid out
    /// like the repo (onnx/, voices/), `KOKORO_OUT` where the WAVs go.
    /// `cargo test --features kokoro --lib -- --ignored end_to_end --nocapture`
    #[cfg(feature = "kokoro")]
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    #[ignore]
    async fn end_to_end() {
        use std::path::PathBuf;
        let models = PathBuf::from(std::env::var("KOKORO_MODELS").expect("KOKORO_MODELS"));
        let out = PathBuf::from(std::env::var("KOKORO_OUT").expect("KOKORO_OUT"));
        std::fs::create_dir_all(&out).unwrap();
        let backend = KokoroBackend::from_files(&models);
        let t0 = Instant::now();
        backend.warm();
        while !backend.is_loaded() {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        println!("load {:.0} ms", t0.elapsed().as_secs_f64() * 1000.0);
        let texts = [
            "你好，",
            "我去想想。",
            "这个问题其实可以从三个不同的角度来理解。",
            "我们用 OpenAI 的 GPT 模型做了一个对比。",
            "Let me think about that.",
        ];
        for (i, text) in texts.iter().enumerate() {
            let t = Instant::now();
            let pcm = say(&backend, text).await.unwrap();
            let ms = t.elapsed().as_secs_f64() * 1000.0;
            let audio_ms = AudioFormat::PCM16_24K_MONO.duration_ms(pcm.len());
            let peak = pcm
                .chunks_exact(2)
                .map(|b| i16::from_le_bytes([b[0], b[1]]).unsigned_abs())
                .max()
                .unwrap_or(0);
            println!("{i} {text} -> {audio_ms:.0} ms audio in {ms:.0} ms, peak {peak}");
            assert!(audio_ms > 300.0, "{text}: {audio_ms} ms");
            assert!(peak > 1000, "{text}: silent");
            std::fs::write(out.join(format!("{i:02}.wav")), wav(&pcm)).unwrap();
        }
    }

    #[cfg(feature = "kokoro")]
    fn wav(pcm: &[u8]) -> Vec<u8> {
        let mut w = Vec::with_capacity(44 + pcm.len());
        let len = pcm.len() as u32;
        w.extend_from_slice(b"RIFF");
        w.extend_from_slice(&(36 + len).to_le_bytes());
        w.extend_from_slice(b"WAVEfmt ");
        w.extend_from_slice(&16u32.to_le_bytes());
        w.extend_from_slice(&1u16.to_le_bytes());
        w.extend_from_slice(&1u16.to_le_bytes());
        let rate = crate::kokoro::SAMPLE_RATE_HZ;
        w.extend_from_slice(&rate.to_le_bytes());
        w.extend_from_slice(&(rate * 2).to_le_bytes());
        w.extend_from_slice(&2u16.to_le_bytes());
        w.extend_from_slice(&16u16.to_le_bytes());
        w.extend_from_slice(b"data");
        w.extend_from_slice(&len.to_le_bytes());
        w.extend_from_slice(pcm);
        w
    }
}
