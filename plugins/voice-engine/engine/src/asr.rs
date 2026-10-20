// Recognition (docs/companion/89, 识别): Qwen3-ASR-0.6B, a Q4_K_M decoder and
// a Q8_0 mmproj, through llama.cpp's mtmd. A whole utterance goes in at once
// and its text comes out; there is no streaming and no `final`.
//
// `Asr` is the model itself, used from one thread. `Recogniser` owns an `Asr`
// on a dedicated worker thread that loads it in the background and runs one
// job at a time; submitting a job or calling `cancel` voids the one before.
// A voided job stops at the next decode step (llama_set_abort_callback); the
// audio encoder has no abort hook, so a job voided while encoding stops only
// once the encoder is done.
//
// Called through llama-cpp-sys-2 directly, as the reference program did:
// llama-cpp-2 has no way to set the abort callback.

use std::ffi::{c_char, c_void, CString};
use std::path::Path;
use std::sync::atomic::{AtomicU64, AtomicU8, Ordering};
use std::sync::{mpsc, Arc, Once};
use std::thread::{self, JoinHandle};

use llama_cpp_sys_2 as sys;

pub const N_CTX: u32 = 4096;
pub const N_BATCH: i32 = 512;
/// Greedy decoding stops here even without an end-of-generation token.
pub const MAX_TOKENS: usize = 800;
pub const SAMPLE_RATE: u32 = 16_000;
/// The decoder and the audio projector, under the download directory.
pub const MODEL_FILE: &str = "qwen3-asr-0.6b/Qwen3-ASR-0.6B-Q4_K_M.gguf";
pub const MMPROJ_FILE: &str = "qwen3-asr-0.6b/mmproj-Qwen3-ASR-0.6B-Q8_0.gguf";

// No language is forced: the model writes `language X<asr_text>` first.
const PROMPT_HEAD: &str = "<|im_start|>system\n<|im_end|>\n<|im_start|>user\n";
const PROMPT_TAIL: &str = "<|im_end|>\n<|im_start|>assistant\n";
const TEXT_TAG: &str = "<asr_text>";

/// The model's raw output without its `language X<asr_text>` prefix, trimmed.
pub fn strip_language(raw: &str) -> &str {
    match raw.find(TEXT_TAG) {
        Some(i) => raw[i + TEXT_TAG.len()..].trim(),
        None => raw.trim(),
    }
}

/// Where a job is. Encoding cannot be interrupted; the others stop within one
/// decode step of a cancel.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Phase {
    Idle = 0,
    Loading = 1,
    Encoding = 2,
    Prefill = 3,
    Generating = 4,
}

impl Phase {
    fn from_u8(v: u8) -> Phase {
        match v {
            1 => Phase::Loading,
            2 => Phase::Encoding,
            3 => Phase::Prefill,
            4 => Phase::Generating,
            _ => Phase::Idle,
        }
    }
}

/// Shared between the owner and llama.cpp's abort callback. A job runs as
/// `job`; it is void as soon as `current` moves past it.
struct Control {
    current: AtomicU64,
    job: AtomicU64,
    phase: AtomicU8,
}

impl Control {
    fn voided(&self) -> bool {
        self.current.load(Ordering::Acquire) != self.job.load(Ordering::Acquire)
    }
    fn set_phase(&self, p: Phase) {
        self.phase.store(p as u8, Ordering::Release);
    }
}

unsafe extern "C" fn abort_cb(data: *mut c_void) -> bool {
    // SAFETY: `data` is the `Control` the context was created with, kept alive
    // by the `Asr` that owns the context.
    unsafe { (*(data as *const Control)).voided() }
}

unsafe extern "C" fn log_cb(level: sys::ggml_log_level, text: *const c_char, _: *mut c_void) {
    if level == sys::GGML_LOG_LEVEL_ERROR && !text.is_null() {
        // SAFETY: llama.cpp passes a NUL-terminated string.
        let s = unsafe { std::ffi::CStr::from_ptr(text) };
        eprint!("llama.cpp: {}", s.to_string_lossy());
    }
}

static BACKEND: Once = Once::new();

fn backend_init() {
    BACKEND.call_once(|| unsafe {
        sys::llama_log_set(Some(log_cb), std::ptr::null_mut());
        sys::mtmd_helper_log_set(Some(log_cb), std::ptr::null_mut());
        sys::llama_backend_init();
    });
}

fn c_path(p: &Path) -> Result<CString, String> {
    if !p.is_file() {
        return Err(format!("{} is missing", p.display()));
    }
    CString::new(p.as_os_str().as_encoded_bytes()).map_err(|_| format!("{}: NUL in path", p.display()))
}

/// Qwen3-ASR loaded: the decoder, its context and the audio projector.
pub struct Asr {
    model: *mut sys::llama_model,
    ctx: *mut sys::llama_context,
    mtmd: *mut sys::mtmd_context,
    vocab: *const sys::llama_vocab,
    control: Arc<Control>,
}

// SAFETY: the pointers are used only through `&mut self`, from one thread at
// a time; llama.cpp contexts are not tied to the thread that made them.
unsafe impl Send for Asr {}

impl Asr {
    /// Load the decoder `model` (GGUF) and the audio projector `mmproj`. A
    /// missing, truncated or wrong file is an `Err`, never a panic.
    pub fn load(model: &Path, mmproj: &Path, threads: i32) -> Result<Asr, String> {
        Self::load_with(model, mmproj, threads, Arc::new(Control::new()))
    }

    fn load_with(model: &Path, mmproj: &Path, threads: i32, control: Arc<Control>) -> Result<Asr, String> {
        let model_c = c_path(model)?;
        let mmproj_c = c_path(mmproj)?;
        backend_init();
        let mut asr = Asr {
            model: std::ptr::null_mut(),
            ctx: std::ptr::null_mut(),
            mtmd: std::ptr::null_mut(),
            vocab: std::ptr::null(),
            control,
        };
        unsafe {
            let mut mp = sys::llama_model_default_params();
            mp.n_gpu_layers = 0;
            asr.model = sys::llama_model_load_from_file(model_c.as_ptr(), mp);
            if asr.model.is_null() {
                return Err(format!("{}: not a loadable model", model.display()));
            }
            asr.vocab = sys::llama_model_get_vocab(asr.model);

            let mut cp = sys::llama_context_default_params();
            cp.n_ctx = N_CTX;
            cp.n_batch = N_BATCH as u32;
            cp.n_threads = threads;
            cp.n_threads_batch = threads;
            cp.abort_callback = Some(abort_cb);
            cp.abort_callback_data = Arc::as_ptr(&asr.control) as *mut c_void;
            asr.ctx = sys::llama_init_from_model(asr.model, cp);
            if asr.ctx.is_null() {
                return Err(format!("{}: no context", model.display()));
            }

            let mut mcp = sys::mtmd_context_params_default();
            mcp.use_gpu = false;
            mcp.print_timings = false;
            mcp.n_threads = threads;
            asr.mtmd = sys::mtmd_init_from_file(mmproj_c.as_ptr(), asr.model, mcp);
            if asr.mtmd.is_null() {
                return Err(format!("{}: not a loadable projector", mmproj.display()));
            }
            if !sys::mtmd_support_audio(asr.mtmd) {
                return Err(format!("{}: not an audio projector", mmproj.display()));
            }
            let rate = sys::mtmd_get_audio_sample_rate(asr.mtmd);
            if rate != SAMPLE_RATE as i32 {
                return Err(format!("{}: wants {rate} Hz audio", mmproj.display()));
            }
        }
        Ok(asr)
    }

    /// Recognise one utterance of 16 kHz mono samples in [-1, 1].
    pub fn transcribe(&mut self, pcm: &[f32]) -> Result<String, String> {
        let job = self.control.current.load(Ordering::Acquire);
        self.run(pcm, job).map(|t| t.unwrap_or_default())
    }

    /// `Ok(None)` when the job was voided before it finished.
    fn run(&mut self, pcm: &[f32], job: u64) -> Result<Option<String>, String> {
        let c = Arc::clone(&self.control);
        c.job.store(job, Ordering::Release);
        let out = self.run_inner(pcm, &c);
        c.set_phase(Phase::Idle);
        out
    }

    fn run_inner(&mut self, pcm: &[f32], c: &Control) -> Result<Option<String>, String> {
        if pcm.is_empty() {
            return Ok(Some(String::new()));
        }
        unsafe {
            let bitmap = Owned(sys::mtmd_bitmap_init_from_audio(pcm.len(), pcm.as_ptr()), sys::mtmd_bitmap_free);
            let chunks = Owned(sys::mtmd_input_chunks_init(), sys::mtmd_input_chunks_free);
            if bitmap.0.is_null() || chunks.0.is_null() {
                return Err("mtmd: out of memory".into());
            }
            let head = sys::mtmd_input_text {
                text: PROMPT_HEAD.as_ptr() as *const c_char,
                text_len: PROMPT_HEAD.len(),
                add_special: true,
                parse_special: true,
            };
            let tail = sys::mtmd_input_text {
                text: PROMPT_TAIL.as_ptr() as *const c_char,
                text_len: PROMPT_TAIL.len(),
                add_special: false,
                parse_special: true,
            };
            let parts = [
                sys::mtmd_input_part { text: &head, bitmap: std::ptr::null() },
                sys::mtmd_input_part { text: std::ptr::null(), bitmap: bitmap.0 },
                sys::mtmd_input_part { text: &tail, bitmap: std::ptr::null() },
            ];
            let part_ptrs: [*const sys::mtmd_input_part; 3] = [&parts[0], &parts[1], &parts[2]];
            if sys::mtmd_tokenize_from_parts(self.mtmd, chunks.0, part_ptrs.as_ptr(), 3, true) != 0 {
                return Err("mtmd: tokenize failed".into());
            }

            sys::llama_memory_clear(sys::llama_get_memory(self.ctx), true);
            let mut n_past: sys::llama_pos = 0;
            let n = sys::mtmd_input_chunks_size(chunks.0);
            for i in 0..n {
                if c.voided() {
                    return Ok(None);
                }
                let chunk = sys::mtmd_input_chunks_get(chunks.0, i);
                let mut np = n_past;
                if sys::mtmd_input_chunk_get_type(chunk) == sys::MTMD_INPUT_CHUNK_TYPE_TEXT {
                    c.set_phase(Phase::Prefill);
                    let rc = sys::mtmd_helper_eval_chunk_single(
                        self.mtmd, self.ctx, chunk, n_past, 0, N_BATCH, i == n - 1, &mut np,
                    );
                    if rc != 0 {
                        return if c.voided() { Ok(None) } else { Err(format!("prefill failed ({rc})")) };
                    }
                } else {
                    c.set_phase(Phase::Encoding);
                    if sys::mtmd_encode_chunk(self.mtmd, chunk) != 0 {
                        return Err("audio encoder failed".into());
                    }
                    if c.voided() {
                        return Ok(None);
                    }
                    c.set_phase(Phase::Prefill);
                    let embd = sys::mtmd_get_output_embd(self.mtmd);
                    let rc = sys::mtmd_helper_decode_image_chunk(
                        self.mtmd, self.ctx, chunk, embd, n_past, 0, N_BATCH, &mut np, None, std::ptr::null_mut(),
                    );
                    if rc != 0 {
                        return if c.voided() { Ok(None) } else { Err(format!("audio prefill failed ({rc})")) };
                    }
                }
                n_past = np;
            }

            c.set_phase(Phase::Generating);
            let sampler = Owned(sys::llama_sampler_init_greedy(), sys::llama_sampler_free);
            let mut tokens: Vec<sys::llama_token> = Vec::new();
            while tokens.len() < MAX_TOKENS {
                if c.voided() {
                    return Ok(None);
                }
                let mut tok = sys::llama_sampler_sample(sampler.0, self.ctx, -1);
                if sys::llama_vocab_is_eog(self.vocab, tok) {
                    break;
                }
                tokens.push(tok);
                let batch = sys::llama_batch_get_one(&mut tok, 1);
                if sys::llama_decode(self.ctx, batch) != 0 {
                    if c.voided() {
                        return Ok(None);
                    }
                    // Out of context: keep what came out.
                    break;
                }
            }
            if c.voided() {
                return Ok(None);
            }
            Ok(Some(strip_language(&self.detokenize(&tokens)).to_string()))
        }
    }

    fn detokenize(&self, tokens: &[sys::llama_token]) -> String {
        let mut buf = vec![0u8; tokens.len() * 16 + 16];
        loop {
            // Special tokens are rendered: `<asr_text>` is one.
            let n = unsafe {
                sys::llama_detokenize(
                    self.vocab,
                    tokens.as_ptr(),
                    tokens.len() as i32,
                    buf.as_mut_ptr() as *mut c_char,
                    buf.len() as i32,
                    false,
                    true,
                )
            };
            if n >= 0 {
                buf.truncate(n as usize);
                return String::from_utf8_lossy(&buf).into_owned();
            }
            buf.resize((-n) as usize, 0);
        }
    }
}

impl Drop for Asr {
    fn drop(&mut self) {
        unsafe {
            if !self.mtmd.is_null() {
                sys::mtmd_free(self.mtmd);
            }
            if !self.ctx.is_null() {
                sys::llama_free(self.ctx);
            }
            if !self.model.is_null() {
                sys::llama_model_free(self.model);
            }
        }
    }
}

impl Control {
    fn new() -> Control {
        Control { current: AtomicU64::new(0), job: AtomicU64::new(0), phase: AtomicU8::new(Phase::Idle as u8) }
    }
}

/// A C object freed by its free function on drop.
struct Owned<T>(*mut T, unsafe extern "C" fn(*mut T));

impl<T> Drop for Owned<T> {
    fn drop(&mut self) {
        if !self.0.is_null() {
            unsafe { (self.1)(self.0) }
        }
    }
}

struct Job {
    id: u64,
    pcm: Vec<f32>,
    reply: mpsc::Sender<Result<Option<String>, String>>,
}

/// One recognition job's answer.
pub struct Ticket {
    rx: mpsc::Receiver<Result<Option<String>, String>>,
}

impl Ticket {
    /// Block until the job is done. `Ok(None)`: it was voided by `cancel` or a
    /// later `submit`. `Err`: the model failed to load, or llama.cpp failed.
    pub fn wait(self) -> Result<Option<String>, String> {
        self.rx.recv().unwrap_or_else(|_| Err("recogniser stopped".into()))
    }
}

/// `Asr` on its own worker thread, loaded in the background.
pub struct Recogniser {
    control: Arc<Control>,
    tx: Option<mpsc::Sender<Job>>,
    worker: Option<JoinHandle<()>>,
}

impl Recogniser {
    /// Start the worker and load the model on it. Jobs submitted before the
    /// load finishes wait for it; if it fails, each job answers its error.
    pub fn spawn(model: &Path, mmproj: &Path, threads: i32) -> Recogniser {
        let control = Arc::new(Control::new());
        control.set_phase(Phase::Loading);
        let (tx, rx) = mpsc::channel::<Job>();
        let (model, mmproj, c) = (model.to_path_buf(), mmproj.to_path_buf(), Arc::clone(&control));
        let worker = thread::Builder::new()
            .name("asr".into())
            .spawn(move || {
                let mut asr = Asr::load_with(&model, &mmproj, threads, Arc::clone(&c));
                c.set_phase(Phase::Idle);
                while let Ok(job) = rx.recv() {
                    let out = match &mut asr {
                        Err(e) => Err(e.clone()),
                        Ok(_) if c.current.load(Ordering::Acquire) != job.id => Ok(None),
                        Ok(asr) => asr.run(&job.pcm, job.id),
                    };
                    let _ = job.reply.send(out);
                }
            })
            .expect("spawn asr thread");
        Recogniser { control, tx: Some(tx), worker: Some(worker) }
    }

    /// Recognise `pcm` (16 kHz mono, [-1, 1]). Voids any job before it.
    pub fn submit(&self, pcm: Vec<f32>) -> Ticket {
        let id = self.control.current.fetch_add(1, Ordering::AcqRel) + 1;
        let (reply, rx) = mpsc::channel();
        if let Some(tx) = &self.tx {
            let _ = tx.send(Job { id, pcm, reply });
        }
        Ticket { rx }
    }

    /// Void the running or queued job: its ticket answers `Ok(None)`.
    pub fn cancel(&self) {
        self.control.current.fetch_add(1, Ordering::AcqRel);
    }

    pub fn phase(&self) -> Phase {
        Phase::from_u8(self.control.phase.load(Ordering::Acquire))
    }
}

impl Drop for Recogniser {
    fn drop(&mut self) {
        self.cancel();
        self.tx.take();
        if let Some(w) = self.worker.take() {
            let _ = w.join();
        }
    }
}

/// C entry point that keeps the recogniser in the shared object past
/// `--gc-sections` until the JNI surface exists: load from two NUL-terminated
/// paths and recognise one second of silence. 0 on success.
///
/// # Safety
/// Both arguments must be valid NUL-terminated strings.
#[no_mangle]
pub unsafe extern "C" fn voice_engine_asr_probe(model: *const c_char, mmproj: *const c_char) -> i32 {
    if model.is_null() || mmproj.is_null() {
        return 1;
    }
    let path = |p: *const c_char| {
        // SAFETY: the caller passes NUL-terminated strings.
        std::path::PathBuf::from(unsafe { std::ffi::CStr::from_ptr(p) }.to_string_lossy().into_owned())
    };
    match Asr::load(&path(model), &path(mmproj), 1).and_then(|mut a| a.transcribe(&[0.0; SAMPLE_RATE as usize])) {
        Ok(_) => 0,
        Err(_) => 1,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use std::time::{Duration, Instant};

    #[test]
    fn strips_the_language_prefix() {
        assert_eq!(strip_language("language Chinese<asr_text>你好，世界。"), "你好，世界。");
        assert_eq!(strip_language("language English<asr_text> Hello. "), "Hello.");
        assert_eq!(strip_language("language None<asr_text>"), "");
        assert_eq!(strip_language(" 没有前缀 "), "没有前缀");
        assert_eq!(strip_language(""), "");
    }

    fn scratch(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("voice-engine-asr-{}-{name}", std::process::id()));
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn missing_or_garbage_files_are_errors() {
        let d = scratch("garbage");
        let missing = d.join("missing.gguf");
        let garbage = d.join("garbage.gguf");
        let empty = d.join("empty.gguf");
        std::fs::write(&garbage, vec![0x5au8; 1 << 16]).unwrap();
        std::fs::write(&empty, b"").unwrap();
        assert!(Asr::load(&missing, &missing, 1).err().unwrap().contains("missing"));
        assert!(Asr::load(&garbage, &garbage, 1).is_err());
        assert!(Asr::load(&empty, &empty, 1).is_err());
        let r = Recogniser::spawn(&missing, &missing, 1);
        assert!(r.submit(vec![0.0; 1600]).wait().unwrap_err().contains("missing"));
        std::fs::remove_dir_all(d).ok();
    }

    /// `VOICE_MODELS` laid out like the download directory: MODEL_FILE and
    /// MMPROJ_FILE under it.
    fn models() -> Option<(PathBuf, PathBuf)> {
        let dir = PathBuf::from(std::env::var_os("VOICE_MODELS")?);
        let m = (dir.join(MODEL_FILE), dir.join(MMPROJ_FILE));
        if m.0.is_file() && m.1.is_file() {
            Some(m)
        } else {
            eprintln!("skipped: no Qwen3-ASR under {}", dir.display());
            None
        }
    }

    /// `VOICE_ASR_WAV`: a 16 kHz mono 16-bit WAV of speech, 30 s or longer.
    fn speech() -> Option<Vec<f32>> {
        let Some(p) = std::env::var_os("VOICE_ASR_WAV") else {
            eprintln!("skipped: VOICE_ASR_WAV not set");
            return None;
        };
        Some(read_wav(Path::new(&p)))
    }

    fn read_wav(p: &Path) -> Vec<f32> {
        let b = std::fs::read(p).unwrap();
        let mut i = 12;
        while i + 8 <= b.len() {
            let len = u32::from_le_bytes(b[i + 4..i + 8].try_into().unwrap()) as usize;
            if &b[i..i + 4] == b"data" {
                let data = &b[i + 8..(i + 8 + len).min(b.len())];
                return data.chunks_exact(2).map(|s| i16::from_le_bytes([s[0], s[1]]) as f32 / 32768.0).collect();
            }
            i += 8 + len + (len & 1);
        }
        panic!("{}: no data chunk", p.display());
    }

    fn copy_prefix(from: &Path, to: &Path, n: usize) {
        let b = std::fs::read(from).unwrap();
        std::fs::write(to, &b[..n.min(b.len())]).unwrap();
    }

    #[test]
    fn broken_real_files_are_errors() {
        let Some((model, mmproj)) = models() else { return };
        let d = scratch("broken");
        let short_model = d.join("short-model.gguf");
        let short_mmproj = d.join("short-mmproj.gguf");
        copy_prefix(&model, &short_model, 4 << 20);
        copy_prefix(&mmproj, &short_mmproj, 4 << 20);
        let garbage = d.join("garbage.gguf");
        std::fs::write(&garbage, vec![0x5au8; 1 << 16]).unwrap();
        assert!(Asr::load(&short_model, &mmproj, 1).is_err());
        assert!(Asr::load(&model, &short_mmproj, 1).is_err());
        assert!(Asr::load(&model, &garbage, 1).is_err());
        assert!(Asr::load(&model, &model, 1).is_err(), "the decoder is not a projector");
        std::fs::remove_dir_all(d).ok();
    }

    #[test]
    fn recognises_and_voids() {
        let Some((model, mmproj)) = models() else { return };
        let Some(pcm) = speech() else { return };
        let r = Recogniser::spawn(&model, &mmproj, 4);

        // Plain recognition, prefix gone.
        let text = r.submit(pcm[..10 * 16_000].to_vec()).wait().unwrap().unwrap();
        eprintln!("10 s: {text}");
        assert!(!text.is_empty() && !text.contains("<asr_text>") && !text.starts_with("language "));

        // A later submit voids the earlier one.
        let first = r.submit(pcm[..20 * 16_000].to_vec());
        let second = r.submit(pcm[..5 * 16_000].to_vec());
        assert_eq!(first.wait().unwrap(), None);
        assert!(!second.wait().unwrap().unwrap().is_empty());

        // Voided in each interruptible phase, the worker is free within 200 ms.
        for target in [Phase::Prefill, Phase::Generating] {
            let ticket = r.submit(pcm.clone());
            let t0 = Instant::now();
            // The prompt head is a short Prefill before the audio: wait past the encoder.
            while r.phase() != Phase::Encoding {
                assert!(t0.elapsed() < Duration::from_secs(60), "never encoded");
                thread::sleep(Duration::from_millis(1));
            }
            while r.phase() != target {
                assert!(t0.elapsed() < Duration::from_secs(60), "never reached {target:?}");
                thread::sleep(Duration::from_millis(1));
            }
            if target == Phase::Generating {
                thread::sleep(Duration::from_millis(500));
                assert_eq!(r.phase(), Phase::Generating, "finished before the cancel");
            }
            let t = Instant::now();
            r.cancel();
            while r.phase() != Phase::Idle {
                thread::sleep(Duration::from_millis(1));
            }
            let freed = t.elapsed();
            eprintln!("voided in {target:?}: worker free after {freed:?}");
            assert!(freed < Duration::from_millis(200), "{target:?}: {freed:?}");
            assert_eq!(ticket.wait().unwrap(), None);
        }

        // And it still recognises after that.
        assert!(!r.submit(pcm[..5 * 16_000].to_vec()).wait().unwrap().unwrap().is_empty());
    }
}
