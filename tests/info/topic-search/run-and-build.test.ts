// The run pipeline and the result builder together (docs/info/88 「两种 run」
// 「打分」「看原文」「送达」): a first run and the next night's increment on a real
// Harness, the X reader in a fake browse session that serves the real
// signed-in search page in tests/info/x/fixtures, a scripted model and scripted
// pages. What is checked is what crosses from one half to the other: the result
// file on disk, the box item, the X pages counted on the device's allowance,
// the source health on the collector's state file, and the questions saved up.

import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Window } from "happy-dom";
import { registerProgramTask, runProgramTask } from "../../../src/legion/durable/program-task";
import type { SourceHealth } from "../../../src/info/sources/engine";
import { PAGE_CHROME_SCRIPT, SEARCH_PAGE_SCRIPT } from "../../../src/info/x/search-page";
import { PERMALINK_SCRIPT } from "../../../src/info/x/permalink";
import { makeResultBuilder, SOURCE_HEALTH_FILE, type BuildResultDeps } from "../../../src/info/topic-search/build-result";
import type { TopicModelCall } from "../../../src/info/topic-search/model-io";
import { QUESTIONS_FILE, parseQuestionsFile } from "../../../src/info/topic-search/questions";
import { parseResultFile } from "../../../src/info/topic-search/result-types";
import { topicSearchTask, type TopicSearchRunDeps, type TopicSearchRunResult } from "../../../src/info/topic-search/run";
import {
  createStateStore,
  loadRead,
  nightLimits,
  permalinkBudget,
  progressLog,
  saveRead,
  spendNight,
  type StateFs,
} from "../../../src/info/topic-search/run-state";
import { recordHalt, xGate } from "../../../src/info/topic-search/halt";
import { foldTopicSearchHealth, parseSourceHealthFile } from "../../../src/info/topic-search/source-health";
import { topicSearchHealthRows } from "../../../src/ui/components/info/sources-page";
import type { TopicSearch } from "../../../src/info/topic-search/types";
import type { BrowseEval, BrowseLoad, BrowseSession } from "../../../src/workshop/extract/webview-browse";
import { openTestRuntime } from "../../legion/durable/support/runtime";

const FIXTURE = readFileSync(join(import.meta.dir, "../x/fixtures/search-live-ai-for-science.html"), "utf8");

/** What the search page script returns on the fixture, as the browse session would hand it back. */
function fixtureScreen(): { posts: unknown[] } & Record<string, unknown> {
  const win = new Window({ url: "https://x.com/search?q=x" });
  win.document.body.innerHTML = FIXTURE;
  const run = new Function("document", "location", "innerHeight", "scrollY", `return ${SEARCH_PAGE_SCRIPT}`);
  const value = JSON.parse(JSON.stringify(run(win.document, win.location, 2420, 0)));
  win.close();
  return value;
}

const SCREEN = fixtureScreen();
// The fixture is newest first. The first run sees the older half; by the next
// night the newer half has come in above it.
const OLDER = { ...SCREEN, posts: SCREEN.posts.slice(SCREEN.posts.length / 2) };

const local = (y: number, mo: number, d: number, h: number, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime();

/** One browse session over a page that shows `screen` and never scrolls further. */
function fakeSession(screen: unknown, log: { navigations: string[] }): BrowseSession {
  const load = (url: string): BrowseLoad => ({ status: "ok", url, title: null, loaded: true, value: true, error: null, elapsedMs: 900, detail: null });
  const ev = (value: unknown): BrowseEval => ({ status: "ok", url: null, title: null, value, error: null, elapsedMs: 5, detail: null });
  return {
    id: 1,
    navigate: async (url) => {
      log.navigations.push(url);
      return load(url);
    },
    back: async () => load(""),
    evaluate: async (script) => {
      if (script === SEARCH_PAGE_SCRIPT) return ev(screen);
      if (script === PAGE_CHROME_SCRIPT) return ev({ path: "/someone/status/1", chrome: "Post", loginWall: false });
      if (script === PERMALINK_SCRIPT) return ev(null);
      return ev({ availWidth: 2560, availHeight: 2560 });
    },
    scrollBy: async () => ({ status: "ok", before: 0, after: 0, height: 9000, viewport: 2420, detail: null }),
    close: async () => true,
  };
}

function memFs(): StateFs & { files: Map<string, string> } {
  const files = new Map<string, string>();
  return {
    files,
    exists: async (p) => files.has(p),
    readText: async (p) => {
      const text = files.get(p);
      if (text === undefined) throw new Error(`no ${p}`);
      return text;
    },
    writeAtomic: async (p, text) => void files.set(p, text),
    appendText: async (p, text) => void files.set(p, (files.get(p) ?? "") + text),
    mkdirp: async () => {},
  };
}

/** The doubt the model raises on its n-th rerank. */
const DOUBTS = ["Do you want tools for scientists, or only research results?", "Should lab automation hardware count?"];

// The model: every candidate a 70, one with a doubt; no comparison claims; a
// plain write-up for whatever items it is shown.
function model(log: TopicModelCall[]) {
  return async (call: TopicModelCall): Promise<string> => {
    log.push(call);
    if (call.site === "rerank") {
      const ids = [...new Set([...call.user.matchAll(/\b(c\d+) · /g)].map((m) => m[1]))];
      const doubt = DOUBTS[log.filter((l) => l.site === "rerank").length - 1];
      return JSON.stringify({ items: ids.map((c, i) => ({ c, score: 70, main: "self", subtopic: null, ...(i === 0 ? { doubt } : {}) })) });
    }
    if (call.site === "verify") return JSON.stringify({ claims: [] });
    if (call.site === "dedupe") return JSON.stringify({ verdicts: [] });
    const ids = [...new Set([...call.user.matchAll(/<material id="(E\d+)">/g)].map((m) => m[1]))];
    return JSON.stringify({
      overview: { text: `Work on AI for science this window; see ${ids[0]}.`, cites: [ids[0]] },
      items: ids.map((e) => ({ e, conclusion: "Work relevant to the topic.", body: ["What it is.", "Why it likely matters."], unknown: "Whether it holds up.", cites: [] })),
      doubts: [],
      repeats: [],
    });
  };
}

const SEARCH: TopicSearch = {
  id: "ts-0a1b2c3d",
  name: "AI for science",
  concernId: null,
  scope: "AI used to do science: discovery, materials, proteins, autonomous labs.",
  subtopics: [],
  want: [],
  avoid: [],
  judgments: [],
  anchors: ["science"],
  queries: [
    { id: "q1", subtopic: null, x: '"AI for science" -filter:retweets', arxiv: "AI for science", ranking: "Is this real AI-for-science work?", weight: 1 },
  ],
  answers: [],
  status: "active",
  revision: 1,
  createdAt: 0,
  lastRunAt: null,
};

const HEALTH_FILE = "info-source-health.json";

function world() {
  const fs = memFs();
  const store = createStateStore(fs, "state.json");
  let now = local(2026, 10, 14, 14);
  let search = { ...SEARCH };
  let screen: unknown = OLDER;
  const browse = { navigations: [] as string[] };
  const opened: string[] = [];
  const modelLog: TopicModelCall[] = [];
  const box: { id: string; cover: string; resultFile: string }[] = [];
  let ids = 0;
  const day = () => {
    const d = new Date(now);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };
  const buildDeps: BuildResultDeps = {
    model: model(modelLog),
    searchArxiv: async () => [],
    fetchText: async () => ({ status: 404, text: "" }),
    openLink: async (url) => {
      opened.push(url);
      if (new URL(url).hostname === "x.com") {
        return { ok: true, via: "x", title: null, author: null, publishedAt: null, sections: [{ heading: null, html: "<p>The whole post, read off its own page.</p>" }], whole: null };
      }
      return { ok: false, reason: "not in this test" };
    },
    repoLookups: () => ({ lookup: async () => ({ kind: "missing" }) as never, quotaLeft: () => 50 }),
    files: {
      read: async (p) => fs.files.get(p) ?? null,
      write: async (p, c) => void fs.files.set(p, c),
      list: async (prefix) => [...fs.files.keys()].filter((k) => !k.includes("/") && k.startsWith(prefix)),
    },
    profile: async () => [],
    language: async () => "",
    now: () => now,
    today: day,
  };
  const deps: TopicSearchRunDeps = {
    loadSearch: async (id) => (id === search.id ? search : null),
    ran: async (_s, at) => void (search = { ...search, lastRunAt: Math.max(search.lastRunAt ?? 0, at) }),
    stopOnce: async () => {},
    builder: () => makeResultBuilder(buildDeps),
    xPages: (about) => permalinkBudget(store, about, () => now),
    // As runs-live.ts does it, on this test's files.
    foldSourceHealth: async (dir, s) => {
      const file = parseSourceHealthFile(fs.files.get(`${dir}/${SOURCE_HEALTH_FILE}`) ?? "");
      const prior = JSON.parse(fs.files.get(HEALTH_FILE) ?? "{}") as Record<string, SourceHealth>;
      if (file) fs.files.set(HEALTH_FILE, JSON.stringify(foldTopicSearchHealth(prior, file, s)));
    },
    runDir: async (runId) => `topic-search-runs/${runId}`,
    progress: (dir) => progressLog(fs, dir),
    saveRead: (dir, x) => saveRead(fs, dir, x),
    loadRead: (dir) => loadRead(fs, dir),
    memory: store.reader,
    nightLimits: async (night) => nightLimits((await store.load()).night, night),
    spendNight: async (night, x) => void (await store.update((s) => ({ ...s, night: spendNight(s.night, night, x) }))),
    gate: async (night) => xGate((await store.load()).halt, night),
    readClean: async () => void (await store.update((s) => ({ ...s, halt: null }))),
    checkSession: async () => "ok",
    halted: async (halt, about) => void (await store.update((s) => ({ ...s, halt: recordHalt(s.halt, halt, now, about.night) }))),
    keepAwake: async () => ({ held: true, detail: null, release: async () => {} }),
    open: async () => ({ status: "ok", session: fakeSession(screen, browse) }),
    expandLink: async () => null,
    deliver: async (item) => void box.push({ id: item.id, cover: item.cover, resultFile: item.resultFile }),
    newBoxItemId: () => `box-${++ids}`,
    lane: (work) => work(),
    now: () => now,
    random: () => 0.5,
    sleep: async (ms) => void (now += ms),
  };
  return {
    fs,
    store,
    deps,
    box,
    opened,
    modelLog,
    browse,
    at: (ms: number) => void (now = ms),
    show: (s: unknown) => void (screen = s),
    search: () => search,
  };
}

async function run(w: ReturnType<typeof world>, runId: string, brief: { searchId: string; kind: "first" | "daily"; night: string | null }) {
  const task = topicSearchTask(w.deps);
  const off = registerProgramTask(task);
  const t = await openTestRuntime({ root: mkdtempSync(join(tmpdir(), "ts-run-build-")), responses: [] });
  try {
    const outcome = await runProgramTask<TopicSearchRunResult>(t.runtime, { task, key: runId, name: "topic-search", input: { runId, brief } });
    if (outcome.status !== "completed") throw new Error(`run ${runId}: ${JSON.stringify(outcome)}`);
    return outcome.result;
  } finally {
    off();
  }
}

const xOpens = (urls: string[]) => urls.filter((u) => new URL(u).hostname === "x.com").length;

describe("a first run, then the next night", () => {
  const w = world();

  test("the first run reads X, builds, writes the result and puts it in the box", async () => {
    const result = await run(w, "r-first", { searchId: SEARCH.id, kind: "first", night: null });
    expect(result.status).toBe("delivered");
    expect(result.x?.status).toBe("done");
    expect(result.x?.posts).toBe(OLDER.posts.length);
    expect(result.resultFile).toBe("topic-search-ts-0a1b2c3d-2026-10-14.json");

    const file = parseResultFile(w.fs.files.get(result.resultFile!)!)!;
    expect(file.kind).toBe("first");
    expect(file.items.length).toBe(result.itemCount);
    expect(file.items.length).toBeGreaterThan(0);
    expect(file.runDir).toBe("topic-search-runs/r-first");
    expect(w.box).toEqual([{ id: "box-1", cover: "AI for science: first look", resultFile: result.resultFile! }]);
    expect(w.search().lastRunAt).toBe(local(2026, 10, 14, 14));
  });

  test("the build's X pages came off the same daily allowance as the reader's", async () => {
    const state = await w.store.load();
    const read = JSON.parse(w.fs.files.get("topic-search-runs/r-first/x-read.json")!) as { pages: { search: number; permalink: number } };
    expect(read.pages.search).toBe(1);
    expect(xOpens(w.opened)).toBeGreaterThan(0);
    expect(state.reader.daily).toEqual({ day: "2026-10-14", search: 1, permalink: read.pages.permalink + xOpens(w.opened) });
    // A first run is not the night's.
    expect(state.night).toBeNull();
  });

  test("the source health is on the collector's state file, the way the source page reads it", () => {
    const health = JSON.parse(w.fs.files.get(HEALTH_FILE)!) as Record<string, SourceHealth>;
    const rows = topicSearchHealthRows(health);
    expect(rows.map((r) => [r.key, r.line.status])).toEqual([
      ["topic-search:ts-0a1b2c3d:q1:x", "ok"],
      ["topic-search:ts-0a1b2c3d:q1:arxiv", "empty"],
    ]);
    expect(rows[0].line).toMatchObject({ name: "AI for science", label: SEARCH.queries[0].x, read: OLDER.posts.length });
    // Read when the build ran, after the reading.
    expect(rows[0].health.lastSuccess).toBeGreaterThan(local(2026, 10, 14, 14));
  });

  test("the model's doubt is saved up as a question", () => {
    const questions = parseQuestionsFile(w.fs.files.get(QUESTIONS_FILE) ?? null).topics[SEARCH.id]?.questions ?? [];
    expect(questions.map((q) => q.text)).toContain(DOUBTS[0]);
  });

  test("the next night reads only what came in above, spends the night's ceiling, and delivers the day", async () => {
    const before = w.opened.length;
    w.show(SCREEN);
    w.at(local(2026, 10, 15, 2));
    const result = await run(w, "r-night", { searchId: SEARCH.id, kind: "daily", night: "2026-10-15" });
    expect(result.x?.status).toBe("done");
    expect(result.x?.posts).toBe(SCREEN.posts.length - OLDER.posts.length);
    expect(result.status).toBe("delivered");
    expect(result.resultFile).toBe("topic-search-ts-0a1b2c3d-2026-10-15.json");
    const file = parseResultFile(w.fs.files.get(result.resultFile!)!)!;
    expect(file.kind).toBe("daily");
    expect(file.window.since).toBe(local(2026, 10, 14, 14));
    expect(w.box.map((b) => b.id)).toEqual(["box-1", "box-2"]);
    expect(w.box[1].cover).toContain("AI for science");

    const state = await w.store.load();
    const read = JSON.parse(w.fs.files.get("topic-search-runs/r-night/x-read.json")!) as { pages: { search: number; permalink: number } };
    const buildOpens = xOpens(w.opened.slice(before));
    expect(state.reader.daily).toEqual({ day: "2026-10-15", search: 1, permalink: read.pages.permalink + buildOpens });
    expect(state.night).toMatchObject({ night: "2026-10-15", searchPages: 1, permalinkPages: read.pages.permalink + buildOpens });

    // The night's line is on the state file under the same key, read again.
    const health = JSON.parse(w.fs.files.get(HEALTH_FILE)!) as Record<string, SourceHealth>;
    expect(health["topic-search:ts-0a1b2c3d:q1:x"].lastSuccess).toBe(file.createdAt);
    expect(health["topic-search:ts-0a1b2c3d:q1:x"].topicSearch?.read).toBe(SCREEN.posts.length - OLDER.posts.length);
    const questions = parseQuestionsFile(w.fs.files.get(QUESTIONS_FILE) ?? null).topics[SEARCH.id]?.questions ?? [];
    expect(questions.map((q) => q.text)).toEqual(expect.arrayContaining(DOUBTS));
  });
});

test("with the day's permalink pages gone, the build opens nothing on X and still delivers", async () => {
  const w = world();
  await w.store.update((s) => ({ ...s, reader: { ...s.reader, daily: { day: "2026-10-14", search: 0, permalink: 80 } } }));
  const result = await run(w, "r-spent", { searchId: SEARCH.id, kind: "first", night: null });
  expect(result.status).toBe("delivered");
  expect(xOpens(w.opened)).toBe(0);
  expect((await w.store.load()).reader.daily?.permalink).toBe(80);
});

test("a line that failed keeps its last success; a query gone from the search goes; sources are untouched", () => {
  const key = "topic-search:ts-0a1b2c3d:q1:x";
  const prior: Record<string, SourceHealth> = {
    "arxiv-cs": { lastSuccess: 5 },
    [key]: { lastSuccess: 10, lastItems: 30 },
    "topic-search:ts-0a1b2c3d:q9:x": { lastSuccess: 10 },
  };
  const entry = { searchId: SEARCH.id, query: "q1", source: "x" as const, status: "failed" as const, why: "rate-limited", fetchedAt: null, read: 0, fresh: 0, passedFloor: 0 };
  const after = foldTopicSearchHealth(prior, { version: 1, searchId: SEARCH.id, kind: "daily", at: 20, entries: [entry] }, SEARCH);
  expect(Object.keys(after).sort()).toEqual(["arxiv-cs", key]);
  expect(after[key]).toMatchObject({ lastSuccess: 10, lastError: "rate-limited", lastErrorAt: 20 });
  expect(after[key].topicSearch?.status).toBe("failed");
});
