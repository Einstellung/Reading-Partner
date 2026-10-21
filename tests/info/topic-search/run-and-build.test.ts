// The run pipeline and the result builder together (docs/info/88 「两种 run」
// 「打分」「看原文」「送达」): a first run and the next night's increment on a real
// Harness, the X reader in a fake browse session that serves the real
// signed-in search page in tests/info/x/fixtures, a scripted model and scripted
// pages. What is checked is what crosses from one half to the other: the result
// file on disk, the brief issue the closed run made (info/issue: the EPUB filed
// as kind issue, the shelf row, one box item), the X pages counted on the
// device's allowance,
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
import { parseResultFile, pendingJudging } from "../../../src/info/topic-search/result-types";
import { topicSearchTask, type TopicSearchRunDeps, type TopicSearchRunResult } from "../../../src/info/topic-search/run";
import {
  createStateStore,
  loadArxivRead,
  loadHfRead,
  loadFirstPart,
  loadRead,
  saveArxivRead,
  saveHfRead,
  saveFirstPart,
  nightLimits,
  permalinkBudget,
  progressLog,
  saveRead,
  spendNight,
  type StateFs,
} from "../../../src/info/topic-search/run-state";
import { recordHalt, xGate } from "../../../src/info/topic-search/halt";
import { foldTopicSearchHealth, parseSourceHealthFile } from "../../../src/info/topic-search/source-health";
import type { TopicSearch } from "../../../src/info/topic-search/types";
import type { BrowseEval, BrowseLoad, BrowseSession } from "../../../src/workshop/extract/webview-browse";
import { openTestRuntime } from "../../legion/durable/support/runtime";
import { runClosed, type IssueDeps } from "../../../src/info/issue/assemble";
import { INFO_SHELF_FILE, ISSUE_BOX_KIND, parseShelf } from "../../../src/info/issue/types";
import { buildSectionedEpub } from "../../../src/workshop/bindery/build-article";
import { nightEndAt } from "../../../src/info/topic-search/nightly";
import { planRetry } from "../../../src/info/topic-search/retry";
import type { TopicSearchBrief } from "../../../src/info/topic-search/run";
import type { InfoItem } from "../../../src/info/sources/item";
import { assembleIssue } from "../../../src/info/issue/assemble";

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

function world(opts: { papers?: InfoItem[] } = {}) {
  const fs = memFs();
  const store = createStateStore(fs, "state.json");
  let now = local(2026, 10, 14, 14);
  let search = { ...SEARCH };
  let screen: unknown = OLDER;
  const browse = { navigations: [] as string[] };
  const opened: string[] = [];
  const modelLog: TopicModelCall[] = [];
  const box: { id: string; kind: string; cover: string; body: string; date: string }[] = [];
  const library = new Map<string, { fileName: string; bytes: Uint8Array }>();
  let ids = 0;
  let arxivCalls = 0;
  let offline = false;
  const scripted = model(modelLog);
  const day = () => {
    const d = new Date(now);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };
  const buildDeps: BuildResultDeps = {
    model: async (call) => {
      if (offline) throw new Error("Connection error.");
      return scripted(call);
    },
    sleep: async () => {},
    fetchText: async () => ({ status: 404, text: "" }),
    openLink: async (url) => {
      opened.push(url);
      if (new URL(url).hostname === "x.com") {
        return { ok: true, via: "x", title: null, author: null, publishedAt: null, sections: [{ heading: null, html: "<p>The whole post, read off its own page.</p>" }], whole: null, links: [] };
      }
      return { ok: false, code: "not_found", reason: "not in this test" };
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
    searchArxiv: async () => {
      arxivCalls++;
      return opts.papers ?? [];
    },
    saveArxiv: (dir, read) => saveArxivRead(fs, dir, read),
    loadArxiv: (dir) => loadArxivRead(fs, dir),
    searchHf: async () => [],
    saveHf: (dir, read) => saveHfRead(fs, dir, read),
    loadHf: (dir) => loadHfRead(fs, dir),
    saveFirstPart: (dir, part) => saveFirstPart(fs, dir, part),
    loadFirstPart: (dir) => loadFirstPart(fs, dir),
    memory: store.reader,
    nightLimits: async (night) => nightLimits((await store.load()).night, night),
    spendNight: async (night, x) => void (await store.update((s) => ({ ...s, night: spendNight(s.night, night, x) }))),
    gate: async (night) => xGate((await store.load()).halt, night),
    readClean: async () => void (await store.update((s) => ({ ...s, halt: null }))),
    checkSession: async () => "ok",
    // As runs-live.ts does it, over this test's health file and result files.
    retryPlan: async (s) => planRetry(s, JSON.parse(fs.files.get(HEALTH_FILE) ?? "{}") as Record<string, SourceHealth>, waitingRuns(fs, s.id)),
    halted: async (halt, about) => void (await store.update((s) => ({ ...s, halt: recordHalt(s.halt, halt, now, about.night) }))),
    keepAwake: async () => ({ held: true, detail: null, release: async () => {} }),
    open: async () => ({ status: "ok", session: fakeSession(screen, browse) }),
    expandLink: async () => null,
    closed: (closedRun) => runClosed(issueDeps, closedRun).then(() => {}),
    lane: (work) => work(),
    now: () => now,
    random: () => 0.5,
    sleep: async (ms) => void (now += ms),
  };
  const issueDeps: IssueDeps = {
    files: { read: async (path) => fs.files.get(path) ?? null, write: async (path, text) => void fs.files.set(path, text) },
    topics: async () => [{ searchId: search.id, name: search.name, subtopics: search.subtopics }],
    activeSearchIds: async () => [search.id],
    buildEpub: buildSectionedEpub,
    importBook: async (bytes, fileName) => {
      const hash = `book-${library.size + 1}`;
      library.set(hash, { fileName, bytes });
      return { hash };
    },
    attachOriginal: async () => false,
    putBox: async (item) => void box.push({ id: item.id, kind: item.kind, cover: item.cover, body: item.body, date: item.origin.date }),
    newBoxItemId: () => `box-${++ids}`,
    nightEndAt,
    now: () => now,
    today: day,
  };
  return {
    fs,
    store,
    deps,
    issueDeps,
    box,
    library,
    opened,
    modelLog,
    browse,
    at: (ms: number) => void (now = ms),
    show: (s: unknown) => void (screen = s),
    search: () => search,
    arxivCalls: () => arxivCalls,
    offline: (on: boolean) => void (offline = on),
  };
}

/** The runs whose reads wait to be judged, off the search's result files. */
function waitingRuns(fs: ReturnType<typeof memFs>, searchId: string): string[] {
  const results = [...fs.files.entries()]
    .filter(([k]) => k.startsWith(`topic-search-${searchId}-`))
    .map(([, text]) => parseResultFile(text))
    .filter((r): r is NonNullable<typeof r> => r !== null);
  return pendingJudging(results).map((u) => u.runId);
}

async function run(w: ReturnType<typeof world>, runId: string, brief: TopicSearchBrief) {
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

  test("the first run reads X after an empty arXiv part, builds, writes the result and X's issue goes in the box", async () => {
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
    // arXiv found nothing, so the first part had no issue; everything came from X, the slow part.
    expect(file.awaiting).toBeUndefined();
    expect(file.retries?.map((r) => [r.runId, r.part, r.items.length])).toEqual([["r-first", "slow", file.items.length]]);
    expect(w.box).toEqual([{ id: "box-1", kind: ISSUE_BOX_KIND, cover: `Oct 14 brief · ${file.items.length} items`, body: "book-1", date: "2026-10-14" }]);
    expect(w.library.get("book-1")?.fileName).toBe("Daily Brief 2026-10-14 No. 1.epub");
    const shelf = parseShelf(w.fs.files.get(INFO_SHELF_FILE) ?? null);
    expect(shelf.issues.map((i) => `${i.key} ${i.number} ${i.bookId} ${i.results.join(",")}`)).toEqual([
      `first:${SEARCH.id}#r-first 1 book-1 ${file.id}`,
    ]);
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

  test("the source health is on the collector's state file", () => {
    const health = JSON.parse(w.fs.files.get(HEALTH_FILE)!) as Record<string, SourceHealth>;
    // The topic search's lines, by query, X, arXiv, Hugging Face.
    const order = ["x", "arxiv", "huggingface"];
    const rows = Object.entries(health)
      .flatMap(([key, h]) => (h.topicSearch ? [{ key, health: h, line: h.topicSearch }] : []))
      .sort((a, b) => a.line.query.localeCompare(b.line.query) || order.indexOf(a.line.source) - order.indexOf(b.line.source));
    expect(rows.map((r) => [r.key, r.line.status])).toEqual([
      ["topic-search:ts-0a1b2c3d:q1:x", "ok"],
      ["topic-search:ts-0a1b2c3d:q1:arxiv", "empty"],
      ["topic-search:ts-0a1b2c3d:q1:huggingface", "empty"],
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
    // The only search's run closed, so the night's issue was made at once.
    expect(w.box.map((b) => b.id)).toEqual(["box-1", "box-2"]);
    expect(w.box[1].cover).toMatch(/^Oct 15 brief · \d+ items?$/);
    expect(parseShelf(w.fs.files.get(INFO_SHELF_FILE) ?? null).issues.map((i) => `${i.key} ${i.number}`)).toEqual([
      `first:${SEARCH.id}#r-first 1`,
      "night:2026-10-15 2",
    ]);

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

describe("a first run signed out of X, then a retry after signing in", () => {
  const w = world();
  const firstFile = "topic-search-ts-0a1b2c3d-2026-10-14.json";
  const health = () => JSON.parse(w.fs.files.get(HEALTH_FILE)!) as Record<string, SourceHealth>;

  test("the first run reads no X, finds nothing on arXiv, and leaves X failed and arXiv empty after its ladder", async () => {
    w.deps.checkSession = async () => "signed-out";
    const result = await run(w, "r-first", { searchId: SEARCH.id, kind: "first", night: null });
    expect(result.status).toBe("empty");
    expect(result.x?.status).toBe("unavailable");
    expect(w.fs.files.has(firstFile)).toBe(true);
    expect(health()["topic-search:ts-0a1b2c3d:q1:x"]?.topicSearch?.status).toBe("failed");
    expect(health()["topic-search:ts-0a1b2c3d:q1:arxiv"]?.topicSearch?.status).toBe("empty");
    expect(health()["topic-search:ts-0a1b2c3d:q1:huggingface"]?.topicSearch?.status).toBe("empty");
    expect(planRetry(w.search(), health())).toEqual({ x: ["q1"], arxiv: [], huggingface: [] });
    expect((await w.store.load()).halt?.kind).toBe("signed-out");
  });

  test("the retry reads X alone, adds to the first look's file, and its own issue goes in the box", async () => {
    w.deps.checkSession = async () => "ok";
    const arxivBefore = w.arxivCalls();
    const arxivHealth = health()["topic-search:ts-0a1b2c3d:q1:arxiv"];
    const result = await run(w, "r-retry", { searchId: SEARCH.id, kind: "retry", night: null, n: 1 });
    expect(result.status).toBe("delivered");
    expect(result.x?.status).toBe("done");
    expect(result.resultFile).toBe(firstFile);
    expect(w.arxivCalls()).toBe(arxivBefore);

    const file = parseResultFile(w.fs.files.get(firstFile)!)!;
    expect(file.kind).toBe("first");
    expect(file.runDir).toBe("topic-search-runs/r-first");
    expect(file.items.length).toBe(result.itemCount);
    // The first run's X part read nothing (signed out) and added nothing; the retry added everything.
    expect(file.retries?.map((r) => [r.runId, r.items.length])).toEqual([
      ["r-first", 0],
      ["r-retry", file.items.length],
    ]);
    expect(new Set(file.materials.map((m) => m.id)).size).toBe(file.materials.length);
    // Material bodies go where the file says they are.
    for (const m of file.materials) expect(w.fs.files.has(`${file.runDir}/${m.body}`)).toBe(true);
    // No second file for the day.
    expect([...w.fs.files.keys()].filter((k) => k.startsWith("topic-search-ts-0a1b2c3d-"))).toEqual([firstFile]);

    expect(health()["topic-search:ts-0a1b2c3d:q1:x"]?.topicSearch?.status).toBe("ok");
    expect(health()["topic-search:ts-0a1b2c3d:q1:arxiv"]).toEqual(arxivHealth);
    expect((await w.store.load()).halt).toBeNull();

    const shelf = parseShelf(w.fs.files.get(INFO_SHELF_FILE) ?? null);
    expect(shelf.issues.map((i) => i.key)).toEqual([`first:${SEARCH.id}#r-retry`]);
    expect(w.box.length).toBe(1);
  });

  test("with nothing left to read again, a second retry is skipped", async () => {
    expect(planRetry(w.search(), health())).toEqual({ x: [], arxiv: [], huggingface: [] });
    const result = await run(w, "r-retry-2", { searchId: SEARCH.id, kind: "retry", night: null, n: 2 });
    expect(result).toMatchObject({ status: "skipped", why: "nothing the first look missed is left to read again" });
  });
});

describe("a first look in two parts: arXiv first, then X", () => {
  const paper = (id: string, title: string): InfoItem => ({
    id: `arxiv-${id}`,
    source: "arxiv",
    sourceName: "arXiv",
    sourceKey: id,
    title,
    url: `https://arxiv.org/abs/${id}`,
    publishedAt: "2026-10-10",
    summary: `${title}. We show how AI speeds up science in the lab.`,
    authors: ["A. Author"],
  });
  const w = world({ papers: [paper("2610.00001", "AI for science in an autonomous materials lab"), paper("2610.00002", "Protein science with diffusion models")] });
  const firstFile = "topic-search-ts-0a1b2c3d-2026-10-14.json";
  const shelfKeys = () => parseShelf(w.fs.files.get(INFO_SHELF_FILE) ?? null).issues.map((i) => i.key);
  let atLane: { shelf: string[]; awaiting: unknown; items: number; box: number } | null = null;
  w.deps.lane = async (work) => {
    const file = parseResultFile(w.fs.files.get(firstFile) ?? "");
    atLane = { shelf: shelfKeys(), awaiting: file?.awaiting, items: file?.items.length ?? 0, box: w.box.length };
    return work();
  };
  let result: TopicSearchRunResult;

  test("the first part is filed, says X is still being read, and its issue is out before X is opened", async () => {
    result = await run(w, "r-first", { searchId: SEARCH.id, kind: "first", night: null });
    expect(atLane).not.toBeNull();
    expect(atLane!.shelf).toEqual([`first:${SEARCH.id}`]);
    expect(atLane!.awaiting).toEqual(["x"]);
    expect(atLane!.items).toBeGreaterThan(0);
    expect(atLane!.box).toBe(1);
  });

  test("X's part is added to the same file, with an issue of its own holding only what it added", async () => {
    expect(result.status).toBe("delivered");
    expect(result.resultFile).toBe(firstFile);
    const file = parseResultFile(w.fs.files.get(firstFile)!)!;
    expect(file.awaiting).toBeUndefined();
    const slow = file.retries?.find((r) => r.runId === "r-first");
    expect(slow?.part).toBe("slow");
    expect(slow!.items.length).toBeGreaterThan(0);
    expect(file.items.length).toBe(atLane!.items + slow!.items.length);
    expect(result.itemCount).toBe(file.items.length);
    // Numbered after the first part's.
    expect(slow!.items[0]).toBe(`E${atLane!.items + 1}`);
    expect([...w.fs.files.keys()].filter((k) => k.startsWith("topic-search-ts-0a1b2c3d-"))).toEqual([firstFile]);
    const shelf = parseShelf(w.fs.files.get(INFO_SHELF_FILE) ?? null);
    expect(shelf.issues.map((i) => [i.key, i.items])).toEqual([
      [`first:${SEARCH.id}`, atLane!.items],
      [`first:${SEARCH.id}#r-first`, slow!.items.length],
    ]);
    expect(w.box.length).toBe(2);
    // Both sources' health is on the collector's state file.
    const health = JSON.parse(w.fs.files.get(HEALTH_FILE)!) as Record<string, SourceHealth>;
    expect(health["topic-search:ts-0a1b2c3d:q1:x"]?.topicSearch?.status).toBe("ok");
    expect(health["topic-search:ts-0a1b2c3d:q1:arxiv"]?.topicSearch?.status).toBe("ok");
  });

  test("the first look's issue assembled after the merge still holds only the first part", async () => {
    const shelfBefore = w.fs.files.get(INFO_SHELF_FILE);
    w.fs.files.set(INFO_SHELF_FILE, JSON.stringify({ ...parseShelf(shelfBefore ?? null), issues: [] }));
    const made = await assembleIssue(w.issueDeps, `first:${SEARCH.id}`, "2026-10-14", [firstFile]);
    expect(made.issue?.items).toBe(atLane!.items);
    w.fs.files.set(INFO_SHELF_FILE, shelfBefore!);
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

describe("a first look whose judging the network broke, then a retry", () => {
  const w = world();
  const firstFile = "topic-search-ts-0a1b2c3d-2026-10-14.json";
  const health = () => JSON.parse(w.fs.files.get(HEALTH_FILE)!) as Record<string, SourceHealth>;

  test("X is read, nothing unjudged is listed, the file and the issue say the judging waits", async () => {
    w.offline(true);
    const result = await run(w, "r-first", { searchId: SEARCH.id, kind: "first", night: null });
    expect(result.status).toBe("empty");
    expect(result.x?.status).toBe("done");
    expect(result.unjudged).toBeGreaterThan(0);
    expect(result.resultFile).toBe(firstFile);

    const file = parseResultFile(w.fs.files.get(firstFile)!)!;
    expect(file.items).toEqual([]);
    expect(file.retries?.map((r) => [r.runId, r.part, r.items.length, r.unjudged?.runId, r.unjudged?.why])).toEqual([
      ["r-first", "slow", 0, "r-first", "Connection error."],
    ]);
    // What was read stands: X is not read again for it.
    expect(health()["topic-search:ts-0a1b2c3d:q1:x"]?.topicSearch?.status).toBe("ok");
    expect(planRetry(w.search(), health(), waitingRuns(w.fs, SEARCH.id))).toEqual({ x: [], arxiv: [], huggingface: [], judge: ["r-first"] });

    // The X part's issue lists nothing and says why.
    const shelf = parseShelf(w.fs.files.get(INFO_SHELF_FILE) ?? null);
    expect(shelf.issues.map((i) => [i.key, i.items])).toEqual([[`first:${SEARCH.id}#r-first`, 0]]);
    expect(w.modelLog).toEqual([]);
  });

  test("the retry reads nothing again, judges the first look's reads and lists them in an issue of its own", async () => {
    w.offline(false);
    const navigations = w.browse.navigations.length;
    const arxivBefore = w.arxivCalls();
    const result = await run(w, "r-retry", { searchId: SEARCH.id, kind: "retry", night: null, n: 1 });
    expect(result.status).toBe("delivered");
    expect(result.unjudged).toBeUndefined();
    expect(result.itemCount).toBeGreaterThan(0);
    expect(w.browse.navigations.length).toBe(navigations);
    expect(w.arxivCalls()).toBe(arxivBefore);
    expect(w.modelLog.filter((c) => c.site === "rerank").length).toBe(1);

    const file = parseResultFile(w.fs.files.get(firstFile)!)!;
    expect(file.retries?.map((r) => [r.runId, r.items.length, r.judged])).toEqual([
      ["r-first", 0, undefined],
      ["r-retry", file.items.length, ["r-first"]],
    ]);
    expect(file.items.every((i) => i.summary)).toBe(true);
    expect(waitingRuns(w.fs, SEARCH.id)).toEqual([]);
    const shelf = parseShelf(w.fs.files.get(INFO_SHELF_FILE) ?? null);
    expect(shelf.issues.map((i) => i.key)).toEqual([`first:${SEARCH.id}#r-first`, `first:${SEARCH.id}#r-retry`]);
  });
});
