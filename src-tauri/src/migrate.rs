// One-time migration after the bundle identifier change from
// `com.reading-partner.app` to `com.xinyuan.readingpartner` (picked for the
// iOS/App Store release). Tauri derives every per-app directory from the
// identifier, so existing desktop installs would otherwise start with an
// empty data dir. On startup, each per-app directory that exists under the
// old identifier and not under the new one is renamed to the new location.

use std::fs;
use std::io;
use std::path::Path;

const OLD_IDENTIFIER: &str = "com.reading-partner.app";

/// Rename `old` to `new` if `old` exists and `new` does not.
/// Returns Ok(true) when a move happened.
fn move_dir_once(old: &Path, new: &Path) -> io::Result<bool> {
    if !old.is_dir() || new.exists() {
        return Ok(false);
    }
    if let Some(parent) = new.parent() {
        fs::create_dir_all(parent)?;
    }
    // Same parent directory in practice (e.g. ~/.local/share/<id>), so a
    // rename is atomic and never crosses filesystems.
    fs::rename(old, new)?;
    Ok(true)
}

/// Move data left behind by the old bundle identifier, if any.
/// Failures are logged and ignored: a failed migration must not stop the app.
pub fn migrate_legacy_dirs(app: &tauri::AppHandle) {
    use tauri::Manager;

    let path = app.path();
    // (base dir, per-app dir under the new identifier). On Linux data and
    // local-data coincide; the second pair is then a no-op.
    let pairs = [
        (path.data_dir(), path.app_data_dir()),
        (path.local_data_dir(), path.app_local_data_dir()),
        (path.config_dir(), path.app_config_dir()),
        (path.cache_dir(), path.app_cache_dir()),
    ];
    for (base, new) in pairs {
        let (Ok(base), Ok(new)) = (base, new) else {
            continue;
        };
        let old = base.join(OLD_IDENTIFIER);
        if old == new {
            continue;
        }
        match move_dir_once(&old, &new) {
            Ok(true) => eprintln!("migrated {} -> {}", old.display(), new.display()),
            Ok(false) => {}
            Err(err) => eprintln!("failed to migrate {}: {}", old.display(), err),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::move_dir_once;
    use std::fs;
    use std::path::PathBuf;

    struct TempRoot(PathBuf);

    impl TempRoot {
        fn new(name: &str) -> Self {
            let dir = std::env::temp_dir().join(format!(
                "rp-migrate-{}-{}",
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

    #[test]
    fn moves_old_dir_when_new_is_missing() {
        let root = TempRoot::new("move");
        let old = root.0.join("com.reading-partner.app");
        let new = root.0.join("com.xinyuan.readingpartner");
        fs::create_dir_all(old.join("images")).unwrap();
        fs::write(old.join("settings.json"), b"{}").unwrap();

        assert!(move_dir_once(&old, &new).unwrap());
        assert!(!old.exists());
        assert!(new.join("settings.json").exists());
        assert!(new.join("images").is_dir());
    }

    #[test]
    fn keeps_both_dirs_when_new_already_exists() {
        let root = TempRoot::new("both");
        let old = root.0.join("old");
        let new = root.0.join("new");
        fs::create_dir_all(&old).unwrap();
        fs::write(old.join("a.json"), b"old").unwrap();
        fs::create_dir_all(&new).unwrap();
        fs::write(new.join("b.json"), b"new").unwrap();

        assert!(!move_dir_once(&old, &new).unwrap());
        assert!(old.join("a.json").exists());
        assert!(new.join("b.json").exists());
    }

    #[test]
    fn no_op_when_old_is_missing() {
        let root = TempRoot::new("none");
        let old = root.0.join("old");
        let new = root.0.join("new");

        assert!(!move_dir_once(&old, &new).unwrap());
        assert!(!new.exists());
    }
}
