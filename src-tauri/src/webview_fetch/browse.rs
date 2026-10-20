// A hidden page that stays open: the browse session (docs/info/88, 「取材」).
//
// `fetch_page_via_webview` next door opens a window, waits, reads once and
// destroys it. Reading a list that grows as it is scrolled needs the opposite: one
// page kept alive across many calls, moved by the caller a few hundred pixels at
// a time, read after every move, sent back, sent somewhere else. This is that
// page. It knows nothing about any site; what to load, what to read and how fast
// to go are the caller's business.
//
// Everything that makes the fetch windows safe holds here too, because it is the
// same window: created hidden and never put on a screen, the same profile and
// cookie jar (docs/pitfall/385 for macOS's store), the same user agent, the navigation
// exemption registered in `WebviewFetchState::live` for exactly as long as the
// window exists, the same lid on dialogs and permission prompts
// (`connect_engine_signals`). Each call that touches the page takes the fetcher's
// gate for its own length, not for the session's: a session may sit open for an
// hour between reads, and the article fetch and the sign-in window must not wait
// that out.
//
// One session at a time. Opening a second while one is live answers `busy`; the
// handle a session is opened with is what every later call names, so a caller
// holding a stale handle gets `closed` rather than someone else's page. A
// session nobody has touched for its idle window is closed by itself, so a
// frontend that reloads mid-run cannot leave a hidden page on a third-party site
// open, and the slot taken, until the app quits.
//
// Waiting for a page is by the caller's own script where it gives one: the
// navigation is over when the script comes back truthy on the new document.
// The load event is not a usable signal for the pages this exists for — an X
// page has its posts on screen at 15 seconds and reports itself loaded at 48
// (docs/pitfall/496) — and an in-page navigation never reports one at all.
//
// Unlike the fetch windows, the page has to render. WebKit runs no rendering
// update in a page nobody can see, so in a window that is merely hidden
// requestAnimationFrame, IntersectionObserver, ResizeObserver and the scroll
// event after a scrollBy never fire (docs/pitfall/600), and a list that loads
// more when its end comes into view never loads more. `render_unseen` puts the
// page somewhere that counts as visible to WebKit and is on no screen.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, TryRecvError};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::{AppHandle, Manager, Url, WebviewWindow, Wry};

use super::policy::{self, Ready};
use super::{
    build_window, connect_engine_signals, profile_dir, Chrome, LiveGuard, LoadEvent,
    WebviewFetchState, HAS_DOM_BRIDGE,
};

/// How long a session may sit untouched before it closes itself, when the
/// caller does not say. Longer than any pause a reader takes inside one stretch
/// of reading; a caller that rests between stretches either says how long it
/// rests or opens a new session afterwards.
const DEFAULT_IDLE: Duration = Duration::from_secs(15 * 60);
const MIN_IDLE: Duration = Duration::from_secs(60);
const MAX_IDLE: Duration = Duration::from_secs(60 * 60);

/// How often the idle check looks. Coarse on purpose: it only has to close a
/// forgotten page eventually, not on the second.
const REAP_POLL: Duration = Duration::from_secs(15);

/// Default and bounds for one navigation's wait.
const DEFAULT_WAIT: Duration = Duration::from_secs(60);
const MIN_WAIT: Duration = Duration::from_secs(2);
const MAX_WAIT: Duration = policy::OVERALL_TIMEOUT;

/// Bounds for one evaluation.
const MIN_EVAL: Duration = Duration::from_secs(1);
const MAX_EVAL: Duration = Duration::from_secs(60);

/// How often a waiting navigation looks at the page.
const POLL: Duration = policy::READY_POLL;

/// The most one scroll call moves. A caller that means a screen asks for a
/// screen; a number past this is a unit mix-up, not a scroll.
const MAX_SCROLL_PX: f64 = 20_000.0;

/// The browse slot, kept inside `WebviewFetchState` so the navigation guard and
/// the gate are the ones every other window of the fetcher answers to.
#[derive(Default)]
pub struct Slot {
    session: Mutex<Option<Session>>,
    seq: AtomicU64,
}

struct Session {
    id: u64,
    label: String,
    rx: Receiver<LoadEvent>,
    last_used: Instant,
    idle: Duration,
    marks: u64,
    /// Destroys the window and drops its navigation exemption when the session
    /// goes, whichever way it goes.
    _guard: LiveGuard<Wry>,
}

impl Session {
    fn next_mark(&mut self) -> String {
        self.marks += 1;
        format!("rp-browse-{}-{}", self.id, self.marks)
    }
}

/// How a browse call ended.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum BrowseStatus {
    /// The call did what it was asked.
    Ok,
    /// The page did not get there in time: the navigation's `until` never came
    /// back truthy, or the page did not answer a script.
    Timeout,
    /// The engine reported the load as failed.
    Network,
    /// No session under that handle: never opened, closed, or closed for idling.
    Closed,
    /// A session is already open.
    Busy,
    /// No browse window on this platform.
    Unsupported,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowseOpened {
    pub status: BrowseStatus,
    /// The handle every later call names.
    pub session: Option<u64>,
    pub detail: Option<String>,
}

/// What a navigation or a step back came to.
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowseLoad {
    pub status: BrowseStatus,
    /// Where the page is now, redirects included. Only from the new document.
    pub url: Option<String>,
    pub title: Option<String>,
    /// Whether the engine reported the load finished. Informational: a page can
    /// be complete for the caller's purpose long before this.
    pub loaded: bool,
    /// The `until` script's last value on the new document.
    pub value: Option<serde_json::Value>,
    /// What the `until` script threw, if it threw.
    pub error: Option<String>,
    pub elapsed_ms: u64,
    pub detail: Option<String>,
}

impl BrowseLoad {
    fn failed(status: BrowseStatus, started: Instant, detail: impl Into<String>) -> Self {
        Self {
            status,
            url: None,
            title: None,
            loaded: false,
            value: None,
            error: None,
            elapsed_ms: started.elapsed().as_millis() as u64,
            detail: Some(detail.into()),
        }
    }
}

/// What a script run in the page came to.
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowseEval {
    pub status: BrowseStatus,
    pub url: Option<String>,
    pub title: Option<String>,
    /// The script's value, JSON round-tripped.
    pub value: Option<serde_json::Value>,
    /// What the script threw. The page answered, so the status is still `ok`.
    pub error: Option<String>,
    pub elapsed_ms: u64,
    pub detail: Option<String>,
}

impl BrowseEval {
    fn failed(status: BrowseStatus, started: Instant, detail: impl Into<String>) -> Self {
        Self {
            status,
            url: None,
            title: None,
            value: None,
            error: None,
            elapsed_ms: started.elapsed().as_millis() as u64,
            detail: Some(detail.into()),
        }
    }
}

/// Where a scroll left the page, in CSS pixels.
#[derive(Debug, Default, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowseScroll {
    #[serde(default = "ok_status", skip_deserializing)]
    pub status: BrowseStatus,
    /// `scrollY` before and after. Equal means the page had nowhere to go.
    pub before: f64,
    pub after: f64,
    /// `scrollHeight` of the document after the move.
    pub height: f64,
    /// `innerHeight`: one screen.
    pub viewport: f64,
    #[serde(skip_deserializing)]
    pub detail: Option<String>,
}

fn ok_status() -> BrowseStatus {
    BrowseStatus::Ok
}

impl Default for BrowseStatus {
    fn default() -> Self {
        BrowseStatus::Ok
    }
}

impl BrowseScroll {
    fn failed(status: BrowseStatus, detail: impl Into<String>) -> Self {
        Self {
            status,
            detail: Some(detail.into()),
            ..Self::default()
        }
    }
}

/// One look at the page (browse.js).
#[derive(Debug, Default, serde::Deserialize)]
struct Look {
    url: String,
    title: String,
    state: String,
    chars: usize,
    /// Not the document that carried the mark set before the navigation.
    fresh: bool,
    ok: bool,
    #[serde(default)]
    value: Option<serde_json::Value>,
    #[serde(default)]
    error: Option<String>,
}

fn idle_window(ms: Option<u64>) -> Duration {
    ms.map_or(DEFAULT_IDLE, |ms| Duration::from_millis(ms).clamp(MIN_IDLE, MAX_IDLE))
}

fn wait_budget(ms: Option<u64>) -> Duration {
    ms.map_or(DEFAULT_WAIT, |ms| Duration::from_millis(ms).clamp(MIN_WAIT, MAX_WAIT))
}

fn eval_budget(ms: Option<u64>) -> Duration {
    ms.map_or(policy::EVAL_TIMEOUT, |ms| Duration::from_millis(ms).clamp(MIN_EVAL, MAX_EVAL))
}

/// JavaScript's truthiness, over a value that has been through JSON.
fn truthy(value: &Option<serde_json::Value>) -> bool {
    use serde_json::Value;
    match value {
        None | Some(Value::Null) => false,
        Some(Value::Bool(b)) => *b,
        Some(Value::Number(n)) => n.as_f64().is_some_and(|f| f != 0.0 && !f.is_nan()),
        Some(Value::String(s)) => !s.is_empty(),
        Some(Value::Array(_)) | Some(Value::Object(_)) => true,
    }
}

/// The look script with the mark and the caller's script in place. The mark goes
/// in first, so a script that happens to contain the mark's placeholder is left
/// as it was written.
fn look_script(mark: Option<&str>, script: Option<&str>) -> String {
    let mark = match mark {
        Some(mark) => serde_json::to_string(mark).unwrap_or_else(|_| "null".into()),
        None => "null".into(),
    };
    include_str!("browse.js")
        .replace("__RP_MARK__", &mark)
        .replace("__RP_SCRIPT__", script.unwrap_or("null"))
}

/// The scroll script: one `scrollBy` in the page, and where it left things.
fn scroll_script(dy: f64) -> String {
    format!(
        "(() => {{ const before = window.scrollY; window.scrollBy(0, {dy}); \
         const root = document.scrollingElement || document.documentElement; \
         return JSON.stringify({{ before: before, after: window.scrollY, \
         height: root ? root.scrollHeight : 0, viewport: window.innerHeight }}); }})()"
    )
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
fn eval(window: &WebviewWindow<Wry>, js: &str, timeout: Duration) -> Result<String, String> {
    super::eval_string(window, js, timeout)
}

#[cfg(not(any(target_os = "linux", target_os = "macos")))]
fn eval(_window: &WebviewWindow<Wry>, _js: &str, _timeout: Duration) -> Result<String, String> {
    Err("no DOM bridge on this platform".to_string())
}

fn look(
    window: &WebviewWindow<Wry>,
    mark: Option<&str>,
    script: Option<&str>,
    timeout: Duration,
) -> Result<Look, String> {
    let json = eval(window, &look_script(mark, script), timeout)?;
    serde_json::from_str(&json).map_err(|e| format!("the page answered unusable JSON: {e}"))
}

/// Mark the document that is about to be left, and say where it is. The mark is
/// how a wait tells the new document from the old one, which stays in place —
/// and answers scripts — until the new one commits.
fn set_mark(window: &WebviewWindow<Wry>, mark: &str) -> Result<String, String> {
    let quoted = serde_json::to_string(mark).map_err(|e| e.to_string())?;
    eval(
        window,
        &format!("(() => {{ window.__rpBrowseMark = {quoted}; return String(location.href); }})()"),
        policy::EVAL_TIMEOUT,
    )
}

/// Run `op` on the live session named `id`, holding the slot for the length of
/// it. With `gated`, the fetcher's gate is held too: anything that loads or reads
/// a page takes its turn with the other windows on the same jar.
fn with_session<T>(
    app: &AppHandle,
    id: u64,
    gated: bool,
    op: impl FnOnce(&WebviewWindow<Wry>, &mut Session) -> T,
) -> Result<T, (BrowseStatus, String)> {
    if !HAS_DOM_BRIDGE {
        return Err((BrowseStatus::Unsupported, "no DOM bridge on this platform".into()));
    }
    let Some(state) = app.try_state::<WebviewFetchState>() else {
        return Err((BrowseStatus::Unsupported, "webview fetch state is not registered".into()));
    };
    let mut slot = state.browse.session.lock().unwrap_or_else(|e| e.into_inner());
    let label = match slot.as_ref() {
        Some(session) if session.id == id => session.label.clone(),
        _ => return Err((BrowseStatus::Closed, format!("no browse session {id}"))),
    };
    let Some(window) = app.get_webview_window(&label) else {
        // The window went without the session noticing; the slot goes with it.
        *slot = None;
        return Err((BrowseStatus::Closed, format!("browse session {id} lost its window")));
    };
    let _gate = gated.then(|| state.gate.lock().unwrap_or_else(|e| e.into_inner()));
    let session = slot.as_mut().expect("checked above");
    session.last_used = Instant::now();
    let out = op(&window, session);
    session.last_used = Instant::now();
    Ok(out)
}

/// Open the session's hidden window, blank. Nothing is loaded until the first
/// navigation.
///
/// `viewport` is the page's [width, height] in CSS pixels; the caller picks a
/// size a real screen has, since the page can read it. Clamped to 800-3840 by
/// 600-4320; absent, `policy::VIEWPORT`.
///
/// `init_script` is the session's document-start script (`build_window`'s
/// `page_script`), there only when the caller passes one: the X reader's
/// capture of its page's own answers. The session still knows no site; the
/// script guards itself to the hosts it is for.
#[tauri::command]
pub async fn browse_open(
    app: AppHandle,
    idle_timeout_ms: Option<u64>,
    viewport: Option<[f64; 2]>,
    init_script: Option<String>,
) -> Result<BrowseOpened, String> {
    tauri::async_runtime::spawn_blocking(move || {
        open_blocking(&app, idle_timeout_ms, viewport, init_script.as_deref())
    })
        .await
        .map_err(|e| format!("browse open task failed: {e}"))
}

/// The viewport a session asked for, inside sane bounds.
fn viewport_size(asked: Option<[f64; 2]>) -> (f64, f64) {
    match asked {
        Some([w, h]) if w.is_finite() && h.is_finite() => (w.clamp(800.0, 3840.0), h.clamp(600.0, 4320.0)),
        _ => policy::VIEWPORT,
    }
}

fn open_blocking(
    app: &AppHandle,
    idle_timeout_ms: Option<u64>,
    viewport: Option<[f64; 2]>,
    init_script: Option<&str>,
) -> BrowseOpened {
    let refuse = |status: BrowseStatus, detail: String| BrowseOpened {
        status,
        session: None,
        detail: Some(detail),
    };
    if !HAS_DOM_BRIDGE {
        return refuse(BrowseStatus::Unsupported, "no DOM bridge on this platform".into());
    }
    let Some(state) = app.try_state::<WebviewFetchState>() else {
        return refuse(BrowseStatus::Unsupported, "webview fetch state is not registered".into());
    };
    let mut slot = state.browse.session.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(live) = slot.as_ref() {
        return refuse(BrowseStatus::Busy, format!("browse session {} is open", live.id));
    }
    let profile = match profile_dir(app) {
        Ok(dir) => dir,
        Err(err) => return refuse(BrowseStatus::Unsupported, err),
    };

    let label = state.next_label();
    // Registered before the window exists, as every fetch window is, so the
    // navigation guard knows it from the first navigation on.
    if let Ok(mut live) = state.live.lock() {
        live.insert(label.clone());
    }
    let guard = LiveGuard {
        app: app.clone(),
        label: label.clone(),
    };
    let (tx, rx) = mpsc::channel::<LoadEvent>();
    let init_script = init_script.filter(|s| !s.trim().is_empty());
    let window = match build_window(app, &label, &profile, tx.clone(), Chrome::hidden(), init_script) {
        Ok(window) => window,
        Err(err) => return refuse(BrowseStatus::Network, format!("window failed: {err}")),
    };
    connect_engine_signals(&window, tx);
    render_unseen(&window, viewport_size(viewport));

    let id = state.browse.seq.fetch_add(1, Ordering::Relaxed) + 1;
    let idle = idle_window(idle_timeout_ms);
    *slot = Some(Session {
        id,
        label,
        rx,
        last_used: Instant::now(),
        idle,
        marks: 0,
        _guard: guard,
    });
    drop(slot);
    spawn_reaper(app.clone(), id);
    BrowseOpened {
        status: BrowseStatus::Ok,
        session: Some(id),
        detail: None,
    }
}

/// Make the page render without putting it on any screen.
///
/// The window `build_window` made is hidden and stays hidden. A hidden view is
/// a hidden page to WebKit (`visibilityState` "hidden"), and a hidden page gets
/// no rendering updates (docs/pitfall/600). On GTK the view is moved out of that
/// window into a `GtkOffscreenWindow`: a toplevel that GTK maps and draws into
/// memory and never hands to the display server. The view counts as mapped, so
/// the page is visible to itself, and there is no X11 or Wayland window to show
/// up on a screen, in a taskbar or in the focus chain. The offscreen window also
/// gives the view its size (`policy::VIEWPORT` unless the session asked for
/// another), which a never-mapped window would leave at 0x0.
///
/// wry still owns the view and destroys it when the Tauri window goes; the
/// offscreen window goes with it.
#[cfg(target_os = "linux")]
fn render_unseen(window: &WebviewWindow<Wry>, (w, h): (f64, f64)) {
    let _ = window.with_webview(move |platform| {
        use gtk::prelude::*;
        let view = platform.inner();
        if let Some(parent) = view.parent().and_then(|p| p.downcast::<gtk::Container>().ok()) {
            parent.remove(&view);
        }
        view.set_size_request(w as i32, h as i32);
        let offscreen = gtk::OffscreenWindow::new();
        offscreen.add(&view);
        offscreen.show_all();
        view.connect_destroy(move |_| {
            // Safety: the offscreen window is ours alone; nothing else holds it
            // or will touch it after this.
            unsafe { offscreen.destroy() };
        });
    });
}

/// The macOS counterpart, written blind: nothing here has been built or run
/// (docs/pitfall/600). WKWebView takes a page to be hidden when its window is
/// not ordered in or is occluded, and a window placed outside every screen is
/// occluded. So the window is made borderless (AppKit only pulls titled windows
/// back onto a screen), moved far outside every screen, kept out of the mouse,
/// Mission Control, the window cycle and the Window menu, ordered in at the back
/// without becoming key, and the view's occlusion detection is switched off
/// through WebKit's private `_setWindowOcclusionDetectionEnabled:`, when the
/// view answers to it.
#[cfg(target_os = "macos")]
fn render_unseen(window: &WebviewWindow<Wry>, (w, h): (f64, f64)) {
    let _ = window.set_size(tauri::Size::Logical(tauri::LogicalSize::new(w, h)));
    let _ = window.with_webview(|platform| {
        use objc2::runtime::AnyObject;
        use objc2::{msg_send, sel};
        use objc2_foundation::NSPoint;
        // NSWindowStyleMaskBorderless.
        const BORDERLESS: usize = 0;
        // NSWindowCollectionBehaviorTransient | NSWindowCollectionBehaviorIgnoresCycle.
        const BEHAVIOR: usize = (1 << 3) | (1 << 6);
        // Safety: on the main thread, `inner` is wry's WKWebView and `ns_window`
        // its NSWindow, both alive for the length of this closure.
        unsafe {
            let view = platform.inner() as *mut AnyObject;
            let ns_window = platform.ns_window() as *mut AnyObject;
            let (Some(view), Some(ns_window)) = (view.as_ref(), ns_window.as_ref()) else {
                return;
            };
            let private = sel!(_setWindowOcclusionDetectionEnabled:);
            let answers: bool = msg_send![view, respondsToSelector: private];
            if answers {
                let _: () = msg_send![view, _setWindowOcclusionDetectionEnabled: false];
            }
            let _: () = msg_send![ns_window, setStyleMask: BORDERLESS];
            let _: () = msg_send![ns_window, setHasShadow: false];
            let _: () = msg_send![ns_window, setIgnoresMouseEvents: true];
            let _: () = msg_send![ns_window, setExcludedFromWindowsMenu: true];
            let _: () = msg_send![ns_window, setCollectionBehavior: BEHAVIOR];
            let _: () = msg_send![ns_window, setFrameOrigin: NSPoint::new(-20_000.0, -20_000.0)];
            let _: () = msg_send![ns_window, orderBack: std::ptr::null::<AnyObject>()];
        }
    });
}

#[cfg(not(any(target_os = "linux", target_os = "macos")))]
fn render_unseen(_window: &WebviewWindow<Wry>, _size: (f64, f64)) {}

/// Close session `id` once nothing has touched it for its idle window.
fn spawn_reaper(app: AppHandle, id: u64) {
    std::thread::spawn(move || loop {
        std::thread::sleep(REAP_POLL);
        let Some(state) = app.try_state::<WebviewFetchState>() else {
            return;
        };
        let mut slot = state.browse.session.lock().unwrap_or_else(|e| e.into_inner());
        match slot.as_ref() {
            Some(session) if session.id == id => {
                if session.last_used.elapsed() >= session.idle {
                    eprintln!(
                        "webview-browse: closing session {id}, untouched for {}s",
                        session.idle.as_secs()
                    );
                    *slot = None;
                    return;
                }
            }
            // Closed, or replaced after a close: this watch is over.
            _ => return,
        }
    });
}

/// Close session `id`. Answers whether there was one to close.
#[tauri::command]
pub async fn browse_close(app: AppHandle, session: u64) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || close_blocking(&app, session))
        .await
        .map_err(|e| format!("browse close task failed: {e}"))
}

fn close_blocking(app: &AppHandle, id: u64) -> bool {
    let Some(state) = app.try_state::<WebviewFetchState>() else {
        return false;
    };
    let mut slot = state.browse.session.lock().unwrap_or_else(|e| e.into_inner());
    if slot.as_ref().is_some_and(|s| s.id == id) {
        // Dropping the session drops its guard, which destroys the window.
        *slot = None;
        true
    } else {
        false
    }
}

/// Load `url` in the session's page and wait for it.
///
/// With `until`, the wait ends when that script — an expression or an IIFE, run
/// in the page every half second — comes back truthy on the new document. It
/// should only read: it runs many times. Without it, the wait ends on the load
/// event or, failing that, on a document that has parsed and rendered something
/// (`policy::has_begun`). `timeout_ms` bounds the wait (default 60s).
///
/// `Err` is the caller's mistake: a URL the fetcher never loads.
#[tauri::command]
pub async fn browse_navigate(
    app: AppHandle,
    session: u64,
    url: String,
    until: Option<String>,
    timeout_ms: Option<u64>,
) -> Result<BrowseLoad, String> {
    let target = policy::validate_target(&url)?;
    tauri::async_runtime::spawn_blocking(move || {
        navigate_blocking(&app, session, &target, until.as_deref(), timeout_ms)
    })
    .await
    .map_err(|e| format!("browse navigate task failed: {e}"))
}

fn navigate_blocking(
    app: &AppHandle,
    id: u64,
    target: &Url,
    until: Option<&str>,
    timeout_ms: Option<u64>,
) -> BrowseLoad {
    let started = Instant::now();
    let budget = wait_budget(timeout_ms);
    with_session(app, id, true, |window, session| {
        drain(&session.rx);
        let mark = session.next_mark();
        let marked = set_mark(window, &mark).is_ok();
        if let Err(err) = window.navigate(target.clone()) {
            return BrowseLoad::failed(BrowseStatus::Network, started, format!("navigate failed: {err}"));
        }
        let wait = Wait {
            mark: marked.then_some(mark.as_str()),
            from: None,
            until,
        };
        wait_for(window, &session.rx, &wait, budget, started)
    })
    .unwrap_or_else(|(status, detail)| BrowseLoad::failed(status, started, detail))
}

/// Go back one entry in the page's history and wait, the way a navigation waits.
/// An in-page history entry has no load event and keeps the same document, so a
/// change of address also counts as having arrived.
#[tauri::command]
pub async fn browse_back(
    app: AppHandle,
    session: u64,
    until: Option<String>,
    timeout_ms: Option<u64>,
) -> Result<BrowseLoad, String> {
    tauri::async_runtime::spawn_blocking(move || back_blocking(&app, session, until.as_deref(), timeout_ms))
        .await
        .map_err(|e| format!("browse back task failed: {e}"))
}

fn back_blocking(app: &AppHandle, id: u64, until: Option<&str>, timeout_ms: Option<u64>) -> BrowseLoad {
    let started = Instant::now();
    let budget = wait_budget(timeout_ms);
    with_session(app, id, true, |window, session| {
        drain(&session.rx);
        let mark = session.next_mark();
        let from = match set_mark(window, &mark) {
            Ok(href) => href,
            Err(err) => {
                return BrowseLoad::failed(BrowseStatus::Timeout, started, format!("the page did not answer: {err}"))
            }
        };
        if let Err(err) = eval(window, "(() => { history.back(); return \"ok\"; })()", policy::EVAL_TIMEOUT) {
            return BrowseLoad::failed(BrowseStatus::Timeout, started, format!("history.back() did not run: {err}"));
        }
        let wait = Wait {
            mark: Some(mark.as_str()),
            from: Some(from.as_str()),
            until,
        };
        wait_for(window, &session.rx, &wait, budget, started)
    })
    .unwrap_or_else(|(status, detail)| BrowseLoad::failed(status, started, detail))
}

/// Run `script` in the session's page and return its value, with where the page
/// is. The script is an expression or an IIFE whose value is JSON-serialisable.
#[tauri::command]
pub async fn browse_eval(
    app: AppHandle,
    session: u64,
    script: String,
    timeout_ms: Option<u64>,
) -> Result<BrowseEval, String> {
    tauri::async_runtime::spawn_blocking(move || eval_blocking(&app, session, &script, timeout_ms))
        .await
        .map_err(|e| format!("browse eval task failed: {e}"))
}

fn eval_blocking(app: &AppHandle, id: u64, script: &str, timeout_ms: Option<u64>) -> BrowseEval {
    let started = Instant::now();
    let timeout = eval_budget(timeout_ms);
    with_session(app, id, true, |window, _session| match look(window, None, Some(script), timeout) {
        Ok(found) => BrowseEval {
            status: BrowseStatus::Ok,
            url: Some(found.url),
            title: Some(found.title),
            value: found.value.filter(|v| !v.is_null()),
            error: found.error,
            elapsed_ms: started.elapsed().as_millis() as u64,
            detail: None,
        },
        Err(err) => BrowseEval::failed(BrowseStatus::Timeout, started, err),
    })
    .unwrap_or_else(|(status, detail)| BrowseEval::failed(status, started, detail))
}

/// Scroll the session's page by `dy` CSS pixels with the page's own
/// `window.scrollBy`, and say where it ended up. One move per call; a caller that
/// wants a slow scroll makes several small ones.
#[tauri::command]
pub async fn browse_scroll(app: AppHandle, session: u64, dy: f64) -> Result<BrowseScroll, String> {
    if !dy.is_finite() {
        return Err(format!("not a scroll distance: {dy}"));
    }
    tauri::async_runtime::spawn_blocking(move || scroll_blocking(&app, session, dy))
        .await
        .map_err(|e| format!("browse scroll task failed: {e}"))
}

fn scroll_blocking(app: &AppHandle, id: u64, dy: f64) -> BrowseScroll {
    let dy = dy.clamp(-MAX_SCROLL_PX, MAX_SCROLL_PX);
    with_session(app, id, true, |window, _session| {
        match eval(window, &scroll_script(dy), policy::EVAL_TIMEOUT) {
            Ok(json) => serde_json::from_str::<BrowseScroll>(&json)
                .unwrap_or_else(|e| BrowseScroll::failed(BrowseStatus::Timeout, format!("unusable JSON: {e}"))),
            Err(err) => BrowseScroll::failed(BrowseStatus::Timeout, err),
        }
    })
    .unwrap_or_else(|(status, detail)| BrowseScroll::failed(status, detail))
}

fn drain(rx: &Receiver<LoadEvent>) {
    while rx.try_recv().is_ok() {}
}

/// What a wait is waiting for.
struct Wait<'a> {
    /// The mark the old document carries; a document without it is the new one.
    /// `None` when the mark could not be set, and then only a load event says the
    /// new document is in.
    mark: Option<&'a str>,
    /// The address before a step back. A different address also means arrived.
    from: Option<&'a str>,
    until: Option<&'a str>,
}

impl Wait<'_> {
    fn arrived(&self, look: &Look, loaded: bool) -> bool {
        let new_document = match self.mark {
            Some(_) => look.fresh,
            None => loaded,
        };
        new_document || self.from.is_some_and(|from| from != look.url)
    }

    fn done(&self, look: &Look, loaded: bool) -> bool {
        match self.until {
            Some(_) => look.ok && truthy(&look.value),
            None => {
                loaded
                    || policy::has_begun(&Ready {
                        state: look.state.clone(),
                        chars: look.chars,
                    })
            }
        }
    }
}

fn wait_for(
    window: &WebviewWindow<Wry>,
    rx: &Receiver<LoadEvent>,
    wait: &Wait<'_>,
    budget: Duration,
    started: Instant,
) -> BrowseLoad {
    let deadline = Instant::now() + budget;
    let mut loaded = false;
    // The last look at the new document, for a wait that runs out: what is there
    // is the caller's best evidence of why.
    let mut last: Option<Look> = None;
    let mut last_err: Option<String> = None;

    let finish = |status: BrowseStatus, last: Option<Look>, loaded: bool, detail: Option<String>| {
        let (url, title, value, error) = match last {
            Some(l) => (Some(l.url), Some(l.title), l.value.filter(|v| !v.is_null()), l.error),
            None => (None, None, None, None),
        };
        BrowseLoad {
            status,
            url,
            title,
            loaded,
            value,
            error,
            elapsed_ms: started.elapsed().as_millis() as u64,
            detail,
        }
    };

    loop {
        loop {
            match rx.try_recv() {
                Ok(LoadEvent::Finished) => loaded = true,
                Ok(LoadEvent::Failed(detail)) => return finish(BrowseStatus::Network, last, loaded, Some(detail)),
                Err(TryRecvError::Empty) => break,
                Err(TryRecvError::Disconnected) => {
                    return finish(BrowseStatus::Closed, last, loaded, Some("the window went away".into()))
                }
            }
        }

        let remaining = deadline.saturating_duration_since(Instant::now());
        match look(window, wait.mark, wait.until, policy::EVAL_TIMEOUT.min(remaining.max(MIN_EVAL))) {
            Ok(found) => {
                if wait.arrived(&found, loaded) {
                    let done = wait.done(&found, loaded);
                    last = Some(found);
                    if done {
                        return finish(BrowseStatus::Ok, last, loaded, None);
                    }
                }
            }
            Err(err) => last_err = Some(err),
        }

        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            let detail = match (&last, wait.until) {
                (None, _) => Some(format!(
                    "the new document never answered within {}s{}",
                    budget.as_secs(),
                    last_err.map(|e| format!(" ({e})")).unwrap_or_default()
                )),
                (Some(_), Some(_)) => Some(format!("`until` was not met within {}s", budget.as_secs())),
                (Some(_), None) => Some(format!("no load event within {}s", budget.as_secs())),
            };
            return finish(BrowseStatus::Timeout, last, loaded, detail);
        }
        match rx.recv_timeout(remaining.min(POLL)) {
            Ok(LoadEvent::Finished) => loaded = true,
            Ok(LoadEvent::Failed(detail)) => return finish(BrowseStatus::Network, last, loaded, Some(detail)),
            Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => {
                return finish(BrowseStatus::Closed, last, loaded, Some("the window went away".into()))
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn truthiness_is_javascripts() {
        for v in [json!(true), json!(1), json!(-0.5), json!("x"), json!([]), json!({})] {
            assert!(truthy(&Some(v.clone())), "{v}");
        }
        for v in [json!(false), json!(0), json!(""), json!(null)] {
            assert!(!truthy(&Some(v.clone())), "{v}");
        }
        assert!(!truthy(&None));
    }

    #[test]
    fn the_template_names_each_placeholder_once() {
        let template = include_str!("browse.js");
        assert_eq!(template.matches("__RP_MARK__").count(), 1);
        assert_eq!(template.matches("__RP_SCRIPT__").count(), 1);
    }

    /// The mark goes in before the script, so a script that mentions the mark's
    /// placeholder keeps it, and a multi-line script stays in one piece.
    #[test]
    fn the_script_goes_in_last_and_whole() {
        let script = "(function () {\n  return \"__RP_MARK__\";\n})()";
        let js = look_script(Some("m-1"), Some(script));
        assert!(js.contains("window.__rpBrowseMark !== \"m-1\""));
        assert!(js.contains("return \"__RP_MARK__\";"));
        for line in js.lines() {
            if line.trim_start().starts_with("//") {
                assert!(!line.contains("return"), "script spilled into a comment: {line}");
            }
        }
        let bare = look_script(None, None);
        assert!(bare.contains("window.__rpBrowseMark !== null"));
        assert!(bare.contains("const value = (null);"));
    }

    #[test]
    fn budgets_are_clamped() {
        assert_eq!(wait_budget(None), DEFAULT_WAIT);
        assert_eq!(wait_budget(Some(1)), MIN_WAIT);
        assert_eq!(wait_budget(Some(10_000_000)), MAX_WAIT);
        assert_eq!(idle_window(None), DEFAULT_IDLE);
        assert_eq!(idle_window(Some(1)), MIN_IDLE);
        assert_eq!(idle_window(Some(u64::MAX)), MAX_IDLE);
        assert_eq!(eval_budget(Some(0)), MIN_EVAL);
    }

    fn look_at(url: &str, fresh: bool, value: serde_json::Value) -> Look {
        Look {
            url: url.into(),
            title: String::new(),
            state: "interactive".into(),
            chars: 10,
            fresh,
            ok: true,
            value: Some(value),
            error: None,
        }
    }

    #[test]
    fn the_old_document_never_ends_a_navigation() {
        let wait = Wait {
            mark: Some("m"),
            from: None,
            until: Some("1"),
        };
        // Still the page being left: its posts are not the new page's posts.
        let old = look_at("https://x.com/search?q=a", false, json!(12));
        assert!(!wait.arrived(&old, false));
        // Even after a load event — the mark is the better witness.
        assert!(!wait.arrived(&old, true));
        let new = look_at("https://x.com/search?q=a", true, json!(12));
        assert!(wait.arrived(&new, false));
        assert!(wait.done(&new, false));
        let empty = look_at("https://x.com/search?q=a", true, json!(0));
        assert!(!wait.done(&empty, false));
    }

    #[test]
    fn without_a_mark_only_a_load_event_says_the_document_is_new() {
        let wait = Wait {
            mark: None,
            from: None,
            until: Some("1"),
        };
        let page = look_at("https://example.com/", true, json!(true));
        assert!(!wait.arrived(&page, false));
        assert!(wait.arrived(&page, true));
    }

    #[test]
    fn a_step_back_inside_the_page_arrives_on_the_address() {
        let wait = Wait {
            mark: Some("m"),
            from: Some("https://x.com/a/status/1"),
            until: None,
        };
        // Same document (still marked), new address: an in-page history entry.
        let moved = look_at("https://x.com/search?q=a", false, json!(null));
        assert!(wait.arrived(&moved, false));
        let stayed = look_at("https://x.com/a/status/1", false, json!(null));
        assert!(!wait.arrived(&stayed, false));
    }

    #[test]
    fn without_until_a_rendered_document_is_enough() {
        let wait = Wait {
            mark: Some("m"),
            from: None,
            until: None,
        };
        let mut page = look_at("https://example.com/", true, json!(null));
        page.chars = policy::READY_MIN_CHARS;
        assert!(wait.done(&page, false));
        page.chars = 0;
        assert!(!wait.done(&page, false));
        assert!(wait.done(&page, true));
    }

    #[test]
    fn a_scroll_reads_back() {
        let parsed: BrowseScroll =
            serde_json::from_str(r#"{"before":0,"after":630,"height":4000,"viewport":900}"#).unwrap();
        assert_eq!(parsed.status, BrowseStatus::Ok);
        assert_eq!(parsed.after, 630.0);
        assert!(scroll_script(-12.5).contains("window.scrollBy(0, -12.5)"));
    }

    #[test]
    fn a_probe_plan_reads() {
        let plan: ProbePlan = serde_json::from_str(
            r#"{"idleTimeoutMs":60000,"steps":[
                {"op":"navigate","url":"https://example.com/","until":"1","timeoutMs":5000},
                {"op":"eval","script":"1","stopIf":"halt"},
                {"op":"scroll","screens":0.3},
                {"op":"sleep","ms":10,"charsPerSecond":15,"charsFrom":"newChars","maxMs":100},
                {"op":"back"},
                {"op":"signIn","url":"https://x.com/i/flow/login"},
                {"op":"check","url":"https://x.com/"}
            ]}"#,
        )
        .unwrap();
        assert_eq!(plan.steps.len(), 7);
        assert!(plan.init_script.is_none());
        let with: ProbePlan = serde_json::from_str(r#"{"initScript":"(() => 1)()"}"#).unwrap();
        assert_eq!(with.init_script.as_deref(), Some("(() => 1)()"));
        assert!(matches!(&plan.steps[1], ProbeStep::Eval { stop_if: Some(f), .. } if f == "halt"));
        assert!(matches!(&plan.steps[3], ProbeStep::Sleep { chars_from: Some(_), max_ms: Some(100), .. }));
    }
}

/// One step of a probe plan (`run_probe_from_env`).
#[derive(Debug, serde::Deserialize)]
#[serde(tag = "op", rename_all = "camelCase", rename_all_fields = "camelCase")]
enum ProbeStep {
    Navigate {
        url: String,
        until: Option<String>,
        timeout_ms: Option<u64>,
    },
    Back {
        until: Option<String>,
        timeout_ms: Option<u64>,
    },
    /// Run a script. With `stop_if`, a truthy field of that name on the value
    /// ends the plan here: the page said something the plan must not read past.
    Eval {
        script: String,
        stop_if: Option<String>,
    },
    /// Scroll by `dy` pixels, or by `screens` of the page's own height.
    Scroll {
        dy: Option<f64>,
        screens: Option<f64>,
    },
    /// Wait `ms`, plus — with `chars_per_second` and `chars_from` — the time it
    /// takes to read as many characters as the last value says in its field
    /// `chars_from`, the whole capped at `max_ms`.
    Sleep {
        ms: u64,
        chars_per_second: Option<f64>,
        chars_from: Option<String>,
        max_ms: Option<u64>,
    },
    /// Open the visible sign-in window on `url` and wait for the person at the
    /// screen to close it. Never under Xvfb: nobody is there to close it.
    SignIn { url: String },
    /// `check_site_session` on `url`.
    Check { url: String },
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProbePlan {
    idle_timeout_ms: Option<u64>,
    viewport: Option<[f64; 2]>,
    /// The session's document-start script, as `browse_open` takes it.
    init_script: Option<String>,
    #[serde(default)]
    steps: Vec<ProbeStep>,
}

fn probe_line(step: usize, op: &str, result: serde_json::Value) {
    println!(
        "RP-BROWSE {}",
        serde_json::json!({ "step": step, "op": op, "at": super::unix_millis(), "result": result })
    );
}

fn probe_value<T: serde::Serialize, E: std::fmt::Display>(out: Result<T, E>) -> serde_json::Value {
    match out {
        Ok(value) => serde_json::to_value(&value).unwrap_or_default(),
        Err(err) => serde_json::json!({ "error": err.to_string() }),
    }
}

/// Dev-only end-to-end check of the browse session against a live site.
/// `RP_WEBVIEW_BROWSE_PROBE=<plan.json>` runs the plan's steps through one
/// session at startup, prints one `RP-BROWSE` JSON line per step and exits.
/// The plan is `{ "idleTimeoutMs"?, "steps": [ { "op": "navigate" | "back" |
/// "eval" | "scroll" | "sleep" | "signIn" | "check", … } ] }`, fields as in
/// `ProbeStep`. scripts/x-search-probe.ts writes the plans for X search and
/// reads the lines back.
///
/// lib.rs hides the app's own window and sends it to `about:blank` first: a
/// probe has no use for the frontend, and a debug build's frontend is whatever
/// dev server answers on the dev port. Run it with a data directory of its own
/// (`XDG_DATA_HOME`), and under Xvfb except for a sign-in plan, which is the one
/// that needs a person and a screen.
pub fn run_probe_from_env(app: &AppHandle) {
    let Ok(path) = std::env::var("RP_WEBVIEW_BROWSE_PROBE") else {
        return;
    };
    let app = app.clone();
    std::thread::spawn(move || {
        if path == "-" {
            run_stdin(&app);
            app.exit(0);
            return;
        }
        let plan: Result<ProbePlan, String> = std::fs::read_to_string(&path)
            .map_err(|e| e.to_string())
            .and_then(|text| serde_json::from_str(&text).map_err(|e| e.to_string()));
        match plan {
            Ok(plan) => {
                run_plan(&app, plan);
                app.exit(0);
            }
            Err(err) => {
                println!("RP-BROWSE {}", serde_json::json!({ "error": format!("plan {path}: {err}") }));
                app.exit(2);
            }
        }
    });
}

/// `RP_WEBVIEW_BROWSE_PROBE=-`: the plan comes in on stdin one JSON line at a
/// time, so a driver can choose each step from the last answer
/// (scripts/x-reader-live.ts runs the topic-search reader this way). The first
/// line is the plan without steps (`idleTimeoutMs`, `viewport`, `initScript`); every line after
/// it is one step, answered by one `RP-BROWSE` line. End of input closes the
/// session.
fn run_stdin(app: &AppHandle) {
    use std::io::BufRead;
    let mut lines = std::io::stdin().lock().lines();
    let header: ProbePlan = match lines.next() {
        Some(Ok(text)) => match serde_json::from_str(&text) {
            Ok(plan) => plan,
            Err(err) => {
                println!("RP-BROWSE {}", serde_json::json!({ "error": format!("header: {err}") }));
                return;
            }
        },
        _ => return,
    };
    let opened = open_blocking(app, header.idle_timeout_ms, header.viewport, header.init_script.as_deref());
    probe_line(0, "open", serde_json::to_value(&opened).unwrap_or_default());
    let Some(id) = opened.session else {
        return;
    };
    let mut run = ProbeRun::default();
    for (i, line) in lines.enumerate() {
        let Ok(text) = line else { break };
        if text.trim().is_empty() {
            continue;
        }
        match serde_json::from_str::<ProbeStep>(&text) {
            Ok(step) => {
                if !run.step(app, id, i + 1, step) {
                    break;
                }
            }
            Err(err) => probe_line(i + 1, "error", serde_json::json!({ "error": err.to_string() })),
        }
    }
    let closed = close_blocking(app, id);
    probe_line(0, "close", serde_json::json!({ "closed": closed }));
}

fn run_plan(app: &AppHandle, plan: ProbePlan) {
    let opened = open_blocking(app, plan.idle_timeout_ms, plan.viewport, plan.init_script.as_deref());
    probe_line(0, "open", serde_json::to_value(&opened).unwrap_or_default());
    let Some(id) = opened.session else {
        return;
    };
    let mut run = ProbeRun::default();
    for (i, step) in plan.steps.into_iter().enumerate() {
        if !run.step(app, id, i + 1, step) {
            break;
        }
    }
    let closed = close_blocking(app, id);
    probe_line(0, "close", serde_json::json!({ "closed": closed }));
}

/// What a probe carries from one step to the next.
#[derive(Default)]
struct ProbeRun {
    last_value: Option<serde_json::Value>,
    viewport: Option<f64>,
}

impl ProbeRun {
    /// Run one step and print its line. False ends the plan.
    fn step(&mut self, app: &AppHandle, id: u64, n: usize, step: ProbeStep) -> bool {
        let last_value = &mut self.last_value;
        let viewport = &mut self.viewport;
        match step {
            ProbeStep::Navigate { url, until, timeout_ms } => {
                let result = match policy::validate_target(&url) {
                    Ok(target) => {
                        let load = navigate_blocking(app, id, &target, until.as_deref(), timeout_ms);
                        *last_value = load.value.clone();
                        serde_json::to_value(&load).unwrap_or_default()
                    }
                    Err(err) => serde_json::json!({ "status": "rejected", "detail": err }),
                };
                probe_line(n, "navigate", result);
            }
            ProbeStep::Back { until, timeout_ms } => {
                let load = back_blocking(app, id, until.as_deref(), timeout_ms);
                *last_value = load.value.clone();
                probe_line(n, "back", serde_json::to_value(&load).unwrap_or_default());
            }
            ProbeStep::Eval { script, stop_if } => {
                let out = eval_blocking(app, id, &script, None);
                *last_value = out.value.clone();
                probe_line(n, "eval", serde_json::to_value(&out).unwrap_or_default());
                let hit = stop_if
                    .as_deref()
                    .and_then(|field| out.value.as_ref().and_then(|v| v.get(field)).cloned().map(|v| (field, v)));
                if let Some((field, value)) = hit {
                    if truthy(&Some(value.clone())) {
                        probe_line(n, "stop", serde_json::json!({ "field": field, "value": value }));
                        return false;
                    }
                }
                if out.status == BrowseStatus::Closed {
                    return false;
                }
            }
            ProbeStep::Scroll { dy, screens } => {
                let px = match (dy, screens) {
                    (Some(dy), _) => Some(dy),
                    (None, Some(screens)) => {
                        if viewport.is_none() {
                            let out = eval_blocking(app, id, "window.innerHeight", None);
                            *viewport = out.value.and_then(|v| v.as_f64());
                        }
                        viewport.map(|h| h * screens)
                    }
                    (None, None) => None,
                };
                let result = match px {
                    Some(px) if px.is_finite() => {
                        let moved = scroll_blocking(app, id, px);
                        if moved.viewport > 0.0 {
                            *viewport = Some(moved.viewport);
                        }
                        serde_json::to_value(&moved).unwrap_or_default()
                    }
                    _ => serde_json::json!({ "status": "rejected", "detail": "no distance" }),
                };
                probe_line(n, "scroll", result);
            }
            ProbeStep::Sleep {
                ms,
                chars_per_second,
                chars_from,
                max_ms,
            } => {
                let chars = chars_from
                    .as_deref()
                    .and_then(|field| last_value.as_ref().and_then(|v| v.get(field)).and_then(|v| v.as_f64()))
                    .unwrap_or(0.0);
                let reading = match chars_per_second {
                    Some(cps) if cps > 0.0 => (chars.max(0.0) / cps * 1000.0) as u64,
                    _ => 0,
                };
                let total = (ms + reading).min(max_ms.unwrap_or(u64::MAX));
                probe_line(n, "sleep", serde_json::json!({ "ms": total, "chars": chars }));
                std::thread::sleep(Duration::from_millis(total));
            }
            ProbeStep::SignIn { url } => {
                let out = tauri::async_runtime::block_on(super::session::open_site_sign_in(app.clone(), url));
                probe_line(n, "signIn", probe_value(out));
            }
            ProbeStep::Check { url } => {
                let out = tauri::async_runtime::block_on(super::session::check_site_session(app.clone(), url));
                probe_line(n, "check", probe_value(out));
            }
        }
        true
    }
}
