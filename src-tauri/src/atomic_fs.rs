// Crash-safe writes for the app's data files. `writeTextFile` truncates the
// target and streams into it, so a process death mid-write leaves a half file:
// every loader in the frontend then degrades that book/shelf/settings file to
// "empty" and the next save makes the loss permanent. This writes a temp file
// in the target's own directory, fsyncs it, and renames it over the target, so
// a reader only ever sees the old contents or the new ones. Being killed
// mid-write is not hypothetical here — systemd-oomd has killed the session
// during a build (docs/pitfall/14).
//
// Paths are AppData-relative, matching the frontend's BaseDirectory.AppData
// convention. Escaping AppData is rejected rather than resolved.

use std::fs::{self, File};
use std::io::{self, Write};
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::Manager;

// Makes concurrent writes to the same target pick distinct temp names.
static TEMP_SEQ: AtomicU64 = AtomicU64::new(0);

/// Join an AppData-relative path onto `root`, rejecting anything that is not a
/// plain descending path (absolute, `..`, `.`, or empty).
fn safe_join(root: &Path, rel: &str) -> Result<PathBuf, String> {
    let path = Path::new(rel);
    let mut any = false;
    for component in path.components() {
        match component {
            Component::Normal(_) => any = true,
            _ => return Err(format!("path escapes the data directory: {rel}")),
        }
    }
    if !any {
        return Err("empty path".to_string());
    }
    Ok(root.join(path))
}

/// Write `bytes` to `target` atomically: temp file in the same directory,
/// fsync, rename. Parent directories are created first.
fn write_atomic(target: &Path, bytes: &[u8]) -> io::Result<()> {
    let dir = target
        .parent()
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "no parent directory"))?;
    fs::create_dir_all(dir)?;

    let name = target
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "no file name"))?;
    let seq = TEMP_SEQ.fetch_add(1, Ordering::Relaxed);
    let tmp = dir.join(format!(".{name}.{}.{seq}.tmp", std::process::id()));

    let result = (|| -> io::Result<()> {
        let mut file = File::create(&tmp)?;
        file.write_all(bytes)?;
        // Durable before the rename: otherwise the rename can land while the
        // contents are still only in the page cache.
        file.sync_all()?;
        drop(file);
        // Same directory, so this never crosses a filesystem; on Windows it
        // replaces an existing target rather than failing.
        fs::rename(&tmp, target)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    result?;

    // Persist the directory entry itself. Not available on every platform, and
    // a failure here only costs durability of the rename, so it is ignored.
    #[cfg(unix)]
    if let Ok(dir_handle) = File::open(dir) {
        let _ = dir_handle.sync_all();
    }
    Ok(())
}

fn now_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

fn data_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path().app_data_dir().map_err(|e| e.to_string())
}

/// Atomically replace an AppData-relative text file.
#[tauri::command]
pub fn write_text_file_atomic(
    app: tauri::AppHandle,
    path: String,
    contents: String,
) -> Result<(), String> {
    let target = safe_join(&data_root(&app)?, &path)?;
    write_atomic(&target, contents.as_bytes()).map_err(|e| format!("{}: {e}", target.display()))
}

/// Move an unparseable file aside as `<name>.corrupt-<unix-ms>` and return the
/// new AppData-relative name, or `None` when there was no file. The frontend
/// calls this before falling back to defaults, so data it cannot rebuild is
/// never overwritten by the next save. The timestamp is taken here rather than
/// passed in, so the name can't be shaped by a caller with a wrong clock source.
#[tauri::command]
pub fn quarantine_file(app: tauri::AppHandle, path: String) -> Result<Option<String>, String> {
    let root = data_root(&app)?;
    let target = safe_join(&root, &path)?;
    if !target.is_file() {
        return Ok(None);
    }
    let renamed = format!("{path}.corrupt-{}", now_ms());
    let dest = safe_join(&root, &renamed)?;
    fs::rename(&target, &dest).map_err(|e| format!("{}: {e}", target.display()))?;
    Ok(Some(renamed))
}

#[cfg(test)]
mod tests {
    use super::{safe_join, write_atomic};
    use std::fs;
    use std::path::{Path, PathBuf};

    struct TempRoot(PathBuf);

    impl TempRoot {
        fn new(name: &str) -> Self {
            let dir = std::env::temp_dir().join(format!(
                "rp-atomic-{}-{}",
                name,
                std::process::id()
            ));
            let _ = fs::remove_dir_all(&dir);
            fs::create_dir_all(&dir).unwrap();
            TempRoot(dir)
        }
    }

    impl Drop for TempRoot {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn entries(dir: &Path) -> Vec<String> {
        let mut names: Vec<String> = fs::read_dir(dir)
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        names.sort();
        names
    }

    #[test]
    fn writes_a_new_file_and_leaves_no_temp_behind() {
        let root = TempRoot::new("new");
        let target = root.0.join("settings.json");
        write_atomic(&target, b"{\"a\":1}").unwrap();
        assert_eq!(fs::read_to_string(&target).unwrap(), "{\"a\":1}");
        assert_eq!(entries(&root.0), vec!["settings.json"]);
    }

    #[test]
    fn replaces_an_existing_file_in_full() {
        let root = TempRoot::new("replace");
        let target = root.0.join("library.json");
        fs::write(&target, "a much longer previous version").unwrap();
        write_atomic(&target, b"short").unwrap();
        assert_eq!(fs::read_to_string(&target).unwrap(), "short");
        assert_eq!(entries(&root.0), vec!["library.json"]);
    }

    #[test]
    fn creates_missing_parent_directories() {
        let root = TempRoot::new("mkdir");
        let target = root.0.join("notes-abc").join("state.json");
        write_atomic(&target, b"{}").unwrap();
        assert_eq!(fs::read_to_string(&target).unwrap(), "{}");
    }

    #[test]
    fn safe_join_accepts_a_nested_relative_path() {
        let joined = safe_join(Path::new("/data"), "notes-abc/state.json").unwrap();
        assert_eq!(joined, PathBuf::from("/data/notes-abc/state.json"));
    }

    #[test]
    fn safe_join_rejects_traversal_absolute_and_empty_paths() {
        assert!(safe_join(Path::new("/data"), "../secrets").is_err());
        assert!(safe_join(Path::new("/data"), "a/../../b").is_err());
        assert!(safe_join(Path::new("/data"), "/etc/passwd").is_err());
        assert!(safe_join(Path::new("/data"), "./x").is_err());
        assert!(safe_join(Path::new("/data"), "").is_err());
    }
}
