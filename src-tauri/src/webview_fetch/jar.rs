// The cookie jar as the warm-up's completion signal.
//
// The warm-up loads a site's homepage for one reason: to have that site's
// cookies in the profile before the article is asked for. It used to end only
// on the page's `finished` load event, and on bloomberg.com — the heaviest page
// on the site — that event is not something to build on. Across one session on
// 2026-08-12 it arrived on four warm-up attempts out of twelve; the other eight
// ran into the 60s timeout, and every one of those failed a whole fetch.
//
// What the warm-up was actually waiting for had arrived long before. WebKitGTK
// writes the jar to `<profile>/cookies` as it goes — Netscape text, httpOnly
// rows carrying a `#HttpOnly_` prefix (docs/pitfall/110) — so the warm-up can
// watch the thing it wants instead of an event that may never come. Two
// bloomberg.com homepage loads sampled at 200ms, neither of which ever reached
// `finished`, `_px3` being the PerimeterX cookie the article needs
// (docs/pitfall/114):
//
// | since the first row | rows | what landed                        |
// |---------------------|------|------------------------------------|
// |               0.000 |    5 | server Set-Cookie: session_id, …   |
// |               3.249 |    7 | first script-set pair              |
// |        4.265–5.281  |   18 | `_pxvid` `_px3` `_px2` `_pxde`     |
// |        5.485–9.365  |   44 | analytics, ads                     |
// |              14.070 |   46 | Stripe                             |
// |              46.851 |   47 | Reddit pixel                       |
//
// The second, later the same session on a jar that already held five rows:
//
// |        0.000–4.684  |   45 | the lot, `_px3` in the last step   |
// |              10.209 |   47 | Stripe                             |
// |              44.011 |   48 | Reddit pixel                       |
//
// Both loads had every cookie the article needs within ten seconds, and neither
// was ever going to report a load event.
//
// bloomberg.com is not the only site that behaves this way, which matters,
// because a rule fitted to one site's recordings is a rule fitted to one site.
// Recorded 2026-08-12 through this module's own sampler (see `trace_config`),
// techcrunch.com's homepage did not reach `finished` inside 30 seconds either,
// cold or warm:
//
// | site, profile        | rows        | changes | first–last | widest gap between |
// |----------------------|-------------|---------|------------|--------------------|
// | techcrunch, cold     | 0 → 13      |      11 | 3.0–12.0s  | 3.25s              |
// | techcrunch, warm     | 13 → 13     |       5 | 3.0–5.8s   | 1.50s              |
// | en.wikipedia, cold   | 0 → 2       |       1 | 1.0s       | —                  |
// | en.wikipedia, warm   | 2 → 2       |       0 | —          | —                  |
//
// Two things in that table shape the rule. The warm techcrunch load never
// changed the row count and rewrote the rows five times, so counting rows would
// have seen a re-warm as nothing happening at all — what is watched has to be
// the contents. And wikipedia is the ordinary case: it sets its cookies once
// and reports itself loaded 3.6 seconds in, so the jar never gets to decide and
// does not need to.
//
// Why this is sampled and not read once: when WebKit copies its in-memory jar
// to that file is WebKit's business, not the caller's (docs/pitfall/111 — the
// same property that lets a deleted cookie survive on disk). A single read
// answers "what had been written by then", which is not a question worth
// asking. A sequence of reads answers "has it stopped writing", which is.
//
// The constants and the rule sit together in this file rather than in policy.rs
// with the page-readout decisions, because they are one measurement: the poll
// interval is the resolution the gaps above were measured at, and the quiet
// window is a multiple of it chosen against those gaps.

use std::collections::hash_map::DefaultHasher;
use std::fmt;
use std::hash::{Hash, Hasher};
use std::path::Path;
use std::sync::mpsc::{Receiver, RecvTimeoutError};
use std::time::{Duration, Instant};

use tauri::Url;

use super::policy::{self, Status};
use super::{LoadEvent, PageOutcome};

/// Gap between two reads of the jar. The recordings above were taken at 200ms
/// and the decision below needs seconds of resolution, so this is chosen to
/// stay near the resolution the gaps are known at rather than for what the
/// reads cost: the file is a few KB and a warm-up reads it a few hundred times.
pub const POLL: Duration = Duration::from_millis(250);

/// How many consecutive samples must find the site's rows unchanged before the
/// warm-up is done. 24 × `POLL` = 6.0 seconds.
///
/// The number to beat is the widest gap that ever fell *inside* a load's run of
/// cookie writes, because stopping in one of those is stopping before the
/// cookies that matter: 3.249s on bloomberg.com and 3.25s on techcrunch.com,
/// two sites recorded by two different samplers. 6 seconds clears both by
/// nearly a factor of two.
///
/// There is little reason to be tighter and some to be looser. Once a load's
/// writes are over the next thing to touch the jar is 30 seconds away or never
/// (the Reddit pixel at +32.8s and +33.8s in the recordings above), so seconds
/// spent here are seconds, not a wrong answer — while stopping early hands the
/// article a jar that PerimeterX will not accept, which costs a page load, a
/// failed fetch and a re-warm. And a window that never closes is not a failure
/// either: `WARMUP_LOAD_TIMEOUT` then ends the warm-up on the cookies it has.
///
/// Replayed against the recordings, this settles a cold bloomberg.com warm-up
/// 21.3s in and a warm one 16.3s in, against the 60 seconds each of those runs
/// actually spent before reporting failure.
pub const QUIET_SAMPLES: u32 = 24;

/// How many separate changes to the site's rows must be seen before quiet means
/// anything.
///
/// One change is what a page produces by merely being served, and it can be the
/// last thing that ever happens. Measured — in the same session as the
/// recordings above, a homepage load put its five `Set-Cookie` rows in the jar
/// at +1.0s and then wrote nothing at all for the remaining 59 seconds of its
/// timeout, `_px3` never among them. Calling that warm would hand the article a
/// jar PerimeterX has never seen. Every load that did work wrote at least five
/// times.
///
/// A site that legitimately sets its cookies once and stops is not stranded by
/// this: such a page loads, `finished` arrives, and the fast path ends the
/// warm-up before the jar has anything to say. en.wikipedia.org is that site —
/// two rows, one write, loaded in 3.6 seconds.
pub const CHANGES_MIN: u32 = 2;

/// The jar as text, or empty when there is none yet — a cold profile has no
/// file until the first cookie is written.
pub fn read(profile: &Path) -> String {
    std::fs::read_to_string(profile.join("cookies")).unwrap_or_default()
}

/// The site a host belongs to: lower case, one `www.` off the front. Cookies
/// for `www.bloomberg.com` mostly live on `.bloomberg.com`, and the session
/// lives on `login.bloomberg.com`, so the site is what gets counted, never the
/// exact host.
pub fn site_of(host: &str) -> String {
    let host = host.trim().trim_end_matches('.').to_ascii_lowercase();
    host.strip_prefix("www.").unwrap_or(&host).to_string()
}

/// The domain a jar row is for: `#HttpOnly_` marker off, leading dot off, lower
/// case. `None` for blank lines and for real comments — the httpOnly marker
/// makes those rows look like comments, which is the trap in docs/pitfall/110.
pub fn row_domain(line: &str) -> Option<String> {
    let raw = line.split('\t').next()?.trim();
    if raw.is_empty() {
        return None;
    }
    let domain = match raw.strip_prefix("#HttpOnly_") {
        Some(rest) => rest,
        None if raw.starts_with('#') => return None,
        None => raw,
    };
    Some(domain.trim_start_matches('.').to_ascii_lowercase())
}

/// Whether a row's domain belongs to `site` (as returned by `site_of`): the
/// site itself or anything under it. Never the other way round — a cookie on a
/// shorter domain than the site is somebody else's.
pub fn belongs_to(domain: &str, site: &str) -> bool {
    domain == site || domain.ends_with(&format!(".{site}"))
}

/// How many rows the jar holds for `site`, and a mark that changes whenever any
/// of them changes.
///
/// The mark is what makes a re-warm observable. A profile that has been warmed
/// before starts the next warm-up with a full jar, so counting rows would see
/// nothing happen at all; but the page rewrites those rows — new `_px3`, new
/// expiry — and that is a change. Rows are summed rather than hashed in order,
/// so a jar rewritten in a different order is not mistaken for a jar that
/// changed.
pub fn fingerprint(jar: &str, site: &str) -> (usize, u64) {
    let mut rows = 0;
    let mut mark: u64 = 0;
    for line in jar.lines() {
        let Some(domain) = row_domain(line) else {
            continue;
        };
        if !belongs_to(&domain, site) {
            continue;
        }
        rows += 1;
        let mut hasher = DefaultHasher::new();
        line.trim_end().hash(&mut hasher);
        mark = mark.wrapping_add(hasher.finish());
    }
    (rows, mark)
}

/// The jar's state across a warm-up, sample by sample. Pure: `sample` is fed
/// readings and decides, so a recorded load can be replayed through it without
/// a webview.
#[derive(Debug, Clone)]
pub struct Watch {
    site: String,
    rows: usize,
    mark: u64,
    changes: u32,
    quiet: u32,
    started: bool,
}

impl Watch {
    pub fn new(host: &str) -> Self {
        Self {
            site: site_of(host),
            rows: 0,
            mark: 0,
            changes: 0,
            quiet: 0,
            started: false,
        }
    }

    /// Take a reading of the jar text.
    pub fn observe(&mut self, jar: &str) {
        let (rows, mark) = fingerprint(jar, &self.site);
        self.sample(rows, mark);
    }

    /// Take a reading directly. The first one is only a baseline: whatever the
    /// jar already held when this warm-up started is not something this
    /// warm-up did.
    pub fn sample(&mut self, rows: usize, mark: u64) {
        if !self.started {
            self.started = true;
            self.rows = rows;
            self.mark = mark;
            return;
        }
        if rows != self.rows || mark != self.mark {
            self.changes += 1;
            self.quiet = 0;
            self.rows = rows;
            self.mark = mark;
        } else {
            self.quiet = self.quiet.saturating_add(1);
        }
    }

    /// Whether the site's cookies have arrived and stopped arriving.
    pub fn is_settled(&self) -> bool {
        self.changes >= CHANGES_MIN && self.quiet >= QUIET_SAMPLES
    }

    /// Whether this warm-up has anything to show for itself. A jar with no row
    /// for the site is the one outcome that is a failure rather than a slow
    /// success: the page did not answer, and the article will not either.
    pub fn is_warm(&self) -> bool {
        self.rows > 0
    }

    fn report(&self, settled: bool, elapsed: Duration) -> Report {
        Report {
            rows: self.rows,
            changes: self.changes,
            settled,
            ms: elapsed.as_millis() as u64,
        }
    }
}

/// What the warm-up ended on. Kept apart because they mean different things
/// downstream: a page that loaded can be read, a page known only through its
/// cookies cannot be waited on any further.
pub enum Warm {
    /// `finished` arrived. The page is there to be looked at, and the warm-up
    /// goes on to settle and read it like any other.
    Loaded,
    /// The jar answered instead, either because it went quiet or because the
    /// load ran out of time with the site's cookies already in it.
    Jar(Report),
}

/// What the jar said, for the fetch result's `detail`.
pub struct Report {
    pub rows: usize,
    pub changes: u32,
    /// False when the wait ended on the load timeout rather than on the jar
    /// going quiet: the cookies are there, the page never stopped moving.
    pub settled: bool,
    pub ms: u64,
}

impl fmt::Display for Report {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "{} cookie rows for the site after {} change{} in {:.1}s ({})",
            self.rows,
            self.changes,
            if self.changes == 1 { "" } else { "s" },
            self.ms as f64 / 1000.0,
            if self.settled {
                "jar quiet"
            } else {
                "load timed out"
            }
        )
    }
}

/// Wait for the warm-up's homepage to have done what it is loaded for.
///
/// Four ways out, and only the last is a failure:
///
/// - `finished` arrives. The fast path, and the one most sites take; it is
///   still the better signal when it comes, because it says the whole page is
///   there rather than only its cookies.
/// - The jar goes quiet under the rule above. The page may well still be
///   loading; the warm-up has what it came for and stops paying for the rest.
/// - `WARMUP_LOAD_TIMEOUT` runs out with the site's cookies in the jar. Same
///   conclusion, reached by exhaustion instead of by the rule — this is what
///   catches a load that never stops writing.
/// - The load fails outright, or the timeout runs out with no row for the site
///   at all. Nothing was collected, so nothing was warmed.
pub fn wait_for_warm_jar(
    rx: &Receiver<LoadEvent>,
    profile: &Path,
    home: &Url,
    started: Instant,
) -> Result<Warm, PageOutcome> {
    let trace = trace_config();
    let poll = trace.map_or(POLL, |(_, poll)| poll);
    let opened = Instant::now();
    let deadline = opened + trace.map_or(policy::WARMUP_LOAD_TIMEOUT, |(window, _)| window);
    let mut watch = Watch::new(home.host_str().unwrap_or_default());
    let mut finished = false;
    loop {
        if started.elapsed() > policy::OVERALL_TIMEOUT {
            return Err(PageOutcome::failed(
                Status::Timeout,
                "overall fetch budget exhausted",
            ));
        }
        match rx.recv_timeout(poll) {
            Ok(LoadEvent::Finished) => {
                finished = true;
                if trace.is_none() {
                    return Ok(Warm::Loaded);
                }
            }
            Ok(LoadEvent::Failed(detail)) => {
                return Err(PageOutcome::failed(Status::Network, detail))
            }
            Err(RecvTimeoutError::Disconnected) => {
                return Err(PageOutcome::failed(
                    Status::Network,
                    "the webview went away before the page loaded",
                ))
            }
            Err(RecvTimeoutError::Timeout) => {}
        }

        watch.observe(&read(profile));
        if trace.is_some() {
            print_sample(&watch, opened.elapsed(), finished);
        } else if watch.is_settled() {
            return Ok(Warm::Jar(watch.report(true, opened.elapsed())));
        }
        if Instant::now() >= deadline {
            if finished {
                return Ok(Warm::Loaded);
            }
            return if watch.is_warm() {
                Ok(Warm::Jar(watch.report(trace.is_none(), opened.elapsed())))
            } else {
                Err(PageOutcome::failed(
                    Status::Timeout,
                    format!(
                        "no load event and no cookies within {}s",
                        policy::WARMUP_LOAD_TIMEOUT.as_secs()
                    ),
                ))
            };
        }
    }
}

/// Dev-only measurement mode: `RP_WEBVIEW_FETCH_JAR_TRACE=<seconds>[:<poll_ms>]`.
///
/// With it set the warm-up decides nothing: it samples the jar for the whole
/// window, ignoring both the rule above and `finished`, and prints one `RP-JAR`
/// line per sample. Those lines are the jar's curve for that load — `ms`,
/// `rows` and `mark` are exactly what `Watch::sample` takes — so every
/// candidate rule can be replayed off one recording instead of costing one page
/// load each. That is how `QUIET_SAMPLES` and `CHANGES_MIN` were set; re-record
/// rather than guess when a site changes what it does.
///
/// Run it under the fetch probe (`RP_WEBVIEW_FETCH_PROBE`, see mod.rs) and
/// under Xvfb, so no window reaches a screen.
fn trace_config() -> Option<(Duration, Duration)> {
    let raw = std::env::var("RP_WEBVIEW_FETCH_JAR_TRACE").ok()?;
    let (secs, poll_ms) = match raw.split_once(':') {
        Some((secs, poll)) => (secs, poll.parse().ok()?),
        None => (raw.as_str(), POLL.as_millis() as u64),
    };
    Some((
        Duration::from_secs_f64(secs.trim().parse().ok()?),
        Duration::from_millis(poll_ms),
    ))
}

fn print_sample(watch: &Watch, elapsed: Duration, finished: bool) {
    println!(
        "RP-JAR {}",
        serde_json::json!({
            "ms": elapsed.as_millis() as u64,
            "rows": watch.rows,
            "mark": watch.mark,
            "changes": watch.changes,
            "quiet": watch.quiet,
            "settled": watch.is_settled(),
            "finished": finished,
        })
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    const JAR: &str = "\
# Netscape HTTP Cookie File\n\
# https://curl.se/docs/http-cookies.html\n\
.bloomberg.com\tTRUE\t/\tTRUE\t1818037131\t_px3\tabc\n\
#HttpOnly_.bloomberg.com\tTRUE\t/\tTRUE\t1818037131\t_session_id_backup\tdef\n\
login.bloomberg.com\tFALSE\t/\tTRUE\t1818037131\t_pxhd\tghi\n\
www.bloomberg.com\tFALSE\t/\tTRUE\t1818037131\tg_state\tjkl\n\
.example.com\tTRUE\t/\tFALSE\t1818037131\tsomething\tmno\n";

    #[test]
    fn counts_only_the_site_s_rows() {
        let (rows, _) = fingerprint(JAR, &site_of("www.bloomberg.com"));
        assert_eq!(rows, 4, "the site's rows, httpOnly and subdomain included");
        let (rows, _) = fingerprint(JAR, &site_of("example.com"));
        assert_eq!(rows, 1);
        let (rows, _) = fingerprint(JAR, &site_of("nothing.test"));
        assert_eq!(rows, 0);
    }

    #[test]
    fn a_shorter_domain_is_another_site() {
        assert!(belongs_to("login.bloomberg.com", "bloomberg.com"));
        // A row on the parent belongs to the parent, not to the subdomain that
        // asked, and a name that merely ends the same way is a stranger.
        assert!(!belongs_to("bloomberg.com", "login.bloomberg.com"));
        assert!(!belongs_to("notbloomberg.com", "bloomberg.com"));
    }

    #[test]
    fn a_rewritten_row_is_a_change_even_though_the_count_holds() {
        let site = site_of("www.bloomberg.com");
        let refreshed = JAR.replace("_px3\tabc", "_px3\txyz");
        let (rows, mark) = fingerprint(JAR, &site);
        let (rows_after, mark_after) = fingerprint(&refreshed, &site);
        assert_eq!(rows, rows_after);
        assert_ne!(mark, mark_after, "a re-warm has to be observable");
    }

    #[test]
    fn row_order_is_not_a_change() {
        let site = site_of("www.bloomberg.com");
        let mut lines: Vec<&str> = JAR.lines().collect();
        lines.reverse();
        let reversed = lines.join("\n");
        assert_eq!(fingerprint(JAR, &site), fingerprint(&reversed, &site));
    }

    /// Feed a `Watch` a recorded load and return when it settled, in ms since
    /// the watch started, or `None` if it never did.
    ///
    /// A recording is one entry per write the jar took — `(ms, rows)` — and the
    /// mark is the entry's own place in the list, because two writes are two
    /// writes whether or not they left the row count where it was. The samples
    /// in between are the jar holding still, which is the whole question.
    ///
    /// One recording answers for every candidate rule, which is why the loads
    /// are recorded rather than the verdicts (docs/pitfall/113).
    fn replay(curve: &[(u64, usize)], window_ms: u64) -> Option<u64> {
        let mut watch = Watch::new("www.bloomberg.com");
        let step = POLL.as_millis() as u64;
        let mut at = 0;
        while at <= window_ms {
            let (rows, mark) = curve
                .iter()
                .enumerate()
                .filter(|(_, (ms, _))| *ms <= at)
                .map(|(i, (_, rows))| (*rows, i as u64 + 1))
                .last()
                .unwrap_or((0, 0));
            watch.sample(rows, mark);
            if watch.is_settled() {
                return Some(at);
            }
            at += step;
        }
        None
    }

    /// bloomberg.com homepage, cold profile, 2026-08-12, 200ms sampling, no
    /// `finished` within the 60s timeout. Offsets in ms from the first row.
    /// `_px3` is in the 5281 step.
    const COLD_HOME: &[(u64, usize)] = &[
        (1000, 5),
        (4249, 7),
        (5265, 9),
        (5468, 12),
        (5672, 14),
        (6281, 18),
        (6485, 21),
        (6689, 26),
        (6892, 27),
        (7300, 32),
        (8117, 33),
        (8525, 39),
        (8729, 40),
        (9342, 41),
        (10365, 44),
        (15070, 46),
        (47851, 47),
    ];

    /// The same site later the same session, warm profile (5 rows already
    /// there), again with no `finished`. `_px3` is in the 4684 step, which is
    /// also the last of the burst.
    const WARM_HOME: &[(u64, usize)] = &[
        (0, 5),
        (203, 7),
        (406, 8),
        (1015, 12),
        (1219, 14),
        (1829, 15),
        (2032, 19),
        (2235, 21),
        (2439, 25),
        (2642, 30),
        (2846, 31),
        (3252, 33),
        (3660, 34),
        (4068, 41),
        (4684, 45),
        (10209, 47),
        (44011, 48),
    ];

    /// The stalled load from the same session: the response's own rows and then
    /// nothing for the rest of the timeout.
    const STALLED_HOME: &[(u64, usize)] = &[(1000, 5)];

    /// techcrunch.com, cold profile, recorded through this module's own sampler
    /// on 2026-08-12. No `finished` inside 30 seconds either. The gap between
    /// 8007 and 11259 is the widest one measured inside a load's writes.
    const TC_COLD: &[(u64, usize)] = &[
        (3002, 3),
        (3502, 3),
        (3752, 5),
        (4252, 7),
        (4503, 8),
        (4753, 10),
        (6755, 11),
        (7006, 12),
        (8007, 12),
        (11259, 12),
        (12010, 13),
    ];

    /// The same, warm profile. The count never moves: thirteen rows before,
    /// thirteen after, rewritten five times in between.
    const TC_WARM: &[(u64, usize)] = &[
        (0, 13),
        (3002, 13),
        (3253, 13),
        (4754, 13),
        (5504, 13),
        (5754, 13),
    ];

    /// en.wikipedia.org, cold profile, same sampler: two rows, written once,
    /// and the page reports itself loaded at 3.6s.
    const WIKI: &[(u64, usize)] = &[(1000, 2)];

    #[test]
    fn settles_once_the_site_stops_writing() {
        // Last write of the burst at 10.365s, then Stripe at 15.07s restarts
        // the window, then nothing until 47.9s.
        let at = replay(COLD_HOME, 60_000).expect("the jar went quiet");
        assert!(
            (21_000..21_500).contains(&at),
            "settled at {at}ms, wanted 6s after the last write at 15.07s"
        );
        let at = replay(TC_COLD, 60_000).expect("the jar went quiet");
        assert!(
            (18_000..18_500).contains(&at),
            "settled at {at}ms, wanted 6s after the last write at 12.01s"
        );
    }

    #[test]
    fn settles_after_the_cookie_the_article_needs() {
        // Not a proxy for the answer: `_px3` lands at 6281ms in the cold
        // recording and 4684ms in the warm one, and the rule may not stop
        // before it. Both are minutes inside the 60s the same loads spent
        // failing.
        let at = replay(COLD_HOME, 60_000).unwrap();
        assert!(at > 6281, "settled at {at}ms, before _px3");
        assert!(at < 60_000, "settled at {at}ms, no better than the timeout");
        let at = replay(WARM_HOME, 60_000).unwrap();
        assert!(at > 4684, "settled at {at}ms, before _px3");
        assert!(at < 60_000, "settled at {at}ms, no better than the timeout");
    }

    #[test]
    fn does_not_stop_in_the_widest_gap_a_load_left() {
        // 3.25s of quiet at 8.0s into the techcrunch load, with the last write
        // still to come.
        let at = replay(TC_COLD, 60_000).unwrap();
        assert!(at > 12_010, "settled at {at}ms, inside the gap at 8.0s");
    }

    #[test]
    fn a_re_warm_settles_on_rewritten_rows_alone() {
        // Thirteen rows throughout: a rule that counted rows would see this
        // load do nothing at all and wait out the timeout.
        let at = replay(TC_WARM, 60_000).expect("the rewrites are the signal");
        assert!((11_750..12_250).contains(&at), "settled at {at}ms");
    }

    #[test]
    fn a_stalled_load_never_settles() {
        // One batch of rows from the server and nothing running in the page:
        // there is no quiet window long enough to make that a warm jar.
        assert_eq!(replay(STALLED_HOME, 60_000), None);
    }

    #[test]
    fn a_page_that_writes_once_is_left_to_its_load_event() {
        // Wikipedia is not a stall — it is a site with two cookies and a load
        // event 3.6s in. The jar has nothing to add and says nothing.
        assert_eq!(replay(WIKI, 60_000), None);
    }

    #[test]
    fn an_untouched_jar_never_settles() {
        assert_eq!(replay(&[], 60_000), None);
    }

    #[test]
    fn a_warm_up_that_only_refreshes_is_still_a_change() {
        // Rows never move; the values do. This is every re-warm of a profile
        // that has been here before.
        let mut watch = Watch::new("www.bloomberg.com");
        watch.sample(44, 1);
        watch.sample(44, 2);
        watch.sample(44, 3);
        for _ in 0..QUIET_SAMPLES {
            watch.sample(44, 3);
        }
        assert!(watch.is_settled());
        assert_eq!(watch.changes, 2);
    }

    #[test]
    fn quiet_alone_is_not_enough() {
        let mut watch = Watch::new("www.bloomberg.com");
        watch.sample(0, 0);
        watch.sample(5, 1);
        for _ in 0..(QUIET_SAMPLES * 4) {
            watch.sample(5, 1);
        }
        // One write is what being served produces, and the timeout is what
        // decides whether those rows were worth anything.
        assert!(!watch.is_settled(), "one write is not a warm-up");
        assert!(watch.is_warm(), "the rows are real though");
    }

    #[test]
    fn a_change_restarts_the_quiet_window() {
        let mut watch = Watch::new("www.bloomberg.com");
        watch.sample(0, 0);
        watch.sample(5, 1);
        watch.sample(9, 2);
        for _ in 0..(QUIET_SAMPLES - 1) {
            watch.sample(9, 2);
        }
        assert!(!watch.is_settled());
        watch.sample(12, 3);
        for _ in 0..(QUIET_SAMPLES - 1) {
            watch.sample(12, 3);
        }
        assert!(!watch.is_settled(), "the window restarted at the change");
        watch.sample(12, 3);
        assert!(watch.is_settled());
    }
}
