// Keeping the app on its own page. A webview navigation replaces the whole
// document, and a Tauri window has no back gesture and no address bar: one
// `<a href="https://…">` in a model reply takes the open book and the running
// conversation with it, and only killing the app brings it back. Tauri allows
// every navigation by default, so this plugin is the net under every path that
// can produce a link — markdown, injected article HTML, and whatever gets
// written next. The frontend also opens external links explicitly
// (src/platform/app/external-link.ts); this is the layer nobody can forget.
//
// Anything that is not the app's own page is cancelled. A web link is handed to
// the system browser instead, which is what the user wanted from the click.
//
// One kind of webview is exempt, and the exemption is per window, never per
// URL: the hidden windows the article fetcher opens (webview_fetch), whose
// entire job is to render somebody else's page. They are recognised by being in
// the fetcher's live registry — a set written only when the fetcher itself
// builds a window and cleared when it destroys it. Nothing a page does can put
// a webview in that set, and the rule for every other webview, the app's own
// window first of all, is the same function it always was.

use tauri::plugin::{Builder, TauriPlugin};
use tauri::{Manager, Runtime, Url};
use tauri_plugin_opener::OpenerExt;

/// What the webview should do with a navigation it is about to perform.
#[derive(Debug, PartialEq, Eq)]
pub enum Decision {
    /// The app's own page. Let the webview load it.
    Allow,
    /// A link meant for somewhere else. Cancel and open it in the system browser.
    HandOff,
    /// Neither ours nor openable. Cancel and drop it.
    Cancel,
}

/// Which build the rule is applied for. Both fields are `cfg!` at the call site
/// and parameters here so every combination is testable.
#[derive(Debug, Clone, Copy)]
pub struct Build {
    /// A dev build, where the vite dev server is a page of ours.
    pub dev: bool,
    /// The app's own assets are served over http from wry's workaround host.
    /// True on Windows and Android; everywhere else the production origin is
    /// `tauri://localhost` and nothing of ours answers over http.
    pub http_assets: bool,
}

impl Build {
    fn current() -> Self {
        Self {
            dev: cfg!(dev),
            http_assets: cfg!(any(target_os = "windows", target_os = "android")),
        }
    }
}

/// Which webview is navigating. Not a property of the URL: the same URL is
/// cancelled in the app's window and loaded in a fetcher window.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Target {
    /// The app's own webview — the main window and anything else the app shows.
    /// The default, and the answer whenever there is any doubt.
    App,
    /// A hidden window the article fetcher owns. It holds no app page, no IPC
    /// access (its origin is remote, so Tauri's ACL rejects every command), and
    /// is destroyed when the fetch ends.
    Fetcher,
}

// wry's workaround hosts: `http(s)://tauri.localhost` for the app's assets and
// `http(s)://img.localhost` for our image scheme (image_proxy.rs). Only Windows
// and Android serve anything there. On macOS, iOS and Linux these names are
// nobody's page — and since article markup can put any http(s) URL in an
// `<a href>` (src/info/extract/sanitize.ts), an unconditional pass here is a
// hole a third-party page can aim at rather than a host of ours.
fn is_workaround_host(host: Option<&str>) -> bool {
    matches!(host, Some(h) if h.eq_ignore_ascii_case("tauri.localhost") || h.eq_ignore_ascii_case("img.localhost"))
}

/// Whether a host names the machine the app runs on, or the LAN around it:
/// loopback, RFC 1918, link-local (169.254, which is where cloud metadata
/// services live), the unspecified address, and every `*.localhost` name, which
/// RFC 6761 pins to loopback.
///
/// Used two ways: the article fetcher refuses to be pointed at such a host at
/// all (webview_fetch::policy::validate_target), and a fetcher window's
/// navigations to one are cancelled, so a redirect cannot get there either.
/// `is_dev_host` below overlaps with this by nature — the dev server lives at
/// one of these addresses — but answers a different question and only in a dev
/// build, so the two stay apart.
pub fn is_local_host(host: &str) -> bool {
    let host = host.trim_end_matches('.');
    if host.eq_ignore_ascii_case("localhost") || ends_with_localhost(host) {
        return true;
    }
    if let Ok(ip) = host.parse::<std::net::Ipv4Addr>() {
        return ip.is_loopback() || ip.is_private() || ip.is_link_local() || ip.is_unspecified();
    }
    let bare = host
        .strip_prefix('[')
        .and_then(|h| h.strip_suffix(']'))
        .unwrap_or(host);
    if let Ok(ip) = bare.parse::<std::net::Ipv6Addr>() {
        return ip.is_loopback() || ip.is_unspecified();
    }
    false
}

fn ends_with_localhost(host: &str) -> bool {
    host.len() > "localhost".len()
        && host[host.len() - "localhost".len()..].eq_ignore_ascii_case("localhost")
        && host.as_bytes()[host.len() - "localhost".len() - 1] == b'.'
}

// The vite dev server. `bun run tauri dev` serves it from localhost; `tauri ios
// dev` serves it from the development machine's LAN address, so a private or
// link-local IPv4 counts as well. Dev builds only — a release build never
// navigates to a local address on purpose.
fn is_dev_host(host: Option<&str>) -> bool {
    let Some(host) = host else { return false };
    if host.eq_ignore_ascii_case("localhost") {
        return true;
    }
    if let Ok(ip) = host.parse::<std::net::Ipv4Addr>() {
        return ip.is_loopback() || ip.is_private() || ip.is_link_local();
    }
    // A Url renders an IPv6 host bracketed.
    let bare = host
        .strip_prefix('[')
        .and_then(|h| h.strip_suffix(']'))
        .unwrap_or(host);
    if let Ok(ip) = bare.parse::<std::net::Ipv6Addr>() {
        return ip.is_loopback();
    }
    false
}

/// The rule, as a function of the target URL, the build it runs in, and which
/// webview is asking.
pub fn decide(url: &Url, build: Build, target: Target) -> Decision {
    if target == Target::Fetcher {
        return decide_for_fetcher(url);
    }
    match url.scheme() {
        // Our own schemes. `tauri:` is the production asset protocol, `img:` the
        // image proxy, `about:` the blank document a webview starts on.
        "tauri" | "img" | "about" => return Decision::Allow,
        // Ours as well: a blob: URL exists only because our own page made one,
        // and it carries our origin. It reaches this function at all because
        // wry hands every frame's navigation to the same callback, not just the
        // main document's (docs/pitfall/99), so a blob: preview or export frame
        // would otherwise be cancelled with nothing to show for it anywhere.
        // Note the CSP still has to list blob: under frame-src for that to work.
        "blob" => return Decision::Allow,
        "http" | "https" => {}
        // Not a page, but still something the system knows how to handle. The
        // OAuth redirect schemes never appear here: the desktop flow comes back
        // over a loopback socket and the iOS one through the deep-link plugin,
        // neither of which is a webview navigation.
        "mailto" | "tel" | "sms" => return Decision::HandOff,
        // Everything else, `data:` included. A data: document is not a product
        // of ours the way a blob: URL is — anything that can put text on the
        // screen can write one, and loading it would replace the app with
        // someone else's markup on an opaque origin. Cancelled on purpose.
        _ => return Decision::Cancel,
    }
    if is_workaround_host(url.host_str()) {
        // The app itself only where wry serves it that way, and only on the
        // default port — the real origin never carries one. Anywhere else this
        // is not a page to load and not a URL to hand to a browser either
        // (`.localhost` resolves to loopback, so handing it over would send the
        // system browser at the user's own machine).
        //
        // Where it is the app, a link to it is still a full reload that throws
        // away the open book and the conversation. That one is same-origin and
        // indistinguishable here from the app's own initial load, so it stays
        // Allow and the frontend blocks it (classifyLink in
        // src/platform/app/external-link.ts returns `block` for same origin).
        return if build.http_assets && url.port().is_none() {
            Decision::Allow
        } else {
            Decision::Cancel
        };
    }
    if build.dev && is_dev_host(url.host_str()) {
        return Decision::Allow;
    }
    Decision::HandOff
}

/// The rule inside one of the article fetcher's hidden windows. Wider than the
/// app's in exactly one respect — a public http(s) page loads instead of being
/// handed to the browser — and narrower in every other:
///
/// * no HandOff at all. Anywhere else a `mailto:` or an unknown scheme is
///   passed to the system browser; from a hidden window driven by a page we do
///   not control, that would be a way to open things on the user's desktop.
/// * not the app's own origin, in any of its spellings, so a fetched page can
///   never end up running where app pages run.
/// * not this machine or the LAN behind it, so a redirect cannot turn the
///   fetcher into a reader of local services.
fn decide_for_fetcher(url: &Url) -> Decision {
    match url.scheme() {
        // The blank document every fetcher window is created on.
        "about" => return Decision::Allow,
        "http" | "https" => {}
        _ => return Decision::Cancel,
    }
    let Some(host) = url.host_str() else {
        return Decision::Cancel;
    };
    if is_workaround_host(Some(host)) || is_local_host(host) {
        return Decision::Cancel;
    }
    Decision::Allow
}

// A cancelled navigation is invisible from the page: no error, no console
// message, no CSP report — the click just does nothing (docs/pitfall/99). This
// line is the only trace it leaves, so a link or a frame that silently refuses
// to load can be recognised for what it is. stderr reaches a terminal running
// `tauri dev` and Xcode's console with a device attached; a TestFlight build
// has nowhere to put it.
fn report(what: std::fmt::Arguments<'_>) {
    eprintln!("navigation-guard: {what}");
}

/// Which rule this webview is judged by. The fetcher's registry is the only
/// thing that can answer `Fetcher`, and it is not consulted at all on mobile,
/// where there is no fetcher to ask.
fn target_of<R: Runtime>(webview: &tauri::Webview<R>) -> Target {
    #[cfg(desktop)]
    if crate::webview_fetch::is_fetch_webview(webview) {
        return Target::Fetcher;
    }
    let _ = webview;
    Target::App
}

/// Cancel the navigation and open it where the user expected it — except from a
/// fetcher window, which is never allowed to reach the desktop. A window that
/// has just been unregistered still answers `App` above, so the check is by
/// label and covers a fetcher window for its whole life.
fn hand_off<R: Runtime>(webview: &tauri::Webview<R>, url: &Url) -> bool {
    #[cfg(desktop)]
    if crate::webview_fetch::is_fetch_label(webview.label()) {
        report(format_args!(
            "refused to open {url} from the article fetcher's window"
        ));
        return false;
    }
    let app = webview.app_handle().clone();
    let target = url.to_string();
    // Off the webview thread: the navigation decision is returned now and the
    // browser opens on its own time. `opener()` is the handle-based API, the
    // only one that reaches UIApplication on iOS — the free `open_url` function
    // shells out and does nothing there.
    tauri::async_runtime::spawn_blocking(move || {
        if let Err(err) = app.opener().open_url(&target, None::<&str>) {
            report(format_args!(
                "failed to open {target} in the system browser: {err}"
            ));
        }
    });
    false
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("navigation-guard")
        .on_navigation(|webview, url| match decide(url, Build::current(), target_of(webview)) {
            Decision::Allow => true,
            Decision::HandOff => hand_off(webview, url),
            Decision::Cancel => {
                report(format_args!("cancelled a navigation to {url}"));
                false
            }
        })
        .build()
}

#[cfg(test)]
mod tests {
    use super::*;

    // A release build on macOS, iOS or Linux: the app is `tauri://localhost`.
    const NATIVE: Build = Build { dev: false, http_assets: false };
    // A release build on Windows or Android: the app is `http://tauri.localhost`.
    const HTTP_ASSETS: Build = Build { dev: false, http_assets: true };

    /// The app's own webview, which is what every rule below is about unless it
    /// says otherwise.
    fn decide_url(url: &str, build: Build) -> Decision {
        decide(&Url::parse(url).expect("test url"), build, Target::App)
    }

    /// One of the article fetcher's hidden windows.
    fn decide_fetch(url: &str, build: Build) -> Decision {
        decide(&Url::parse(url).expect("test url"), build, Target::Fetcher)
    }

    #[test]
    fn app_pages_load() {
        for url in [
            "tauri://localhost/",
            "tauri://localhost/index.html?shell=phone",
            "about:blank",
            "img://localhost/https%3A%2F%2Fcdn%2Fa.jpg",
        ] {
            assert_eq!(decide_url(url, NATIVE), Decision::Allow, "{url}");
            assert_eq!(decide_url(url, HTTP_ASSETS), Decision::Allow, "{url}");
        }
    }

    #[test]
    fn the_workaround_host_is_the_app_only_where_wry_serves_it() {
        // Windows and Android reach the same assets over http.
        for url in [
            "http://tauri.localhost/",
            "https://tauri.localhost/index.html",
            "http://img.localhost/https%3A%2F%2Fcdn%2Fa.jpg",
        ] {
            assert_eq!(decide_url(url, HTTP_ASSETS), Decision::Allow, "{url}");
            // Everywhere else nothing of ours answers there. An article body can
            // put any http(s) URL in an `<a href>`, so this shape arrives from
            // third-party markup, not from the app.
            assert_eq!(decide_url(url, NATIVE), Decision::Cancel, "{url}");
        }
    }

    #[test]
    fn a_port_makes_it_someone_elses_server() {
        // The app's origin never carries one, on any platform.
        for url in ["http://tauri.localhost:8080/", "http://img.localhost:1420/x"] {
            assert_eq!(decide_url(url, HTTP_ASSETS), Decision::Cancel, "{url}");
            assert_eq!(decide_url(url, NATIVE), Decision::Cancel, "{url}");
        }
    }

    #[test]
    fn web_links_go_to_the_browser() {
        for url in [
            "https://arxiv.org/abs/1705.08439",
            "http://example.com/a",
            "https://accounts.google.com/o/oauth2/v2/auth?client_id=x",
            "mailto:someone@example.com",
            "tel:+1234567890",
        ] {
            assert_eq!(decide_url(url, NATIVE), Decision::HandOff, "{url}");
        }
    }

    #[test]
    fn a_blob_url_is_our_own_document() {
        // Only our own page can mint one, and wry sends frame navigations here
        // too, so this is what keeps a blob: frame from being dropped in
        // silence.
        for url in [
            "blob:tauri://localhost/8f1e7b0c-1f5a-4a1d-9a9e-1b2c3d4e5f60",
            "blob:http://tauri.localhost/8f1e7b0c-1f5a-4a1d-9a9e-1b2c3d4e5f60",
        ] {
            assert_eq!(decide_url(url, NATIVE), Decision::Allow, "{url}");
        }
    }

    #[test]
    fn unknown_schemes_are_dropped() {
        for url in [
            // A data: document is not ours: it can hold anyone's markup on an
            // opaque origin, so it is cancelled where blob: is allowed.
            "data:text/html,<h1>hi</h1>",
            "javascript:alert(1)",
            "file:///etc/passwd",
            "com.googleusercontent.apps.379091688229-esc:/callback?code=x",
        ] {
            assert_eq!(decide_url(url, NATIVE), Decision::Cancel, "{url}");
        }
    }

    #[test]
    fn the_dev_server_loads_only_in_a_dev_build() {
        for url in [
            "http://localhost:1420/",
            "http://127.0.0.1:1420/",
            "http://192.168.1.20:1420/",
            "http://10.0.0.5:1420/",
            "http://172.16.3.4:1420/",
            "http://[::1]:1420/",
        ] {
            assert_eq!(decide_url(url, Build { dev: true, ..NATIVE }), Decision::Allow, "dev {url}");
            assert_eq!(decide_url(url, NATIVE), Decision::HandOff, "release {url}");
        }
    }

    #[test]
    fn a_public_address_is_never_the_dev_server() {
        // 172.32 is outside the private 172.16/12 block.
        for url in ["http://8.8.8.8/", "http://172.32.0.1:1420/"] {
            assert_eq!(decide_url(url, Build { dev: true, ..NATIVE }), Decision::HandOff, "{url}");
        }
    }

    #[test]
    fn a_lookalike_host_is_not_the_app() {
        for url in [
            "https://tauri.localhost.evil.com/",
            "https://nottauri.localhost/",
        ] {
            assert_eq!(decide_url(url, NATIVE), Decision::HandOff, "{url}");
            assert_eq!(decide_url(url, HTTP_ASSETS), Decision::HandOff, "{url}");
        }
    }

    // The fetcher exemption. Everything below is about the hidden windows in
    // webview_fetch.rs; the tests above are unchanged and still describe what
    // the app's own webview may do.

    #[test]
    fn the_fetcher_loads_the_web_the_app_hands_off() {
        // This is the whole exemption: an article page renders in the hidden
        // window instead of being opened in the user's browser.
        for url in [
            "https://www.bloomberg.com/news/articles/2026-08-11/aluminum-hits-seven-week-high",
            "https://www.bloomberg.com/",
            "http://example.com/a",
        ] {
            assert_eq!(decide_fetch(url, NATIVE), Decision::Allow, "{url}");
            // And the app's own webview still refuses the very same URLs.
            assert_eq!(decide_url(url, NATIVE), Decision::HandOff, "{url}");
        }
        // Created blank, so about: has to load.
        assert_eq!(decide_fetch("about:blank", NATIVE), Decision::Allow);
    }

    #[test]
    fn the_fetcher_never_reaches_the_app_origin() {
        // A page in a fetcher window redirecting at the app's own origin would
        // be someone else's markup running where app pages run. Cancelled on
        // every platform, including the ones where these hosts are real.
        for url in [
            "tauri://localhost/index.html",
            "img://localhost/https%3A%2F%2Fcdn%2Fa.jpg",
            "http://tauri.localhost/",
            "https://tauri.localhost/index.html",
            "http://img.localhost/x",
            "blob:tauri://localhost/8f1e7b0c-1f5a-4a1d-9a9e-1b2c3d4e5f60",
        ] {
            assert_eq!(decide_fetch(url, NATIVE), Decision::Cancel, "{url}");
            assert_eq!(decide_fetch(url, HTTP_ASSETS), Decision::Cancel, "{url}");
        }
    }

    #[test]
    fn the_fetcher_never_reaches_this_machine() {
        for url in [
            "http://localhost:1420/",
            "http://127.0.0.1:8080/",
            "http://192.168.1.1/admin",
            "http://10.0.0.5/",
            "http://172.16.3.4/",
            "http://169.254.169.254/latest/meta-data/",
            "http://[::1]/",
            "http://0.0.0.0/",
            "http://router.localhost/",
        ] {
            assert_eq!(decide_fetch(url, NATIVE), Decision::Cancel, "{url}");
            assert_eq!(
                decide_fetch(url, Build { dev: true, ..NATIVE }),
                Decision::Cancel,
                "dev {url}"
            );
        }
        // A public address that only looks private is still the open web.
        assert_eq!(decide_fetch("http://172.32.0.1/", NATIVE), Decision::Allow);
    }

    #[test]
    fn a_fetcher_window_can_open_nothing_on_the_desktop() {
        // No HandOff exists in the fetcher rule: a hidden window driven by a
        // third-party page must not be able to launch the system browser or a
        // mail client, and must not load a document of its own making.
        for url in [
            "mailto:someone@example.com",
            "tel:+1234567890",
            "sms:+1234567890",
            "data:text/html,<h1>hi</h1>",
            "javascript:alert(1)",
            "file:///etc/passwd",
            "com.googleusercontent.apps.379091688229-esc:/callback?code=x",
        ] {
            assert_eq!(decide_fetch(url, NATIVE), Decision::Cancel, "{url}");
        }
    }

    #[test]
    fn local_hosts_are_recognised_by_name_and_by_address() {
        for host in [
            "localhost",
            "LOCALHOST",
            "localhost.",
            "anything.localhost",
            "127.0.0.1",
            "127.1.2.3",
            "10.1.2.3",
            "192.168.0.1",
            "172.16.0.1",
            "169.254.169.254",
            "0.0.0.0",
            "[::1]",
            "::1",
        ] {
            assert!(is_local_host(host), "{host}");
        }
        for host in [
            "www.bloomberg.com",
            "localhost.evil.com",
            "notlocalhost",
            "8.8.8.8",
            "172.32.0.1",
            "11.0.0.1",
        ] {
            assert!(!is_local_host(host), "{host}");
        }
    }
}
