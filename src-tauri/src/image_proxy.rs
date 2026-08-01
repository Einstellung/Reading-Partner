// Article images served through a custom URI scheme (docs/pitfall/30). The
// webview blocks every external <img> twice — the CSP img-src has no https:,
// and COEP require-corp (the PDFium WASM engine needs cross-origin isolation)
// drops every subresource that arrives without a CORP header. Neither can be
// relaxed, so the bytes come back through here: the frontend rewrites
// `<img src="https://cdn/a.jpg">` to convertFileSrc(url, "img"), this handler
// fetches the original and replays it with `Cross-Origin-Resource-Policy:
// cross-origin`, which is exactly what COEP is looking for.
//
// This is the app's only outbound request driven by third-party markup, so it
// is deliberately narrow: GET/HEAD only, absolute http/https only, no
// loopback/private/link-local host (before or after a redirect), an image
// content type, and a hard byte cap. Beyond that it fetches nothing the article
// view would not have fetched itself.

use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};
use std::sync::OnceLock;
use std::time::Duration;

use tauri::http::{header, Method, Request, Response, StatusCode};
use tauri::{Runtime, UriSchemeContext, UriSchemeResponder};
use tauri_plugin_http::reqwest::{redirect, Client, Url};

// The scheme name. The frontend never spells the URL out: convertFileSrc turns
// this into `img://localhost/<encoded>` on macOS/iOS/Linux and
// `http://img.localhost/<encoded>` on Windows/Android, and the CSP img-src in
// tauri.conf.json allows both shapes.
pub const SCHEME: &str = "img";

// Matches MAX_IMAGE_BYTES in src/platform/app/image-proxy.ts. A news photo is
// well under this; anything above it is not what the article view is for.
const MAX_IMAGE_BYTES: usize = 5 * 1024 * 1024;
const MAX_REDIRECTS: usize = 5;
const TIMEOUT: Duration = Duration::from_secs(20);

// Same identity as infoFetch (src/info/extract/user-agent.ts): news CDNs serve
// a placeholder or a 403 to anything that does not look like a browser. No
// Referer is sent — reqwest sends none by default, and the CDNs' hotlink
// protection is what would blank the image out.
const USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const ACCEPT: &str = "image/avif,image/webp,image/apng,image/*,*/*;q=0.8";

pub fn handle<R: Runtime>(
    _ctx: UriSchemeContext<'_, R>,
    request: Request<Vec<u8>>,
    responder: UriSchemeResponder,
) {
    if !matches!(*request.method(), Method::GET | Method::HEAD) {
        responder.respond(fail(StatusCode::METHOD_NOT_ALLOWED));
        return;
    }
    let Some(url) = target_url(request.uri().path()) else {
        responder.respond(fail(StatusCode::BAD_REQUEST));
        return;
    };
    // The handler is called on the webview's thread; the fetch runs on Tauri's
    // async runtime so nothing blocks the UI.
    tauri::async_runtime::spawn(async move { responder.respond(fetch(url).await) });
}

// The image URL arrives as one percent-encoded path segment: the frontend uses
// convertFileSrc, which runs the whole URL through encodeURIComponent, so the
// scheme, query and any non-ASCII characters land here escaped and the payload
// can never be confused with a path of our own. Decoded once, then validated.
fn target_url(path: &str) -> Option<Url> {
    let raw = percent_encoding::percent_decode(path.strip_prefix('/')?.as_bytes())
        .decode_utf8()
        .ok()?;
    let url = Url::parse(&raw).ok()?;
    if !matches!(url.scheme(), "http" | "https") {
        return None;
    }
    if !host_allowed(&url) {
        return None;
    }
    Some(url)
}

// Whether a host may be fetched. Rejects the loopback/private/link-local ranges
// so article markup cannot aim the proxy at the machine it runs on or at the
// LAN around it. A literal-host check: a public name that resolves to a private
// address still gets through, which is the price of not resolving DNS twice.
fn host_allowed(url: &Url) -> bool {
    let Some(raw) = url.host_str() else {
        return false;
    };
    // host_str keeps the brackets around an IPv6 literal.
    let host = raw.trim_start_matches('[').trim_end_matches(']').to_ascii_lowercase();
    if let Ok(ip) = host.parse::<IpAddr>() {
        return match ip {
            IpAddr::V4(v4) => v4_allowed(&v4),
            IpAddr::V6(v6) => v6_allowed(&v6),
        };
    }
    host != "localhost" && !host.ends_with(".localhost") && !host.ends_with(".local")
}

fn v4_allowed(ip: &Ipv4Addr) -> bool {
    let [a, b, ..] = ip.octets();
    // 0.0.0.0/8, 100.64.0.0/10 (carrier NAT) and 169.254.0.0/16 (the cloud
    // metadata address lives there) on top of what std already names.
    !(ip.is_loopback()
        || ip.is_private()
        || ip.is_link_local()
        || ip.is_unspecified()
        || ip.is_broadcast()
        || ip.is_multicast()
        || a == 0
        || (a == 100 && (64..128).contains(&b)))
}

fn v6_allowed(ip: &Ipv6Addr) -> bool {
    if let Some(v4) = ip.to_ipv4_mapped() {
        return v4_allowed(&v4);
    }
    let head = ip.segments()[0];
    // fc00::/7 unique-local and fe80::/10 link-local; is_unique_local is not
    // stable yet, so the prefixes are matched by hand.
    !(ip.is_loopback()
        || ip.is_unspecified()
        || ip.is_multicast()
        || head & 0xfe00 == 0xfc00
        || head & 0xffc0 == 0xfe80)
}

fn client() -> &'static Client {
    static CLIENT: OnceLock<Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        Client::builder()
            .user_agent(USER_AGENT)
            .timeout(TIMEOUT)
            // Every hop is re-checked: a public host that redirects to
            // 127.0.0.1 must not be followed.
            .redirect(redirect::Policy::custom(|attempt| {
                if attempt.previous().len() >= MAX_REDIRECTS || !host_allowed(attempt.url()) {
                    attempt.stop()
                } else {
                    attempt.follow()
                }
            }))
            .build()
            .expect("failed to build the image proxy HTTP client")
    })
}

async fn fetch(url: Url) -> Response<Vec<u8>> {
    let Ok(mut res) = client().get(url).header(header::ACCEPT, ACCEPT).send().await else {
        return fail(StatusCode::BAD_GATEWAY);
    };
    if !res.status().is_success() {
        return fail(StatusCode::BAD_GATEWAY);
    }
    if res.content_length().is_some_and(|n| n > MAX_IMAGE_BYTES as u64) {
        return fail(StatusCode::PAYLOAD_TOO_LARGE);
    }
    let declared = res
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .map(str::to_owned);
    // Read chunk by chunk rather than through bytes(): a body with no
    // Content-Length would otherwise be buffered without a bound.
    let mut body: Vec<u8> = Vec::new();
    loop {
        match res.chunk().await {
            Ok(Some(chunk)) => {
                if body.len() + chunk.len() > MAX_IMAGE_BYTES {
                    return fail(StatusCode::PAYLOAD_TOO_LARGE);
                }
                body.extend_from_slice(&chunk);
            }
            Ok(None) => break,
            Err(_) => return fail(StatusCode::BAD_GATEWAY),
        }
    }
    match image_content_type(declared.as_deref(), &body) {
        Some(content_type) => ok(&content_type, body),
        None => fail(StatusCode::UNSUPPORTED_MEDIA_TYPE),
    }
}

// The content type to serve. The upstream one wins when it is an image type;
// otherwise the magic bytes decide, because plenty of CDNs label images
// application/octet-stream. Anything else is refused, which keeps the route an
// image proxy rather than a general-purpose fetcher reachable from markup.
fn image_content_type(declared: Option<&str>, body: &[u8]) -> Option<String> {
    let essence = declared
        .unwrap_or("")
        .split(';')
        .next()
        .unwrap_or("")
        .trim()
        .to_ascii_lowercase();
    if essence.starts_with("image/") && essence.len() > "image/".len() {
        return Some(essence);
    }
    sniff(body).map(str::to_owned)
}

fn sniff(body: &[u8]) -> Option<&'static str> {
    if body.starts_with(&[0xff, 0xd8, 0xff]) {
        return Some("image/jpeg");
    }
    if body.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Some("image/png");
    }
    if body.starts_with(b"GIF87a") || body.starts_with(b"GIF89a") {
        return Some("image/gif");
    }
    if body.starts_with(b"BM") {
        return Some("image/bmp");
    }
    if body.len() >= 12 && &body[0..4] == b"RIFF" && &body[8..12] == b"WEBP" {
        return Some("image/webp");
    }
    if body.len() >= 12 && &body[4..8] == b"ftyp" && matches!(&body[8..12], b"avif" | b"avis") {
        return Some("image/avif");
    }
    None
}

// CORP cross-origin is the header the whole route exists for: without it COEP
// require-corp drops the response before it reaches the <img>. ACAO is there so
// the same bytes can be read by fetch() later without a second round of this.
fn ok(content_type: &str, body: Vec<u8>) -> Response<Vec<u8>> {
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, content_type)
        .header("Cross-Origin-Resource-Policy", "cross-origin")
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .header(header::CACHE_CONTROL, "max-age=86400")
        .body(body)
        .unwrap_or_else(|_| Response::new(Vec::new()))
}

// An empty body with a status. The article view hides the <img> on the load
// error rather than showing a broken-image icon.
fn fail(status: StatusCode) -> Response<Vec<u8>> {
    Response::builder()
        .status(status)
        .header("Cross-Origin-Resource-Policy", "cross-origin")
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .body(Vec::new())
        .unwrap_or_else(|_| Response::new(Vec::new()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn decode(path: &str) -> Option<String> {
        target_url(path).map(|u| u.to_string())
    }

    #[test]
    fn accepts_an_encoded_absolute_https_url() {
        assert_eq!(
            decode("/https%3A%2F%2Fcdn.example.com%2Fa.jpg%3Fw%3D640%26h%3D480"),
            Some("https://cdn.example.com/a.jpg?w=640&h=480".to_string())
        );
    }

    #[test]
    fn keeps_non_ascii_paths_intact() {
        let encoded = "/https%3A%2F%2Fcdn.example.com%2F%E5%9B%BE%E7%89%87.jpg";
        assert_eq!(
            decode(encoded),
            Some("https://cdn.example.com/%E5%9B%BE%E7%89%87.jpg".to_string())
        );
    }

    #[test]
    fn rejects_everything_that_is_not_a_remote_http_url() {
        for path in [
            "/file%3A%2F%2F%2Fetc%2Fpasswd",
            "/data%3Atext%2Fhtml%2C%3Cscript%3E",
            "/..%2F..%2Fsecret.png",
            "/a.jpg",
            "",
            "/",
            "/http%3A%2F%2F127.0.0.1%2Fa.png",
            "/http%3A%2F%2Flocalhost%3A1420%2Fa.png",
            "/http%3A%2F%2F192.168.1.1%2Fa.png",
            "/http%3A%2F%2F169.254.169.254%2Flatest%2Fmeta-data",
            "/http%3A%2F%2F%5B%3A%3A1%5D%2Fa.png",
            "/http%3A%2F%2Fprinter.local%2Fa.png",
        ] {
            assert_eq!(decode(path), None, "{path} should be refused");
        }
    }

    #[test]
    fn content_type_prefers_the_upstream_image_type_then_sniffs() {
        let jpeg = [0xff, 0xd8, 0xff, 0xe0];
        assert_eq!(
            image_content_type(Some("image/webp; charset=binary"), &jpeg),
            Some("image/webp".to_string())
        );
        assert_eq!(
            image_content_type(Some("application/octet-stream"), &jpeg),
            Some("image/jpeg".to_string())
        );
        assert_eq!(image_content_type(None, &jpeg), Some("image/jpeg".to_string()));
        assert_eq!(image_content_type(Some("text/html"), b"<html>"), None);
    }
}
