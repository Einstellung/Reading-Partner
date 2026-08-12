// Fetching an article the only way some sites can be read: with a real browser
// engine (docs/17, "订阅 webview 按需抽取").
//
// Bloomberg's article pages are behind PerimeterX. A bare HTTP request gets a
// 403 and so does a fresh webview — measured 2026-08-11 in WebKitGTK 2.52.3,
// the same engine Tauri uses on Linux: three article URLs opened in a cold
// profile, three captcha pages ("Bloomberg - Are you a robot?"). Load
// `https://www.bloomberg.com/` first in the same profile and the jar ends up
// with 82 cookies; the same three articles then return 200 with a complete
// `<article>`. So this module is built around two things that are not
// optimisations: a cookie jar that survives restarts, and a homepage warm-up
// before the first article of a site.
//
// The shape: a hidden WebviewWindow (never `visible`) loads the page, injected
// JS reads the rendered DOM back out, the window is destroyed. Every decision it
// makes — which URLs are allowed, when to warm up, what a readout means — lives
// in policy.rs with unit tests; this file is the windows, the timers and the
// platform glue.
//
// Scope: desktop, and in practice Linux. The DOM comes back through
// WebKitGTK's own `run_javascript` callback, because Tauri's `eval` is
// fire-and-forget and the alternative — letting the remote page talk to us over
// Tauri's IPC — would mean putting bloomberg.com in a capability's `remote`
// list, i.e. handing a page we do not control a door into the app's commands.
// macOS and Windows build and return `unsupported` until someone writes the
// equivalent bridge (WKWebView `evaluateJavaScript`, WebView2
// `ExecuteScriptAsync`).
//
// iOS: not attempted, not compiled. It is a different network stack (WKWebView
// with ITP, which partitions and expires third-party cookie state far more
// aggressively) and the warm-up assumption above is exactly the thing ITP is
// designed to break. Nothing here was verified there. TODO(M-info-3): decide
// whether iOS fetches articles at all or reads what the desktop already
// extracted, once sync carries article bodies.

use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::webview::PageLoadEvent;
use tauri::{AppHandle, Manager, Runtime, Url, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

pub mod jar;
pub mod policy;
pub mod session;

use policy::{Phase, Readout, Status};

/// Label prefix for the hidden windows. Every live one is also registered in
/// `WebviewFetchState::live`; navigation.rs checks that registry, not this
/// prefix, before it lets a webview leave the app's origin.
const LABEL_PREFIX: &str = "webview-fetch-";

/// Sub-directory of the app data dir that holds the fetcher's profile: cookie
/// jar, cache, local storage. Separate from the app's own webview profile on
/// purpose — this jar holds sessions for third-party sites and is fed by pages
/// the app does not control, so it has no business sitting in the same store as
/// the app's own origin.
const PROFILE_DIR: &str = "webview-fetch-profile";

/// Everything the fetcher keeps between calls.
#[derive(Default)]
pub struct WebviewFetchState {
    /// Labels of the windows the fetcher owns right now — the hidden ones and
    /// the visible sign-in window. Read by the navigation guard.
    pub(crate) live: Mutex<HashSet<String>>,
    /// Which origins have been warmed, and when.
    ledger: Mutex<policy::WarmupLedger>,
    /// One fetch at a time. Two hidden windows sharing one cookie jar while a
    /// bot-detection script writes to it is not a race worth debugging, and the
    /// caller (a briefing run walking a feed) has no reason to parallelise.
    pub(crate) gate: Mutex<()>,
    seq: AtomicU64,
}

impl WebviewFetchState {
    pub(crate) fn next_label(&self) -> String {
        format!("{LABEL_PREFIX}{}", self.seq.fetch_add(1, Ordering::Relaxed))
    }
}

/// Whether a window label belongs to the fetcher at all, live or not.
///
/// The registry below is what grants a window the navigation exemption. This is
/// the backstop for the sliver between a fetch ending and its window actually
/// going away: a navigation queued in that window would then be judged by the
/// app's rule, and the app's rule hands a web link to the system browser. A
/// hidden window driven by a third-party page must never open anything on the
/// user's desktop, so navigation.rs refuses to hand off for any label of ours.
pub fn is_fetch_label(label: &str) -> bool {
    label.starts_with(LABEL_PREFIX)
}

/// Whether this webview is one of the fetcher's hidden windows.
///
/// The navigation guard uses this to widen its rule for exactly these windows.
/// Membership is written here and nowhere else: a label is inserted right before
/// the window is built and removed when it is destroyed, so a webview the
/// fetcher did not create can never match — not by being named like one, not by
/// navigating anywhere. When the state is missing (mobile, or before setup) this
/// answers `false`, which leaves the strict rule in force.
pub fn is_fetch_webview<R: Runtime>(webview: &tauri::Webview<R>) -> bool {
    let Some(state) = webview.try_state::<WebviewFetchState>() else {
        return false;
    };
    let label = webview.label().to_string();
    state
        .live
        .lock()
        .map(|live| live.contains(&label))
        .unwrap_or(false)
}

/// The result handed back to the frontend. The failures stay apart: `blocked`
/// means a bot wall answered (retrying now is pointless; a real session or a
/// fresh warm-up might help), `timeout` means the page never settled (retrying
/// may well work), `network` means it never loaded at all.
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FetchResult {
    pub status: Status,
    pub requested_url: String,
    /// Where the webview ended up, redirects included.
    pub final_url: Option<String>,
    pub title: Option<String>,
    /// The article's own paragraphs, joined.
    pub text: Option<String>,
    /// Those paragraphs' markup, for the extraction stack.
    pub html: Option<String>,
    /// Which selector produced the body.
    pub selector: Option<String>,
    /// Inline "Read More:" promo lines dropped from the body.
    pub promos_dropped: usize,
    /// Whether the page still showed a way to sign in — i.e. whether this body
    /// came back as an anonymous reader or as the signed-in one.
    pub sees_sign_in: bool,
    /// `application/ld+json` blocks from the page.
    pub ld_json: Vec<String>,
    pub chars: usize,
    /// Whether this call paid for a homepage warm-up.
    pub warmed: bool,
    pub elapsed_ms: u64,
    /// Human-readable reason, for the failures and for diagnosing a site whose
    /// markup moved.
    pub detail: Option<String>,
}

impl FetchResult {
    fn failed(status: Status, url: &str, detail: impl Into<String>, started: Instant) -> Self {
        Self {
            status,
            requested_url: url.to_string(),
            final_url: None,
            title: None,
            text: None,
            html: None,
            selector: None,
            promos_dropped: 0,
            sees_sign_in: false,
            ld_json: Vec::new(),
            chars: 0,
            warmed: false,
            elapsed_ms: started.elapsed().as_millis() as u64,
            detail: Some(detail.into()),
        }
    }
}

/// Render `url` in a hidden webview and return its article body.
///
/// Errors (`Err`) are the caller's mistakes — a URL this must never load. A page
/// that refuses to give up an article is a successful call with a `status` that
/// says which way it refused.
#[tauri::command]
pub async fn fetch_article_via_webview(
    app: AppHandle,
    url: String,
) -> Result<FetchResult, String> {
    let target = policy::validate_target(&url)?;
    tauri::async_runtime::spawn_blocking(move || fetch_blocking(&app, target))
        .await
        .map_err(|e| format!("webview fetch task failed: {e}"))
}

fn fetch_blocking<R: Runtime>(app: &AppHandle<R>, target: Url) -> FetchResult {
    let started = Instant::now();
    let requested = target.to_string();

    if !cfg!(target_os = "linux") {
        return FetchResult::failed(
            Status::Unsupported,
            &requested,
            "the webview fetcher only has a DOM bridge on Linux so far",
            started,
        );
    }

    let state = match app.try_state::<WebviewFetchState>() {
        Some(state) => state,
        None => {
            return FetchResult::failed(
                Status::Unsupported,
                &requested,
                "webview fetch state is not registered",
                started,
            )
        }
    };
    // Serialised on purpose (see WebviewFetchState::gate).
    let _gate = state.gate.lock().unwrap_or_else(|e| e.into_inner());

    let profile = match profile_dir(app) {
        Ok(dir) => dir,
        Err(err) => return FetchResult::failed(Status::Unsupported, &requested, err, started),
    };

    let origin = policy::origin_key(&target);
    let mut warmed = false;

    // Warm-up. The homepage load is what puts the bot-detection cookies in the
    // jar; without it the article is a captcha page, every time. When it is
    // done is decided by the jar and not by the homepage's load event, which on
    // the site this exists for arrives about a third of the time (jar.rs).
    if let Some(home) = policy::warmup_target(&target) {
        let needs = state
            .ledger
            .lock()
            .map(|l| l.needs_warmup(&origin, Instant::now()))
            .unwrap_or(true);
        if needs {
            warmed = true;
            let outcome = run_page(app, &state, &profile, &home, Phase::Warmup, started);
            match outcome.status {
                Status::Ok | Status::Empty => {
                    // The homepage rendered and was not a wall: the jar is as
                    // good as the spike's. `Empty` is normal here — a homepage
                    // has no `<article>`.
                    if let Ok(mut ledger) = state.ledger.lock() {
                        ledger.record(&origin, Instant::now());
                    }
                }
                other => {
                    // A wall on the homepage means the article has no chance,
                    // and the reason is more useful than whatever the article
                    // page would say.
                    let mut result = FetchResult::failed(
                        other,
                        &requested,
                        format!(
                            "warm-up of {home} failed: {}",
                            outcome.detail.unwrap_or_else(|| "no detail".into())
                        ),
                        started,
                    );
                    result.warmed = true;
                    return result;
                }
            }
        }
    }

    let outcome = run_page(app, &state, &profile, &target, Phase::Article, started);
    if outcome.status == Status::Blocked {
        // The jar we were trusting is no longer accepted; make the next attempt
        // warm again instead of repeating this one.
        if let Ok(mut ledger) = state.ledger.lock() {
            ledger.forget(&origin);
        }
    }

    let readout = outcome.readout.unwrap_or_default();
    // A bot wall has text — 467 characters of "click the box below to let us
    // know you're not a robot" — and none of it is an article. Returning it
    // would put the wall into whatever reads this next, so a blocked result
    // carries only what says why: the title and the detail.
    let body = outcome.status != Status::Blocked;
    FetchResult {
        status: outcome.status,
        requested_url: requested,
        final_url: (!readout.url.is_empty()).then(|| readout.url.clone()),
        title: (!readout.title.is_empty()).then(|| readout.title.clone()),
        chars: if body { readout.text.chars().count() } else { 0 },
        text: (body && !readout.text.is_empty())
            .then(|| policy::truncate_chars(&readout.text, policy::MAX_TEXT_CHARS)),
        html: (body && !readout.html.is_empty())
            .then(|| policy::truncate_chars(&readout.html, policy::MAX_HTML_CHARS)),
        selector: (!readout.selector.is_empty()).then(|| readout.selector.clone()),
        promos_dropped: readout.promos_dropped,
        sees_sign_in: readout.sees_sign_in,
        ld_json: if body { readout.ld_json } else { Vec::new() },
        warmed,
        elapsed_ms: started.elapsed().as_millis() as u64,
        detail: outcome.detail,
    }
}

pub(crate) struct PageOutcome {
    pub(crate) status: Status,
    readout: Option<Readout>,
    pub(crate) detail: Option<String>,
}

impl PageOutcome {
    fn failed(status: Status, detail: impl Into<String>) -> Self {
        Self {
            status,
            readout: None,
            detail: Some(detail.into()),
        }
    }
}

/// What the webview reports about a load, from Tauri's page-load hook and (on
/// Linux) WebKit's `load-failed` signal.
pub(crate) enum LoadEvent {
    /// The document reached `finished`. Which document it was is not carried:
    /// the extractor reports `location.href` itself, so redirects are visible in
    /// the readout rather than in this channel.
    Finished,
    Failed(String),
}

fn run_page<R: Runtime>(
    app: &AppHandle<R>,
    state: &tauri::State<'_, WebviewFetchState>,
    profile: &PathBuf,
    target: &Url,
    phase: Phase,
    started: Instant,
) -> PageOutcome {
    let label = state.next_label();
    // Registered before the window exists, so the navigation guard already knows
    // this label by the time the first navigation is decided.
    if let Ok(mut live) = state.live.lock() {
        live.insert(label.clone());
    }
    let guard = LiveGuard {
        app: app.clone(),
        label: label.clone(),
    };

    let (tx, rx) = mpsc::channel::<LoadEvent>();
    let window = match build_window(app, &label, profile, tx.clone(), Chrome::hidden()) {
        Ok(window) => window,
        Err(err) => return PageOutcome::failed(Status::Network, format!("window failed: {err}")),
    };

    // Signals first, navigation second: the window is created blank so a load
    // that fails in the first milliseconds still has somewhere to report, and
    // so nothing the page does can reach the screen.
    connect_engine_signals(&window, tx);

    if let Err(err) = window.navigate(target.clone()) {
        return PageOutcome::failed(Status::Network, format!("navigate failed: {err}"));
    }

    // The two phases wait for different things. An article is wanted for its
    // DOM, so it waits for the page. A warm-up is wanted for its cookies, and
    // those land in the jar long before the homepage reports itself loaded —
    // often when it never reports at all (jar.rs).
    //
    // RP-LOAD is only printed where a load event actually arrived. A warm-up
    // that ended on the jar never got one, and jar.rs traces that path itself.
    let navigated = Instant::now();
    let outcome = match phase {
        Phase::Warmup => match jar::wait_for_warm_jar(&rx, profile, target, started) {
            Ok(jar::Warm::Loaded) => {
                trace_load(phase, target, navigated);
                settle_and_extract(&window, &rx, phase, started)
            }
            Ok(jar::Warm::Jar(report)) => warmed_by_jar(&window, target, report),
            Err(outcome) => outcome,
        },
        Phase::Article => match wait_for_load(&rx, policy::LOAD_TIMEOUT, started) {
            Ok(()) => {
                trace_load(phase, target, navigated);
                settle_and_extract(&window, &rx, phase, started)
            }
            Err(outcome) => outcome,
        },
    };

    drop(guard);
    outcome
}

/// End a warm-up that the cookie jar answered for.
///
/// There is nothing to settle: the page may still be loading, and a homepage
/// has no article to wait for anyway. The one thing still worth asking is
/// whether the homepage is itself a bot wall, which is a better answer than the
/// article's would be — so the document is read once, and only when the jar
/// settled while the page was alive. After a load timeout the page has spent a
/// minute not answering and asking it for a DOM only buys another `EVAL_TIMEOUT`
/// of the same silence. A page too broken to read is not a failure here either:
/// a warm jar is a warm jar.
/// Dev-only: record how long the navigation took to report itself loaded.
/// Only called where a load event really arrived (docs/pitfall/114).
fn trace_load(phase: Phase, target: &Url, navigated: Instant) {
    if trace_config().is_none() {
        return;
    }
    println!(
        "RP-LOAD {}",
        serde_json::json!({
            "phase": if phase == Phase::Warmup { "warmup" } else { "article" },
            "url": target.to_string(),
            "loadMs": navigated.elapsed().as_millis() as u64,
            "at": unix_millis(),
        })
    );
}

fn warmed_by_jar<R: Runtime>(
    window: &WebviewWindow<R>,
    target: &Url,
    report: jar::Report,
) -> PageOutcome {
    eprintln!("webview-fetch: {target} warmed without a load event — {report}");
    if report.settled {
        if let Ok(readout) = extract(window) {
            if policy::looks_blocked(&readout) {
                return PageOutcome {
                    status: Status::Blocked,
                    detail: Some(format!("bot wall: {}", readout.title)),
                    readout: Some(readout),
                };
            }
        }
    }
    // `Empty` and not `Ok`: nothing was extracted, and a warm-up is allowed to
    // come back empty — that is what a homepage does.
    PageOutcome {
        status: Status::Empty,
        readout: None,
        detail: Some(report.to_string()),
    }
}

/// Removes the label from the live set and destroys the window, whichever way
/// the fetch ends. A hidden window that outlives its fetch would keep a
/// navigation exemption alive with it.
pub(crate) struct LiveGuard<R: Runtime> {
    pub(crate) app: AppHandle<R>,
    pub(crate) label: String,
}

impl<R: Runtime> Drop for LiveGuard<R> {
    fn drop(&mut self) {
        if let Some(window) = self.app.get_webview_window(&self.label) {
            if let Err(err) = window.destroy() {
                eprintln!("webview-fetch: failed to destroy {}: {err}", self.label);
            }
        }
        if let Some(state) = self.app.try_state::<WebviewFetchState>() {
            if let Ok(mut live) = state.live.lock() {
                live.remove(&self.label);
            }
        }
    }
}

/// Whether the window is the fetcher's own (hidden, and never shown) or the
/// sign-in window, which exists to be looked at and typed into.
pub(crate) struct Chrome<'a> {
    pub visible: bool,
    pub title: &'a str,
}

impl Chrome<'_> {
    /// The hidden fetch window. Created invisible, never shown, destroyed with
    /// the fetch.
    pub(crate) fn hidden() -> Self {
        Self { visible: false, title: "" }
    }
}

pub(crate) fn build_window<R: Runtime>(
    app: &AppHandle<R>,
    label: &str,
    profile: &PathBuf,
    tx: Sender<LoadEvent>,
    chrome: Chrome<'_>,
) -> tauri::Result<WebviewWindow<R>> {
    let sender = Mutex::new(tx);
    let visible = chrome.visible;
    // `about:blank` costs nothing to load and is what tauri-runtime-wry treats
    // as "no initial URL"; the real navigation happens once the failure signal
    // is connected.
    let blank = Url::parse("about:blank").expect("about:blank parses");
    WebviewWindowBuilder::new(app, label, WebviewUrl::External(blank))
        // A fetch window is created hidden and never shown; nothing in this
        // module calls show() on one. The sign-in window is the exception, and
        // it is one the user asked for.
        .visible(visible)
        .focused(visible)
        .skip_taskbar(!visible)
        .title(chrome.title)
        .inner_size(policy::VIEWPORT.0, policy::VIEWPORT.1)
        .user_agent(policy::USER_AGENT)
        // The point of the exercise: one jar, on disk, shared by every window
        // the fetcher opens. tauri-runtime-wry keys its WebContext by this path
        // and wry points WebKit's cookie manager at `<dir>/cookies` with
        // persistent storage on, so the warm-up survives both the window that
        // did it and the process it ran in.
        .data_directory(profile.clone())
        .incognito(false)
        // A page in a fetch window may not open windows or download files: it is
        // loaded to be read, not to act. The sign-in window has to allow the
        // popup, because that is what "continue with Google" is.
        .on_new_window(move |_url, _features| {
            if visible {
                tauri::webview::NewWindowResponse::Allow
            } else {
                tauri::webview::NewWindowResponse::Deny
            }
        })
        .on_download(|_webview, _event| false)
        .on_page_load(move |_window, payload| {
            if payload.event() != PageLoadEvent::Finished {
                return;
            }
            // The blank bootstrap document is not the page we are waiting for.
            if payload.url().as_str() == "about:blank" {
                return;
            }
            if let Ok(tx) = sender.lock() {
                let _ = tx.send(LoadEvent::Finished);
            }
        })
        .build()
}

/// Wire up the two things the window needs from the engine itself: a report
/// when a load fails, and a lid on everything WebKitGTK would otherwise put on
/// the screen.
///
/// Failures first. WebKit tells us about TLS, connection and cancelled-policy
/// failures; Tauri's page-load hook does not, so without this a broken host
/// would look exactly like a slow one. It does not cover everything: a hostname
/// that does not resolve produces no event at all in WebKitGTK 2.52 (measured:
/// `load-changed started` and then nothing for 25s), so DNS failures surface as
/// timeouts. See docs/pitfall/109.
///
/// Then the lid. A GTK webview is wired to the desktop by default: `alert()`,
/// `confirm()` and `prompt()` open a modal dialog, `window.print()` opens the
/// print dialog, a file input opens a file chooser, `Notification` posts a
/// desktop notification, and an HTTP 401 can open an auth prompt. wry connects
/// none of those signals (checked in wry 0.55's webkitgtk backend), so the
/// engine's own default handler runs — and the default handler puts a window on
/// the user's screen. The whole point of this module is that a page we fetch in
/// the background is never seen, so each of those is answered here with "handled,
/// and the answer is no".
#[cfg(target_os = "linux")]
pub(crate) fn connect_engine_signals<R: Runtime>(window: &WebviewWindow<R>, tx: Sender<LoadEvent>) {
    let _ = window.with_webview(move |platform| {
        use webkit2gtk::{
            AuthenticationRequestExt, FileChooserRequestExt, PermissionRequestExt, WebViewExt,
        };
        let view = platform.inner();

        view.connect_load_failed(move |_view, _event, uri, error| {
            let _ = tx.send(LoadEvent::Failed(format!("{uri}: {error}")));
            // Let WebKit render its own error page; we are about to give up
            // anyway and the document is never shown.
            false
        });

        // Returning true means "handled": the default handler, the one that
        // would show something, does not run.
        view.connect_script_dialog(|_view, dialog| {
            dialog.close();
            true
        });
        view.connect_run_file_chooser(|_view, request| {
            request.cancel();
            true
        });
        view.connect_permission_request(|_view, request| {
            request.deny();
            true
        });
        view.connect_authenticate(|_view, request| {
            request.cancel();
            true
        });
        view.connect_show_notification(|_view, _notification| true);
        view.connect_print(|_view, _operation| true);
    });
}

#[cfg(not(target_os = "linux"))]
pub(crate) fn connect_engine_signals<R: Runtime>(_window: &WebviewWindow<R>, _tx: Sender<LoadEvent>) {}

/// Wait for the page to reach `finished`, or for a reason it never will.
pub(crate) fn wait_for_load(
    rx: &Receiver<LoadEvent>,
    timeout: Duration,
    started: Instant,
) -> Result<(), PageOutcome> {
    let deadline = Instant::now() + timeout;
    loop {
        if started.elapsed() > policy::OVERALL_TIMEOUT {
            return Err(PageOutcome::failed(
                Status::Timeout,
                "overall fetch budget exhausted",
            ));
        }
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            return Err(PageOutcome::failed(
                Status::Timeout,
                format!("no load event within {}s", timeout.as_secs()),
            ));
        }
        match rx.recv_timeout(remaining.min(Duration::from_secs(1))) {
            Ok(LoadEvent::Finished) => return Ok(()),
            Ok(LoadEvent::Failed(detail)) => {
                return Err(PageOutcome::failed(Status::Network, detail))
            }
            Err(RecvTimeoutError::Timeout) => continue,
            Err(RecvTimeoutError::Disconnected) => {
                return Err(PageOutcome::failed(
                    Status::Network,
                    "the webview went away before the page loaded",
                ))
            }
        }
    }
}

/// Dev-only measurement mode: `RP_WEBVIEW_FETCH_TRACE=<seconds>[:<poll_ms>]`.
///
/// With it set, the settle loop stops deciding anything — it ignores the
/// stability test and `SETTLE_MAX`, polls the document for `<seconds>` after
/// `finished` and prints one `RP-TRACE` line per poll. Those lines are the
/// document's fill curve, and every candidate settle rule can be replayed off
/// one recording of it instead of costing one page load per rule. This is how
/// the `SETTLE_*` numbers in policy.rs were measured; re-run it when a site
/// changes its markup or its rendering, rather than guessing a new constant.
///
/// A bot wall still ends the trace: it is a final answer, and reloading walls to
/// watch them not change only warms the site's rate limiter.
fn trace_config() -> Option<(Duration, Duration)> {
    let raw = std::env::var("RP_WEBVIEW_FETCH_TRACE").ok()?;
    let (secs, poll_ms) = match raw.split_once(':') {
        Some((secs, poll)) => (secs, poll.parse().ok()?),
        None => (raw.as_str(), policy::SETTLE_POLL.as_millis() as u64),
    };
    Some((
        Duration::from_secs_f64(secs.trim().parse().ok()?),
        Duration::from_millis(poll_ms),
    ))
}

/// Wall clock, so a trace can be lined up against something measured outside the
/// process (the cookie jar on disk, a packet capture).
fn unix_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// One line of the fill curve: when the poll ran (ms after `finished`), how long
/// the extractor took, and what it found.
fn print_trace(phase: Phase, opened: Instant, poll_started: Instant, readout: &Readout, len: usize) {
    let paragraphs = readout.text.split("\n\n").filter(|p| !p.trim().is_empty()).count();
    println!(
        "RP-TRACE {}",
        serde_json::json!({
            "phase": if phase == Phase::Warmup { "warmup" } else { "article" },
            "at": unix_millis(),
            "ms": opened.elapsed().as_millis() as u64,
            "extractMs": poll_started.elapsed().as_millis() as u64,
            "chars": len,
            "paragraphs": paragraphs,
            "containerChars": readout.container_chars,
            "selector": readout.selector,
            "promosDropped": readout.promos_dropped,
            "seesSignIn": readout.sees_sign_in,
            "blocked": policy::looks_blocked(readout),
            "title": readout.title,
            "url": readout.url,
            "ldJson": readout.ld_json.len(),
        })
    );
}

/// Read the document until it says it is finished, and take what it holds then.
///
/// "Finished" is a property of the document, never an elapsed time: the body has
/// reported the same length for `SETTLE_STABLE_POLLS` polls in a row, and — for
/// an article — what it holds classifies as an article rather than as nothing.
/// A page whose body never arrives is the one case that runs to `SETTLE_MAX`,
/// because a page that has been empty for a second is indistinguishable from one
/// that is about to fill; a page that already has its article is not.
///
/// The warm-up runs the same loop for the same reason. All it needs from the
/// homepage is that it stopped moving and is not itself a wall, so it stops at
/// "settled" without asking for a body — a homepage has no article, and waiting
/// for one would spend `SETTLE_MAX` on every cold origin.
fn settle_and_extract<R: Runtime>(
    window: &WebviewWindow<R>,
    rx: &Receiver<LoadEvent>,
    phase: Phase,
    started: Instant,
) -> PageOutcome {
    let trace = trace_config();
    let poll = trace.map_or(policy::SETTLE_POLL, |(_, poll)| poll);
    let mut opened = Instant::now();
    let mut deadline = Instant::now() + policy::SETTLE_MAX;
    let mut last_len: Option<usize> = None;
    let mut stable = 0u32;
    let mut latest: Option<Readout> = None;

    loop {
        // A redirect (or a bot wall replacing the document) is a new page: start
        // the settle clock over rather than reading a document that is being
        // torn down.
        while let Ok(event) = rx.try_recv() {
            match event {
                LoadEvent::Finished => {
                    opened = Instant::now();
                    deadline = Instant::now() + policy::SETTLE_MAX;
                    last_len = None;
                    stable = 0;
                }
                LoadEvent::Failed(detail) => {
                    if latest.is_none() {
                        return PageOutcome::failed(Status::Network, detail);
                    }
                }
            }
        }

        let poll_started = Instant::now();
        match extract(window) {
            Ok(readout) => {
                let len = readout.text.chars().count();
                if trace.is_some() {
                    print_trace(phase, opened, poll_started, &readout, len);
                }
                // A wall is final: nothing is going to grow into an article.
                if policy::looks_blocked(&readout) {
                    return PageOutcome {
                        status: Status::Blocked,
                        detail: Some(format!("bot wall: {}", readout.title)),
                        readout: Some(readout),
                    };
                }
                if Some(len) == last_len {
                    stable += 1;
                } else {
                    stable = 0;
                }
                last_len = Some(len);
                let done = policy::settle_is_done(phase, stable, &readout);
                latest = Some(readout);
                if trace.is_none() && done {
                    break;
                }
            }
            Err(err) => {
                if latest.is_none() && Instant::now() >= deadline {
                    return PageOutcome::failed(Status::Network, format!("extractor failed: {err}"));
                }
            }
        }

        if let Some((window_len, _)) = trace {
            if opened.elapsed() >= window_len {
                break;
            }
        } else if Instant::now() >= deadline {
            break;
        }
        if started.elapsed() > policy::OVERALL_TIMEOUT {
            break;
        }
        std::thread::sleep(poll);
    }

    match latest {
        Some(readout) => {
            let status = policy::classify(&readout);
            let detail = match status {
                Status::Empty => Some(format!(
                    "no article body found (selector {:?}, {} chars)",
                    readout.selector,
                    readout.text.chars().count()
                )),
                _ => None,
            };
            PageOutcome {
                status,
                readout: Some(readout),
                detail,
            }
        }
        None => PageOutcome::failed(Status::Timeout, "the document never answered the extractor"),
    }
}

/// Run the extractor in the page and parse what it returns.
#[cfg(target_os = "linux")]
pub(crate) fn extract<R: Runtime>(window: &WebviewWindow<R>) -> Result<Readout, String> {
    let json = eval_string(window, include_str!("extract.js"), policy::EVAL_TIMEOUT)?;
    serde_json::from_str(&json).map_err(|e| format!("extractor returned unusable JSON: {e}"))
}

#[cfg(not(target_os = "linux"))]
pub(crate) fn extract<R: Runtime>(_window: &WebviewWindow<R>) -> Result<Readout, String> {
    Err("no DOM bridge on this platform".to_string())
}

/// Evaluate `js` in the page and return its completion value as a string.
///
/// Tauri's own `eval` is one-way, so this goes to WebKitGTK directly.
/// `run_javascript` is deprecated in favour of `evaluate_javascript` (WebKitGTK
/// 2.40+), but the replacement would force the `webkit2gtk/v2_40` feature on the
/// whole build and with it a newer libwebkit2gtk-4.1 than the release
/// workflow's ubuntu-22.04 runner is guaranteed to have. The deprecated call is
/// still exported by 4.1 (checked against the local 2.52.3).
#[cfg(target_os = "linux")]
fn eval_string<R: Runtime>(
    window: &WebviewWindow<R>,
    js: &str,
    timeout: Duration,
) -> Result<String, String> {
    let (tx, rx) = mpsc::channel::<Result<String, String>>();
    let script = js.to_string();
    window
        .with_webview(move |platform| {
            #[allow(deprecated)]
            {
                use webkit2gtk::gio;
                use webkit2gtk::WebViewExt;
                let view = platform.inner();
                view.run_javascript(&script, None::<&gio::Cancellable>, move |result| {
                    use javascriptcore::ValueExt;
                    let value = result
                        .map_err(|e| e.to_string())
                        .and_then(|r| r.js_value().ok_or_else(|| "no value returned".to_string()))
                        .map(|v| v.to_str().to_string());
                    let _ = tx.send(value);
                });
            }
        })
        .map_err(|e| format!("cannot reach the webview: {e}"))?;
    match rx.recv_timeout(timeout) {
        Ok(result) => result,
        Err(RecvTimeoutError::Timeout) => Err("the page did not answer the extractor".to_string()),
        Err(RecvTimeoutError::Disconnected) => Err("the webview closed mid-extraction".to_string()),
    }
}

/// `<app data>/webview-fetch-profile`, created on demand. Same data root as
/// every other file the app owns (lib.rs creates it at startup).
pub(crate) fn profile_dir<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("no app data dir: {e}"))?
        .join(PROFILE_DIR);
    std::fs::create_dir_all(&dir).map_err(|e| format!("cannot create {}: {e}", dir.display()))?;
    Ok(dir)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_the_fetchers_own_labels_are_recognised() {
        let state = WebviewFetchState::default();
        let label = state.next_label();
        assert!(is_fetch_label(&label));
        assert!(is_fetch_label(&state.next_label()));
        // The app's window, and anything else that is not ours.
        for other in ["main", "", "fetch", "webview", "webview-fetch"] {
            assert!(!is_fetch_label(other), "{other}");
        }
    }

    #[test]
    fn labels_do_not_repeat() {
        let state = WebviewFetchState::default();
        assert_ne!(state.next_label(), state.next_label());
    }
}

/// Dev-only end-to-end check, because everything above only proves itself
/// against a live site. `RP_WEBVIEW_FETCH_PROBE=<url>[,<url>…]` makes the app
/// fetch those URLs at startup, print one JSON line per URL prefixed with
/// `RP-PROBE`, and exit. Run it under Xvfb so no window can reach a screen:
///
///   RP_WEBVIEW_FETCH_PROBE=https://www.bloomberg.com/news/articles/… \
///     xvfb-run -a ./target/debug/reading-partner
///
/// Absent the variable this returns immediately and the app starts normally.
///
/// Add `RP_WEBVIEW_FETCH_TRACE` (see `trace_config`) to make each fetch print
/// its fill curve as well, which is how the settle constants are re-measured.
pub fn run_probe_from_env(app: &AppHandle) {
    let Ok(raw) = std::env::var("RP_WEBVIEW_FETCH_PROBE") else {
        return;
    };
    let urls: Vec<String> = raw
        .split(',')
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();
    if urls.is_empty() {
        return;
    }
    let app = app.clone();
    std::thread::spawn(move || {
        for url in urls {
            let line = match policy::validate_target(&url) {
                Ok(target) => {
                    let result = fetch_blocking(&app, target);
                    serde_json::to_string(&result).unwrap_or_else(|e| format!("{{\"error\":\"{e}\"}}"))
                }
                Err(err) => format!("{{\"status\":\"rejected\",\"url\":\"{url}\",\"detail\":\"{err}\"}}"),
            };
            println!("RP-PROBE {line}");
        }
        app.exit(0);
    });
}
