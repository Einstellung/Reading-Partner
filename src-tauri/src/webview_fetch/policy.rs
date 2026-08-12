// The decisions the webview fetcher makes, separated from the windows and
// timers it makes them with: which URLs may be handed to the hidden webview,
// which origin has to be warmed up first and when that warm-up expires, and
// what a page readout means (article / bot wall / empty / broken). All of it is
// plain data in and out, so it is unit-tested here instead of being observed by
// hand through a webview.
//
// Every number in here comes from the WebKitGTK spike of 2026-08-11 (same
// engine as Tauri's Linux webview, WebKitGTK 2.52.3 / webkit2gtk-4.1) against
// bloomberg.com. The measurements are quoted at each constant; anything not
// measured says so.

use std::collections::HashMap;
use std::time::{Duration, Instant};

use tauri::Url;

/// What the hidden webview presents itself as: pinned here rather than left to
/// whatever the WebKit build emits, so the identity is ours and does not change
/// under the app when the distro updates its webkit2gtk.
///
/// The value is the string WebKitGTK 2.52.3 sends by default, and it is that on
/// purpose. Measured 2026-08-11, cold profile, bloomberg.com homepage, one
/// variable at a time:
///
/// | User-Agent                                        | result |
/// |---------------------------------------------------|--------|
/// | engine default, not set explicitly                 | 200    |
/// | this exact string, set explicitly                  | 200    |
/// | same, `Version/18.5` instead of `Version/60.5`     | 403 + captcha |
/// | same, `X11; Linux x86_64` (no `Ubuntu;`)           | 403 + captcha |
/// | Chrome 124 on Windows (the info engine's UA)       | 403 + captcha |
///
/// The 200s came after the 403s, so this is not the IP being flagged: it is
/// PerimeterX checking the string against everything else it can measure about
/// the client and refusing anything that does not add up. "Modernising" the
/// Safari version — the obvious thing to do with a version token from 2018 — is
/// exactly what puts the block back. Changing this string is a change to be
/// measured, not a cleanup.
pub const USER_AGENT: &str = "Mozilla/5.0 (X11; Ubuntu; Linux x86_64) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/60.5 Safari/605.1.15";

/// Viewport for the hidden window. The spike ran 1440x900 and got the desktop
/// layout; a tiny window would invite the mobile or "unsupported browser" page.
pub const VIEWPORT: (f64, f64) = (1440.0, 900.0);

/// How long to wait for the page's `finished` load event before giving up.
/// Measured: an article page reached `finished` at 8.0s (cold), 11.0s and 15.1s
/// (warm); the homepage took 24.6s. 45s is triple the worst article and 1.8x the
/// homepage.
pub const LOAD_TIMEOUT: Duration = Duration::from_secs(45);
/// Same, for the warm-up load of a site's homepage, which is the heavier page.
pub const WARMUP_LOAD_TIMEOUT: Duration = Duration::from_secs(60);

/// How long to keep reading the document after `finished` before taking what it
/// has. The DOM keeps growing well past that event: the spike read every article
/// 15s later and got a complete `<article>` each time.
///
/// This is a floor, not a deadline, and the floor is the point. The first
/// version of this module stopped as soon as the text stopped growing for 1.5s
/// and came back with 735 characters of the same Bloomberg article the spike had
/// measured at 1345 — the page pauses mid-fill for longer than any "it stopped
/// changing" test can tell from "it is finished".
pub const SETTLE_MIN: Duration = Duration::from_secs(15);
/// Where the settle gives up on a page that is still growing at `SETTLE_MIN`.
/// Nothing measured a page that needed this; it exists so a document that
/// rewrites itself forever cannot hold the fetch open.
pub const SETTLE_MAX: Duration = Duration::from_secs(30);
/// Gap between two extraction polls while waiting for the DOM to settle. Also
/// how quickly a bot wall is noticed, which ends the wait early.
pub const SETTLE_POLL: Duration = Duration::from_millis(750);
/// How many consecutive polls must return the same text length before a page
/// that is past `SETTLE_MIN` counts as settled. Two identical polls = 1.5s of no
/// change.
pub const SETTLE_STABLE_POLLS: u32 = 2;

/// The warm-up waits this long after `finished` and reads the page once, to see
/// whether the homepage was itself a wall. Same 15s, same reason as
/// `SETTLE_MIN`, and here there is nothing to poll for anyway: the
/// bot-detection cookies are httpOnly, so no injected script can tell whether
/// they have arrived.
pub const WARMUP_SETTLE: Duration = Duration::from_secs(15);

/// How long a warmed origin stays warm. Nothing measured this: the spike only
/// showed that a jar warmed once keeps working across process restarts within
/// the same session (82 cookies from the homepage, three articles afterwards,
/// all 200). Half an hour keeps the ~40s warm-up off all but the first fetch of
/// a reading session while re-proving the jar often enough to notice expiry.
pub const WARMUP_TTL: Duration = Duration::from_secs(30 * 60);

/// Ceiling on one `fetch_article_via_webview` call, warm-up included, so a
/// wedged page cannot hold the queue forever.
pub const OVERALL_TIMEOUT: Duration = Duration::from_secs(180);
/// Ceiling on a single injected-JS round trip.
pub const EVAL_TIMEOUT: Duration = Duration::from_secs(10);

/// Caps on what comes back over IPC. A Bloomberg article page is ~800KB of
/// rendered HTML, of which the `<article>` element is the part worth keeping.
pub const MAX_TEXT_CHARS: usize = 200_000;
pub const MAX_HTML_CHARS: usize = 400_000;
/// How much body text is scanned for bot-wall wording. The block page puts it
/// in the first 600 characters; 4000 covers a wordier one without turning the
/// whole article into a haystack.
pub const MARKER_SCAN_CHARS: usize = 4000;

/// Below this the extraction did not find an article. Measured: the metered-wall
/// previews Bloomberg serves to a logged-out reader ran 968, 1345 and 1392
/// characters in the `<article>` element, so 200 is far under the real floor.
pub const MIN_ARTICLE_CHARS: usize = 200;
/// Bot-wall wording only means "blocked" when there is no article container
/// next to it — otherwise an article *about* captchas would classify itself as
/// a block page. Measured: the block page has no container at all (0
/// characters), real articles 968 and up.
///
/// The container length is what this is compared against, never the returned
/// text: the wall's four paragraphs of "you are not a robot" come to 467
/// characters, so the `<p>` merge fallback passes any length threshold. The
/// first run of this fetcher classified a captcha page as a perfectly good
/// article that way.
pub const BLOCKED_MAX_ARTICLE_CHARS: usize = 400;

/// Wording that only appears on an interstitial. Taken from the spike's
/// detector, which fired on Bloomberg's PerimeterX page (title "Bloomberg - Are
/// you a robot?") and on nothing else it read.
const BLOCK_MARKERS: &[&str] = &[
    "are you a robot",
    "px-captcha",
    "human verification",
    "checking your browser",
    "just a moment",
    "enable javascript and cookies",
    "verify you are human",
    "unusual activity from your computer network",
];

/// How a fetch ended. The three failures the caller has to tell apart —
/// intercepted by a bot wall, too slow, never loaded — are separate variants on
/// purpose: retrying helps a timeout, a longer warm-up or a real session helps a
/// block, and neither helps a dead host.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Status {
    /// An article body came back.
    Ok,
    /// A bot wall or captcha interstitial answered instead of the article.
    Blocked,
    /// The page loaded and was not a wall, but held no article worth returning
    /// (a hard paywall with no preview, a section page, a redirect to a stub).
    Empty,
    /// The load or the settle wait ran out of time.
    Timeout,
    /// The webview reported the load as failed: DNS, TLS, connection, or a
    /// scheme the navigation guard refused.
    Network,
    /// No webview fetcher on this platform (see the module note about iOS).
    Unsupported,
}

/// What the injected extractor reports back about one document.
#[derive(Debug, Clone, Default, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Readout {
    pub title: String,
    pub url: String,
    /// The body: the article's own paragraphs, joined.
    pub text: String,
    /// Those paragraphs' markup, for the extraction stack downstream.
    pub html: String,
    /// How much text the container held, before any `<p>`-merge fallback
    /// replaced it. The bot-wall check reads this and not `text`.
    #[serde(default)]
    pub container_chars: usize,
    /// Which selector produced the body. For diagnosing a site that changed its
    /// markup.
    pub selector: String,
    /// How many inline "Read More: <other headline>" promo lines were dropped
    /// from the body. Site self-promotion sitting in the prose, not sentences of
    /// this article; counted so the removal is visible.
    #[serde(default)]
    pub promos_dropped: usize,
    /// Whether the page still offers a way to sign in. The signal a logged-in
    /// session is checked by: measured against three Bloomberg articles, it went
    /// true → false when the session was real, with no paywall marker left.
    #[serde(default)]
    pub sees_sign_in: bool,
    /// Head of `document.body.innerText`, for the bot-wall check.
    pub body_head: String,
    /// `application/ld+json` blocks, which carry headline/author/date and
    /// sometimes the article body itself.
    #[serde(default)]
    pub ld_json: Vec<String>,
}

/// Reject anything the hidden webview has no business loading before a window
/// is ever created. The webview runs a hostile page by design, so the entry
/// point is narrow: public http(s) only.
pub fn validate_target(raw: &str) -> Result<Url, String> {
    let url = Url::parse(raw).map_err(|e| format!("not a URL: {e}"))?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err(format!("unsupported scheme: {}", url.scheme()));
    }
    let Some(host) = url.host_str() else {
        return Err("URL has no host".to_string());
    };
    // The same rule the navigation guard applies to a fetcher window's
    // redirects, applied to the entry point: never this machine, never the LAN
    // behind it, never the app's own origin under wry's workaround hosts.
    if crate::navigation::is_local_host(host) {
        return Err(format!("refusing to fetch a local address: {host}"));
    }
    Ok(url)
}

/// The page to load before the article: the site's own root.
///
/// This is the finding the whole feature rests on. Opening a Bloomberg article
/// in a cold profile is a 403 and a captcha page, every time, in the same engine
/// Tauri ships. Loading `https://www.bloomberg.com/` first leaves 82 cookies in
/// the jar, and the same three articles then return 200 with a complete
/// `<article>`. Warming is a precondition, not a nicety.
///
/// `None` when the target already is the root, so a homepage fetch does not warm
/// itself.
pub fn warmup_target(url: &Url) -> Option<Url> {
    if url.path() == "/" && url.query().is_none() {
        return None;
    }
    let mut root = url.clone();
    root.set_path("/");
    root.set_query(None);
    root.set_fragment(None);
    Some(root)
}

/// The key a warm-up is remembered under: scheme + host + port. Warming
/// `www.bloomberg.com` says nothing about `www.economist.com`, and the cookie
/// jar is per-host anyway.
pub fn origin_key(url: &Url) -> String {
    match url.port() {
        Some(port) => format!("{}://{}:{}", url.scheme(), url.host_str().unwrap_or(""), port),
        None => format!("{}://{}", url.scheme(), url.host_str().unwrap_or("")),
    }
}

/// Which origins have been warmed and when. Held in app state so a warm-up is
/// paid once per origin per TTL instead of once per article.
#[derive(Debug, Default)]
pub struct WarmupLedger {
    warmed: HashMap<String, Instant>,
}

impl WarmupLedger {
    /// Whether `origin` has to be warmed before an article there is fetched.
    pub fn needs_warmup(&self, origin: &str, now: Instant) -> bool {
        match self.warmed.get(origin) {
            Some(at) => now.duration_since(*at) >= WARMUP_TTL,
            None => true,
        }
    }

    /// Record a warm-up that completed. Only successful ones are recorded: a
    /// warm-up that timed out has proven nothing about the jar.
    pub fn record(&mut self, origin: &str, now: Instant) {
        self.warmed.insert(origin.to_string(), now);
    }

    /// Drop a remembered warm-up. Used when an article comes back blocked
    /// anyway, so the next attempt warms again instead of trusting a jar the
    /// site has evidently stopped accepting.
    pub fn forget(&mut self, origin: &str) {
        self.warmed.remove(origin);
    }
}

/// Whether a document is a bot wall rather than the article. Needs both the
/// wording and the absence of an article container (see
/// `BLOCKED_MAX_ARTICLE_CHARS`).
pub fn looks_blocked(readout: &Readout) -> bool {
    if readout.container_chars > BLOCKED_MAX_ARTICLE_CHARS {
        return false;
    }
    let haystack = format!(
        "{} {}",
        readout.title.to_lowercase(),
        readout
            .body_head
            .chars()
            .take(MARKER_SCAN_CHARS)
            .collect::<String>()
            .to_lowercase()
    );
    BLOCK_MARKERS.iter().any(|m| haystack.contains(m))
}

/// What a settled document amounts to.
pub fn classify(readout: &Readout) -> Status {
    if looks_blocked(readout) {
        return Status::Blocked;
    }
    if readout.text.chars().count() < MIN_ARTICLE_CHARS {
        return Status::Empty;
    }
    Status::Ok
}

/// Cut a string to a character budget (not bytes: the caller's budget is about
/// how much text a model will read, and a byte cut can split a UTF-8 sequence).
pub fn truncate_chars(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        return s.to_string();
    }
    s.chars().take(max).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn url(raw: &str) -> Url {
        Url::parse(raw).expect("test url")
    }

    #[test]
    fn only_public_web_urls_are_fetchable() {
        assert!(validate_target("https://www.bloomberg.com/news/articles/x").is_ok());
        assert!(validate_target("http://example.com/a").is_ok());
        for bad in [
            "file:///etc/passwd",
            "data:text/html,<h1>hi</h1>",
            "tauri://localhost/index.html",
            "javascript:alert(1)",
            "about:blank",
            "not a url",
        ] {
            assert!(validate_target(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn the_fetcher_is_never_pointed_at_this_machine() {
        for bad in [
            "http://localhost:1420/",
            "http://127.0.0.1/admin",
            "http://192.168.1.1/",
            "http://10.0.0.5/status",
            "http://172.16.3.4/",
            "http://169.254.169.254/latest/meta-data/",
            "http://[::1]:8080/",
            "http://tauri.localhost/index.html",
            "http://img.localhost/x",
            "http://0.0.0.0/",
        ] {
            assert!(validate_target(bad).is_err(), "{bad}");
        }
        // A public address that merely looks private-ish is fine: 172.32 is
        // outside the 172.16/12 block.
        assert!(validate_target("http://172.32.0.1/").is_ok());
        assert!(validate_target("https://8.8.8.8/").is_ok());
    }

    #[test]
    fn an_article_warms_its_own_site_root() {
        assert_eq!(
            warmup_target(&url(
                "https://www.bloomberg.com/news/articles/2026-08-11/aluminum-hits-seven-week-high"
            ))
            .map(|u| u.to_string()),
            Some("https://www.bloomberg.com/".to_string())
        );
        // Query and fragment belong to the article, not to the homepage.
        assert_eq!(
            warmup_target(&url("https://www.economist.com/x/y?utm=1#top")).map(|u| u.to_string()),
            Some("https://www.economist.com/".to_string())
        );
        // A root URL warms itself by being loaded.
        assert_eq!(warmup_target(&url("https://www.bloomberg.com/")), None);
    }

    #[test]
    fn warmups_are_remembered_per_origin_and_expire() {
        let start = Instant::now();
        let mut ledger = WarmupLedger::default();
        let bb = origin_key(&url("https://www.bloomberg.com/news/articles/x"));
        let ec = origin_key(&url("https://www.economist.com/a/b"));
        assert_eq!(bb, "https://www.bloomberg.com");

        assert!(ledger.needs_warmup(&bb, start));
        ledger.record(&bb, start);
        // Same origin, well inside the TTL: the second article skips the ~40s
        // homepage load.
        assert!(!ledger.needs_warmup(&bb, start + Duration::from_secs(60)));
        // A different site is a different jar.
        assert!(ledger.needs_warmup(&ec, start + Duration::from_secs(60)));
        // Past the TTL it is warmed again.
        assert!(ledger.needs_warmup(&bb, start + WARMUP_TTL));
        // A block sends us back to warming even inside the TTL.
        ledger.record(&bb, start + WARMUP_TTL);
        ledger.forget(&bb);
        assert!(ledger.needs_warmup(&bb, start + WARMUP_TTL));
    }

    #[test]
    fn the_port_is_part_of_the_origin() {
        assert_eq!(origin_key(&url("https://example.com:8443/a")), "https://example.com:8443");
        assert_eq!(origin_key(&url("http://example.com/a")), "http://example.com");
    }

    // The three fixtures below are the real documents the spike captured, cut
    // to the fields the classifier reads (webkit-spike/bb1.json, bb-warm.json).

    fn perimeterx_wall() -> Readout {
        Readout {
            title: "Bloomberg - Are you a robot?".into(),
            url: "https://www.bloomberg.com/news/articles/2026-08-11/aluminum-hits".into(),
            // What the extractor really returns for this page: no container
            // (container_chars 0), so the <p> merge kicks in and produces 467
            // characters of captcha wording that look like a body.
            text: "To continue, please click the box below to let us know you're not a robot.\n\n\
                   Please make sure your browser supports JavaScript and cookies and that you are \
                   not blocking them from loading. For more information you can review our Terms \
                   of Service and Cookie Policy.\n\nFor inquiries related to this message please \
                   contact our support team and provide the reference ID below.\n\nGet the most \
                   important global markets news at your fingertips with a Bloomberg.com \
                   subscription."
                .into(),
            html: String::new(),
            container_chars: 0,
            selector: "p".into(),
            promos_dropped: 0,
            // The wall is what an anonymous reader sees, so of course it offers
            // no sign-in link of its own.
            sees_sign_in: false,
            body_head: "BloombergNeed help? Contact us We've detected unusual activity from your \
                        computer network To continue, please click the box below to let us know \
                        you're not a robot. Why did this happen? Please make sure your browser \
                        supports JavaScript and cookies"
                .into(),
            ld_json: vec![],
        }
    }

    fn warmed_article() -> Readout {
        // 1392 characters in the spike; the shape is what matters here.
        let body = "Aluminum advanced for a seventh day as fading prospects for a quick deal to \
                    reopen the Strait of Hormuz fueled concerns that Middle Eastern supplies would \
                    remain constrained for the foreseeable future. "
            .repeat(6);
        Readout {
            title: "Aluminum Hits Seven-Week High as Hormuz Impasse Threatens Supply - Bloomberg"
                .into(),
            url: "https://www.bloomberg.com/news/articles/2026-08-11/aluminum-hits".into(),
            container_chars: body.chars().count(),
            text: body,
            html: "<p>…</p>".into(),
            selector: "[data-component=\"paragraph\"]".into(),
            promos_dropped: 1,
            // Read anonymously: the header still offers a sign-in.
            sees_sign_in: true,
            body_head: "Bloomberg the Company & Its Products Markets Commodities Aluminum Hits \
                        Seven-Week High"
                .into(),
            ld_json: vec!["{\"@type\":\"NewsArticle\"}".into()],
        }
    }

    #[test]
    fn the_bot_wall_is_recognised() {
        let wall = perimeterx_wall();
        assert!(looks_blocked(&wall));
        assert_eq!(classify(&wall), Status::Blocked);
    }

    #[test]
    fn the_paragraph_merge_does_not_rescue_a_bot_wall() {
        // Regression: the first end-to-end run returned this page as `ok` with
        // 467 characters of "article", because the wall's own paragraphs are
        // longer than any threshold worth setting. Only the missing container
        // separates it from a real body.
        let wall = perimeterx_wall();
        assert!(wall.text.chars().count() > BLOCKED_MAX_ARTICLE_CHARS);
        assert_eq!(wall.container_chars, 0);
        assert_eq!(classify(&wall), Status::Blocked);
    }

    #[test]
    fn a_warmed_article_reads_as_an_article() {
        let article = warmed_article();
        assert!(!looks_blocked(&article));
        assert_eq!(classify(&article), Status::Ok);
    }

    #[test]
    fn an_article_about_captchas_is_not_a_wall() {
        // The wording alone must not condemn a page: this is why the check
        // requires a missing article body as well.
        let mut article = warmed_article();
        article.title = "Are you a robot? Inside the captcha arms race".into();
        article.body_head = "Just a moment: why every site now asks you to verify you are human"
            .into();
        assert!(!looks_blocked(&article));
        assert_eq!(classify(&article), Status::Ok);
    }

    #[test]
    fn a_page_with_no_article_is_empty_not_blocked() {
        let readout = Readout {
            title: "Markets - Bloomberg".into(),
            url: "https://www.bloomberg.com/markets".into(),
            text: "Sign in Subscribe".into(),
            ..Default::default()
        };
        assert_eq!(classify(&readout), Status::Empty);
    }

    #[test]
    fn truncation_counts_characters_not_bytes() {
        assert_eq!(truncate_chars("经济学人的正文", 3), "经济学");
        assert_eq!(truncate_chars("short", 50), "short");
    }
}
