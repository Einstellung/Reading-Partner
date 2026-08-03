// Article images served through a custom URI scheme (docs/pitfall/30). The
// webview blocks every external <img> twice — the CSP img-src has no https:,
// and COEP require-corp (the PDFium WASM engine needs cross-origin isolation)
// drops every subresource that arrives without a CORP header. Neither can be
// relaxed, so the bytes come back through here: the frontend rewrites
// `<img src="https://cdn/a.jpg">` to convertFileSrc(payload, "img"), this
// handler fetches the original and replays it with `Cross-Origin-Resource-Policy:
// cross-origin`, which is exactly what COEP is looking for.
//
// This is the app's only outbound request driven by third-party markup, so it
// is deliberately narrow: GET/HEAD only, absolute http/https only, no
// loopback/private/link-local host (before or after a redirect), an image
// content type, and a hard byte cap. Beyond that it fetches nothing the article
// view would not have fetched itself.
//
// The request carries the article's own URL as Referer, which is what the CDNs
// with hotlink protection want to see. The payload keeps it in a segment of its
// own, filled in by the host from the article record; nothing read out of the
// markup ever reaches a request header.

use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};
use std::sync::OnceLock;
use std::time::Duration;

use tauri::http::{header, HeaderValue, Method, Request, Response, StatusCode};
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
// a placeholder or a 403 to anything that does not look like a browser.
const USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const ACCEPT: &str = "image/avif,image/webp,image/apng,image/*,*/*;q=0.8";

pub fn handle<R: Runtime>(
    _ctx: UriSchemeContext<'_, R>,
    request: Request<Vec<u8>>,
    responder: UriSchemeResponder,
) {
    if !matches!(*request.method(), Method::GET | Method::HEAD) {
        responder.respond(refuse(
            StatusCode::METHOD_NOT_ALLOWED,
            format_args!("{} is not allowed", request.method()),
        ));
        return;
    }
    let Some(target) = target(request.uri().path()) else {
        responder.respond(refuse(
            StatusCode::BAD_REQUEST,
            format_args!("unusable payload {}", request.uri().path()),
        ));
        return;
    };
    // The handler is called on the webview's thread; the fetch runs on Tauri's
    // async runtime so nothing blocks the UI.
    tauri::async_runtime::spawn(async move { responder.respond(fetch(target).await) });
}

// What one proxied image request is: the picture to fetch and the page it
// appears on, if the host knew one.
struct Target {
    url: Url,
    referer: Option<String>,
}

// The payload arrives as one percent-encoded path segment holding two of its
// own: `<image url>/<page url>`, each percent-encoded by the frontend
// (imageProxyPayload in src/platform/app/image-proxy.ts) before convertFileSrc
// escapes the lot again. So one decode leaves the separator as the only bare
// "/" — an image URL cannot widen into the referer half whatever it contains,
// and neither half can be confused with a path of our own. Then each half is
// decoded once more and validated.
fn target(path: &str) -> Option<Target> {
    let payload = decode(path.strip_prefix('/')?)?;
    let (image, page) = payload.split_once('/')?;
    let url = remote_http_url(&decode(image)?)?;
    Some(Target { url, referer: referer(&decode(page)?) })
}

fn decode(raw: &str) -> Option<String> {
    percent_encoding::percent_decode(raw.as_bytes())
        .decode_utf8()
        .ok()
        .map(|s| s.into_owned())
}

fn remote_http_url(raw: &str) -> Option<Url> {
    let url = Url::parse(raw).ok()?;
    if !matches!(url.scheme(), "http" | "https") {
        return None;
    }
    if !host_allowed(&url) {
        return None;
    }
    Some(url)
}

// The Referer to send, or None. Empty means the caller had no page URL; a value
// that is not an ordinary http(s) URL, or that a header cannot hold, is dropped
// rather than failing the image — the picture still has a chance without it.
fn referer(raw: &str) -> Option<String> {
    let url = Url::parse(raw).ok()?;
    if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none() {
        return None;
    }
    let value = url.to_string();
    HeaderValue::from_str(&value).ok()?;
    Some(value)
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
                if attempt.previous().len() >= MAX_REDIRECTS {
                    eprintln!("image proxy: too many redirects for {}", attempt.url());
                    attempt.stop()
                } else if !host_allowed(attempt.url()) {
                    eprintln!("image proxy: refused a redirect to {}", attempt.url());
                    attempt.stop()
                } else {
                    attempt.follow()
                }
            }))
            .build()
            .expect("failed to build the image proxy HTTP client")
    })
}

async fn fetch(target: Target) -> Response<Vec<u8>> {
    let url = target.url.clone();
    let mut req = client().get(target.url).header(header::ACCEPT, ACCEPT);
    // Hotlink protection: image.jiqizhixin.com answers 403 to a request with no
    // Referer and 200 to the same one carrying the article's own site, and it
    // is not alone. The article URL is what a browser loading that page would
    // have sent, so this tells the image host nothing it would not already know.
    if let Some(referer) = target.referer {
        req = req.header(header::REFERER, referer);
    }
    let res = req.send().await;
    let mut res = match res {
        Ok(res) => res,
        Err(err) => {
            return refuse(StatusCode::BAD_GATEWAY, format_args!("{url} failed: {err}"))
        }
    };
    if !res.status().is_success() {
        // 403 here is hotlink protection turning the picture down; the Referer
        // sent with the request is the first thing to look at.
        return refuse(
            StatusCode::BAD_GATEWAY,
            format_args!("{url} answered {}", res.status()),
        );
    }
    if res.content_length().is_some_and(|n| n > MAX_IMAGE_BYTES as u64) {
        return refuse(
            StatusCode::PAYLOAD_TOO_LARGE,
            format_args!("{url} declares {:?} bytes", res.content_length()),
        );
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
                    return refuse(
                        StatusCode::PAYLOAD_TOO_LARGE,
                        format_args!("{url} is over {MAX_IMAGE_BYTES} bytes"),
                    );
                }
                body.extend_from_slice(&chunk);
            }
            Ok(None) => break,
            Err(err) => {
                return refuse(
                    StatusCode::BAD_GATEWAY,
                    format_args!("{url} broke off mid-body: {err}"),
                )
            }
        }
    }
    match image_content_type(declared.as_deref(), &body) {
        Some(content_type) => ok(&content_type, body),
        // Hotlink protection sometimes answers 200 with an HTML notice, so this
        // is the same story as a 403 wearing a different hat.
        None => refuse(
            StatusCode::UNSUPPORTED_MEDIA_TYPE,
            format_args!("{url} is not an image: {}", declared.as_deref().unwrap_or("no type")),
        ),
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

// A refusal, said out loud. Nothing outside can tell these apart otherwise: the
// article view only sees an <img> that failed and hides it, and the CSP has no
// img: in connect-src, so the frontend cannot fetch the response to read a
// status or a header off it. Stderr is where the rest of the shell writes
// (migrate.rs, voice.rs); a device build is read with the app attached.
fn refuse(status: StatusCode, reason: std::fmt::Arguments<'_>) -> Response<Vec<u8>> {
    eprintln!("image proxy: {reason}");
    fail(status)
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

    // What the frontend puts on the wire: each half percent-encoded, joined by
    // "/", the pair escaped once more into a single path segment. Mirrors
    // imageProxyPayload + convertFileSrc, so the tests exercise the real shape.
    fn path_for(image: &str, page: &str) -> String {
        let encode = |s: &str| {
            percent_encoding::utf8_percent_encode(s, percent_encoding::NON_ALPHANUMERIC).to_string()
        };
        format!("/{}", encode(&format!("{}/{}", encode(image), encode(page))))
    }

    fn image_of(path: &str) -> Option<String> {
        target(path).map(|t| t.url.to_string())
    }

    fn referer_of(image: &str, page: &str) -> Option<String> {
        target(&path_for(image, page))?.referer
    }

    #[test]
    fn accepts_an_encoded_absolute_https_url() {
        assert_eq!(
            image_of(&path_for("https://cdn.example.com/a.jpg?w=640&h=480", "")),
            Some("https://cdn.example.com/a.jpg?w=640&h=480".to_string())
        );
    }

    #[test]
    fn keeps_non_ascii_paths_intact() {
        assert_eq!(
            image_of(&path_for("https://cdn.example.com/图片.jpg", "")),
            Some("https://cdn.example.com/%E5%9B%BE%E7%89%87.jpg".to_string())
        );
    }

    #[test]
    fn carries_the_page_url_as_the_referer() {
        assert_eq!(
            referer_of("https://image.example.com/a.png", "https://www.example.com/articles/1"),
            Some("https://www.example.com/articles/1".to_string())
        );
        // A page URL with a query and non-ASCII survives its own round trip.
        assert_eq!(
            referer_of("https://image.example.com/a.png", "https://www.example.com/文章?id=7"),
            Some("https://www.example.com/%E6%96%87%E7%AB%A0?id=7".to_string())
        );
    }

    #[test]
    fn sends_no_referer_when_the_page_url_is_missing_or_unusable() {
        for page in ["", "about:blank", "javascript:alert(1)", "/relative", "https://"] {
            assert_eq!(
                referer_of("https://image.example.com/a.png", page),
                None,
                "{page} should not become a Referer"
            );
        }
    }

    // Paths produced by running imageProxyPayload through convertFileSrc's
    // encodeURIComponent, pasted verbatim: encodeURIComponent leaves a few
    // characters (-_.!~*'()) alone that a Rust encoder would escape, so this is
    // the shape the handler really gets rather than the one the tests build.
    #[test]
    fn decodes_what_the_frontend_actually_sends() {
        let article = target("/https%253A%252F%252Fimage.jiqizhixin.com%252Fuploads%252Feditor%252F8c619e12-fd2d-4fc5-a1b6-2beaccf0fa0d%252F640.png%2Fhttps%253A%252F%252Fwww.jiqizhixin.com%252Farticles%252F2025-01-01-9").unwrap();
        assert_eq!(
            article.url.as_str(),
            "https://image.jiqizhixin.com/uploads/editor/8c619e12-fd2d-4fc5-a1b6-2beaccf0fa0d/640.png"
        );
        assert_eq!(
            article.referer.as_deref(),
            Some("https://www.jiqizhixin.com/articles/2025-01-01-9")
        );

        let non_ascii = target("/https%253A%252F%252Fcdn.example.com%252F%25E5%259B%25BE%25E7%2589%2587.jpg%253Fw%253D640%2526h%253D480%2Fhttps%253A%252F%252Fwww.example.com%252F%25E6%2596%2587%25E7%25AB%25A0%253Fid%253D7").unwrap();
        assert_eq!(
            non_ascii.url.as_str(),
            "https://cdn.example.com/%E5%9B%BE%E7%89%87.jpg?w=640&h=480"
        );
        assert_eq!(
            non_ascii.referer.as_deref(),
            Some("https://www.example.com/%E6%96%87%E7%AB%A0?id=7")
        );

        let no_page = target("/https%253A%252F%252Fcdn%252Fa.jpg%2F").unwrap();
        assert_eq!(no_page.url.as_str(), "https://cdn/a.jpg");
        assert_eq!(no_page.referer, None);
    }

    #[test]
    fn rejects_a_payload_that_is_not_the_two_segment_shape() {
        // The old single-segment shape, and an empty one.
        assert_eq!(image_of("/https%3A%2F%2Fcdn.example.com%2Fa.jpg"), None);
        assert_eq!(image_of(""), None);
        assert_eq!(image_of("/"), None);
    }

    #[test]
    fn rejects_everything_that_is_not_a_remote_http_url() {
        for image in [
            "file:///etc/passwd",
            "data:text/html,<script>",
            "../../secret.png",
            "a.jpg",
            "",
            "http://127.0.0.1/a.png",
            "http://localhost:1420/a.png",
            "http://192.168.1.1/a.png",
            "http://169.254.169.254/latest/meta-data",
            "http://[::1]/a.png",
            "http://printer.local/a.png",
        ] {
            assert_eq!(
                image_of(&path_for(image, "https://www.example.com/a")),
                None,
                "{image} should be refused"
            );
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
