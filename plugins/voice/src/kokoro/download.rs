// Fetching the pinned Kokoro files into local app data.
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
// (commands.rs asks Swift) before the first byte lands in it.

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
    /// Bytes on disk and bytes in all, over the requested files.
    pub have_bytes: u64,
    pub total_bytes: u64,
    /// Every file of every variant.
    pub files: Vec<FileStatus>,
}

#[derive(Default)]
struct State {
    running: bool,
    current: Option<String>,
    error: Option<String>,
    requested: Vec<Variant>,
}

pub struct Downloader {
    root: PathBuf,
    state: Mutex<State>,
}

pub fn part_path(dst: &Path) -> PathBuf {
    let mut s = dst.as_os_str().to_owned();
    s.push(".part");
    PathBuf::from(s)
}

fn complete(dst: &Path, size: u64) -> bool {
    fs::metadata(dst).map(|m| m.is_file() && m.len() == size).unwrap_or(false)
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
    /// `base` is local app data; the files go under the revision's directory.
    pub fn new(base: &Path) -> Self {
        Self { root: manifest::root(base), state: Mutex::new(State::default()) }
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    /// Where a manifest file lives once verified.
    pub fn path_of(&self, file: &ModelFile) -> PathBuf {
        self.root.join(file.path)
    }

    pub fn is_ready(&self, variant: Variant) -> bool {
        complete(&self.path_of(&variant.file()), variant.file().size)
            && manifest::VOICES.iter().all(|(_, f)| complete(&self.path_of(f), f.size))
    }

    pub fn status(&self) -> ModelStatus {
        let st = self.state.lock().unwrap();
        let files: Vec<FileStatus> = manifest::files_for(&Variant::ALL)
            .iter()
            .map(|f| {
                let dst = self.path_of(f);
                let ready = complete(&dst, f.size);
                let have = if ready {
                    f.size
                } else {
                    fs::metadata(part_path(&dst)).map(|m| m.len().min(f.size)).unwrap_or(0)
                };
                FileStatus { path: f.path.to_string(), size: f.size, have, ready }
            })
            .collect();
        let wanted = manifest::files_for(&st.requested);
        let (have_bytes, total_bytes) = wanted.iter().fold((0, 0), |(h, t), w| {
            let have = files.iter().find(|f| f.path == w.path).map(|f| f.have).unwrap_or(0);
            (h + have, t + w.size)
        });
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
        }
    }

    /// Create the root so the caller can exclude it from backup before any
    /// file lands in it.
    pub fn prepare_root(&self) -> std::io::Result<&Path> {
        fs::create_dir_all(&self.root)?;
        Ok(&self.root)
    }

    /// Start fetching what these variants need, in the background. False when
    /// a download is already running (and nothing changes).
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

    /// The whole download in the caller's task. `start` is this on a spawn.
    pub async fn run(&self, variants: &[Variant]) -> Result<(), String> {
        let client = reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(20))
            .build()
            .map_err(|e| format!("No HTTP client: {e}"))?;
        for file in manifest::files_for(variants) {
            self.state.lock().unwrap().current = Some(file.path.to_string());
            self.fetch(&client, &file).await?;
        }
        Ok(())
    }

    async fn fetch(&self, client: &reqwest::Client, file: &ModelFile) -> Result<(), String> {
        let dst = self.path_of(file);
        if complete(&dst, file.size) {
            return Ok(());
        }
        if let Some(dir) = dst.parent() {
            fs::create_dir_all(dir).map_err(|e| format!("Creating {}: {e}", dir.display()))?;
        }
        let part = part_path(&dst);
        let mut attempt = 0;
        loop {
            attempt += 1;
            match transfer(client, file, &part).await {
                Ok(()) => break,
                Err(e) if attempt < ATTEMPTS => {
                    let _ = e;
                    tokio::time::sleep(Duration::from_secs(2 * attempt as u64)).await;
                }
                Err(e) => return Err(format!("{}: {e}", file.path)),
            }
        }
        let p = part.clone();
        let got = tauri::async_runtime::spawn_blocking(move || sha256_file(&p))
            .await
            .map_err(|e| e.to_string())?
            .map_err(|e| format!("Hashing {}: {e}", file.path))?;
        if got != file.sha256 {
            let _ = fs::remove_file(&part);
            return Err(format!(
                "{} did not match its sha256 (got {got}); it was deleted and will be fetched again.",
                file.path
            ));
        }
        fs::rename(&part, &dst).map_err(|e| format!("Moving {} into place: {e}", file.path))
    }
}

/// The first byte a `Content-Range: bytes <start>-<end>/<total>` answer covers.
pub fn content_range_start(header: &str) -> Option<u64> {
    header.trim().strip_prefix("bytes ")?.split('-').next()?.trim().parse().ok()
}

/// One attempt: carry `part` forward to the full size, resuming from its
/// current length.
async fn transfer(client: &reqwest::Client, file: &ModelFile, part: &Path) -> Result<(), String> {
    let mut have = fs::metadata(part).map(|m| m.len()).unwrap_or(0);
    if have > file.size {
        let _ = fs::remove_file(part);
        have = 0;
    }
    if have == file.size {
        return Ok(());
    }
    let mut req = client.get(manifest::url(file));
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
    if len != file.size {
        return Err(format!("ended at {len} of {} bytes", file.size));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("kokoro-dl-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        d
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
