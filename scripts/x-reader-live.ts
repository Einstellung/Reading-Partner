// Dev driver for the topic-search X reader (docs/info/88 phase 2) against the
// real site: the reader in src/info/topic-search/x-reader.ts runs here in bun,
// unchanged, and its browse session is the debug binary's, driven one step at a
// time over stdin (RP_WEBVIEW_BROWSE_PROBE=-, src-tauri/src/webview_fetch/browse.rs).
//
// Same isolation as scripts/x-search-probe.ts: XDG data, config and cache dirs
// under PROFILE (default ~/.cache/reading-partner-x-probe, which holds the
// probe's own X sign-in), its own session bus, and Xvfb with a screen the size
// of the monitor the viewport claims. It never touches the app's real data
// directory or cookie jar, and never opens a window on the desktop.
//
//   bun scripts/x-reader-live.ts snapshot --out <dir> [--query q] [--viewport 1440x2420]
//   bun scripts/x-reader-live.ts run --query q [--query q2] [--order live|top] [--since d] [--until d]
//        [--viewport WxH] [--pace slow|tuned] [--posts n] [--minutes m] [--pages n] [--permalinks n] [--tag t]
//
// Read only: navigation and scrolling, nothing on the page is clicked. Build
// first: cargo build --manifest-path src-tauri/Cargo.toml.

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { openBrowse } from "../src/workshop/extract/webview-browse";
import { tcoTarget } from "../src/info/x/outbound";
import { readXSearch, type XReadLine } from "../src/info/topic-search/x-reader";
import { PROBE_PACE, X_PACE, type XPace } from "../src/info/topic-search/x-pace";
import type { XReaderMemory, XStep } from "../src/info/topic-search/x-progress";
import { PipeHost, PROFILE } from "./x-browse-host";

// --- arguments ---------------------------------------------------------------

const [mode, ...rest] = process.argv.slice(2);
const flag = (name: string) => {
	const i = rest.indexOf(name);
	return i >= 0 ? rest[i + 1] : undefined;
};
const flags = (name: string) => rest.flatMap((v, i) => (rest[i - 1] === name ? [v] : []));
const size = (spec: string | undefined, fallback: string) => {
	const [w, h] = (spec ?? fallback).split("x").map(Number);
	return { width: w, height: h };
};
// The monitor a viewport claims: the viewport plus a desktop's top bar and a
// browser's tab strip and toolbar.
const screenFor = (v: { width: number; height: number }) => ({ width: v.width, height: v.height + 140 });

const SNAPSHOT = `(() => {
  const col = document.querySelector('[data-testid="primaryColumn"]');
  const facts = { url: location.href, innerWidth, innerHeight, dpr: devicePixelRatio,
    screen: { width: screen.width, height: screen.height, availWidth: screen.availWidth, availHeight: screen.availHeight },
    visibility: document.visibilityState, articles: document.querySelectorAll("article").length,
    heights: Array.from(document.querySelectorAll("article")).map((a) => Math.round(a.getBoundingClientRect().height)) };
  if (!col) return { ...facts, html: null };
  const clone = col.cloneNode(true);
  for (const el of Array.from(clone.querySelectorAll("script, style, noscript, iframe"))) el.remove();
  for (const svg of Array.from(clone.querySelectorAll("svg"))) while (svg.firstChild) svg.firstChild.remove();
  for (const el of [clone, ...Array.from(clone.querySelectorAll("*"))]) {
    for (const a of Array.from(el.attributes)) {
      if (a.name === "class" || a.name === "style" || a.name.startsWith("on") || a.name === "srcset") el.removeAttribute(a.name);
    }
  }
  return { ...facts, html: clone.outerHTML };
})()`;

const rand = (lo: number, hi: number) => lo + Math.random() * (hi - lo);
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

if (mode === "snapshot") {
	const out = flag("--out");
	if (!out) throw new Error("--out <dir>");
	mkdirSync(out, { recursive: true });
	const viewport = size(flag("--viewport"), "1440x2420");
	const host = new PipeHost(screenFor(viewport), "snapshot");
	const opened = await openBrowse({ idleTimeoutMs: 3_600_000, viewport }, host);
	if (opened.status !== "ok") throw new Error(`open: ${opened.status} ${opened.detail}`);
	const page = opened.session;
	const blank = await page.evaluate(SNAPSHOT.replace("const col = document", "const col = null && document"));
	writeFileSync(join(out, "blank.json"), JSON.stringify(blank.value, null, 2));
	const q = `${flag("--query") ?? '"AI for science"'} -filter:retweets`;
	const url = `https://x.com/search?${new URLSearchParams({ q, src: "typed_query", f: "live" })}`;
	const nav = await page.navigate(url, {
		until: `document.querySelectorAll("article").length > 2 || !location.pathname.startsWith("/search")`,
		timeoutMs: 60_000,
	});
	console.error(`navigate ${nav.status} ${nav.url} ${nav.elapsedMs} ms`);
	for (let shot = 0; shot < 2; shot++) {
		await sleep(rand(8_000, 15_000));
		const snap = await page.evaluate(SNAPSHOT);
		const v = snap.value as Record<string, unknown> | null;
		writeFileSync(join(out, `shot-${shot}.json`), JSON.stringify({ ...v, html: undefined }, null, 2));
		if (v && typeof v.html === "string") writeFileSync(join(out, `shot-${shot}.html`), v.html);
		console.error(`shot ${shot}: ${v?.url} articles ${v?.articles} heights ${JSON.stringify(v?.heights)}`);
		if (!v || !String(v.url).includes("/search")) break;
		if (shot === 0) {
			for (let screenN = 0; screenN < 3; screenN++) {
				const total = rand(0.6, 0.9) * viewport.height;
				const parts = 3 + Math.round(Math.random());
				for (let i = 0; i < parts; i++) {
					await page.scrollBy(total / parts);
					await sleep(rand(150, 400));
				}
				await sleep(rand(15_000, 30_000));
			}
		}
	}
	console.error(`closed ${await page.close()}`);
} else if (mode === "run") {
	const tag = flag("--tag") ?? "run";
	const viewport = size(flag("--viewport"), "1440x2420");
	const base: XPace = flag("--pace") === "slow" ? PROBE_PACE : X_PACE;
	// One sitting as long as the run: a measurement is not the place for a 10-30 minute break.
	const pace: XPace = { ...base, viewport, segments: [1, 1], segmentMs: [600 * 60_000, 600 * 60_000] };
	const order = (flag("--order") ?? "live") as "live" | "top";
	const lines: XReadLine[] = flags("--query").map((query, i) => ({
		key: `${tag}:${order}:${i}`,
		query,
		order,
		since: flag("--since"),
		until: flag("--until"),
		relevance: query.replace(/"/g, ""),
	}));
	const dir = join(PROFILE, "reader", tag);
	mkdirSync(dir, { recursive: true });
	const progressPath = join(dir, "progress.jsonl");
	const memoryPath = join(PROFILE, "reader", "memory.json");
	const host = new PipeHost(screenFor(viewport), tag);
	const started = Date.now();
	const result = await readXSearch(
		{
			lines,
			pace,
			limits: {
				posts: Number(flag("--posts") ?? 200),
				searchPages: Number(flag("--pages") ?? lines.length),
				permalinkPages: Number(flag("--permalinks") ?? 2),
				activeMs: Number(flag("--minutes") ?? 20) * 60_000,
			},
		},
		{
			open: (v, opts) => openBrowse({ idleTimeoutMs: 3_600_000, viewport: v, initScript: opts?.initScript }, host),
			progress: {
				load: async () =>
					existsSync(progressPath)
						? readFileSync(progressPath, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as XStep)
						: [],
				append: async (step) => {
					appendFileSync(progressPath, JSON.stringify(step) + "\n");
					if (step.kind !== "read" && step.kind !== "scroll") console.error(JSON.stringify(step).slice(0, 200));
					else if (step.kind === "read") console.error(`read screen ${step.screen}: on screen ${step.ids.length}, kept ${step.fresh.length}, height ${step.height}`);
				},
			},
			memory: {
				load: async () =>
					existsSync(memoryPath) ? (JSON.parse(readFileSync(memoryPath, "utf8")) as XReaderMemory) : { marks: {}, daily: null },
				save: async (m) => writeFileSync(memoryPath, JSON.stringify(m)),
			},
			expandLink: async (tco) => {
				const res = await fetch(tco, { redirect: "manual" });
				const body = res.status >= 300 && res.status < 400 ? "" : await res.text();
				return tcoTarget(res.status, res.headers.get("location"), body);
			},
			onHalt: async (halt) => console.error(`HALT ${halt.kind}: ${halt.detail}`),
			sleep,
			now: Date.now,
			random: Math.random,
		},
	);
	const wallMin = (Date.now() - started) / 60_000;
	const activeMin = result.activeMs / 60_000;
	const summary = {
		tag,
		viewport,
		count: pace.count,
		status: result.status,
		why: result.why,
		halt: result.halt,
		kept: result.posts.length,
		truncated: result.posts.filter((p) => p.post.truncated).length,
		completed: result.posts.filter((p) => !p.post.truncated && p.post.text.length > 0).length,
		links: result.posts.reduce((n, p) => n + p.post.links.length, 0),
		unresolved: result.posts.reduce((n, p) => n + p.post.links.filter((l) => l.url === null).length, 0),
		pages: result.pages,
		lines: result.lines,
		activeMin: Number(activeMin.toFixed(1)),
		wallMin: Number(wallMin.toFixed(1)),
		perActiveMin: Number((result.posts.length / activeMin).toFixed(2)),
	};
	writeFileSync(join(dir, "result.json"), JSON.stringify({ summary, posts: result.posts }, null, 2));
	console.log(JSON.stringify(summary, null, 2));
	console.error(`binary pid was ${host.pid()}`);
} else if (mode === "baseline" && rest[0]) {
	// posts per minute off a probe log (scripts/x-search-probe.ts run): per page,
	// unique posts and the minutes from its navigation to its last read.
	const entries = readFileSync(rest[0], "utf8").split("\n").filter((l) => l.startsWith("RP-BROWSE "))
		.map((l) => JSON.parse(l.slice(10)) as { op: string; at: number; result: Record<string, unknown> });
	const pages: { start: number; last: number; seen: number }[] = [];
	for (const e of entries) {
		if (e.op === "navigate") pages.push({ start: e.at, last: e.at, seen: 0 });
		const v = e.result.value as { seen?: number } | undefined;
		if (e.op === "eval" && pages.length && v && typeof v.seen === "number") {
			const page = pages[pages.length - 1];
			page.last = e.at;
			page.seen = v.seen;
		}
	}
	for (const p of pages) console.log(`page: ${p.seen} posts in ${((p.last - p.start) / 60_000).toFixed(1)} min = ${(p.seen / ((p.last - p.start) / 60_000)).toFixed(2)}/min`);
	const total = pages.reduce((n, p) => n + p.seen, 0);
	const minutes = (entries[entries.length - 1].at - entries[0].at) / 60_000;
	console.log(`all: ${total} posts in ${minutes.toFixed(1)} min wall = ${(total / minutes).toFixed(2)}/min`);
} else {
	console.error("usage: bun scripts/x-reader-live.ts snapshot --out <dir> | run …");
	process.exit(1);
}
