// Keeping the machine awake for the length of an unattended run (docs/info/88,
// 「排队」): a night's reading on the collector is hours of slow page turns, and
// a desktop that suspends on idle halfway through it ends the run.
//
// What is held is the operating system's own "not now" for idle sleep, nothing
// else. Closing the lid and choosing Sleep from a menu still put the machine to
// sleep: the user asked for that, and a background run has no business
// overruling them.
//
// - Linux: systemd-logind's `Inhibit("sleep:idle", …, "block")` on the system
//   bus. The answer is a file descriptor, and the lock is that descriptor being
//   open — closing it releases, and so does the process ending, however it ends.
//   GIO's D-Bus client is already in the build (WebKitGTK sits on it), so this
//   costs no dependency.
// - macOS: an IOKit power assertion of type `PreventUserIdleSystemSleep`.
//   Released with `IOPMAssertionRelease`, and by the system when the process
//   that holds it exits.
// - Elsewhere: nothing to hold, and the answer says so.
//
// Several holders may want it at once; each acquire is its own lock with its own
// id, and the machine stays awake while any of them is held.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

use tauri::{AppHandle, Manager};

/// Who is asking, as the system's own list of inhibitors shows it
/// (`systemd-inhibit --list`, `pmset -g assertions`).
const WHO: &str = "Reading Partner";

#[derive(Default)]
pub struct KeepAwakeState {
    held: Mutex<HashMap<u64, Hold>>,
    seq: AtomicU64,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KeepAwake {
    /// Whether the machine is now kept awake on this caller's behalf.
    pub held: bool,
    /// The handle to release it by.
    pub id: Option<u64>,
    /// Why it is not held, when it is not.
    pub detail: Option<String>,
}

/// Keep the machine from sleeping on idle until `keep_awake_release` is called
/// with the id this returns, or the app exits. `reason` is shown to the user by
/// the system's own tools.
#[tauri::command]
pub async fn keep_awake_acquire(app: AppHandle, reason: String) -> Result<KeepAwake, String> {
    tauri::async_runtime::spawn_blocking(move || acquire(&app, &reason))
        .await
        .map_err(|e| format!("keep-awake task failed: {e}"))
}

/// Give back a lock taken by `keep_awake_acquire`. Answers whether there was one
/// under that id.
#[tauri::command]
pub async fn keep_awake_release(app: AppHandle, id: u64) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || release(&app, id))
        .await
        .map_err(|e| format!("keep-awake task failed: {e}"))
}

fn acquire(app: &AppHandle, reason: &str) -> KeepAwake {
    let Some(state) = app.try_state::<KeepAwakeState>() else {
        return KeepAwake {
            held: false,
            id: None,
            detail: Some("keep-awake state is not registered".into()),
        };
    };
    match Hold::take(reason) {
        Ok(hold) => {
            let id = state.seq.fetch_add(1, Ordering::Relaxed) + 1;
            state
                .held
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .insert(id, hold);
            KeepAwake {
                held: true,
                id: Some(id),
                detail: None,
            }
        }
        Err(err) => KeepAwake {
            held: false,
            id: None,
            detail: Some(err),
        },
    }
}

fn release(app: &AppHandle, id: u64) -> bool {
    let Some(state) = app.try_state::<KeepAwakeState>() else {
        return false;
    };
    // Dropping the hold is the release.
    let hold = state.held.lock().unwrap_or_else(|e| e.into_inner()).remove(&id);
    hold.is_some()
}

/// One lock, released when dropped.
#[cfg(target_os = "linux")]
struct Hold {
    _fd: std::os::fd::OwnedFd,
}

#[cfg(target_os = "linux")]
impl Hold {
    fn take(reason: &str) -> Result<Self, String> {
        use std::os::fd::FromRawFd;
        use webkit2gtk::gio;
        use webkit2gtk::gio::prelude::*;
        use webkit2gtk::glib;

        let bus = gio::bus_get_sync(gio::BusType::System, None::<&gio::Cancellable>)
            .map_err(|e| format!("no system bus: {e}"))?;
        let args = ("sleep:idle", WHO, reason, "block").to_variant();
        let (reply, fds) = bus
            .call_with_unix_fd_list_sync(
                Some("org.freedesktop.login1"),
                "/org/freedesktop/login1",
                "org.freedesktop.login1.Manager",
                "Inhibit",
                Some(&args),
                Some(glib::VariantTy::new("(h)").expect("a valid type string")),
                gio::DBusCallFlags::NONE,
                5_000,
                None::<&gio::UnixFDList>,
                None::<&gio::Cancellable>,
            )
            .map_err(|e| format!("logind refused the inhibitor: {e}"))?;
        let index = reply
            .child_value(0)
            .get::<glib::variant::Handle>()
            .map(|h| h.0)
            .ok_or_else(|| "logind answered without a handle".to_string())?;
        // `get` hands back a duplicate; the list closes its own copy when it is
        // dropped, and this one is the lock.
        let raw = fds
            .get(index)
            .map_err(|e| format!("logind's answer carried no descriptor: {e}"))?;
        // Safety: `raw` is a fresh duplicate that nothing else owns.
        Ok(Self {
            _fd: unsafe { std::os::fd::OwnedFd::from_raw_fd(raw) },
        })
    }
}

#[cfg(target_os = "macos")]
struct Hold {
    id: u32,
}

#[cfg(target_os = "macos")]
mod iokit {
    use std::ffi::c_void;

    /// `kIOPMAssertionLevelOn`.
    pub const LEVEL_ON: u32 = 255;
    /// `kIOReturnSuccess`.
    pub const SUCCESS: i32 = 0;

    #[link(name = "IOKit", kind = "framework")]
    extern "C" {
        /// The two strings are `CFStringRef`s; an `NSString` is the same object
        /// (toll-free bridged).
        pub fn IOPMAssertionCreateWithName(
            assertion_type: *const c_void,
            level: u32,
            name: *const c_void,
            id: *mut u32,
        ) -> i32;
        pub fn IOPMAssertionRelease(id: u32) -> i32;
    }
}

#[cfg(target_os = "macos")]
impl Hold {
    fn take(reason: &str) -> Result<Self, String> {
        use objc2_foundation::NSString;
        // `kIOPMAssertionTypePreventUserIdleSystemSleep` is this string; the
        // constant itself is a macro, not a symbol.
        let kind = NSString::from_str("PreventUserIdleSystemSleep");
        let name = NSString::from_str(&format!("{WHO}: {reason}"));
        let mut id: u32 = 0;
        // Safety: both pointers are live NSStrings for the length of the call,
        // and `id` is a valid place for the answer.
        let status = unsafe {
            iokit::IOPMAssertionCreateWithName(
                &*kind as *const NSString as *const std::ffi::c_void,
                iokit::LEVEL_ON,
                &*name as *const NSString as *const std::ffi::c_void,
                &mut id,
            )
        };
        if status == iokit::SUCCESS {
            Ok(Self { id })
        } else {
            Err(format!("IOPMAssertionCreateWithName failed: {status:#x}"))
        }
    }
}

#[cfg(target_os = "macos")]
impl Drop for Hold {
    fn drop(&mut self) {
        // Safety: `id` came from a successful create and is released once.
        let status = unsafe { iokit::IOPMAssertionRelease(self.id) };
        if status != iokit::SUCCESS {
            eprintln!("keep-awake: IOPMAssertionRelease failed: {status:#x}");
        }
    }
}

#[cfg(not(any(target_os = "linux", target_os = "macos")))]
struct Hold;

#[cfg(not(any(target_os = "linux", target_os = "macos")))]
impl Hold {
    fn take(_reason: &str) -> Result<Self, String> {
        Err("keeping the machine awake is not implemented on this platform".into())
    }
}

/// Dev-only: `RP_KEEP_AWAKE_PROBE=<seconds>` takes the lock at startup, prints
/// one `RP-KEEP-AWAKE` line, holds it that long (check `systemd-inhibit --list`
/// meanwhile), releases it, prints again and exits.
pub fn run_probe_from_env(app: &AppHandle) {
    let Ok(raw) = std::env::var("RP_KEEP_AWAKE_PROBE") else {
        return;
    };
    let secs: u64 = raw.trim().parse().unwrap_or(10);
    let app = app.clone();
    std::thread::spawn(move || {
        let got = acquire(&app, "keep-awake probe");
        println!("RP-KEEP-AWAKE acquire {}", serde_json::to_string(&got).unwrap_or_default());
        std::thread::sleep(std::time::Duration::from_secs(secs));
        let released = got.id.is_some_and(|id| release(&app, id));
        println!("RP-KEEP-AWAKE release {released}");
        app.exit(0);
    });
}
