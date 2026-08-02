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

// Hosts that serve the app itself. `tauri://localhost` is the production origin
// on macOS, iOS and Linux; Windows and Android reach the same assets through
// wry's workaround host `http(s)://tauri.localhost`. `img.localhost` is that
// same workaround shape for our own image scheme (image_proxy.rs).
fn is_app_host(host: Option<&str>) -> bool {
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

/// The rule, as a function of the target URL alone. `dev` is `cfg!(dev)` at the
/// call site; it is a parameter so both builds are testable.
pub fn decide(url: &Url, dev: bool) -> Decision {
    match url.scheme() {
        // Our own schemes. `tauri:` is the production asset protocol, `img:` the
        // image proxy, `about:` the blank document a webview starts on.
        "tauri" | "img" | "about" => return Decision::Allow,
        "http" | "https" => {}
        // Not a page, but still something the system knows how to handle. The
        // OAuth redirect schemes never appear here: the desktop flow comes back
        // over a loopback socket and the iOS one through the deep-link plugin,
        // neither of which is a webview navigation.
        "mailto" | "tel" | "sms" => return Decision::HandOff,
        _ => return Decision::Cancel,
    }
    if is_app_host(url.host_str()) || (dev && is_dev_host(url.host_str())) {
        Decision::Allow
    } else {
        Decision::HandOff
    }
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("navigation-guard")
        .on_navigation(|webview, url| match decide(url, cfg!(dev)) {
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
                        eprintln!("failed to open {target} in the system browser: {err}");
                    }
                });
                false
            }
            Decision::Cancel => false,
        })
        .build()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn decide_url(url: &str, dev: bool) -> Decision {
        decide(&Url::parse(url).expect("test url"), dev)
    }

    #[test]
    fn app_pages_load() {
        for url in [
            "tauri://localhost/",
            "tauri://localhost/index.html?shell=phone",
            "http://tauri.localhost/",
            "https://tauri.localhost/index.html",
            "about:blank",
            "img://localhost/https%3A%2F%2Fcdn%2Fa.jpg",
            "http://img.localhost/https%3A%2F%2Fcdn%2Fa.jpg",
        ] {
            assert_eq!(decide_url(url, false), Decision::Allow, "{url}");
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
            assert_eq!(decide_url(url, false), Decision::HandOff, "{url}");
        }
    }

    #[test]
    fn unknown_schemes_are_dropped() {
        for url in [
            "data:text/html,<h1>hi</h1>",
            "javascript:alert(1)",
            "file:///etc/passwd",
            "com.googleusercontent.apps.379091688229-esc:/callback?code=x",
        ] {
            assert_eq!(decide_url(url, false), Decision::Cancel, "{url}");
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
            assert_eq!(decide_url(url, true), Decision::Allow, "dev {url}");
            assert_eq!(decide_url(url, false), Decision::HandOff, "release {url}");
        }
    }

    #[test]
    fn a_public_address_is_never_the_dev_server() {
        // 172.32 is outside the private 172.16/12 block.
        for url in ["http://8.8.8.8/", "http://172.32.0.1:1420/"] {
            assert_eq!(decide_url(url, true), Decision::HandOff, "{url}");
        }
    }

    #[test]
    fn a_lookalike_host_is_not_the_app() {
        for url in [
            "https://tauri.localhost.evil.com/",
            "https://nottauri.localhost/",
        ] {
            assert_eq!(decide_url(url, false), Decision::HandOff, "{url}");
        }
    }
}
