#!/usr/bin/env bun
// Dev driver for one topic search's first run (docs/info/88) against the real
// sites and the real model: X read in the debug binary's hidden webview
// (x-browse-host.ts, Xvfb, the probe's own sign-in), arXiv searched and links
// followed, the result built by build-result.ts with the everyday tier, and the
// brief (info/issue) assembled into an EPUB with Lumen's opening.
//
//   bun scripts/topic-search-live.ts --out DIR [--stage read|build|issue|all]
//       [--posts 150] [--pages 8] [--permalinks 15] [--minutes 35] [--wall 40]
//
// Each stage writes into --out and the next reads it, so a stage can be rerun
// without reading X again: read -> x-read.json, build -> appdata/topic-search-*.json,
// issue -> library/*.epub, shelf.json, box.json.
//
// AppData is a directory under --out. Of the app's own data directory only
// four files are read, never written: credentials.json and settings.json /
// device.json (the provider and model, as the app resolves them), and
// statements.json (the reader's profile). A token that would need refreshing
// stops the run rather than being refreshed. The library, supplements and box
// are fakes writing under --out.
//
// Read only on X: navigation and scrolling, nothing on the page is clicked. A
// halt (signed out, challenge, rate limit) ends the read; nothing is retried.

import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { StreamOutcome } from "../src/ai/providers";
import { callModel, resolveModel } from "../src/ai/model-call";
import { registerSourceSiteAdapters } from "../src/info/sources/plugins/all";
import { registerXLinkReader } from "../src/info/x/live";
import { tcoTarget } from "../src/info/x/outbound";
import { readArxiv } from "../src/info/topic-search/arxiv-read";
import { liveResultDeps, searchArxivLive } from "../src/info/topic-search/build-live";
import { makeResultBuilder, type BuildResultDeps } from "../src/info/topic-search/build-result";
import { searchLines } from "../src/info/topic-search/run";
import { FIRST_LOOK_BACK_MS } from "../src/info/topic-search/windows";
import type { TopicSearch } from "../src/info/topic-search/types";
import { readXSearch, type XReadResult } from "../src/info/topic-search/x-reader";
import { X_PACE, type XPace } from "../src/info/topic-search/x-pace";
import type { XReaderMemory, XStep } from "../src/info/topic-search/x-progress";
import { localDay } from "../src/info/topic-search/x-progress";
import { nightEndAt } from "../src/info/topic-search/nightly";
import { runClosed, type IssueDeps } from "../src/info/issue/assemble";
import { appData, type AppDataFs } from "../src/platform/app/appdata";
import { bookLocale } from "../src/info/topic-search/book-language";
import { fetchWithRetry, interactiveRetry } from "../src/platform/http/throttled-fetch";
import { bind, type FetchBytes } from "../src/workshop/bindery";
import { buildSectionedEpub } from "../src/workshop/bindery/build-article";
import { infoFetch } from "../src/workshop/extract/http";
import { openBrowse } from "../src/workshop/extract/webview-browse";
import { PipeHost } from "./x-browse-host";

const require = createRequire(import.meta.url);
(globalThis as { DOMParser?: unknown }).DOMParser = new (require("jsdom") as typeof import("jsdom")).JSDOM("").window.DOMParser;

// --- arguments ---------------------------------------------------------------

const args = process.argv.slice(2);
const flag = (name: string, fallback?: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};
const OUT = resolve(flag("--out") ?? "");
if (!flag("--out")) throw new Error("--out DIR");
const STAGE = flag("--stage", "all")!;
const LIMITS = {
  posts: Number(flag("--posts", "150")),
  searchPages: Number(flag("--pages", "8")),
  permalinkPages: Number(flag("--permalinks", "15")),
  activeMs: Number(flag("--minutes", "35")) * 60_000,
};
const WALL_MS = Number(flag("--wall", "40")) * 60_000;
mkdirSync(OUT, { recursive: true });
const LOG = join(OUT, "driver.log");
const log = (text: string) => {
  const line = `${new Date().toISOString()} ${text}`;
  console.error(line);
  appendFileSync(LOG, line + "\n");
};

// --- the topic ---------------------------------------------------------------

const NOW = Date.now();
const TOPIC: TopicSearch = {
  id: "ts-a1f05c1e",
  name: "AI for science",
  concernId: null,
  scope: "AI used to do science: models that discover materials, design proteins and forecast weather, and the labs and tools around them.",
  subtopics: [
    { id: "materials", name: "Materials", picked: true },
    { id: "proteins", name: "Proteins", picked: true },
    { id: "weather", name: "Weather", picked: true },
    { id: "math", name: "Math proofs", picked: false },
  ],
  want: ["new models, papers and open releases", "results checked against experiment or observation"],
  avoid: ["funding and hiring news", "generic AI hype with no science in it"],
  judgments: ["AI-assisted chip design counts as engineering, not science"],
  anchors: ["science", "scientific", "materials", "material", "crystal", "protein", "proteins", "enzyme", "weather", "forecast", "climate", "molecule", "molecular", "chemistry", "biology", "physics", "lab"],
  queries: [
    { id: "q1", subtopic: null, x: '"AI for science"', arxiv: "AI for science", ranking: "What is new in using AI to do scientific research?", weight: 1.0 },
    { id: "q2", subtopic: null, x: '("AI scientist" OR "self-driving lab" OR "autonomous lab")', arxiv: "autonomous laboratory AI scientist", ranking: "Is this an AI system that runs or plans scientific experiments?", weight: 1.0 },
    { id: "q3", subtopic: "materials", x: '"materials discovery" (AI OR "machine learning")', arxiv: "machine learning materials discovery", ranking: "Does this use AI to find or design new materials?", weight: 0.7 },
    { id: "q4", subtopic: "proteins", x: '"protein design" (AI OR model)', arxiv: "protein design deep learning", ranking: "Does this use AI to design or predict proteins?", weight: 0.7 },
    { id: "q5", subtopic: "weather", x: '"weather forecasting" (AI OR "machine learning")', arxiv: "machine learning weather forecasting", ranking: "Is this an AI weather or climate forecasting model?", weight: 0.7 },
  ],
  answers: [],
  status: "active",
  revision: 1,
  createdAt: NOW,
  lastRunAt: null,
};
writeFileSync(join(OUT, "topic.json"), JSON.stringify(TOPIC, null, 2));

// --- AppData: under OUT, four files of the app read only ----------------------

const APP_DATA = join(homedir(), ".local/share/com.xinyuan.readingpartner");
const READ_ONLY = new Set(["credentials.json", "settings.json", "device.json", "statements.json"]);
const DATA = join(OUT, "appdata");
mkdirSync(DATA, { recursive: true });

function wire(): void {
  const at = (p: string) => (READ_ONLY.has(p) ? join(APP_DATA, p) : join(DATA, p));
  const writable = (p: string) => {
    if (READ_ONLY.has(p)) throw new Error(`the driver does not write the app's ${p}`);
    return join(DATA, p);
  };
  const port: AppDataFs = {
    exists: async (p) => existsSync(at(p)),
    readText: async (p) => readFile(at(p), "utf8"),
    readBytes: async (p) => new Uint8Array(await readFile(at(p))),
    stat: async (p) => {
      try {
        const s = await stat(at(p));
        return { mtimeMs: s.mtimeMs, size: s.size };
      } catch {
        return null;
      }
    },
    writeAtomic: async (p, contents) => {
      const file = writable(p);
      await mkdir(dirname(file), { recursive: true });
      await writeFile(`${file}.tmp`, contents);
      await rename(`${file}.tmp`, file);
    },
    writeBytes: async (p, bytes) => {
      const file = writable(p);
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, bytes);
    },
    appendText: async (p, text) => {
      const file = writable(p);
      await mkdir(dirname(file), { recursive: true });
      appendFileSync(file, text);
    },
    readDir: async (p) =>
      (await readdir(join(DATA, p), { withFileTypes: true })).map((e) => ({ name: e.name, isFile: e.isFile(), isDirectory: e.isDirectory() })) as never,
    mkdirp: async (p) => void (await mkdir(writable(p), { recursive: true })),
    remove: async (p) => rm(writable(p), { force: true }),
    removeDir: async (p) => rm(writable(p), { recursive: true, force: true }),
    rename: async (a, b) => rename(writable(a), writable(b)),
    quarantine: async () => {
      throw new Error("no quarantine in the driver");
    },
    readPicked: async () => {
      throw new Error("no picked files in the driver");
    },
  } as AppDataFs;
  Object.assign(appData, port);
}
wire();

// --- the model, counted -------------------------------------------------------

interface Call {
  at: string;
  what: string;
  ms: number;
  input: number;
  output: number;
  cacheRead: number;
  cost: number;
  ok: boolean;
}
const calls: Call[] = [];
function countedModel(what: string) {
  return async ({ system, user, signal }: { system: string; user: string; signal?: AbortSignal }): Promise<string> => {
    const started = Date.now();
    let usage: StreamOutcome["usage"] | undefined;
    const record = (ok: boolean) => {
      const u = usage as { input?: number; output?: number; cacheRead?: number; cost?: { total?: number } } | undefined;
      const c: Call = { at: new Date().toISOString(), what, ms: Date.now() - started, input: u?.input ?? 0, output: u?.output ?? 0, cacheRead: u?.cacheRead ?? 0, cost: u?.cost?.total ?? 0, ok };
      calls.push(c);
      appendFileSync(join(OUT, "model-calls.jsonl"), JSON.stringify({ ...c, system: system.length, user: user.length }) + "\n");
      log(`model ${what} ${ok ? "ok" : "FAILED"} ${c.ms} ms in ${c.input} out ${c.output}`);
    };
    try {
      const reply = await callModel("prep", "plan", system, user, { signal: signal ?? new AbortController().signal, onProgress: () => {} }, {
        spend: { caller: "info" },
        onFinal: (a) => {
          usage = a.usage;
        },
      });
      record(true);
      appendFileSync(join(OUT, "model-io.jsonl"), JSON.stringify({ what, system, user, reply }) + "\n");
      return reply;
    } catch (e) {
      record(false);
      throw e;
    }
  };
}

const fetchBytes: FetchBytes = async (url) => {
  const res = await fetchWithRetry(url, undefined, interactiveRetry(infoFetch));
  const bytes = res.ok ? new Uint8Array(await res.arrayBuffer()) : new Uint8Array();
  return { ok: res.ok, status: res.status, bytes, contentType: res.headers.get("content-type"), url: res.url || url };
};

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const timings: Record<string, number> = {};

// --- stage: read X ------------------------------------------------------------

const SINCE = NOW - FIRST_LOOK_BACK_MS;
const READ_FILE = join(OUT, "x-read.json");

async function readX(): Promise<XReadResult> {
  const lines = searchLines(TOPIC, "first", SINCE);
  writeFileSync(join(OUT, "x-lines.json"), JSON.stringify(lines, null, 2));
  const viewport = X_PACE.viewport;
  // One sitting: the cap is shorter than one of the pace's segments.
  const pace: XPace = { ...X_PACE, segments: [1, 1], segmentMs: [600 * 60_000, 600 * 60_000] };
  const progressPath = join(OUT, "x-progress.jsonl");
  const memoryPath = join(OUT, "x-memory.json");
  const host = new PipeHost({ width: viewport.width, height: viewport.height + 140 }, "topic-search-live");
  const started = Date.now();
  // The wall cap: past it the session is closed under the reader, which ends the read.
  let closeAt: ReturnType<typeof setTimeout> | null = null;
  let session: { close(): Promise<boolean> } | null = null;
  closeAt = setTimeout(() => {
    log(`wall cap of ${WALL_MS / 60_000} min reached: closing the browse session`);
    void session?.close();
  }, WALL_MS);
  try {
    const result = await readXSearch(
      { lines, pace, limits: LIMITS, allowance: { search: LIMITS.searchPages, permalink: LIMITS.permalinkPages } },
      {
        open: async (v, opts) => {
          const opened = await openBrowse({ idleTimeoutMs: 3_600_000, viewport: v, initScript: opts?.initScript }, host);
          if (opened.status === "ok") session = opened.session;
          log(`browse open ${opened.status}; binary pid ${host.pid()}`);
          return opened;
        },
        progress: {
          load: async () => (existsSync(progressPath) ? readFileSync(progressPath, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as XStep) : []),
          append: async (step) => {
            appendFileSync(progressPath, JSON.stringify(step) + "\n");
            if (step.kind === "read") log(`read screen ${step.screen}: on screen ${step.ids.length}, kept ${step.fresh.length}`);
            else if (step.kind !== "scroll") log(JSON.stringify(step).slice(0, 240));
          },
        },
        memory: {
          load: async () => (existsSync(memoryPath) ? (JSON.parse(readFileSync(memoryPath, "utf8")) as XReaderMemory) : { marks: {}, daily: null }),
          save: async (m) => writeFileSync(memoryPath, JSON.stringify(m)),
        },
        expandLink: async (tco) => {
          const res = await fetch(tco, { redirect: "manual" });
          const body = res.status >= 300 && res.status < 400 ? "" : await res.text();
          return tcoTarget(res.status, res.headers.get("location"), body);
        },
        onHalt: async (halt) => log(`HALT ${halt.kind}: ${halt.detail}`),
        sleep,
        now: Date.now,
        random: Math.random,
      },
    );
    timings.readMs = Date.now() - started;
    writeFileSync(READ_FILE, JSON.stringify(result, null, 2));
    log(`X read: ${result.status} (${result.why ?? ""}) kept ${result.posts.length}, pages ${JSON.stringify(result.pages)}, active ${(result.activeMs / 60_000).toFixed(1)} min, wall ${((Date.now() - started) / 60_000).toFixed(1)} min`);
    return result;
  } finally {
    if (closeAt) clearTimeout(closeAt);
    log(`binary pid was ${host.pid()}`);
  }
}

// --- stage: build the result --------------------------------------------------

async function build(x: XReadResult): Promise<string | null> {
  const statements = async () => {
    const file = join(APP_DATA, "statements.json");
    if (!existsSync(file)) return [];
    const held = JSON.parse(readFileSync(file, "utf8")) as Record<string, { kind: string; text: string; supersededBy?: string | null }[]>;
    return Object.values(held).flat().filter((s) => s && s.kind === "profile" && !s.supersededBy).map((s) => s.text);
  };
  let permalinksLeft = Math.max(0, LIMITS.permalinkPages - x.pages.permalink);
  const deps: BuildResultDeps = { ...liveResultDeps, model: countedModel("build"), profile: statements };
  const started = Date.now();
  const signal = new AbortController().signal;
  const arxiv = await readArxiv(
    TOPIC,
    { kind: "first", since: SINCE, today: localDay(Date.now()), only: null },
    { search: searchArxivLive, load: async () => null, save: async () => {} },
    signal,
  );
  const made = await makeResultBuilder(deps)({
    topic: TOPIC,
    kind: "first",
    x,
    arxiv: arxiv.found,
    since: SINCE,
    runDir: "topic-search-runs/live-first",
    xPages: {
      take: async () => {
        if (permalinksLeft <= 0) return false;
        permalinksLeft--;
        return true;
      },
    },
    signal,
  });
  timings.buildMs = Date.now() - started;
  log(`build: ${JSON.stringify(made)} in ${(timings.buildMs / 60_000).toFixed(1)} min`);
  return made.empty ? null : made.resultFile;
}

// --- stage: assemble the issue ------------------------------------------------

async function issue(resultFile: string): Promise<void> {
  const library = join(OUT, "library");
  mkdirSync(library, { recursive: true });
  const fileBook = async (bytes: Uint8Array, name: string, meta: unknown) => {
    const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 32);
    writeFileSync(join(library, `${hash}-${name.replace(/[/\\]/g, "_")}`), bytes);
    appendFileSync(join(OUT, "library.jsonl"), JSON.stringify({ hash, name, meta, bytes: bytes.length }) + "\n");
    return { hash };
  };
  const deps: IssueDeps = {
    files: {
      read: async (p) => ((await appData.exists(p)) ? await appData.readText(p) : null),
      write: (p, content) => appData.writeAtomic(p, content),
    },
    topics: async () => [{ searchId: TOPIC.id, name: TOPIC.name, subtopics: TOPIC.subtopics }],
    activeSearchIds: async () => [TOPIC.id],
    buildEpub: (input) => {
      writeFileSync(join(OUT, "issue-input.json"), JSON.stringify(input, null, 2));
      return buildSectionedEpub(input);
    },
    importBook: (bytes, name, meta) => fileBook(bytes, name, meta),
    attachOriginal: async (bookId, m) => {
      const made = await bind({ kind: "url", url: m.url }, { fetch: fetchBytes });
      appendFileSync(join(OUT, "supplements.jsonl"), JSON.stringify({ bookId, url: m.url, ok: made.ok, why: made.ok ? null : (made as { reason?: string }).reason ?? null }) + "\n");
      if (!made.ok) return false;
      const title = (made.metadata.title || m.title || m.url).trim();
      const ext = "passedThrough" in made ? made.format : "epub";
      await fileBook("passedThrough" in made ? made.bytes : made.epub, `${title.slice(0, 80)}.${ext}`, { kind: "article", sourceUrl: m.url });
      return true;
    },
    putBox: async (item) => appendFileSync(join(OUT, "box.jsonl"), JSON.stringify(item) + "\n"),
    newBoxItemId: () => `bx-${createHash("sha256").update(String(Date.now())).digest("hex").slice(0, 8)}`,
    writeOpening: countedModel("opening"),
    locale: async () => bookLocale((await resolveModel("prep")).aiLanguage),
    nightEndAt,
    now: () => Date.now(),
    today: () => localDay(Date.now()),
  };
  const started = Date.now();
  const out = await runClosed(deps, { searchId: TOPIC.id, kind: "first", night: null, resultFile });
  timings.issueMs = Date.now() - started;
  writeFileSync(join(OUT, "issue-outcome.json"), JSON.stringify(out, null, 2));
  log(`issue: ${JSON.stringify(out).slice(0, 400)} in ${(timings.issueMs / 1000).toFixed(0)} s`);
}

// --- main ---------------------------------------------------------------------

const model = await resolveModel("prep");
log(`stage ${STAGE}; model ${model.providerId}/${model.modelId} reasoning ${model.reasoning ?? "-"}; limits ${JSON.stringify(LIMITS)}`);
const creds = JSON.parse(readFileSync(join(APP_DATA, "credentials.json"), "utf8")) as Record<string, { expires?: number }>;
const expires = creds[model.providerId]?.expires;
if (typeof expires === "number" && expires < Date.now() + 2 * 3600_000) throw new Error("the provider's token would need refreshing; stopping rather than writing the app's credentials");

// The readers and site adapters the app registers at boot: the build's open route and the issue's bindery both use them.
registerSourceSiteAdapters();
registerXLinkReader();

let x: XReadResult | null = null;
if (STAGE === "read" || STAGE === "all") x = await readX();
let resultFile: string | null = null;
if (STAGE === "build" || STAGE === "all") {
  x ??= JSON.parse(readFileSync(READ_FILE, "utf8")) as XReadResult;
  resultFile = await build(x);
}
if (STAGE === "issue" || STAGE === "all") {
  resultFile ??= (await readdir(DATA)).filter((n) => n.startsWith(`topic-search-${TOPIC.id}-`)).sort().pop() ?? null;
  if (resultFile) await issue(resultFile);
  else log("no result file: no issue");
}
const cost = calls.reduce((n, c) => n + c.cost, 0);
writeFileSync(join(OUT, `summary-${STAGE}.json`), JSON.stringify({ stage: STAGE, model, timings, calls: calls.length, failed: calls.filter((c) => !c.ok).length, input: calls.reduce((n, c) => n + c.input, 0), output: calls.reduce((n, c) => n + c.output, 0), cost }, null, 2));
log(`done: ${calls.length} model calls, cost ${cost.toFixed(4)}`);
process.exit(0);
