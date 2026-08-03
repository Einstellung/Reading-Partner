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

// wry's workaround hosts: `http(s)://tauri.localhost` for the app's assets and
// `http(s)://img.localhost` for our image scheme (image_proxy.rs). Only Windows
// and Android serve anything there. On macOS, iOS and Linux these names are
// nobody's page — and since article markup can put any http(s) URL in an
// `<a href>` (src/info/extract/sanitize.ts), an unconditional pass here is a
// hole a third-party page can aim at rather than a host of ours.
fn is_workaround_host(host: Option<&str>) -> bool {
    matches!(host, Some(h) if h.eq_ignore_ascii_case("tauri.localhost") || h.eq_ignore_ascii_case("img.localhost"))
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

/// The rule, as a function of the target URL and the build it runs in.
pub fn decide(url: &Url, build: Build) -> Decision {
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

// A cancelled navigation is invisible from the page: no error, no console
// message, no CSP report — the click just does nothing (docs/pitfall/99). This
// line is the only trace it leaves, so a link or a frame that silently refuses
// to load can be recognised for what it is. stderr reaches a terminal running
// `tauri dev` and Xcode's console with a device attached; a TestFlight build
// has nowhere to put it.
fn report(what: std::fmt::Arguments<'_>) {
    eprintln!("navigation-guard: {what}");
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("navigation-guard")
        .on_navigation(|webview, url| match decide(url, Build::current()) {
            Decision::Allow => true,
            Decision::HandOff => {
                let app = webview.app_handle().clone();
                let target = url.to_string();
                // Off the webview thread: the navigation decision is returned
                // now and the browser opens on its own time. `opener()` is the
                // handle-based API, the only one that reaches UIApplication on
                // iOS — the free `open_url` function shells out and does
                // nothing there.
                tauri::async_runtime::spawn_blocking(move || {
                    if let Err(err) = app.opener().open_url(&target, None::<&str>) {
                        report(format_args!(
                            "failed to open {target} in the system browser: {err}"
                        ));
                    }
                });
                false
            }
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

    fn decide_url(url: &str, build: Build) -> Decision {
        decide(&Url::parse(url).expect("test url"), build)
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
}
