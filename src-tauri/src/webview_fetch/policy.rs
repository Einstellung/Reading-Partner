// The decisions the webview fetcher makes, separated from the windows and
// timers it makes them with: which URLs may be handed to the hidden webview,
// which origin has to be warmed up first and when that warm-up expires, and
// what a page readout means (article / bot wall / empty / broken). All of it is
// plain data in and out, so it is unit-tested here instead of being observed by
// hand through a webview.
//
// Every number in here was measured against bloomberg.com in WebKitGTK 2.52.3 /
// webkit2gtk-4.1, the same engine Tauri uses on Linux. Most of them come from
// the 2026-08-11 spike; the settle numbers were re-measured on 2026-08-12 in
// this fetcher's own hidden window, because the two harnesses do not read the
// same page the same way and a number from one is not a baseline for the other
// (docs/pitfall/113). The measurements are quoted at each constant; anything not
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

// What ends the wait after `finished` is a property of the document — it stopped
// changing, and what it holds is an article — not an amount of time.
//
// Measured 2026-08-12 in this fetcher's own hidden window (not in a spike
// harness) with `RP_WEBVIEW_FETCH_TRACE`, see mod.rs: it records the fill curve
// poll by poll, so every candidate rule is replayed off one page load instead of
// costing one load per rule. Bloomberg, logged out, warm jar, `finished` as t=0:
//
// | page                        | body whole at | changed again within |
// |-----------------------------|---------------|----------------------|
// | aluminum-hits-seven-week-…  | 55ms, 493 ch  | no, watched to 45.2s |
// | gautam-adani-wins-dismissal | 2ms, 441 ch   | no, watched to 45.1s |
// | www.bloomberg.com (warm-up) | 6ms, 575 ch   | no, watched to 45.4s |
// | www.bloomberg.com, again    | 11ms, 575 ch  | no, watched to 25.7s |
//
// Nothing arrived after the first poll. A 15-second floor used to sit under both
// phases; replayed against these recordings it returns the same body as a
// 3-second one and charges 15 seconds a phase for it.
//
// Live end to end, warm-up included, the two builds run back to back against
// en.wikipedia.org/wiki/Portable_Document_Format — a site that answers reliably,
// so the stopwatch is not measuring bloomberg.com's mood: 35.9s before, 9.1s
// after, and both return the same 35168 characters of body, string for string.
// A Bloomberg article under the new rule came back `ok` with 581 characters in
// 28.8s including a cold warm-up. The matching run on the old build could not be
// taken: bloomberg.com had by then stopped completing loads for this client
// often enough that a stopwatch reading would have been noise, and retrying
// until it cooperated was not worth the block. Both of those runs of the new
// build used a two-poll stability window; the four-poll one shipped here adds
// 1.5s a phase on top of them.
//
// The floor's evidence was two harnesses' readings of one page set against each
// other rather than two moments of one harness — docs/pitfall/113 has that
// story, and it is worth reading before anyone reaches for a fixed wait again.
//
// Measured logged out, which is the only state the app can be in today. On
// Bloomberg that means the body under test is the metered preview: two
// paragraphs, already in the server-rendered HTML. A signed-in article is
// several times longer, and whether its tail is mounted lazily — the one thing
// that would make an early stop lose text — is not verified. Re-run the trace
// when there is a session to run it under.

/// Where the settle gives up on a document that never satisfies `settle_is_done`.
/// Nothing measured a page that needed this; it exists so a document that
/// rewrites itself forever cannot hold the fetch open.
///
/// With the floor gone this is the only way a fetch still spends 30 seconds, and
/// it takes a page that never produces a body (a hard paywall, a section page)
/// or one that never stops rewriting the body it has. A page that hands over its
/// article stops at `SETTLE_STABLE_POLLS` and never comes near this.
pub const SETTLE_MAX: Duration = Duration::from_secs(30);
/// Gap between two extraction polls while waiting for the DOM to settle. Also
/// how quickly a bot wall is noticed, which ends the wait early. Measured: one
/// extraction over Bloomberg's ~800KB article DOM costs 1-4ms, 65ms at its
/// worst, so the interval is chosen for how long "no change" has to last, not
/// for what the polling costs.
pub const SETTLE_POLL: Duration = Duration::from_millis(750);
/// How many consecutive polls must return the same body length before the page
/// counts as settled. Four identical polls = 3s of no change.
///
/// Read out of the recordings above rather than picked. The body was whole at
/// the first poll on every page, but the document went on being edited after
/// that: on the aluminum article the container grew 696 -> 722 -> 732
/// characters, its last change at 2310ms. A two-poll window exits that page at
/// 1558ms, while it is still changing — the change that came after happened not
/// to touch the body. Four polls exit at 3011-3088ms across the four
/// recordings, past every article-side change they hold, and return the same
/// body text as two. (A homepage never does stop changing: its container
/// flickers by six characters for as long as it is watched. That is why the
/// rule reads the body, which does hold still, and not the container.)
///
/// The margin is worth 1.5s a phase (3s on a fetch that warms up, against the
/// 27s the floor's removal saves) because reading a page mid-edit fails
/// quietly. `classify` calls anything past `MIN_ARTICLE_CHARS` an article, and
/// nothing downstream weighs a body against the length it should have had, so
/// stopping early returns a shorter `Ok` rather than an error.
pub const SETTLE_STABLE_POLLS: u32 = 4;

/// How long a warmed origin stays warm. Nothing measured this: the spike only
/// showed that a jar warmed once keeps working across process restarts within
/// the same session (82 cookies from the homepage, three articles afterwards,
/// all 200). Half an hour keeps the ~40s warm-up off all but the first fetch of
/// a reading session while re-proving the jar often enough to notice expiry.
pub const WARMUP_TTL: Duration = Duration::from_secs(30 * 60);

/// Ceiling on one `fetch_article_via_webview` call, warm-up included, so a
/// wedged page cannot hold the queue forever.
///
/// The worst case under it is 165s: `WARMUP_LOAD_TIMEOUT` + `SETTLE_MAX` on the
/// homepage, then `LOAD_TIMEOUT` + `SETTLE_MAX` on the article. It was 150s
/// while the warm-up settled by sleeping a fixed 15s; now that the warm-up runs
/// the article's loop it can spend `SETTLE_MAX` the same way.
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
/// The warm-up used to sleep 15 seconds after `finished` on the theory that the
/// cookies it is there to collect are httpOnly and so unobservable. They are
/// unobservable *to injected JS*; they are not unobservable. WebKitGTK writes
/// the jar to `<profile>/cookies` as it goes, in Netscape format, httpOnly
/// entries included, and watching that file during a cold warm-up (2026-08-12,
/// 200ms sampling) puts PerimeterX's `_px3`, `_px2`, `_pxvid` and `_pxde` in the
/// jar 6.5 seconds into the homepage load — while it was still loading, and in
/// that run `finished` never came at all within the 60s timeout. So there was
/// never anything for a post-`finished` sleep to wait for, and the warm-up now
/// ends the same way an article does: when the document stops changing (measured
/// at 6ms) and is not a wall.
///
/// That the jar can be read from disk is also the answer to a bigger problem
/// than this one. `finished` on the homepage is not an event to build on: it is
/// the heaviest page on the site, and across one session on 2026-08-12 it
/// arrived on four warm-up attempts out of twelve (43.1s and 23.5s among them)
/// and did not arrive inside the 60s timeout on the other eight. Each of those
/// eight failed a whole fetch for want of an event whose cookies had already
/// landed: the two runs with a jar watcher on them ended with 47 and 48 cookies
/// on disk, `_px3` among them both times. The warm-up had everything it exists
/// to collect and reported failure anyway. (The site was stalling article loads
/// in the same stretch, so how much of this is the page's weight and how much is
/// bloomberg.com tiring of a client that had loaded twenty pages in an hour is
/// not established — but the jar does not care either way.) Ending the warm-up
/// on the jar instead of on `finished` is the obvious next move; nothing has
/// measured that yet, so it is not done here.
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

/// Which page a fetch is on. The two ask different things of the same wait: the
/// warm-up wants the site's cookies and any document at all will do, the article
/// wants a body.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Phase {
    /// Load a site's homepage to fill the cookie jar. Nothing is extracted from
    /// it except the check that it is not itself a wall.
    Warmup,
    /// Load an article and read its body.
    Article,
}

/// Whether the settle loop can stop reading, given how many consecutive polls
/// have now returned the same body length.
///
/// Two conditions, and neither of them is a clock. The document has to have
/// stopped changing — anything read before that is a page caught mid-fill. And
/// on the article phase it has to hold something worth stopping for: a settled
/// document with no body in it is as likely to be one that has not started
/// filling as one that never will, so that case keeps reading until `SETTLE_MAX`
/// ends it. The warm-up asks only for the first condition, because a homepage
/// has no article and waiting for one would spend `SETTLE_MAX` on every cold
/// origin.
///
/// That one condition also passes on a document with nothing rendered in it: a
/// body that holds at zero length settles the warm-up. What supports that is
/// that the cookies land before the page is done — one cold profile on
/// bloomberg.com, 2026-08-12, `_px3` in the jar at 6.5s while `finished` never
/// arrived inside 60s (docs/pitfall/114). One origin, one run. It should hold
/// wherever the challenge script runs before the load event; a site that runs
/// one after it is the case the deleted 15s floor happened to cover, and
/// nothing here has measured one.
pub fn settle_is_done(phase: Phase, stable: u32, readout: &Readout) -> bool {
    if stable < SETTLE_STABLE_POLLS {
        return false;
    }
    match phase {
        Phase::Warmup => true,
        Phase::Article => classify(readout) == Status::Ok,
    }
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
    fn nothing_is_settled_while_the_body_is_still_changing() {
        // The only thing that ever ends the wait early is the wall check; a
        // document that is still moving is never done, whatever the clock says.
        let article = warmed_article();
        for stable in 0..SETTLE_STABLE_POLLS {
            assert!(!settle_is_done(Phase::Article, stable, &article), "{stable}");
            assert!(!settle_is_done(Phase::Warmup, stable, &article), "{stable}");
        }
    }

    #[test]
    fn a_settled_article_is_done_and_a_settled_blank_page_is_not() {
        let article = warmed_article();
        assert!(settle_is_done(Phase::Article, SETTLE_STABLE_POLLS, &article));

        // What the 15s floor was really covering, covered by the readout
        // instead: a page that has been quiet for two polls with nothing in it
        // is still read, right up to SETTLE_MAX, because "quiet and empty" and
        // "has not started filling" look the same.
        let blank = Readout {
            title: "Aluminum Extends Rally - Bloomberg".into(),
            ..Default::default()
        };
        assert_eq!(classify(&blank), Status::Empty);
        assert!(!settle_is_done(Phase::Article, SETTLE_STABLE_POLLS, &blank));
        assert!(!settle_is_done(Phase::Article, 99, &blank));
    }

    #[test]
    fn a_warm_up_is_done_with_a_settled_page_that_holds_no_article() {
        // A homepage is `Empty` by the article's standard, and that is the
        // normal case: the warm-up is there for the cookie jar, not for a body.
        let homepage = Readout {
            title: "Bloomberg - Business News, Stock Markets, Finance".into(),
            text: "Sign in".into(),
            ..Default::default()
        };
        assert_eq!(classify(&homepage), Status::Empty);
        assert!(settle_is_done(Phase::Warmup, SETTLE_STABLE_POLLS, &homepage));
        assert!(!settle_is_done(Phase::Warmup, SETTLE_STABLE_POLLS - 1, &homepage));
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
