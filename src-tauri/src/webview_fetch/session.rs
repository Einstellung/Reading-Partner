// The user's own session with a site, for the sources that read one (docs/17).
//
// A Bloomberg article is ~500 characters to an anonymous reader and the whole
// story to a subscriber, so the fetcher is worth much more once the reader has
// signed in. That sign-in happens here, and only here: a visible window loads
// the site's own login page, the user types into it, and the cookies land in the
// same profile the hidden fetch windows read (mod.rs, PROFILE_DIR). The app
// never sees the password, never stores a credential, and has no code path that
// signs in on anyone's behalf.
//
// Three commands, all desktop-only like the fetcher itself:
//
//   open_site_sign_in    show the login page and wait for the user to close it
//   check_site_session   load a page in the hidden window and report whether the
//                        site still offers a sign-in
//   clear_site_cookies   forget one site's cookies — the sign-out
//
// Signing out is deleting cookies rather than driving the site's own logout,
// because the cookie jar is the whole of what we hold: nothing else here knows
// the user is signed in.

use std::path::PathBuf;
use std::sync::mpsc::{self, RecvTimeoutError};
use std::time::{Duration, Instant};

use tauri::{AppHandle, Manager, Runtime, WindowEvent};

use super::jar;
use super::policy::{self, Status};
use super::{
    build_window, connect_engine_signals, extract, profile_dir, wait_for_load, Chrome, LiveGuard,
    WebviewFetchState,
};

/// How long the sign-in window may stay open before the fetcher stops waiting on
/// it. Not a deadline for the user — the window stays where it is and the
/// cookies it collected stay in the jar — only for the call that is watching it.
const SIGN_IN_TIMEOUT: Duration = Duration::from_secs(20 * 60);

/// How long a session check waits past `finished` before reading the page.
///
/// Much shorter than an article's settle, and for a reason rather than out of
/// impatience: what is being read is the header's sign-in control, which is part
/// of the first render, not body text that streams in paragraph by paragraph.
const SESSION_SETTLE: Duration = Duration::from_secs(3);

/// What the sign-in window did.
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SignInOutcome {
    /// Whether the user closed the window (the only signal that the flow is
    /// over: polling the DOM for a logged-in shape guesses, and guesses wrong on
    /// every site that redirects through an identity provider).
    pub closed: bool,
    pub elapsed_ms: u64,
}

/// Whether the site still treats this profile as an anonymous reader.
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionStatus {
    /// How the page load itself went. Only `ok` and `empty` make `signedIn`
    /// meaningful; a wall or a timeout says nothing about the session.
    pub status: Status,
    /// The page offered no way to sign in, so the session is real.
    pub signed_in: bool,
    pub checked_url: String,
    pub final_url: Option<String>,
    pub title: Option<String>,
    pub elapsed_ms: u64,
    pub detail: Option<String>,
}

/// Open the site's own sign-in page in a window the user can see and type into,
/// and return when they close it.
///
/// Popups are allowed in this window and only in this window (the `Chrome` flag
/// in mod.rs), because "continue with Google" is a popup. What wry does with
/// that is worth knowing: it builds a bare `gtk::ApplicationWindow` of its own,
/// shows it, and puts a fresh webview inside it. That window is not a Tauri
/// window — the navigation guard never sees it, and no handle to it reaches this
/// code. And when the popup finishes and calls `window.close()`, wry destroys
/// the webview but not the window it built, so an empty untitled window can be
/// left standing on the user's screen with nothing to explain it (read out of
/// wry 0.55's webkitgtk backend; the popup path itself has never been run
/// against a real identity provider here, since that needs an account). See
/// docs/pitfall/112.
///
/// `sweep_orphan_windows` below is the answer: any toplevel that appeared after
/// this window did, and is not a window Tauri owns, goes when the sign-in ends.
///
/// No warm-up, deliberately. The fetch path loads a site's homepage first to
/// collect the cookies that get an article past the bot check, and doing that
/// here is worse than useless: measured on a fresh profile, /account/signin
/// opens directly, while warming first has a chance of putting an interstitial
/// in front of the user as the first thing the app shows them.
#[tauri::command]
pub async fn open_site_sign_in(app: AppHandle, url: String) -> Result<SignInOutcome, String> {
    let target = policy::validate_target(&url)?;
    tauri::async_runtime::spawn_blocking(move || {
        let started = Instant::now();
        let state = app
            .try_state::<WebviewFetchState>()
            .ok_or_else(|| "webview fetch state is not registered".to_string())?;
        // Held for as long as the window is open: a background body fetch
        // writing to the same jar while the user is logging into it is not a
        // race worth having. A briefing waits; the user is right here.
        let _gate = state.gate.lock().unwrap_or_else(|e| e.into_inner());
        let profile = profile_dir(&app)?;
        let label = state.next_label();
        if let Ok(mut live) = state.live.lock() {
            live.insert(label.clone());
        }
        let _guard = LiveGuard {
            app: app.clone(),
            label: label.clone(),
        };

        // The load channel is wired for the failure reporting inside
        // connect_engine_signals; nothing here waits on it, because what this
        // window is waiting for is the user.
        let (tx, _rx) = mpsc::channel();
        let window = build_window(
            &app,
            &label,
            &profile,
            tx.clone(),
            Chrome {
                visible: true,
                // The window has a taskbar entry and a title bar, so it says
                // what it is rather than showing the app's name twice.
                title: "Sign in",
            },
        )
        .map_err(|e| format!("could not open the sign-in window: {e}"))?;

        // Only the load reporting. The dialog lid the fetch windows wear stays
        // off here: this window is the user's, and a login flow may legitimately
        // need a confirm, a file chooser for an ID photo, or a print dialog.
        connect_engine_signals(&window, tx);

        let (closed_tx, closed_rx) = mpsc::channel();
        window.on_window_event(move |event| {
            if matches!(event, WindowEvent::Destroyed) {
                let _ = closed_tx.send(());
            }
        });

        // Everything that is on screen now, the sign-in window included. Anything
        // that appears after this and is nobody's is a popup wry built and left.
        let before = toplevel_addresses(&app);

        window
            .navigate(target)
            .map_err(|e| format!("could not open the sign-in page: {e}"))?;

        // The user closing the window is the completion signal. Waiting on the
        // DOM instead would mean deciding what "signed in" looks like for every
        // site and every identity provider it redirects through.
        let closed = match closed_rx.recv_timeout(SIGN_IN_TIMEOUT) {
            Ok(()) => true,
            // The app is going away, which closes the window with it.
            Err(RecvTimeoutError::Disconnected) => true,
            Err(RecvTimeoutError::Timeout) => false,
        };
        sweep_orphan_windows(&app, before);
        Ok(SignInOutcome {
            closed,
            elapsed_ms: started.elapsed().as_millis() as u64,
        })
    })
    .await
    .map_err(|e| format!("sign-in task failed: {e}"))?
}

/// Load `url` in a hidden window and report whether the site still offers a way
/// to sign in.
///
/// The signal is the page's own sign-in control, which is what a real session
/// removes: measured against three Bloomberg articles, `seesSignIn` went true →
/// false with a session and the paywall markers went with it. It is read off the
/// rendered page rather than the cookie jar because a jar full of cookies proves
/// nothing — the bot-check cookies are there either way.
#[tauri::command]
pub async fn check_site_session(app: AppHandle, url: String) -> Result<SessionStatus, String> {
    let target = policy::validate_target(&url)?;
    tauri::async_runtime::spawn_blocking(move || {
        let started = Instant::now();
        let checked_url = target.to_string();
        if !cfg!(target_os = "linux") {
            return Ok(unsupported(&checked_url, started));
        }
        let state = match app.try_state::<WebviewFetchState>() {
            Some(state) => state,
            None => return Ok(unsupported(&checked_url, started)),
        };
        let _gate = state.gate.lock().unwrap_or_else(|e| e.into_inner());
        let profile: PathBuf = profile_dir(&app)?;
        let label = state.next_label();
        if let Ok(mut live) = state.live.lock() {
            live.insert(label.clone());
        }
        let _guard = LiveGuard {
            app: app.clone(),
            label: label.clone(),
        };

        let (tx, rx) = mpsc::channel();
        let window = build_window(&app, &label, &profile, tx.clone(), Chrome::hidden())
            .map_err(|e| format!("could not open the check window: {e}"))?;
        connect_engine_signals(&window, tx);
        window
            .navigate(target)
            .map_err(|e| format!("could not load {checked_url}: {e}"))?;

        if let Err(outcome) = wait_for_load(&rx, policy::LOAD_TIMEOUT, started) {
            return Ok(SessionStatus {
                status: outcome.status,
                signed_in: false,
                checked_url,
                final_url: None,
                title: None,
                elapsed_ms: started.elapsed().as_millis() as u64,
                detail: outcome.detail,
            });
        }
        std::thread::sleep(SESSION_SETTLE);
        let readout = extract(&window).map_err(|e| format!("could not read the page: {e}"))?;
        let status = policy::classify(&readout);
        Ok(SessionStatus {
            // A wall answered instead of the site, so the sign-in control being
            // absent means nothing.
            signed_in: status != Status::Blocked && !readout.sees_sign_in,
            status,
            checked_url,
            final_url: (!readout.url.is_empty()).then(|| readout.url.clone()),
            title: (!readout.title.is_empty()).then(|| readout.title.clone()),
            elapsed_ms: started.elapsed().as_millis() as u64,
            detail: (status == Status::Blocked)
                .then(|| format!("bot wall: {}", readout.title)),
        })
    })
    .await
    .map_err(|e| format!("session check failed: {e}"))?
}

fn unsupported(url: &str, started: Instant) -> SessionStatus {
    SessionStatus {
        status: Status::Unsupported,
        signed_in: false,
        checked_url: url.to_string(),
        final_url: None,
        title: None,
        elapsed_ms: started.elapsed().as_millis() as u64,
        detail: Some("no webview session on this platform".into()),
    }
}

/// Sign out of `host`: delete its cookies from the fetcher's profile.
///
/// Everything the app holds about the session is in that jar, so removing the
/// cookies is the whole of signing out. Scoped to the site named — the jar also
/// holds other sites, and one site's sign-out is not another's.
#[tauri::command]
pub async fn clear_site_cookies(app: AppHandle, host: String) -> Result<Vec<String>, String> {
    let mut domains = cookie_domains(&host)?;
    tauri::async_runtime::spawn_blocking(move || {
        let state = app
            .try_state::<WebviewFetchState>()
            .ok_or_else(|| "webview fetch state is not registered".to_string())?;
        let _gate = state.gate.lock().unwrap_or_else(|e| e.into_inner());
        let profile = profile_dir(&app)?;
        // The spellings above are the ones a site's own name produces, and they
        // are not all of them: signing in to Bloomberg leaves a cookie on
        // login.bloomberg.com, which no amount of guessing at www. would have
        // found (measured — the first version of this left exactly that one
        // behind). WebKit's delete-by-domain matches one domain exactly, so the
        // jar on disk is read for the rest. docs/pitfall/110.
        for extra in jar_domains(&read_jar(&profile), &host) {
            if !domains.contains(&extra) {
                domains.push(extra);
            }
        }
        let label = state.next_label();
        if let Ok(mut live) = state.live.lock() {
            live.insert(label.clone());
        }
        let _guard = LiveGuard {
            app: app.clone(),
            label: label.clone(),
        };
        // A window that never navigates anywhere: it exists to reach the cookie
        // manager of the profile's web context, which is per data directory and
        // only reachable through a webview that uses it.
        let (tx, _rx) = mpsc::channel();
        let window = build_window(&app, &label, &profile, tx, Chrome::hidden())
            .map_err(|e| format!("could not open the cookie window: {e}"))?;
        delete_cookies(&window, &host, &domains)?;
        // WebKit's own persistence is on its own schedule, and a sign-out that
        // only holds in memory is not a sign-out: the next launch reads the file
        // and the reader is signed in again. Measured — after the deletes had
        // gone through, the jar on disk still had 13 of the site's rows
        // (docs/pitfall/111). The deletes above leave the network process with
        // nothing for this site, so rewriting the file here can only agree with
        // it, whenever it next writes.
        prune_jar(&profile, &host)?;
        Ok(domains)
    })
    .await
    .map_err(|e| format!("sign-out task failed: {e}"))?
}

/// The cookie jar as text, or empty when there is none yet. wry points WebKit at
/// `<profile>/cookies` in the Netscape text format (see the module note in
/// mod.rs), so this is a file, not a database.
fn read_jar(profile: &PathBuf) -> String {
    jar::read(profile)
}

/// Every domain in the jar that belongs to `host`'s site: the host itself, its
/// registrable-ish parent (one `www.` stripped), and anything under that parent
/// — `login.bloomberg.com` is where a Bloomberg session actually lives. Pure
/// over the jar text, so what a sign-out reaches is testable without a webview.
///
/// Deliberately not the other direction: a cookie on a shorter domain than the
/// one named is some other site's business.
pub fn jar_domains(jar: &str, host: &str) -> Vec<String> {
    // The row parse is jar.rs's: the httpOnly marker makes those rows look like
    // comments, and the warm-up reads the same file for a different reason.
    let bare = jar::site_of(host);
    let mut out: Vec<String> = Vec::new();
    for line in jar.lines() {
        let Some(plain) = jar::row_domain(line) else {
            continue;
        };
        if !jar::belongs_to(&plain, &bare) {
            continue;
        }
        for spelling in [plain.clone(), format!(".{plain}")] {
            if !out.contains(&spelling) {
                out.push(spelling);
            }
        }
    }
    out
}

/// Every domain spelling a site's cookies can be stored under: the host itself,
/// the host without `www.`, and the leading-dot forms a site sets for its
/// subdomains. Pure, so the shape of a sign-out is testable without a webview.
pub fn cookie_domains(host: &str) -> Result<Vec<String>, String> {
    let host = host.trim().trim_end_matches('.').to_ascii_lowercase();
    if host.is_empty() || host.contains('/') || host.contains(' ') {
        return Err(format!("not a host: {host}"));
    }
    if crate::navigation::is_local_host(&host) {
        return Err(format!("refusing to touch cookies for {host}"));
    }
    let bare = host.strip_prefix("www.").unwrap_or(&host).to_string();
    let mut out = vec![host.clone(), format!(".{host}")];
    if bare != host {
        out.push(bare.clone());
        out.push(format!(".{bare}"));
    }
    Ok(out)
}

/// Rewrite the jar without a site's rows. Returns how many rows went.
fn prune_jar(profile: &PathBuf, host: &str) -> Result<usize, String> {
    let path = profile.join("cookies");
    let jar = read_jar(profile);
    if jar.is_empty() {
        return Ok(0);
    }
    let (kept, dropped) = jar_without(&jar, host);
    if dropped == 0 {
        return Ok(0);
    }
    let temp = profile.join("cookies.signout");
    std::fs::write(&temp, kept).map_err(|e| format!("could not write the jar: {e}"))?;
    std::fs::rename(&temp, &path).map_err(|e| format!("could not replace the jar: {e}"))?;
    Ok(dropped)
}

/// The jar text with every row belonging to `host`'s site removed, and how many
/// were removed. Comments and other sites are kept as they were. Pure.
pub fn jar_without(jar: &str, host: &str) -> (String, usize) {
    let doomed = jar_domains(jar, host);
    let mut out = String::with_capacity(jar.len());
    let mut dropped = 0;
    for line in jar.lines() {
        let domain = line
            .split('\t')
            .next()
            .unwrap_or("")
            .trim()
            .trim_start_matches("#HttpOnly_")
            .trim_start_matches('.')
            .to_ascii_lowercase();
        if !domain.is_empty() && doomed.iter().any(|d| d.trim_start_matches('.') == domain) {
            dropped += 1;
            continue;
        }
        out.push_str(line);
        out.push('\n');
    }
    (out, dropped)
}

#[cfg(target_os = "linux")]
fn delete_cookies<R: Runtime>(
    window: &tauri::WebviewWindow<R>,
    host: &str,
    domains: &[String],
) -> Result<(), String> {
    let domains = domains.to_vec();
    let probe_uri = format!("https://{host}/");
    let (tx, rx) = mpsc::channel::<Result<(), String>>();
    window
        .with_webview(move |platform| {
            // delete_cookies_for_domain is marked deprecated in the bindings
            // (WebKit 2.16 pointed at the WebsiteDataManager API), and it is
            // still the one call that removes exactly one site's cookies —
            // clear() on the data manager takes types and a time span, not a
            // host.
            #[allow(deprecated)]
            use webkit2gtk::{gio, CookieManagerExt, WebContextExt, WebViewExt};
            let view = platform.inner();
            match view.context().and_then(|ctx| ctx.cookie_manager()) {
                Some(cookies) => {
                    for domain in &domains {
                        #[allow(deprecated)]
                        cookies.delete_cookies_for_domain(domain);
                    }
                    // The deletes are void calls with no completion of their
                    // own. A read of the same jar afterwards is answered by the
                    // same network process in the same order, so its callback is
                    // the barrier that says the deletes have landed.
                    cookies.cookies(&probe_uri, None::<&gio::Cancellable>, move |_left| {
                        let _ = tx.send(Ok(()));
                    });
                }
                None => {
                    let _ = tx.send(Err("the webview has no cookie manager".to_string()));
                }
            }
        })
        .map_err(|e| format!("cannot reach the webview: {e}"))?;
    match rx.recv_timeout(policy::EVAL_TIMEOUT) {
        Ok(result) => result,
        Err(RecvTimeoutError::Timeout) => Err("the cookie manager did not answer".to_string()),
        Err(RecvTimeoutError::Disconnected) => Err("the webview closed".to_string()),
    }
}

#[cfg(not(target_os = "linux"))]
fn delete_cookies<R: Runtime>(
    _window: &tauri::WebviewWindow<R>,
    _host: &str,
    _domains: &[String],
) -> Result<(), String> {
    Err("no cookie bridge on this platform".to_string())
}

/// The addresses of every GTK toplevel right now, taken on the main thread
/// because that is the only place GTK may be touched. Addresses rather than the
/// widgets themselves: a `gtk::Widget` is not `Send` and this runs on a blocking
/// thread. Reused addresses can only make the sweep skip a window, never destroy
/// one it should not.
#[cfg(target_os = "linux")]
fn toplevel_addresses(app: &AppHandle) -> Vec<usize> {
    let (tx, rx) = mpsc::channel();
    if app
        .run_on_main_thread(move || {
            let _ = tx.send(list_toplevel_addresses());
        })
        .is_err()
    {
        return Vec::new();
    }
    rx.recv_timeout(Duration::from_secs(5)).unwrap_or_default()
}

#[cfg(target_os = "linux")]
fn list_toplevel_addresses() -> Vec<usize> {
    use gtk::glib::translate::ToGlibPtr;
    gtk::Window::list_toplevels()
        .iter()
        .map(|w| {
            let ptr: *mut gtk::ffi::GtkWidget = w.to_glib_none().0;
            ptr as usize
        })
        .collect()
}

/// Destroy the windows the sign-in left behind: anything on screen that was not
/// there when the sign-in window opened and that Tauri does not own.
///
/// The only thing that can produce one is wry answering a `window.open()` — it
/// builds the window, and when the page inside calls `close()` it destroys the
/// webview and leaves the window. An empty untitled window the user cannot place
/// is not something to ship, and there is no handle to it anywhere else.
///
/// Nothing else is at risk: the app's own windows are excluded by asking Tauri
/// for them, and a window that was already there when the sign-in started is
/// excluded by the snapshot.
#[cfg(target_os = "linux")]
fn sweep_orphan_windows(app: &AppHandle, before: Vec<usize>) {
    use gtk::glib::translate::ToGlibPtr;
    use gtk::prelude::{Cast, WidgetExtManual};
    let app_handle = app.clone();
    let _ = app.run_on_main_thread(move || {
        let mut keep = before;
        for (_, window) in app_handle.webview_windows() {
            if let Ok(gtk_window) = window.gtk_window() {
                let widget: gtk::Widget = gtk_window.upcast();
                let ptr: *mut gtk::ffi::GtkWidget = widget.to_glib_none().0;
                keep.push(ptr as usize);
            }
        }
        for widget in gtk::Window::list_toplevels() {
            let ptr: *mut gtk::ffi::GtkWidget = widget.to_glib_none().0;
            if keep.contains(&(ptr as usize)) {
                continue;
            }
            eprintln!("webview-fetch: destroying a window the sign-in popup left behind");
            // Safety: the widget is not touched again, here or anywhere — this
            // code is the only thing that knows it exists.
            unsafe { widget.destroy() };
        }
    });
}

#[cfg(not(target_os = "linux"))]
fn toplevel_addresses(_app: &AppHandle) -> Vec<usize> {
    Vec::new()
}

#[cfg(not(target_os = "linux"))]
fn sweep_orphan_windows(_app: &AppHandle, _before: Vec<usize>) {}

/// Dev-only end-to-end check for the three commands above, in the same shape as
/// the article probe (mod.rs). `RP_WEBVIEW_SESSION_PROBE` takes a comma-separated
/// list of `verb:argument` steps and prints one `RP-SESSION` line per step:
///
///   check:https://www.bloomberg.com/     is this profile signed in there
///   signin:https://www.bloomberg.com/account/signin
///                                        open the visible sign-in window; the
///                                        probe closes it after SIGN_IN_PROBE_CLOSE
///                                        so the "user closed it" path is exercised
///   signout:www.bloomberg.com            delete that site's cookies
///
/// Run it under Xvfb: the sign-in window is a visible window by design.
pub fn run_probe_from_env(app: &AppHandle) {
    let Ok(raw) = std::env::var("RP_WEBVIEW_SESSION_PROBE") else {
        return;
    };
    let steps: Vec<String> = raw
        .split(',')
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();
    if steps.is_empty() {
        return;
    }
    let app = app.clone();
    std::thread::spawn(move || {
        for step in steps {
            let Some((verb, arg)) = step.split_once(':') else {
                println!("RP-SESSION unusable step {step}");
                continue;
            };
            let (verb, arg) = (verb.to_string(), arg.to_string());
            let line = match verb.as_str() {
                "check" => render(tauri::async_runtime::block_on(check_site_session(
                    app.clone(),
                    arg,
                ))),
                "signout" => render(tauri::async_runtime::block_on(clear_site_cookies(
                    app.clone(),
                    arg,
                ))),
                "signin" => {
                    close_sign_in_window_later(&app);
                    render(tauri::async_runtime::block_on(open_site_sign_in(
                        app.clone(),
                        arg,
                    )))
                }
                other => format!("unknown step {other}"),
            };
            println!("RP-SESSION {verb} {line}");
        }
        app.exit(0);
    });
}

/// How long the probe leaves the sign-in window open before closing it for the
/// user who is not there.
const SIGN_IN_PROBE_CLOSE: Duration = Duration::from_secs(15);

fn render<T: serde::Serialize>(result: Result<T, String>) -> String {
    match result {
        Ok(value) => serde_json::to_string(&value).unwrap_or_else(|e| e.to_string()),
        Err(err) => format!("error: {err}"),
    }
}

/// Stand in for the user closing the sign-in window, so the probe can exercise
/// the path that waits for it — and, with RP_SIGN_IN_POPUP set to a URL, for the
/// popup an identity provider would have opened, so the orphan sweep can be
/// checked without an account anywhere.
fn close_sign_in_window_later(app: &AppHandle) {
    let app = app.clone();
    let popup = std::env::var("RP_SIGN_IN_POPUP").ok();
    std::thread::spawn(move || {
        if let Some(url) = popup {
            std::thread::sleep(SIGN_IN_PROBE_CLOSE / 3);
            for (label, window) in app.webview_windows() {
                if super::is_fetch_label(&label) {
                    let _ = window.eval(format!("window.open({});", serde_json::json!(url)));
                }
            }
        }
        std::thread::sleep(SIGN_IN_PROBE_CLOSE);
        for (label, window) in app.webview_windows() {
            if super::is_fetch_label(&label) {
                let _ = window.destroy();
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_sign_out_covers_every_spelling_of_the_site() {
        // A site sets cookies on both its host and its dotted parent, and the
        // jar stores them under exactly the domain that was written.
        assert_eq!(
            cookie_domains("www.bloomberg.com").unwrap(),
            vec![
                "www.bloomberg.com",
                ".www.bloomberg.com",
                "bloomberg.com",
                ".bloomberg.com",
            ]
        );
        assert_eq!(
            cookie_domains("bloomberg.com").unwrap(),
            vec!["bloomberg.com", ".bloomberg.com"]
        );
        // Case and a trailing root dot are the same host.
        assert_eq!(
            cookie_domains("WWW.Bloomberg.COM.").unwrap(),
            cookie_domains("www.bloomberg.com").unwrap()
        );
    }

    // A jar in the shape wry writes: tab-separated Netscape rows, httpOnly ones
    // behind a comment-looking prefix.
    const JAR: &str = concat!(
        "# Netscape HTTP Cookie File\n",
        ".bloomberg.com\tTRUE\t/\tFALSE\t1800000000\t_pxvid\tabc\n",
        "www.bloomberg.com\tFALSE\t/\tTRUE\t1800000000\tagent_id\tdef\n",
        "#HttpOnly_.bloomberg.com\tTRUE\t/\tTRUE\t1800000000\tsession_key\tghi\n",
        "login.bloomberg.com\tFALSE\t/\tTRUE\t1800000000\tstate\tjkl\n",
        ".economist.com\tTRUE\t/\tFALSE\t1800000000\tsomething\tmno\n",
    );

    #[test]
    fn the_jar_is_read_for_the_subdomains_no_one_would_guess() {
        let found = jar_domains(JAR, "www.bloomberg.com");
        // The one that made this necessary: a session cookie on the login
        // subdomain, which survived a sign-out that only knew about www.
        assert!(found.contains(&"login.bloomberg.com".to_string()));
        assert!(found.contains(&"bloomberg.com".to_string()));
        assert!(found.contains(&".bloomberg.com".to_string()));
        assert!(found.contains(&"www.bloomberg.com".to_string()));
        // Another site in the same jar is left alone.
        assert!(!found.iter().any(|d| d.contains("economist")));
        // The header comment is not a domain.
        assert!(!found.iter().any(|d| d.contains('#') || d.contains("Netscape")));
    }

    #[test]
    fn pruning_the_jar_keeps_every_other_site_and_the_header() {
        let (kept, dropped) = jar_without(JAR, "www.bloomberg.com");
        // Four Bloomberg rows, including the httpOnly one and the login
        // subdomain.
        assert_eq!(dropped, 4);
        assert!(kept.contains("economist.com"));
        assert!(kept.contains("# Netscape HTTP Cookie File"));
        assert!(!kept.contains("bloomberg"));
        // Rows the site never owned are untouched, so a sign-out cannot cost
        // another site its session.
        let (unchanged, none) = jar_without(JAR, "example.com");
        assert_eq!(none, 0);
        assert_eq!(unchanged.lines().count(), JAR.lines().count());
    }

    #[test]
    fn an_empty_jar_asks_for_nothing() {
        assert!(jar_domains("", "www.bloomberg.com").is_empty());
        assert!(jar_domains(JAR, "example.com").is_empty());
    }

    #[test]
    fn a_sign_out_is_not_a_way_to_reach_anything_local() {
        for bad in ["", "localhost", "127.0.0.1", "tauri.localhost", "a/b", "a b"] {
            assert!(cookie_domains(bad).is_err(), "{bad}");
        }
    }
}
