// Fetching the pinned model files into local app data, in two packs: the
// Kokoro pack (the voice; the only one on iOS) and, on Android, the listening
// pack (Qwen3-ASR and its mmproj, Silero, Smart Turn: docs/companion/89, 模型文件),
// which comes from several repositories. `kokoro_download` fetches both there.
//
// Each file is written to `<path>.part` and asked for with `Range` from the
// length already on disk, so a transfer the network broke, or one the app was
// killed in the middle of, picks up where it stopped — on the next attempt here
// or on the next `start` after a relaunch. Only after the whole file hashes to
// the manifest's sha256 is it renamed to its own name, which is why "the file
// exists with the right size" is enough for `status` to call it present
// without hashing 300 MB on every question.
//
// One download at a time; a second `start` while one runs changes nothing.
// The root directory is excluded from iCloud/iTunes backup by the caller
// (commands.rs asks Swift) before the first byte lands in it; on Android it is
// under `getNoBackupFilesDir()`.

use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::Serialize;
use sha2::{Digest, Sha256};

use super::manifest::{self, ModelFile, Variant};

/// Attempts per file before the download stops and reports the error. Each
/// one resumes from what the last left behind.
const ATTEMPTS: u32 = 4;
/// Longest wait for the response head, and for each chunk of the body. A
/// stalled transfer is cut and resumed rather than waited on.
const HEAD_TIMEOUT: Duration = Duration::from_secs(30);
const CHUNK_TIMEOUT: Duration = Duration::from_secs(45);

/// Where every model goes under local app data (Kokoro's revision directory
/// is inside it too).
pub const MODELS_DIR: &str = "voice-models";

// The listening pack's files, under `MODELS_DIR`. The engine opens them by
// these names (plugins/voice-engine/engine: asr.rs, vad.rs, smart_turn.rs).
pub const QWEN_FILE: &str = "qwen3-asr-0.6b/Qwen3-ASR-0.6B-Q4_K_M.gguf";
pub const MMPROJ_FILE: &str = "qwen3-asr-0.6b/mmproj-Qwen3-ASR-0.6B-Q8_0.gguf";
pub const SILERO_FILE: &str = "silero-vad-v6.0/silero_vad.onnx";
pub const SMART_TURN_FILE: &str = "smart-turn-v3.2-gpu.onnx";

/// One file of the listening pack: where it goes and where it comes from.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ListenFile {
    /// Under `MODELS_DIR`.
    pub path: String,
    pub url: String,
    pub size: u64,
    pub sha256: String,
}

impl ListenFile {
    fn new(path: &str, url: &str, size: u64, sha256: &str) -> Self {
        Self { path: path.into(), url: url.into(), size, sha256: sha256.into() }
    }
}

/// The listening pack, every file pinned to a revision (docs/companion/89).
/// Silero is the one file not on Hugging Face: the official repository's
/// v6.0 commit.
pub fn listen_files() -> Vec<ListenFile> {
    vec![
        // mradermacher's Q4_K_M of Qwen/Qwen3-ASR-0.6B (Apache-2.0), saved
        // under the name the engine loads.
        ListenFile::new(
            QWEN_FILE,
            "https://huggingface.co/mradermacher/Qwen3-ASR-0.6B-GGUF/resolve/6cf166e9f1c5bd2521108e3410ee5358de5eabab/Qwen3-ASR-0.6B.Q4_K_M.gguf",
            484_216_288,
            "40d27969c614b4492f330baa41fcc8d00e25264aebbe3f16eaf5e4bd5af35cd5",
        ),
        ListenFile::new(
            MMPROJ_FILE,
            "https://huggingface.co/ggml-org/Qwen3-ASR-0.6B-GGUF/resolve/928ab958557df9aa2ef1c93e0e83c7ad0933fae2/mmproj-Qwen3-ASR-0.6B-Q8_0.gguf",
            214_392_480,
            "41a342b5e4c514e968cb756de6cd1b7be39eff43c44c57a2ef5fc6522e36603d",
        ),
        // MIT.
        ListenFile::new(
            SILERO_FILE,
            "https://raw.githubusercontent.com/snakers4/silero-vad/fba061dc5559f696e62171e9a0741782b0fdc23c/src/silero_vad/data/silero_vad.onnx",
            2_327_524,
            "597d30b3ec076608d059477bb14cfeffdf951bf5cae370d38f65d33bbfe82004",
        ),
        // BSD-2-Clause.
        ListenFile::new(
            SMART_TURN_FILE,
            "https://huggingface.co/pipecat-ai/smart-turn-v3/resolve/f766f81d3cfdf7737ac64aad813d91bbfd56bf93/smart-turn-v3.2-gpu.onnx",
            32_411_198,
            "ab8dc64b88713f90b571c15b714bd1330e6c883cad8763dacf65c9376dc539be",
        ),
    ]
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileStatus {
    pub path: String,
    pub size: u64,
    /// Bytes on disk: the whole size once verified, the `.part` length before.
    pub have: u64,
    pub ready: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelStatus {
    pub repo: String,
    pub revision: String,
    pub root: String,
    pub running: bool,
    /// The file being fetched right now.
    pub current: Option<String>,
    /// Why the last download stopped, until the next one starts.
    pub error: Option<String>,
    /// The variants whose model and every voice are present and verified.
    pub ready: Vec<Variant>,
    /// What the running (or last) download was asked for.
    pub requested: Vec<Variant>,
    /// Bytes on disk and bytes in all, over the requested files and the
    /// listening pack.
    pub have_bytes: u64,
    pub total_bytes: u64,
    /// Every file of every variant.
    pub files: Vec<FileStatus>,
    /// The listening pack's files: empty where there is none (iOS).
    pub listen: Vec<FileStatus>,
    /// Every listening file present and verified; true where there are none.
    pub listen_ready: bool,
}

#[derive(Default)]
struct State {
    running: bool,
    current: Option<String>,
    error: Option<String>,
    requested: Vec<Variant>,
}

pub struct Downloader {
    /// `MODELS_DIR` under local app data.
    models: PathBuf,
    /// Kokoro's revision directory, inside `models`.
    root: PathBuf,
    listen: Vec<ListenFile>,
    state: Mutex<State>,
}

/// One file to fetch, from either pack.
struct Fetch {
    name: String,
    url: String,
    dst: PathBuf,
    size: u64,
    sha256: String,
}

pub fn part_path(dst: &Path) -> PathBuf {
    let mut s = dst.as_os_str().to_owned();
    s.push(".part");
    PathBuf::from(s)
}

fn complete(dst: &Path, size: u64) -> bool {
    fs::metadata(dst).map(|m| m.is_file() && m.len() == size).unwrap_or(false)
}

fn file_status(path: &str, dst: &Path, size: u64) -> FileStatus {
    let ready = complete(dst, size);
    let have = if ready { size } else { fs::metadata(part_path(dst)).map(|m| m.len().min(size)).unwrap_or(0) };
    FileStatus { path: path.to_string(), size, have, ready }
}

pub fn sha256_file(path: &Path) -> std::io::Result<String> {
    let mut f = File::open(path)?;
    let mut h = Sha256::new();
    let mut buf = vec![0u8; 1 << 20];
    loop {
        let n = f.read(&mut buf)?;
        if n == 0 {
            break;
        }
        h.update(&buf[..n]);
    }
    Ok(h.finalize().iter().map(|b| format!("{b:02x}")).collect())
}

impl Downloader {
    /// The Kokoro pack alone (iOS). `base` is local app data.
    pub fn new(base: &Path) -> Self {
        Self::at(&base.join(MODELS_DIR), Vec::new())
    }

    /// Both packs (Android). `base` is `getNoBackupFilesDir()`.
    pub fn with_listen(base: &Path) -> Self {
        Self::at(&base.join(MODELS_DIR), listen_files())
    }

    /// The packs this host speaks and listens with.
    pub fn for_host(base: &Path) -> Self {
        if cfg!(target_os = "android") {
            Self::with_listen(base)
        } else {
            Self::new(base)
        }
    }

    /// `models` is the models directory itself; `listen` the listening pack.
    pub fn at(models: &Path, listen: Vec<ListenFile>) -> Self {
        let root = models
            .join(manifest::DIR.strip_prefix("voice-models/").unwrap_or(manifest::DIR))
            .join(manifest::REVISION);
        Self { models: models.to_path_buf(), root, listen, state: Mutex::new(State::default()) }
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn models_dir(&self) -> &Path {
        &self.models
    }

    /// Where a manifest file lives once verified.
    pub fn path_of(&self, file: &ModelFile) -> PathBuf {
        self.root.join(file.path)
    }

    pub fn is_ready(&self, variant: Variant) -> bool {
        complete(&self.path_of(&variant.file()), variant.file().size)
            && manifest::VOICES.iter().all(|(_, f)| complete(&self.path_of(f), f.size))
    }

    pub fn listen_ready(&self) -> bool {
        self.listen.iter().all(|f| complete(&self.models.join(&f.path), f.size))
    }

    /// Every file `Open` has the engine load, as absolute paths: the
    /// listening pack and the fp32 Kokoro model.
    pub fn engine_files(&self) -> voice_wire::ModelFiles {
        let at = |p: &str| self.models.join(p).display().to_string();
        voice_wire::ModelFiles {
            silero: at(SILERO_FILE),
            smart_turn: at(SMART_TURN_FILE),
            asr_model: at(QWEN_FILE),
            asr_mmproj: at(MMPROJ_FILE),
            kokoro_model: self.path_of(&Variant::Fp32.file()).display().to_string(),
        }
    }

    pub fn status(&self) -> ModelStatus {
        let st = self.state.lock().unwrap();
        let files: Vec<FileStatus> = manifest::files_for(&Variant::ALL)
            .iter()
            .map(|f| file_status(f.path, &self.path_of(f), f.size))
            .collect();
        let listen: Vec<FileStatus> =
            self.listen.iter().map(|f| file_status(&f.path, &self.models.join(&f.path), f.size)).collect();
        let wanted = manifest::files_for(&st.requested);
        let (have_bytes, total_bytes) = wanted.iter().fold((0, 0), |(h, t), w| {
            let have = files.iter().find(|f| f.path == w.path).map(|f| f.have).unwrap_or(0);
            (h + have, t + w.size)
        });
        let (have_bytes, total_bytes) =
            listen.iter().fold((have_bytes, total_bytes), |(h, t), f| (h + f.have, t + f.size));
        ModelStatus {
            repo: manifest::REPO.into(),
            revision: manifest::REVISION.into(),
            root: self.root.display().to_string(),
            running: st.running,
            current: st.current.clone(),
            error: st.error.clone(),
            ready: Variant::ALL.into_iter().filter(|v| self.is_ready(*v)).collect(),
            requested: st.requested.clone(),
            have_bytes,
            total_bytes,
            files,
            listen_ready: listen.iter().all(|f| f.ready),
            listen,
        }
    }

    /// Create the root so the caller can exclude it from backup before any
    /// file lands in it.
    pub fn prepare_root(&self) -> std::io::Result<&Path> {
        fs::create_dir_all(&self.root)?;
        Ok(&self.root)
    }

    /// Start fetching what these variants need, and the listening pack, in
    /// the background. False when a download is already running (and nothing
    /// changes).
    pub fn start(self: &Arc<Self>, variants: Vec<Variant>) -> bool {
        {
            let mut st = self.state.lock().unwrap();
            if st.running {
                return false;
            }
            st.running = true;
            st.error = None;
            st.current = None;
            st.requested = variants.clone();
        }
        let this = Arc::clone(self);
        tauri::async_runtime::spawn(async move {
            let result = this.run(&variants).await;
            let mut st = this.state.lock().unwrap();
            st.running = false;
            st.current = None;
            st.error = result.err();
        });
        true
    }

    fn wanted(&self, variants: &[Variant]) -> Vec<Fetch> {
        let kokoro = manifest::files_for(variants).into_iter().map(|f| Fetch {
            name: f.path.to_string(),
            url: manifest::url(&f),
            dst: self.path_of(&f),
            size: f.size,
            sha256: f.sha256.to_string(),
        });
        let listen = self.listen.iter().map(|f| Fetch {
            name: f.path.clone(),
            url: f.url.clone(),
            dst: self.models.join(&f.path),
            size: f.size,
            sha256: f.sha256.clone(),
        });
        kokoro.chain(listen).collect()
    }

    /// The whole download in the caller's task. `start` is this on a spawn.
    pub async fn run(&self, variants: &[Variant]) -> Result<(), String> {
        let client = reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(20))
            .build()
            .map_err(|e| format!("No HTTP client: {e}"))?;
        for file in self.wanted(variants) {
            self.state.lock().unwrap().current = Some(file.name.clone());
            fetch(&client, file).await?;
        }
        Ok(())
    }
}

async fn fetch(client: &reqwest::Client, file: Fetch) -> Result<(), String> {
    if complete(&file.dst, file.size) {
        return Ok(());
    }
    if let Some(dir) = file.dst.parent() {
        fs::create_dir_all(dir).map_err(|e| format!("Creating {}: {e}", dir.display()))?;
    }
    let part = part_path(&file.dst);
    let mut attempt = 0;
    loop {
        attempt += 1;
        match transfer(client, &file.url, file.size, &part).await {
            Ok(()) => break,
            Err(e) if attempt < ATTEMPTS => {
                let _ = e;
                tokio::time::sleep(Duration::from_secs(2 * attempt as u64)).await;
            }
            Err(e) => return Err(format!("{}: {e}", file.name)),
        }
    }
    let p = part.clone();
    let got = tauri::async_runtime::spawn_blocking(move || sha256_file(&p))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| format!("Hashing {}: {e}", file.name))?;
    if got != file.sha256 {
        let _ = fs::remove_file(&part);
        return Err(format!(
            "{} did not match its sha256 (got {got}); it was deleted and will be fetched again.",
            file.name
        ));
    }
    fs::rename(&part, &file.dst).map_err(|e| format!("Moving {} into place: {e}", file.name))
}

/// The first byte a `Content-Range: bytes <start>-<end>/<total>` answer covers.
pub fn content_range_start(header: &str) -> Option<u64> {
    header.trim().strip_prefix("bytes ")?.split('-').next()?.trim().parse().ok()
}

/// One attempt: carry `part` forward to the full size, resuming from its
/// current length.
async fn transfer(client: &reqwest::Client, url: &str, size: u64, part: &Path) -> Result<(), String> {
    let mut have = fs::metadata(part).map(|m| m.len()).unwrap_or(0);
    if have > size {
        let _ = fs::remove_file(part);
        have = 0;
    }
    if have == size {
        return Ok(());
    }
    let mut req = client.get(url);
    if have > 0 {
        req = req.header(reqwest::header::RANGE, format!("bytes={have}-"));
    }
    let mut resp = tokio::time::timeout(HEAD_TIMEOUT, req.send())
        .await
        .map_err(|_| "no response".to_string())?
        .map_err(|e| e.to_string())?;
    let status = resp.status().as_u16();
    let mut out = match status {
        206 => {
            let start = resp
                .headers()
                .get(reqwest::header::CONTENT_RANGE)
                .and_then(|v| v.to_str().ok())
                .and_then(content_range_start);
            if start != Some(have) {
                // Not the bytes we asked for; start this file over.
                let _ = fs::remove_file(part);
                return Err(format!("range answer starts at {start:?}, asked for {have}"));
            }
            OpenOptions::new().append(true).open(part).map_err(|e| e.to_string())?
        }
        // The server sent the whole file: write it from the start.
        200 => File::create(part).map_err(|e| e.to_string())?,
        416 => {
            let _ = fs::remove_file(part);
            return Err("range not satisfiable; starting over".into());
        }
        s => return Err(format!("HTTP {s}")),
    };
    loop {
        let chunk = tokio::time::timeout(CHUNK_TIMEOUT, resp.chunk())
            .await
            .map_err(|_| "transfer stalled".to_string())?
            .map_err(|e| e.to_string())?;
        let Some(chunk) = chunk else { break };
        out.write_all(&chunk).map_err(|e| e.to_string())?;
    }
    out.flush().map_err(|e| e.to_string())?;
    drop(out);
    let len = fs::metadata(part).map(|m| m.len()).unwrap_or(0);
    if len != size {
        return Err(format!("ended at {len} of {size} bytes"));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{BufRead, BufReader};
    use std::net::TcpListener;

    fn scratch(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("kokoro-dl-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        d
    }

    fn sha(bytes: &[u8]) -> String {
        Sha256::digest(bytes).iter().map(|b| format!("{b:02x}")).collect()
    }

    /// Kokoro's voices in place at their full size, so a run fetches only
    /// the listening pack (`complete` goes by the size).
    fn place_voices(d: &Downloader) {
        for (_, v) in manifest::VOICES {
            let p = d.path_of(&v);
            fs::create_dir_all(p.parent().unwrap()).unwrap();
            File::create(&p).unwrap().set_len(v.size).unwrap();
        }
    }

    /// A one-request-per-connection HTTP server on 127.0.0.1 that honours
    /// `Range` and records what each request asked for.
    struct Server {
        base: String,
        asked: Arc<Mutex<Vec<(String, Option<String>)>>>,
    }

    fn serve(files: Vec<(&'static str, Vec<u8>)>) -> Server {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let asked = Arc::new(Mutex::new(Vec::new()));
        let log = Arc::clone(&asked);
        std::thread::spawn(move || {
            for stream in listener.incoming() {
                let Ok(mut stream) = stream else { return };
                let mut lines = BufReader::new(stream.try_clone().unwrap()).lines();
                let request = lines.next().and_then(|l| l.ok()).unwrap_or_default();
                let mut range = None;
                for line in lines.map_while(|l| l.ok()) {
                    if line.is_empty() {
                        break;
                    }
                    if let Some(v) = line.strip_prefix("range: ").or_else(|| line.strip_prefix("Range: ")) {
                        range = Some(v.to_string());
                    }
                }
                let path = request.split(' ').nth(1).unwrap_or("").to_string();
                log.lock().unwrap().push((path.clone(), range.clone()));
                let Some((_, body)) = files.iter().find(|(p, _)| *p == path) else {
                    let _ = stream.write_all(b"HTTP/1.1 404 Not Found\r\ncontent-length: 0\r\nconnection: close\r\n\r\n");
                    continue;
                };
                let from = range
                    .as_deref()
                    .and_then(|r| r.strip_prefix("bytes="))
                    .and_then(|r| r.trim_end_matches('-').parse::<usize>().ok());
                let head = match from {
                    Some(f) => format!(
                        "HTTP/1.1 206 Partial Content\r\ncontent-length: {}\r\ncontent-range: bytes {f}-{}/{}\r\nconnection: close\r\n\r\n",
                        body.len() - f,
                        body.len() - 1,
                        body.len()
                    ),
                    None => format!("HTTP/1.1 200 OK\r\ncontent-length: {}\r\nconnection: close\r\n\r\n", body.len()),
                };
                let _ = stream.write_all(head.as_bytes());
                let _ = stream.write_all(&body[from.unwrap_or(0)..]);
            }
        });
        Server { base, asked }
    }

    #[test]
    fn content_range_parses() {
        assert_eq!(content_range_start("bytes 100-522239/522240"), Some(100));
        assert_eq!(content_range_start("bytes */522240"), None);
        assert_eq!(content_range_start("items 1-2/3"), None);
    }

    #[test]
    fn status_counts_parts_and_verified_files() {
        let base = scratch("status");
        let d = Downloader::new(&base);
        let int8 = Variant::Int8.file();
        let zf = manifest::voice_file("zf_001").unwrap();
        fs::create_dir_all(d.path_of(&int8).parent().unwrap()).unwrap();
        fs::create_dir_all(d.path_of(&zf).parent().unwrap()).unwrap();
        fs::write(part_path(&d.path_of(&int8)), vec![0u8; 1000]).unwrap();
        fs::write(d.path_of(&zf), vec![0u8; zf.size as usize]).unwrap();
        d.state.lock().unwrap().requested = vec![Variant::Int8];

        let s = d.status();
        assert!(!s.running);
        assert!(s.ready.is_empty());
        let f = s.files.iter().find(|f| f.path == int8.path).unwrap();
        assert_eq!((f.have, f.ready), (1000, false));
        let v = s.files.iter().find(|f| f.path == zf.path).unwrap();
        assert_eq!((v.have, v.ready), (zf.size, true));
        assert_eq!(s.have_bytes, 1000 + zf.size);
        assert_eq!(s.total_bytes, int8.size + 2 * zf.size);
        assert!(s.root.ends_with(manifest::REVISION));
        // iOS has no listening pack, and so nothing missing from it.
        assert!(s.listen.is_empty() && s.listen_ready);

        // A model of the right size plus both voices is ready.
        fs::remove_file(part_path(&d.path_of(&int8))).unwrap();
        let f = File::create(d.path_of(&int8)).unwrap();
        f.set_len(int8.size).unwrap();
        let am = manifest::voice_file("af_maple").unwrap();
        fs::write(d.path_of(&am), vec![0u8; am.size as usize]).unwrap();
        assert_eq!(d.status().ready, vec![Variant::Int8]);
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn the_listening_pack_is_android_s_and_adds_up_to_the_documented_total() {
        let base = scratch("android");
        let d = Downloader::with_listen(&base);
        d.state.lock().unwrap().requested = vec![Variant::Fp32];
        let s = d.status();
        let paths: Vec<_> = s.listen.iter().map(|f| f.path.as_str()).collect();
        assert_eq!(paths, [QWEN_FILE, MMPROJ_FILE, SILERO_FILE, SMART_TURN_FILE]);
        assert!(!s.listen_ready);
        // docs/companion/89 and ANDROID_FALLBACK_TOTAL_BYTES.
        assert_eq!(s.total_bytes, 1_073_761_412);
        for f in listen_files() {
            assert_eq!(f.sha256.len(), 64);
            assert!(f.url.starts_with("https://") && !f.url.contains("/main/"), "{}", f.url);
        }

        // Status per pack: the voice ready and the listening pack not, then both.
        let files = d.engine_files();
        assert!(files.kokoro_model.ends_with("kokoro-v1.1-zh/6cc0f0d2ebe369a68b0df87c2b65c1af8c0ac3e3/onnx/model.onnx"));
        assert_eq!(Path::new(&files.silero), base.join("voice-models").join(SILERO_FILE));
        place_voices(&d);
        let fp32 = Variant::Fp32.file();
        fs::create_dir_all(d.path_of(&fp32).parent().unwrap()).unwrap();
        File::create(d.path_of(&fp32)).unwrap().set_len(fp32.size).unwrap();
        assert!(d.is_ready(Variant::Fp32) && !d.listen_ready());
        for f in listen_files() {
            let p = d.models_dir().join(&f.path);
            fs::create_dir_all(p.parent().unwrap()).unwrap();
            File::create(&p).unwrap().set_len(f.size).unwrap();
        }
        let s = d.status();
        assert!(s.listen_ready && s.listen.iter().all(|f| f.ready));
        assert_eq!((s.have_bytes, s.total_bytes), (1_073_761_412, 1_073_761_412));
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn both_packs_download_resuming_a_part_and_deleting_a_file_that_fails_its_hash() {
        let a: Vec<u8> = (0..300_000u32).map(|i| (i * 7 % 251) as u8).collect();
        let b: Vec<u8> = (0..50_000u32).map(|i| (i % 13) as u8).collect();
        let server = serve(vec![("/a.bin", a.clone()), ("/b.bin", b.clone())]);
        let base = scratch("fetch");
        let models = base.join("voice-models");
        let entry = |path: &str, url: &str, body: &[u8], sha256: String| ListenFile {
            path: path.into(),
            url: format!("{}{url}", server.base),
            size: body.len() as u64,
            sha256,
        };
        let wrong = "0".repeat(64);
        let d = Downloader::at(&models, vec![
            entry("pack/a.bin", "/a.bin", &a, sha(&a)),
            entry("b.bin", "/b.bin", &b, wrong),
        ]);
        place_voices(&d);
        // Half of `a` from an earlier attempt.
        fs::create_dir_all(models.join("pack")).unwrap();
        fs::write(part_path(&models.join("pack/a.bin")), &a[..123_456]).unwrap();
        assert_eq!(d.status().listen[0].have, 123_456);

        let rt = tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap();
        let err = rt.block_on(d.run(&[])).unwrap_err();
        assert!(err.starts_with("b.bin did not match its sha256"), "{err}");
        assert_eq!(fs::read(models.join("pack/a.bin")).unwrap(), a);
        assert!(!part_path(&models.join("pack/a.bin")).exists());
        assert!(!models.join("b.bin").exists() && !part_path(&models.join("b.bin")).exists());
        assert_eq!(
            *server.asked.lock().unwrap(),
            [("/a.bin".to_string(), Some("bytes=123456-".to_string())), ("/b.bin".to_string(), None)],
            "Kokoro's voices were in place; `a` resumed where its part ended"
        );
        let s = d.status();
        assert!(s.listen[0].ready && !s.listen[1].ready && !s.listen_ready);

        // With the right hash the next run fetches only `b`.
        let d = Downloader::at(&models, vec![
            entry("pack/a.bin", "/a.bin", &a, sha(&a)),
            entry("b.bin", "/b.bin", &b, sha(&b)),
        ]);
        rt.block_on(d.run(&[])).unwrap();
        assert_eq!(fs::read(models.join("b.bin")).unwrap(), b);
        assert!(d.status().listen_ready);
        assert_eq!(server.asked.lock().unwrap().len(), 3);
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn sha256_of_a_file() {
        let base = scratch("sha");
        let p = base.join("x");
        fs::write(&p, b"abc").unwrap();
        assert_eq!(
            sha256_file(&p).unwrap(),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
        let _ = fs::remove_dir_all(&base);
    }

    /// Real network: the two voices from Hugging Face, the first one resumed
    /// from a seeded half. `KOKORO_SEED` points at a verified copy of
    /// zf_001.bin. Run with `cargo test -- --ignored download_resumes`.
    #[test]
    #[ignore]
    fn download_resumes_from_a_part_file() {
        let seed = std::env::var("KOKORO_SEED").expect("KOKORO_SEED");
        let base = scratch("net");
        let d = Arc::new(Downloader::new(&base));
        let zf = manifest::voice_file("zf_001").unwrap();
        fs::create_dir_all(d.path_of(&zf).parent().unwrap()).unwrap();
        let bytes = fs::read(seed).unwrap();
        fs::write(part_path(&d.path_of(&zf)), &bytes[..200_000]).unwrap();
        let rt = tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap();
        rt.block_on(d.run(&[])).unwrap();
        assert_eq!(sha256_file(&d.path_of(&zf)).unwrap(), zf.sha256);
        assert!(!part_path(&d.path_of(&zf)).exists());
        let _ = fs::remove_dir_all(&base);
    }
}
