// Dev probe for docs/info/88 phase 2, step one: in the app's own hidden browse
// page, does X search (1) keep loading as it is scrolled, (2) honour both the
// default ("Top") order and `f=live`, and (3) honour `since:`/`until:`?
//
// It drives the debug binary through RP_WEBVIEW_BROWSE_PROBE
// (src-tauri/src/webview_fetch/browse.rs) with a profile of its own: XDG data,
// config and cache dirs under PROFILE, its own session bus (dbus-run-session),
// and Xvfb for everything except the sign-in. It never touches the app's real
// data directory or cookie jar. Linux only: on macOS the fetcher's cookie store
// is a fixed one (docs/pitfall/385) and would be the real app's.
//
//   bun scripts/x-search-probe.ts login     # visible X login window; sign in, then close it
//   bun scripts/x-search-probe.ts check     # is the probe profile signed in to X (Xvfb)
//   bun scripts/x-search-probe.ts run [--query "AI for science"] [--screens 12] [--synthetic-scroll]
//   bun scripts/x-search-probe.ts analyze <log>
//
// Build first: (cd src-tauri && cargo build). PROFILE defaults to
// ~/.cache/reading-partner-x-probe (override with RP_X_PROBE_PROFILE).
//
// Read only: three search pages at most per run, navigation and scrolling only,
// nothing on the page is clicked. Paced to the slow end of 88's table: each
// screen is read at 12-20 characters a second plus 2-6 s, a 30-120 s pause every
// 5-10 screens, each scroll 0.6-0.9 of a screen in three or four small steps.
// A run of 12 screens a page takes about 40 minutes.

import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BIN = join(ROOT, "src-tauri/target/debug/reading-partner");
const PROFILE = process.env.RP_X_PROBE_PROFILE ?? join(homedir(), ".cache/reading-partner-x-probe");
const LOGIN_URL = "https://x.com/i/flow/login";

const rand = (lo: number, hi: number) => lo + Math.random() * (hi - lo);
const randInt = (lo: number, hi: number) => Math.floor(rand(lo, hi + 1));
const ymd = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** X post time from its id (snowflake): the top bits are ms since 2010-11-04. */
export function snowflakeMs(id: string): number {
	return Number((BigInt(id) >> 22n) + 1288834974657n);
}

// --- what runs in the page --------------------------------------------------

const UNTIL = `document.querySelectorAll("article time").length > 0 || !location.pathname.startsWith("/search") || /Something went wrong|No results for/i.test(document.body ? document.body.innerText : "")`;

const READ = `(() => {
  const seen = window.__rpSeen || (window.__rpSeen = new Set());
  const posts = [];
  for (const article of Array.from(document.querySelectorAll("article"))) {
    if (article.parentElement && article.parentElement.closest("article")) continue;
    const time = article.querySelector("time");
    const link = time ? time.closest("a[href*='/status/']") : null;
    const m = link ? (link.getAttribute("href") || "").match(/\\/status\\/(\\d+)/) : null;
    if (!m) continue;
    posts.push({ id: m[1], chars: (article.innerText || "").length });
  }
  const fresh = posts.filter((p) => !seen.has(p.id));
  for (const p of fresh) seen.add(p.id);
  const path = location.pathname;
  const text = (document.body && document.body.innerText) || "";
  let halt = null;
  if (/^\\/(i\\/flow\\/login|login|account\\/access)/.test(path)) halt = "login or challenge: " + path;
  else if (!path.startsWith("/search")) halt = "left the search page: " + path;
  else if (!posts.length && /rate limit|Try again later|Something went wrong/i.test(text)) halt = "error text on the page";
  const root = document.scrollingElement || document.documentElement;
  return { articles: posts.length, ids: posts.map((p) => p.id), newIds: fresh.map((p) => p.id),
    newChars: fresh.reduce((n, p) => n + p.chars, 0), seen: seen.size,
    scrollY: Math.round(scrollY), height: root ? root.scrollHeight : 0, viewport: innerHeight, halt };
})()`;

// The browse page renders (docs/pitfall/600), so scrollBy fires real scroll
// events. `--synthetic-scroll` adds a dispatched one after each step anyway, for
// a build or platform where the page does not render.
const SYNTHETIC_SCROLL = `(() => { window.dispatchEvent(new Event("scroll")); return true; })()`;

// --- plans ------------------------------------------------------------------

type Step = Record<string, unknown>;
interface Line { label: string; url: string; order: "top" | "live"; since?: string; until?: string }

function searchUrl(query: string, order: "top" | "live", since?: string, until?: string): string {
	const q = [query, since && `since:${since}`, until && `until:${until}`, "-filter:retweets"].filter(Boolean).join(" ");
	const params = new URLSearchParams({ q, src: "typed_query" });
	if (order === "live") params.set("f", "live");
	return `https://x.com/search?${params.toString()}`;
}

function lines(query: string, now: number): Line[] {
	const day = 86_400_000;
	const since30 = ymd(now - 30 * day);
	const winSince = ymd(now - 3 * day);
	const winUntil = ymd(now - 2 * day);
	return [
		{ label: "top-since30", url: searchUrl(query, "top", since30), order: "top", since: since30 },
		{ label: "live", url: searchUrl(query, "live"), order: "live" },
		{ label: "live-window", url: searchUrl(query, "live", winSince, winUntil), order: "live", since: winSince, until: winUntil },
	];
}

function pagePlan(line: Line, screens: number, synthetic: boolean): Step[] {
	const steps: Step[] = [
		{ op: "navigate", url: line.url, until: UNTIL, timeoutMs: 60_000 },
		{ op: "eval", script: READ, stopIf: "halt" },
		{ op: "sleep", ms: Math.round(rand(2000, 6000)), charsPerSecond: rand(12, 20), charsFrom: "newChars", maxMs: 180_000 },
	];
	let nextLong = randInt(5, 10);
	for (let screen = 1; screen < screens; screen++) {
		const total = rand(0.6, 0.9);
		const parts = randInt(3, 4);
		for (let i = 0; i < parts; i++) {
			steps.push({ op: "scroll", screens: total / parts });
			if (synthetic) steps.push({ op: "eval", script: SYNTHETIC_SCROLL });
			if (i < parts - 1) steps.push({ op: "sleep", ms: randInt(150, 400) });
		}
		steps.push({ op: "eval", script: READ, stopIf: "halt" });
		steps.push({ op: "sleep", ms: Math.round(rand(2000, 6000)), charsPerSecond: rand(12, 20), charsFrom: "newChars", maxMs: 180_000 });
		if (screen === nextLong) {
			steps.push({ op: "sleep", ms: randInt(30_000, 120_000) });
			nextLong += randInt(5, 10);
		}
	}
	return steps;
}

// --- running the binary -----------------------------------------------------

async function runPlan(name: string, steps: Step[], visible: boolean): Promise<string> {
	if (!existsSync(BIN)) throw new Error(`no binary at ${BIN}; run (cd src-tauri && cargo build) first`);
	const dirs = { data: join(PROFILE, "data"), config: join(PROFILE, "config"), cache: join(PROFILE, "cache"), runs: join(PROFILE, "runs") };
	for (const d of Object.values(dirs)) mkdirSync(d, { recursive: true });
	const stamp = new Date().toISOString().replace(/[:.]/g, "-");
	const planPath = join(dirs.runs, `${stamp}-${name}.plan.json`);
	const logPath = join(dirs.runs, `${stamp}-${name}.log`);
	writeFileSync(planPath, JSON.stringify({ idleTimeoutMs: 30 * 60_000, steps }, null, 2));
	const cmd = visible ? ["dbus-run-session", "--", BIN] : ["dbus-run-session", "--", "xvfb-run", "-a", BIN];
	const child = Bun.spawn(cmd, {
		env: {
			...process.env,
			XDG_DATA_HOME: dirs.data,
			XDG_CONFIG_HOME: dirs.config,
			XDG_CACHE_HOME: dirs.cache,
			GTK_USE_PORTAL: "0",
			NO_AT_BRIDGE: "1",
			RP_WEBVIEW_BROWSE_PROBE: planPath,
		},
		stdout: "pipe",
		stderr: "ignore",
	});
	console.error(`pid ${child.pid}; plan ${planPath}; log ${logPath}`);
	const out: string[] = [];
	const decoder = new TextDecoder();
	let buf = "";
	const reader = child.stdout.getReader();
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		buf += decoder.decode(value);
		let nl: number;
		while ((nl = buf.indexOf("\n")) >= 0) {
			const line = buf.slice(0, nl);
			buf = buf.slice(nl + 1);
			if (!line.startsWith("RP-BROWSE ")) continue;
			out.push(line);
			writeFileSync(logPath, out.join("\n") + "\n");
			console.error(line.slice(0, 220));
		}
	}
	await child.exited;
	return logPath;
}

// --- reading the log back ---------------------------------------------------

interface Entry { step: number; op: string; result: Record<string, unknown> }

function parseLog(path: string): Entry[] {
	return readFileSync(path, "utf8")
		.split("\n")
		.filter((l) => l.startsWith("RP-BROWSE "))
		.map((l) => JSON.parse(l.slice("RP-BROWSE ".length)) as Entry);
}

export function analyze(entries: Entry[], meta: Line[]): string[] {
	const out: string[] = [];
	const pages: { line: Line | undefined; reads: Record<string, unknown>[]; nav: Record<string, unknown> }[] = [];
	for (const e of entries) {
		if (e.op === "navigate") {
			// Pages run in plan order, which is the order `meta` was saved in.
			pages.push({ line: meta[pages.length], reads: [], nav: e.result });
		} else if (e.op === "eval" && pages.length && e.result.value && typeof e.result.value === "object" && "seen" in (e.result.value as object)) {
			pages[pages.length - 1].reads.push(e.result.value as Record<string, unknown>);
		} else if (e.op === "stop") {
			out.push(`STOPPED: ${JSON.stringify(e.result)}`);
		}
	}
	for (const page of pages) {
		const line = page.line;
		const label = line?.label ?? "?";
		const order: string[] = [];
		for (const r of page.reads) for (const id of (r.newIds as string[]) ?? []) order.push(id);
		const seenBy = page.reads.map((r) => Number(r.seen));
		const first = seenBy[0] ?? 0;
		const last = seenBy[seenBy.length - 1] ?? 0;
		const tail = page.reads.slice(-3).reduce((n, r) => n + ((r.newIds as string[])?.length ?? 0), 0);
		const times = order.map(snowflakeMs);
		let monotonic = 0;
		for (let i = 1; i < times.length; i++) if (times[i] <= times[i - 1]) monotonic++;
		const mono = times.length > 1 ? monotonic / (times.length - 1) : NaN;
		out.push(`[${label}] nav ${page.nav.status} in ${page.nav.elapsedMs} ms; screens ${page.reads.length}; unique posts by screen ${seenBy.join(",")}`);
		out.push(`  (1) kept loading: ${last >= Math.max(3 * first, first + 20) && tail > 0 ? "YES" : "NO"} (first screen ${first}, last ${last}, new in the last three screens ${tail}); page height ${page.reads.map((r) => r.height).join(",")}`);
		out.push(`  (2) newest-first fraction ${mono.toFixed(2)} (live should be ~1.0, top should not); oldest ${times.length ? ymd(Math.min(...times)) : "-"}, newest ${times.length ? ymd(Math.max(...times)) : "-"}`);
		if (line?.since) {
			const lo = Date.parse(`${line.since}T00:00:00Z`) - 86_400_000;
			const hi = line.until ? Date.parse(`${line.until}T00:00:00Z`) + 86_400_000 : Infinity;
			const inside = times.filter((t) => t >= lo && t < hi).length;
			out.push(`  (3) inside since:${line.since}${line.until ? ` until:${line.until}` : ""} (±1 day): ${inside}/${times.length}`);
		}
	}
	return out;
}

// --- main -------------------------------------------------------------------

const [mode, ...rest] = process.argv.slice(2);
const flag = (name: string) => {
	const i = rest.indexOf(name);
	return i >= 0 ? rest[i + 1] : undefined;
};

if (mode === "login") {
	console.error("A window with X's login page opens on this screen. Sign in, then close the window.");
	const log = await runPlan("login", [{ op: "signIn", url: LOGIN_URL }, { op: "check", url: "https://x.com/" }], true);
	console.log(readFileSync(log, "utf8"));
} else if (mode === "check") {
	const log = await runPlan("check", [{ op: "check", url: "https://x.com/" }], false);
	console.log(readFileSync(log, "utf8"));
} else if (mode === "run") {
	const query = flag("--query") ?? "\"AI for science\"";
	const screens = Number(flag("--screens") ?? 12);
	const synthetic = rest.includes("--synthetic-scroll");
	const all = lines(query, Date.now());
	const shuffled = [...all].sort(() => Math.random() - 0.5);
	const steps: Step[] = [];
	shuffled.forEach((line, i) => {
		if (i > 0) steps.push({ op: "sleep", ms: randInt(20_000, 60_000) });
		steps.push(...pagePlan(line, screens, synthetic));
	});
	writeFileSync(join(PROFILE, "last-lines.json"), JSON.stringify(shuffled, null, 2));
	const log = await runPlan("run", steps, false);
	console.log(`synthetic scroll events: ${synthetic ? "on" : "off"}`);
	for (const l of analyze(parseLog(log), shuffled)) console.log(l);
} else if (mode === "analyze" && rest[0]) {
	const meta = JSON.parse(readFileSync(join(PROFILE, "last-lines.json"), "utf8")) as Line[];
	for (const l of analyze(parseLog(rest[0]), meta)) console.log(l);
} else {
	console.error("usage: bun scripts/x-search-probe.ts login | check | run [--query q] [--screens n] [--synthetic-scroll] | analyze <log>");
	process.exit(1);
}
