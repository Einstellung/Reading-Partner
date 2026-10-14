// The silent bench's Rust half (docs/platform/560, 静默语音测试). Debug builds
// only: `commands::harness` refuses in release, and nothing here writes a line
// until it is armed.
//
// Three writers share one clock. Swift (ios/Sources/VoiceHarness.swift) writes
// native.jsonl, this file writes rust.jsonl, and the webview's marks reach this
// file through `commands::harness` and are written here with the moment they
// arrived beside the webview's own `performance.now()`. All of them are
// CLOCK_UPTIME_RAW in milliseconds, which is what `mach_absolute_time` counts:
// one call to `clock_gettime_nsec_np` on either side of the bridge reads the
// same counter, so the rows line up without any offset to estimate.

use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde_json::{json, Map, Value};
use tokio::sync::mpsc::UnboundedReceiver;

use crate::tts::RelayEvent;

struct Armed {
    dir: PathBuf,
    log: File,
}

static ARMED: Mutex<Option<Armed>> = Mutex::new(None);

#[cfg(target_vendor = "apple")]
pub fn now_ms() -> f64 {
    extern "C" {
        fn clock_gettime_nsec_np(clock_id: u32) -> u64;
    }
    // <time.h>: _CLOCK_UPTIME_RAW = 8.
    const CLOCK_UPTIME_RAW: u32 = 8;
    // SAFETY: a libSystem call with no pointers and no preconditions.
    unsafe { clock_gettime_nsec_np(CLOCK_UPTIME_RAW) as f64 / 1_000_000.0 }
}

#[cfg(not(target_vendor = "apple"))]
pub fn now_ms() -> f64 {
    use std::sync::OnceLock;
    use std::time::Instant;
    static START: OnceLock<Instant> = OnceLock::new();
    START.get_or_init(Instant::now).elapsed().as_secs_f64() * 1000.0
}

pub fn arm(dir: &Path) -> std::io::Result<()> {
    fs::create_dir_all(dir.join("clips"))?;
    let log = OpenOptions::new()
        .create(true)
        .truncate(true)
        .write(true)
        .open(dir.join("rust.jsonl"))?;
    *ARMED.lock().unwrap_or_else(|e| e.into_inner()) = Some(Armed {
        dir: dir.to_path_buf(),
        log,
    });
    mark("armed", json!({ "dir": dir }));
    Ok(())
}

pub fn disarm() -> Option<PathBuf> {
    mark("disarmed", json!({}));
    ARMED
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .take()
        .map(|a| a.dir)
}

pub fn dir() -> Option<PathBuf> {
    ARMED
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .as_ref()
        .map(|a| a.dir.clone())
}

/// One row, stamped now. Answers with the stamp, or None when not armed.
pub fn mark(ev: &str, fields: Value) -> Option<f64> {
    let t = now_ms();
    write_row("rust", ev, t, fields).then_some(t)
}

/// A webview mark: stamped on arrival, carrying the webview's own clock too.
pub fn mark_js(ev: &str, perf_ms: Option<f64>, fields: Value) -> Option<f64> {
    let t = now_ms();
    let mut fields = match fields {
        Value::Object(map) => map,
        Value::Null => Map::new(),
        other => {
            let mut map = Map::new();
            map.insert("data".into(), other);
            map
        }
    };
    if let Some(p) = perf_ms {
        fields.insert("perfMs".into(), json!(p));
    }
    write_row("js", ev, t, Value::Object(fields)).then_some(t)
}

fn write_row(src: &str, ev: &str, t: f64, fields: Value) -> bool {
    let mut guard = ARMED.lock().unwrap_or_else(|e| e.into_inner());
    let Some(armed) = guard.as_mut() else {
        return false;
    };
    let mut row = match fields {
        Value::Object(map) => map,
        _ => Map::new(),
    };
    row.insert("t".into(), json!(t));
    row.insert("src".into(), json!(src));
    row.insert("ev".into(), json!(ev));
    let mut line = Value::Object(row).to_string();
    line.push('\n');
    let _ = armed.log.write_all(line.as_bytes());
    true
}

/// A turn's relay timeline, which a conversation otherwise drops: written as
/// `tts:<event>` rows while armed, dropped as before when not.
pub fn watch_relay(mut timeline: UnboundedReceiver<RelayEvent>) {
    if !cfg!(debug_assertions) || dir().is_none() {
        return;
    }
    tauri::async_runtime::spawn(async move {
        while let Some(event) = timeline.recv().await {
            relay_row(&event);
        }
    });
}

#[cfg(debug_assertions)]
fn relay_row(event: &RelayEvent) {
    let mut row = crate::live::record(event);
    let kind = row
        .get("event")
        .and_then(Value::as_str)
        .unwrap_or("event")
        .to_string();
    if let Some(map) = row.as_object_mut() {
        map.remove("event");
        // The relay's own clock starts at its own start; keep it, renamed.
        if let Some(at) = map.remove("atMs") {
            map.insert("relayMs".into(), at);
        }
    }
    mark(&format!("tts:{kind}"), row);
}

#[cfg(not(debug_assertions))]
fn relay_row(_event: &RelayEvent) {}
