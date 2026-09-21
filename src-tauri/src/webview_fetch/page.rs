// The generic half of the fetcher: load any page in one of the same hidden
// windows and hand back its markup, plus the value of a script run inside it.
//
// `fetch_article_via_webview` next door answers "what does this article say",
// which means an extractor, promo stripping and a homepage warm-up. This one
// answers "what does this page hold", which is a different question and has
// none of that: no extraction, no warm-up, no judgement about what a body is.
// What it does share is everything that makes the window safe and the session
// real — the same profile and cookie jar, the same user agent, the same
// navigation rule, the same one-fetch-at-a-time gate, the same guarantee that
// the window is created hidden, never shown, and destroyed with the call.
//
// The wait is shared too (`with_page`): a page is settled when the document has
// stopped changing, which is `Phase::Page` in policy.rs. What is not shared is
// what is read at the end — the whole `documentElement`, not an article
// container.

use std::time::{Duration, Instant};

use tauri::{AppHandle, Runtime, Url, WebviewWindow};

use super::policy::{self, Phase, Status};
use super::{profile_dir, with_page, PageOutcome, WebviewFetchState};

/// What one page load comes back with.
///
/// `status` keeps the failures apart the same way the article fetch does, with
/// one difference: `html` is captured whatever the status says, walls included.
/// A caller driving a page with its own script has no other way to see why the
/// script found nothing, and a wall's markup is the evidence.
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WebviewPage {
    pub status: Status,
    pub requested_url: String,
    /// Where the webview ended up, redirects included.
    pub final_url: Option<String>,
    pub title: Option<String>,
    /// `document.documentElement.outerHTML` once the load settled.
    pub html: Option<String>,
    /// What the script evaluated to, JSON round-tripped. `null` when no script
    /// was given, or when it threw — the reason is then in `detail`.
    pub result: Option<serde_json::Value>,
    pub elapsed_ms: u64,
    /// Human-readable reason: why a status is not `ok`, why the script has no
    /// result, whether the markup was truncated.
    pub detail: Option<String>,
}

impl WebviewPage {
    fn failed(status: Status, url: &str, detail: impl Into<String>, started: Instant) -> Self {
        Self {
            status,
            requested_url: url.to_string(),
            final_url: None,
            title: None,
            html: None,
            result: None,
            elapsed_ms: started.elapsed().as_millis() as u64,
            detail: Some(detail.into()),
        }
    }
}

/// Default ceiling on one call, and the most one may ask for. The article
/// fetch's budget covers a warm-up as well; this one never warms up, so the
/// same number is roomier than it looks.
const MAX_BUDGET: Duration = policy::OVERALL_TIMEOUT;
/// Floor, so a caller cannot ask for a timeout no page could ever meet and get
/// a `timeout` that says nothing.
const MIN_BUDGET: Duration = Duration::from_secs(5);

fn budget(timeout_ms: Option<u64>) -> Duration {
    match timeout_ms {
        Some(ms) => Duration::from_millis(ms).clamp(MIN_BUDGET, MAX_BUDGET),
        None => MAX_BUDGET,
    }
}

/// Render `url` in a hidden webview and return the page.
///
/// Errors (`Err`) are the caller's mistakes — a URL this must never load. A
/// page that will not answer is a successful call with a `status` that says how
/// it refused.
#[tauri::command]
pub async fn fetch_page_via_webview(
    app: AppHandle,
    url: String,
    script: Option<String>,
    timeout_ms: Option<u64>,
) -> Result<WebviewPage, String> {
    let target = policy::validate_target(&url)?;
    tauri::async_runtime::spawn_blocking(move || fetch_blocking(&app, target, script, timeout_ms))
        .await
        .map_err(|e| format!("webview page fetch task failed: {e}"))
}

fn fetch_blocking<R: Runtime>(
    app: &AppHandle<R>,
    target: Url,
    script: Option<String>,
    timeout_ms: Option<u64>,
) -> WebviewPage {
    let started = Instant::now();
    let requested = target.to_string();

    if !cfg!(target_os = "linux") {
        return WebviewPage::failed(
            Status::Unsupported,
            &requested,
            "the webview fetcher only has a DOM bridge on Linux so far",
            started,
        );
    }

    let Some(state) = tauri::Manager::try_state::<WebviewFetchState>(app) else {
        return WebviewPage::failed(
            Status::Unsupported,
            &requested,
            "webview fetch state is not registered",
            started,
        );
    };
    // The same gate as the article fetch, and the same reason: one hidden
    // window at a time on one cookie jar.
    let _gate = state.gate.lock().unwrap_or_else(|e| e.into_inner());

    let profile = match profile_dir(app) {
        Ok(dir) => dir,
        Err(err) => return WebviewPage::failed(Status::Unsupported, &requested, err, started),
    };

    let budget = budget(timeout_ms);
    let outcome = with_page(
        app,
        &state,
        &profile,
        &target,
        Phase::Page,
        started,
        budget,
        |window, outcome| read_page(window, outcome, script.as_deref(), &requested, started),
    );
    outcome.unwrap_or_else(|failed| {
        WebviewPage::failed(
            failed.status,
            &requested,
            failed.detail.unwrap_or_else(|| "no detail".into()),
            started,
        )
    })
}

/// Read the settled document, then run the caller's script in it.
///
/// In that order: the script is allowed to touch the page (that is what an
/// expression over the DOM may end up doing), and the markup that comes back
/// should be the page as it was found.
fn read_page<R: Runtime>(
    window: &WebviewWindow<R>,
    outcome: PageOutcome,
    script: Option<&str>,
    requested: &str,
    started: Instant,
) -> WebviewPage {
    let mut details: Vec<String> = outcome.detail.into_iter().collect();
    let mut final_url = None;
    let mut title = None;
    let mut html = None;

    match read_document(window) {
        Ok(doc) => {
            final_url = (!doc.url.is_empty()).then(|| doc.url.clone());
            title = (!doc.title.is_empty()).then(|| doc.title.clone());
            if let Some(err) = doc.error {
                details.push(format!("document capture: {err}"));
            }
            if !doc.html.is_empty() {
                let chars = doc.html.chars().count();
                if chars > policy::MAX_PAGE_HTML_CHARS {
                    details.push(format!(
                        "html truncated to {} of {chars} characters",
                        policy::MAX_PAGE_HTML_CHARS
                    ));
                }
                html = Some(policy::truncate_chars(&doc.html, policy::MAX_PAGE_HTML_CHARS));
            }
        }
        Err(err) => details.push(format!("the page did not hand over its markup: {err}")),
    }

    let mut result = None;
    if let Some(script) = script {
        match run_script(window, script) {
            Ok(value) => result = value,
            Err(err) => details.push(err),
        }
    }

    // A wall stays a wall; a load that never happened keeps its own reason.
    // Otherwise the page is what it holds: `empty` when nothing came back at
    // all, `ok` when something did. `Empty` out of the article classifier is
    // meaningless here — it only means the page has no article — so it is not
    // carried over.
    let status = match outcome.status {
        Status::Blocked | Status::Timeout | Status::Network | Status::Unsupported => outcome.status,
        Status::Ok | Status::Empty => {
            if html.is_some() {
                Status::Ok
            } else {
                Status::Empty
            }
        }
    };

    WebviewPage {
        status,
        requested_url: requested.to_string(),
        final_url,
        title,
        html,
        result,
        elapsed_ms: started.elapsed().as_millis() as u64,
        detail: (!details.is_empty()).then(|| details.join("; ")),
    }
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct Document {
    url: String,
    title: String,
    html: String,
    #[serde(default)]
    error: Option<String>,
}

#[derive(serde::Deserialize)]
struct ScriptOutcome {
    ok: bool,
    #[serde(default)]
    value: Option<serde_json::Value>,
    #[serde(default)]
    error: Option<String>,
}

#[cfg(target_os = "linux")]
fn read_document<R: Runtime>(window: &WebviewWindow<R>) -> Result<Document, String> {
    let json = super::eval_string(window, include_str!("page.js"), policy::EVAL_TIMEOUT)?;
    serde_json::from_str(&json).map_err(|e| format!("unusable JSON: {e}"))
}

#[cfg(not(target_os = "linux"))]
fn read_document<R: Runtime>(_window: &WebviewWindow<R>) -> Result<Document, String> {
    Err("no DOM bridge on this platform".to_string())
}

/// Run the caller's script and parse its value. `Ok(None)` means the script ran
/// and had nothing to give; `Err` is a sentence for `detail`.
#[cfg(target_os = "linux")]
fn run_script<R: Runtime>(
    window: &WebviewWindow<R>,
    script: &str,
) -> Result<Option<serde_json::Value>, String> {
    let wrapped = include_str!("script.js").replace("__RP_SCRIPT__", script);
    let json = super::eval_string(window, &wrapped, policy::EVAL_TIMEOUT)
        .map_err(|e| format!("the script did not run: {e}"))?;
    let outcome: ScriptOutcome = serde_json::from_str(&json)
        .map_err(|e| format!("the script returned unusable JSON: {e}"))?;
    if !outcome.ok {
        return Err(format!(
            "the script failed: {}",
            outcome.error.unwrap_or_else(|| "no message".into())
        ));
    }
    Ok(outcome.value.filter(|v| !v.is_null()))
}

#[cfg(not(target_os = "linux"))]
fn run_script<R: Runtime>(
    _window: &WebviewWindow<R>,
    _script: &str,
) -> Result<Option<serde_json::Value>, String> {
    Err("no DOM bridge on this platform".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_budget_is_clamped_to_something_a_page_could_meet() {
        assert_eq!(budget(None), MAX_BUDGET);
        assert_eq!(budget(Some(1)), MIN_BUDGET);
        assert_eq!(budget(Some(1_000_000)), MAX_BUDGET);
        assert_eq!(budget(Some(20_000)), Duration::from_secs(20));
    }

    #[test]
    fn the_wrapper_carries_the_script_verbatim() {
        let wrapped = include_str!("script.js").replace("__RP_SCRIPT__", "1 + 1");
        assert!(wrapped.contains("const value = (1 + 1);"));
        assert!(!wrapped.contains("__RP_SCRIPT__"));
    }
}

/// Dev-only end-to-end check, the page fetch's own version of
/// `webview_fetch::run_probe_from_env`. `RP_WEBVIEW_PAGE_PROBE=<url>` fetches
/// that page at startup, prints what came back to stderr and exits; with
/// `RP_WEBVIEW_PAGE_SCRIPT=<js>` it runs that script in the page too, and
/// `RP_WEBVIEW_PAGE_TIMEOUT_MS` sets the budget. Run it under Xvfb so no window
/// can reach a screen:
///
///   RP_WEBVIEW_PAGE_PROBE=https://example.com/ \
///     RP_WEBVIEW_PAGE_SCRIPT='document.querySelectorAll("a").length' \
///     xvfb-run -a ./target/debug/reading-partner
pub fn run_probe_from_env(app: &AppHandle) {
    let Ok(raw) = std::env::var("RP_WEBVIEW_PAGE_PROBE") else {
        return;
    };
    let url = raw.trim().to_string();
    if url.is_empty() {
        return;
    }
    let script = std::env::var("RP_WEBVIEW_PAGE_SCRIPT")
        .ok()
        .filter(|s| !s.trim().is_empty());
    let timeout_ms = std::env::var("RP_WEBVIEW_PAGE_TIMEOUT_MS")
        .ok()
        .and_then(|s| s.trim().parse::<u64>().ok());
    let app = app.clone();
    std::thread::spawn(move || {
        match policy::validate_target(&url) {
            Ok(target) => {
                let page = fetch_blocking(&app, target, script, timeout_ms);
                let html = page.html.unwrap_or_default();
                eprintln!(
                    "RP-PAGE-PROBE status={:?} finalUrl={:?} title={:?} htmlChars={} elapsedMs={} detail={:?}",
                    page.status,
                    page.final_url,
                    page.title,
                    html.chars().count(),
                    page.elapsed_ms,
                    page.detail,
                );
                eprintln!(
                    "RP-PAGE-PROBE result {}",
                    page.result
                        .map(|v| v.to_string())
                        .unwrap_or_else(|| "null".into())
                );
                eprintln!(
                    "RP-PAGE-PROBE html[0..500] {}",
                    html.chars().take(500).collect::<String>()
                );
            }
            Err(err) => eprintln!("RP-PAGE-PROBE rejected {url}: {err}"),
        }
        app.exit(0);
    });
}
