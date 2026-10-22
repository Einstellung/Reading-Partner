// A topic search result built end to end (docs/info/88 第 3 期): the posts are
// the real signed-in search page in tests/info/x/fixtures (parsed by the page
// script as the reader would), the arXiv search, the originals, the GitHub
// lookup and every model answer are scripted. One first run, then a day's run
// over the first's history, then a day with nothing new.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Window } from "happy-dom";
import { MaterialRegistry } from "../../../src/info/dossier/registry";
import type { InfoItem } from "../../../src/info/sources/item";
import type { RepoLookup } from "../../../src/info/sources/plugins/github-lookup";
import { parseSearchRead, SEARCH_PAGE_SCRIPT, type XSearchPost } from "../../../src/info/x/search-page";
import { makeResultBuilder as makeBuilder, SOURCE_HEALTH_FILE, type BuildResultDeps, type BuildTopicSearchResultArgs, type SourceHealthFile } from "../../../src/info/topic-search/build-result";
import type { ArxivSearch } from "../../../src/info/topic-search/arxiv-ladder";
import { readArxiv } from "../../../src/info/topic-search/arxiv-read";
import { missingNumbers, numbersIn, type TopicModel, type TopicModelCall } from "../../../src/info/topic-search/model-io";
import { QUESTIONS_FILE, enqueue, labelQuestion, metricQuestions, pickQuestions, questionCap, type PendingQuestion } from "../../../src/info/topic-search/questions";
import type { TopicLabel } from "../../../src/info/topic-search/labels";
import { numberPool, parseRerank, type Candidate } from "../../../src/info/topic-search/rank-pool";
import { firstPart, parseResultFile, pendingJudging, type ResultStats, type TopicSearchResult } from "../../../src/info/topic-search/result-types";
import { ITEM_FLOOR } from "../../../src/info/topic-search/select";
import type { TopicSearch } from "../../../src/info/topic-search/types";
import type { XReadResult } from "../../../src/info/topic-search/x-reader";
import { readmeAnswer } from "./readme-answer";

const FIXTURE = readFileSync(join(import.meta.dir, "../x/fixtures/search-live-ai-for-science.html"), "utf8");

function fixturePosts(): XSearchPost[] {
  const win = new Window({ url: "https://x.com/search?q=x" });
  win.document.body.innerHTML = FIXTURE;
  const run = new Function("document", "location", "innerHeight", "scrollY", `return ${SEARCH_PAGE_SCRIPT}`);
  const read = parseSearchRead(JSON.parse(JSON.stringify(run(win.document, win.location, 2420, 0))));
  win.close();
  if (!read) throw new Error("no read");
  return read.posts.map((p) => p.post);
}

const POSTS = fixturePosts();
/** A budget that never runs out of X pages. */
const ANY_PAGES = { take: async () => true };
const post = (handle: string) => POSTS.find((p) => p.handle === handle)!;

const TOPIC: TopicSearch = {
  id: "ts-0a1b2c3d",
  name: "AI for science",
  concernId: null,
  scope: "AI used to do science: discovery, materials, proteins, autonomous labs.",
  subtopics: [
    { id: "s1", name: "Autonomous discovery", picked: true },
    { id: "s2", name: "Materials", picked: true },
    { id: "s3", name: "Weather", picked: false },
  ],
  want: ["papers and code"],
  avoid: ["fundraising"],
  judgments: [],
  anchors: ["science", "scientific"],
  queries: [
    { id: "q1", subtopic: null, x: '"AI for science" -filter:retweets', arxiv: "AI for science", ranking: "Is this real AI-for-science work?", weight: 1 },
    { id: "q2", subtopic: "s2", x: "AI materials discovery", arxiv: "materials discovery", ranking: "Is this about materials?", weight: 0.7 },
    { id: "q3", subtopic: "s1", x: "agentic science", arxiv: null, ranking: "Is this about agents doing science?", weight: 0.8 },
  ],
  answers: [],
  status: "active",
  revision: 1,
  createdAt: 0,
  lastRunAt: null,
};

// The q1 line read the whole fixture; the q3 line (as X answers several
// searches with the same posts) found the four that point at something.
const Q3_HANDLES = ["bimedotcom", "thePandaily", "yashgurbani4", "NUSComputing", "acme_lab"];

function xRead(posts: XSearchPost[]): XReadResult {
  const q3 = posts.filter((p) => Q3_HANDLES.includes(p.handle));
  return {
    status: "done",
    why: null,
    halt: null,
    posts: [...posts.map((p) => ({ line: `${TOPIC.id}:q1`, post: p })), ...q3.map((p) => ({ line: `${TOPIC.id}:q3`, post: p }))],
    lines: [
      { key: `${TOPIC.id}:q1`, why: "caught-up", screens: 6, kept: posts.length },
      { key: `${TOPIC.id}:q3`, why: "caught-up", screens: 1, kept: q3.length },
    ],
    pages: { search: 1, permalink: 0 },
    activeMs: 600_000,
  };
}

function paper(id: string, title: string, abstract: string, published: string): InfoItem {
  return {
    id: `arxiv-${id}`,
    source: "arxiv",
    sourceName: "arXiv",
    sourceKey: id,
    title,
    url: `https://arxiv.org/abs/${id}`,
    publishedAt: published,
    textContent: abstract,
    summaryOnly: true,
    authors: ["Ada Lovelace", "Alan Turing"],
  };
}

const AGENTIC = paper(
  "2609.31562",
  "Agentic Economies for Autonomous Scientific Discovery",
  "We study markets of AI agents that run scientific discovery for science problems.",
  "2026-09-30T00:00:00Z",
);
const MATERIALS = paper(
  "2610.00001",
  "Foundation models for materials discovery",
  "A foundation model for materials discovery in science, trained on 40 million structures.",
  "2026-10-01T00:00:00Z",
);

const ARXIV_HTML =
  "<html><head><title>Agentic Economies for Autonomous Scientific Discovery</title></head><body><nav>arXiv menu</nav><article>" +
  "<h2>Abstract</h2><p>We study markets of AI agents.</p>" +
  `<h2>1 Introduction</h2><p>This version was posted on September 30, 2026. ${"Agents trade compute for experiments. ".repeat(160)}</p>` +
  `<h2>2 Method</h2><p>We run 12 agents in one market. ${"Each agent bids. ".repeat(200)}</p>` +
  "</article></body></html>";

// The model, scripted per call site from the numbers in the prompt.
function scriptedModel(log: TopicModelCall[], opts: { writeFails?: number } = {}) {
  let writes = 0;
  return async (call: TopicModelCall): Promise<string> => {
    log.push(call);
    if (call.site === "rerank") {
      const items: unknown[] = [];
      for (const m of call.user.matchAll(/(c\d+) · post · @(\S+)/g)) {
        const [c, handle] = [m[1], m[2]];
        const link = new RegExp(`(${c}\\.[a-z]) (\\S+)`).exec(call.user);
        if (handle === "bimedotcom" || handle === "yashgurbani4" || handle === "NUSComputing" || handle === "acme_lab") {
          items.push({ c, score: 88, main: link?.[1] ?? "self", subtopic: handle === "bimedotcom" ? "s1" : null });
        } else if (handle === "thePandaily") {
          items.push({ c, score: 75, main: "self", subtopic: "s1", doubt: "Do you want runtime tools for agents, or only research results?" });
        } else if (handle === "uselegion") {
          items.push({ c, score: 3, main: "self", subtopic: null });
        } else {
          items.push({ c, score: 25, main: "self", subtopic: null });
        }
      }
      for (const m of call.user.matchAll(/(c\d+) · paper · .*? · arXiv (\S+)/g)) {
        items.push({ c: m[1], score: m[2] === "2609.31562" ? 90 : 70, main: "self", subtopic: m[2] === "2609.31562" ? "s1" : "s2" });
      }
      items.push({ c: "c999", score: 100, main: "self", subtopic: null });
      return JSON.stringify({ items });
    }
    if (call.site === "verify") {
      const intro = /(M\d+\.§\d+) 1 Introduction/.exec(call.user)?.[1] ?? null;
      return JSON.stringify({
        claims: [
          { post: "p1", says: "The paper came out recently", verdict: "match", evidence: intro, difference: null },
          { post: "p1", says: "Google DeepMind wrote it", verdict: "mismatch", evidence: intro, difference: "The paper is dated September 30, 2026." }, { post: "p1", says: "Out for a week", verdict: "mismatch", evidence: intro, difference: "It is dated September 25." },
          { post: "p1", says: "It used agents", verdict: "mismatch", evidence: intro, difference: "The paper runs 99 agents." },
          { post: "p9", says: "Nobody posted this", verdict: "absent", evidence: null, difference: null },
        ],
      });
    }
    if (call.site === "dedupe") return JSON.stringify({ verdicts: [] });
    writes++;
    const ids = [...call.user.matchAll(/<material id="(E\d+)">\n\1 · (\w+)[^\n]*?( · continuing)?\n/g)];
    const paperItem = ids.find((m) => m[2] === "paper")?.[1] ?? ids[0]?.[1];
    const bad = writes <= (opts.writeFails ?? 0);
    return JSON.stringify({
      overview: { text: bad ? `Seventy-seven labs, 77 in all, joined; see ${paperItem}.` : `Agent markets for discovery lead this window; see ${paperItem}.`, cites: [paperItem] },
      items: ids.filter((m) => !m[3]).map((m) => ({ e: m[1], summary: m[1] === paperItem ? "A study of agent markets, posted September 30, 2026." : "Work relevant to the topic.", body: ["What it is."], cites: [] })),
      doubts: [],
      repeats: [],
    });
  };
}

function memoryFiles(seed: Record<string, string> = {}) {
  const files = new Map(Object.entries(seed));
  return {
    files,
    io: {
      read: async (p: string) => files.get(p) ?? null,
      write: async (p: string, c: string) => void files.set(p, c),
      list: async (prefix: string) => [...files.keys()].filter((k) => !k.includes("/") && k.startsWith(prefix)),
    },
  };
}

/** The build's deps, and the arXiv search the run's read phase would have sent. */
type TestDeps = BuildResultDeps & { searchArxiv: ArxivSearch };

/** The builder after an arXiv read over the scripted search, as the run hands it what its read phase found. */
function makeResultBuilder(d: TestDeps) {
  const build = makeBuilder(d);
  return async (args: Omit<BuildTopicSearchResultArgs, "arxiv">) => {
    const plan = { kind: args.kind, since: args.since, today: d.today(), only: args.retry?.arxiv ?? null };
    const read = await readArxiv(args.topic, plan, { search: d.searchArxiv, load: async () => null, save: async () => {} }, args.signal);
    return build({ ...args, arxiv: read.found });
  };
}

function deps(over: {
  files: ReturnType<typeof memoryFiles>;
  log: TopicModelCall[];
  today: string;
  writeFails?: number;
  arxiv?: Record<string, InfoItem[]>;
  opened?: string[];
}): TestDeps {
  const now = Date.parse(`${over.today}T12:00:00Z`);
  return {
    model: scriptedModel(over.log, { writeFails: over.writeFails }),
    searchArxiv: async (text) => {
      if (text === "materials discovery" && !over.arxiv) throw new Error("export.arxiv.org answered HTTP 429");
      // The ladder sends the query's searchable words: "AI for science" searches "science".
      return (over.arxiv ?? { science: [AGENTIC, MATERIALS] })[text] ?? [];
    },
    fetchText: async (url) => {
      if (url === "https://arxiv.org/html/2609.31562") return { status: 200, text: ARXIV_HTML };
      if (url === "https://arxiv.org/html/2610.00001") return { status: 200, text: "<html><head><title>Untitled Document</title></head><body>Conversion failed</body></html>" };
      if (url.includes("api.github.com/repos/yashgurbani/amino-arcade/readme")) return readmeAnswer("# Amino Arcade\n\nA game that teaches protein folding.\n\n## Install\n\nRun it with 3 commands.");
      if (url.includes("api.github.com/repos/acme/sci-bench/readme")) return readmeAnswer("# SciBench\n\nA benchmark of 120 science tasks for agents.");
      if (url.startsWith("https://api.github.com/repos/") && url.endsWith("/contents")) return { status: 200, text: JSON.stringify([{ name: "src", type: "dir" }, { name: "README.md", type: "file" }]) };
      return { status: 404, text: "" };
    },
    openLink: async (url) => {
      over.opened?.push(url);
      if (url.includes("comp.nus.edu.sg")) {
        return { ok: true, via: "web", title: "From code to cancer: NUS Computing's expanding role in AI for science", author: "NUS Computing", publishedAt: "2026-10-12", sections: [{ heading: null, html: "<p>Four NUS teams apply AI to cancer research and materials science.</p><h2>Teams</h2><p>The four teams work across two faculties.</p>" }], whole: null, links: [] };
      }
      if (url.includes("thePandaily")) {
        return { ok: true, via: "x", title: "SRHarness: an open-source runtime for agents", author: "@thePandaily", publishedAt: null, sections: [{ heading: null, html: "<p>Tsinghua researchers released SRHarness, an open-source runtime for agentic science.</p>" }], whole: null, links: [] };
      }
      return { ok: false, code: "login_wall", reason: `${new URL(url).hostname} needs a sign-in` };
    },
    repoLookups: () => ({
      lookup: async (name): Promise<RepoLookup> => ({
        kind: "found",
        facts: { fullName: name, url: `https://github.com/${name}`, description: null, stars: 42, forks: 3, createdAt: "2026-09-01T00:00:00Z", defaultBranch: "main", lastCommitAt: "2026-10-10T08:00:00Z", release: null, license: "MIT" },
      }),
      quotaLeft: () => 50,
    }),
    files: over.files.io,
    profile: async () => ["Prefers engineering write-ups to pure theory."],
    known: async () => ["Not familiar with symbolic regression"],
    language: async () => "",
    now: () => now,
    today: () => over.today,
  };
}

const RUN_DIR = "runs/topic-search-1";

describe("a first run, then a day, then a quiet day", () => {
  const files = memoryFiles();
  const firstLog: TopicModelCall[] = [];
  const opened: string[] = [];
  const firstNow = Date.parse("2026-10-14T12:00:00Z");
  let first: TopicSearchResult;

  test("first run: the file, its items and facts", async () => {
    const build = makeResultBuilder(deps({ files, log: firstLog, today: "2026-10-14", writeFails: 1, opened }));
    const out = await build({ topic: TOPIC, kind: "first", x: xRead(POSTS), since: firstNow - 30 * 86_400_000, runDir: RUN_DIR, xPages: ANY_PAGES, signal: new AbortController().signal });
    expect(out.resultFile).toBe("topic-search-ts-0a1b2c3d-2026-10-14.json");
    expect(out.empty).toBe(false);
    first = parseResultFile(files.files.get(out.resultFile!)!)!;
    expect(first.kind).toBe("first");
    expect(first.items.length).toBe(out.itemCount);
    expect(out.itemCount).toBeLessThanOrEqual(15);

    // The paper: the arXiv search and the post linking it are one item, facts the program's.
    const agentic = first.items.find((i) => i.key === "arxiv:2609.31562")!;
    expect(agentic.kind).toBe("paper");
    expect(agentic.title).toBe("Agentic Economies for Autonomous Scientific Discovery");
    expect(agentic.titleFrom).toBe("original");
    expect(agentic.facts).toEqual({ kind: "paper", arxivId: "2609.31562", authors: ["Ada Lovelace", "Alan Turing"], publishedAt: "2026-09-30T00:00:00Z", depth: "head" });
    expect(agentic.links.posts.map((p) => p.handle)).toContain("bimedotcom");
    expect(agentic.links.posts[0].url).toBe(`https://x.com/bimedotcom/status/${post("bimedotcom").id}`);
    expect(agentic.subtopic).toBe("s1");

    // Read and compared: the discrepancy whose numbers are in the section stays, the made-up one goes.
    expect(agentic.verify.status).toBe("compared");
    expect(agentic.verify.discrepancies.map((d) => d.difference)).toEqual(["The paper is dated September 30, 2026."]);
    expect(agentic.verify.checked).toEqual({ match: 1, mismatch: 1, absent: 0 });
    const m = first.materials.find((x) => x.id === agentic.materials[0])!;
    expect(m.reader).toBe("arxiv");
    expect(m.sections.map((s) => s.heading)).toEqual(["Abstract", "1 Introduction", "2 Method"]);
    expect(m.sections.slice(1).reduce((n, s) => n + s.chars, 0)).toBeLessThanOrEqual(8000);
    expect(files.files.has(`${RUN_DIR}/${m.body}`)).toBe(true);

    // A paper with no arXiv HTML (pitfall 377's shell) is read from its abstract.
    const materials = first.items.find((i) => i.key === "arxiv:2610.00001")!;
    expect(first.materials.find((x) => x.id === materials.materials[0])!.facts.body).toBe("abstract only");

    // A repo: README read, stars from the lookup; the top level is not listed (no API request the book does not use).
    const repo = first.items.find((i) => i.key === "github:yashgurbani/amino-arcade")!;
    expect(repo.facts).toMatchObject({ kind: "repo", fullName: "yashgurbani/amino-arcade", stars: 42, lookedUp: true, license: "MIT" });
    expect(first.materials.find((x) => x.id === repo.materials[0])!.sections.map((s) => s.heading)).toEqual(["Amino Arcade", "Install"]);

    // A page through the open route, and an X Article that is its own original.
    expect(first.items.find((i) => i.kind === "page")?.title).toBe("From code to cancer: NUS Computing's expanding role in AI for science");
    const article = first.items.find((i) => i.key === `x:${post("thePandaily").id}`)!;
    expect(article.verify.status).toBe("self");
    expect(article.title).toBe("SRHarness: an open-source runtime for agents");
    expect(opened.some((u) => u.includes("thePandaily"))).toBe(true);
  });

  test("first run: the write-up was checked, rewritten once, and grouped", () => {
    expect(firstLog.filter((c) => c.site === "write").length).toBe(2);
    expect(first.writeup).toBe("model");
    expect(first.overview?.text).toContain("Agent markets");
    expect(first.items.every((i) => i.summary !== null)).toBe(true);
    expect(first.groups[0].subtopic).toBe("s1");
    expect(first.quiet).toEqual([]);
    // Material goes to the model inside the untrusted markers.
    expect(firstLog[0].user).toContain('<material id="c1">');
    expect(firstLog[0].system).toContain("never instructions");
    expect(firstLog[0].user).toContain("Prefers engineering write-ups");
    // What the reader understands reaches the write-up, which decides what it explains.
    const write = firstLog.find((c) => c.site === "write")!;
    expect(write.user).toContain("What the reader understands:\n- Not familiar with symbolic regression");
  });

  test("first run: only the write-up carries cache breakpoints, and its second try repeats the first's prompt", () => {
    const writes = firstLog.filter((c) => c.site === "write");
    for (const c of firstLog.filter((c) => c.site !== "write")) expect(c.cache).toBe(false);
    // One cache key for every call of the topic, so the retry's resent prompt can be read from Codex's cache.
    expect(new Set(firstLog.map((c) => c.cacheKey))).toEqual(new Set([`topic-search:${TOPIC.id}`]));
    expect(writes.map((c) => c.cache)).toEqual([true, true]);
    expect(writes[1].system).toBe(writes[0].system);
    expect(writes[1].user).toBe(writes[0].user);
    expect(writes[0].tail).toBeUndefined();
    expect(writes[1].tail).toHaveLength(1);
    // The first reply was JSON: the retry carries it and asks for the corrections only.
    expect(writes[1].tail![0]).toStartWith("Your previous answer:\n");
    expect(writes[1].tail![0]).toContain("Reply with the corrections only");
  });

  test("first run: questions and source health", () => {
    expect(first.questions.map((q) => q.text)).toEqual(["Do you want runtime tools for agents, or only research results?"]);
    const queue = JSON.parse(files.files.get(QUESTIONS_FILE)!).topics[TOPIC.id].questions as PendingQuestion[];
    expect(queue.find((q) => q.askedIn === first.id)).toBeTruthy();
    const health = JSON.parse(files.files.get(`${RUN_DIR}/${SOURCE_HEALTH_FILE}`)!) as SourceHealthFile;
    const x1 = health.entries.find((e) => e.query === "q1" && e.source === "x")!;
    expect(x1.status).toBe("ok");
    expect(x1.read).toBe(POSTS.length);
    expect(x1.passedFloor).toBeGreaterThan(0);
    expect(x1.passedFloor).toBeLessThan(x1.read);
    expect(health.entries.find((e) => e.query === "q2" && e.source === "arxiv")).toMatchObject({ status: "failed", why: "export.arxiv.org answered HTTP 429", fetchedAt: null });
    expect(health.entries.find((e) => e.query === "q2" && e.source === "x")).toMatchObject({ status: "failed" });
  });

  test("a day: seen things out, a doubled post continues, a new repo comes in", async () => {
    const log: TopicModelCall[] = [];
    const bime = post("bimedotcom");
    const grown: XSearchPost = { ...bime, counts: { ...bime.counts, likes: 400, reposts: 60 } };
    const fresh: XSearchPost = {
      ...post("CoffeeMnguni"),
      id: "2110300000000000000",
      handle: "acme_lab",
      name: "Acme Lab",
      postedAt: Date.parse("2026-10-14T20:00:00Z"),
      shownAt: null,
      text: "We released SciBench, an AI for science benchmark for agents: https://github.com/acme/sci-bench",
      links: [{ tco: "https://t.co/abc", url: "https://github.com/acme/sci-bench", card: false }],
      permalink: "https://x.com/acme_lab/status/2110300000000000000",
    };
    const build = makeResultBuilder(deps({ files, log, today: "2026-10-15", arxiv: { science: [AGENTIC] } }));
    const out = await build({
      topic: TOPIC,
      kind: "daily",
      x: xRead([grown, post("yashgurbani4"), fresh]),
      since: Date.parse("2026-10-14T12:00:00Z"),
      runDir: "runs/topic-search-2",
      xPages: ANY_PAGES, signal: new AbortController().signal,
    });
    expect(out.resultFile).toBe("topic-search-ts-0a1b2c3d-2026-10-15.json");
    const day = parseResultFile(files.files.get(out.resultFile!)!)!;
    expect(day.items.map((i) => i.key).sort()).toEqual(["arxiv:2609.31562", "github:acme/sci-bench"]);
    const cont = day.items.find((i) => i.key === "arxiv:2609.31562")!;
    expect(cont.continuing).toMatchObject({ previous: first.id, post: bime.id, after: { likes: 400 } });
    expect(cont.verify.status).toBe("skipped");
    expect(cont.summary).toBeNull();
    const repo = day.items.find((i) => i.key === "github:acme/sci-bench")!;
    expect(repo.summary).toBe("Work relevant to the topic.");
    expect(day.overview).not.toBeNull();
    expect(day.quiet).toEqual(["s1", "s2"]);
    // Asked once, never again.
    expect(day.questions).toEqual([]);
  });

  test("a quiet day: nothing new, no model write, an empty file", async () => {
    const log: TopicModelCall[] = [];
    const build = makeResultBuilder(deps({ files, log, today: "2026-10-16", arxiv: { science: [AGENTIC] } }));
    const out = await build({ topic: TOPIC, kind: "daily", x: xRead([post("yashgurbani4")]), since: Date.parse("2026-10-15T12:00:00Z"), runDir: "runs/topic-search-3", xPages: ANY_PAGES, signal: new AbortController().signal });
    expect(out).toEqual({ resultFile: "topic-search-ts-0a1b2c3d-2026-10-16.json", itemCount: 0, empty: true });
    const day = parseResultFile(files.files.get(out.resultFile!)!)!;
    expect(day.writeup).toBe("none");
    expect(log.some((c) => c.site === "write")).toBe(false);
  });
});

test("the slow part merged into the first part's file: the overview and counts speak for the whole, the first part stays its own", async () => {
  const files = memoryFiles();
  const now = Date.parse("2026-10-14T12:00:00Z");
  const since = now - 30 * 86_400_000;
  const noX: XReadResult = { status: "done", why: null, halt: null, posts: [], lines: [], pages: { search: 0, permalink: 0 }, activeMs: 0 };
  const fastOut = await makeResultBuilder(deps({ files, log: [], today: "2026-10-14" }))({
    topic: TOPIC, kind: "first", x: noX, since, runDir: RUN_DIR, xPages: ANY_PAGES, signal: new AbortController().signal, later: ["x"],
  });
  const fast = parseResultFile(files.files.get(fastOut.resultFile!)!)!;
  expect(fast.items.every((i) => i.kind === "paper")).toBe(true);
  expect(fast.stats.candidates.x).toBe(0);

  const log: TopicModelCall[] = [];
  const slowOut = await makeResultBuilder(deps({ files, log, today: "2026-10-14" }))({
    topic: TOPIC, kind: "first", x: xRead(POSTS), since, runDir: RUN_DIR, xPages: ANY_PAGES, signal: new AbortController().signal,
    retry: { runId: "r-first", x: ["q1", "q3"], arxiv: [], part: "slow" },
  });
  expect(slowOut.resultFile).toBe(fastOut.resultFile);
  const merged = parseResultFile(files.files.get(slowOut.resultFile!)!)!;
  const added = merged.retries![0].items;
  expect(added.length).toBeGreaterThan(0);

  // The write-up saw the first part's items beside its own and wrote the overview over both.
  const write = log.find((c) => c.site === "write")!;
  expect(write.user).toContain("Already in this result (no entries):");
  for (const i of fast.items) expect(write.user).toContain(`<material id="${i.id}">\n${i.id} · paper`);
  expect(merged.overview).toEqual(merged.retries![0].overview);
  expect(merged.overview!.cites.some((c) => fast.items.some((i) => i.id === c))).toBe(true);

  // Counts add up; every item is in a group; the first part keeps its own.
  expect(merged.stats.candidates).toEqual({ x: merged.retries![0].stats.candidates.x, arxiv: fast.stats.candidates.arxiv, huggingface: 0 });
  expect(merged.stats.candidates.x).toBeGreaterThan(0);
  expect(merged.groups.flatMap((g) => g.items).sort()).toEqual(merged.items.map((i) => i.id).sort());
  expect(merged.firstLook).toEqual({ overview: fast.overview, writeup: fast.writeup, stats: fast.stats });
  const first = firstPart(merged);
  expect(first.items).toEqual(fast.items);
  expect(first.overview).toEqual(fast.overview);
  expect(first.stats).toEqual(fast.stats);

  // Nothing under the item floor is listed (select.test.ts has the small-pool case).
  expect(merged.items.every((i) => i.score >= ITEM_FLOOR)).toBe(true);
});

test("a write-up that fails twice falls back to the program's version", async () => {
  const files = memoryFiles();
  const log: TopicModelCall[] = [];
  const build = makeResultBuilder(deps({ files, log, today: "2026-10-14", writeFails: 2 }));
  const now = Date.parse("2026-10-14T12:00:00Z");
  const out = await build({ topic: TOPIC, kind: "first", x: xRead(POSTS), since: now - 30 * 86_400_000, runDir: RUN_DIR, xPages: ANY_PAGES, signal: new AbortController().signal });
  const result = parseResultFile(files.files.get(out.resultFile!)!)!;
  expect(result.writeup).toBe("fallback");
  expect(result.overview).toBeNull();
  expect(result.items.every((i) => i.summary === null && i.title && i.facts)).toBe(true);
});

describe("a rerank that fails", () => {
  const files = memoryFiles();
  const log: TopicModelCall[] = [];
  const since = Date.parse("2026-10-14T12:00:00Z") - 30 * 86_400_000;
  const firstFile = () => parseResultFile(files.files.get("topic-search-ts-0a1b2c3d-2026-10-14.json")!)!;

  test("lists nothing on a fallback score, says so in the file, and asks the model nothing more", async () => {
    const d = deps({ files, log, today: "2026-10-14" });
    const model = d.model;
    d.model = async (call) => (call.site === "rerank" ? "not json" : model(call));
    const out = await makeResultBuilder(d)({ topic: TOPIC, kind: "first", x: xRead(POSTS), since, runDir: "topic-search-runs/r-first", runId: "r-first", xPages: ANY_PAGES, signal: new AbortController().signal });
    expect(out).toMatchObject({ resultFile: "topic-search-ts-0a1b2c3d-2026-10-14.json", itemCount: 0, empty: true });
    expect(out.unjudged).toBeGreaterThan(0);
    const result = firstFile();
    expect(result.items).toEqual([]);
    expect(result.writeup).toBe("none");
    expect(result.stats.reranked).toBe(false);
    expect(result.unjudged).toMatchObject({ runId: "r-first", why: "the reply holds no JSON", candidates: out.unjudged });
    // The rerank was the scripted model's only call, and it was bypassed: no write-up, no comparison.
    expect(log).toEqual([]);
    expect(pendingJudging([result]).map((u) => u.runId)).toEqual(["r-first"]);
    // What was read stands in the source health: the retry does not read it again.
    const health = JSON.parse(files.files.get(`topic-search-runs/r-first/${SOURCE_HEALTH_FILE}`)!) as SourceHealthFile;
    expect(health.entries.find((e) => e.query === "q1" && e.source === "x")?.status).toBe("ok");
  });

  test("the next run takes the waiting reads in, judges them and lists them", async () => {
    const d = deps({ files, log, today: "2026-10-15" });
    const nothing = { ...xRead([]), posts: [], lines: [] };
    const carried: string[] = [];
    const out = await makeResultBuilder(d)({
      topic: TOPIC,
      kind: "daily",
      x: nothing,
      since: Date.parse("2026-10-14T12:00:00Z"),
      runDir: "topic-search-runs/r-night",
      runId: "r-night",
      xPages: ANY_PAGES,
      signal: new AbortController().signal,
      carry: async (id) => (carried.push(id), { x: xRead(POSTS), arxiv: [], huggingface: [] }),
    });
    expect(carried).toEqual(["r-first"]);
    expect(out.unjudged).toBeUndefined();
    expect(out.itemCount).toBeGreaterThan(0);
    const result = parseResultFile(files.files.get(out.resultFile!)!)!;
    expect(result.judged).toEqual(["r-first"]);
    expect(result.stats.reranked).toBe(true);
    expect(result.items.some((i) => i.links.posts.length > 0)).toBe(true);
    expect(log.filter((c) => c.site === "rerank").length).toBe(1);
    expect(pendingJudging([firstFile(), result])).toEqual([]);
  });
});

test("a model call the network broke is tried again twice, a few seconds apart, then the reads wait", async () => {
  const since = Date.parse("2026-10-14T12:00:00Z") - 30 * 86_400_000;
  const attempt = async (fails: number) => {
    const files = memoryFiles();
    const d = deps({ files, log: [], today: "2026-10-14" });
    const model = d.model;
    const waits: number[] = [];
    let reranks = 0;
    d.model = async (call) => {
      if (call.site === "rerank" && ++reranks <= fails) throw new Error("Connection error.");
      return model(call);
    };
    d.sleep = async (ms) => void waits.push(ms);
    const out = await makeResultBuilder(d)({ topic: TOPIC, kind: "first", x: xRead(POSTS), since, runDir: RUN_DIR, xPages: ANY_PAGES, signal: new AbortController().signal });
    return { out, waits, reranks, result: parseResultFile(files.files.get(out.resultFile!)!)! };
  };
  const twice = await attempt(2);
  expect(twice.waits).toEqual([3_000, 6_000]);
  expect(twice.out.itemCount).toBeGreaterThan(0);
  expect(twice.result.stats.reranked).toBe(true);

  const thrice = await attempt(3);
  expect(thrice.waits).toEqual([3_000, 6_000]);
  expect(thrice.reranks).toBe(3);
  expect(thrice.out.itemCount).toBe(0);
  expect(thrice.result.unjudged).toMatchObject({ runId: "topic-search-1", why: "Connection error." });
});

test("the build takes arXiv from what the read phase found and sends no arXiv request", async () => {
  const files = memoryFiles();
  let searched = 0;
  const d = { ...deps({ files, log: [], today: "2026-10-14" }), searchArxiv: async () => (searched++, []) };
  const now = Date.parse("2026-10-14T12:00:00Z");
  const step = { terms: ["science"], since: "2025-10-14", until: "2026-10-14" };
  const out = await makeBuilder(d)({
    topic: TOPIC,
    kind: "first",
    x: xRead(POSTS),
    arxiv: [
      { query: "q1", items: [AGENTIC], error: null, ladder: { outcome: "widened", steps: [{ ...step, hits: 1 }] } },
      { query: "q2", items: [], error: "rate limited (HTTP 429)", ladder: { outcome: "rate_limited", steps: [{ ...step, terms: ["materials", "discovery"], hits: null }] } },
    ],
    since: now - 30 * 86_400_000,
    runDir: RUN_DIR,
    xPages: ANY_PAGES,
    signal: new AbortController().signal,
  });
  expect(searched).toBe(0);
  const result = parseResultFile(files.files.get(out.resultFile!)!)!;
  expect(result.items.some((i) => i.key === "arxiv:2609.31562")).toBe(true);
  const health = JSON.parse(files.files.get(`${RUN_DIR}/${SOURCE_HEALTH_FILE}`)!) as SourceHealthFile;
  expect(health.entries.find((e) => e.query === "q1" && e.source === "arxiv")).toMatchObject({ status: "ok", ladder: { outcome: "widened" } });
  expect(health.entries.find((e) => e.query === "q2" && e.source === "arxiv")).toMatchObject({ status: "failed", why: "rate limited (HTTP 429)", ladder: { outcome: "rate_limited" } });
});

describe("pieces", () => {
  test("numbers: separators, decimals and references", () => {
    expect(numbersIn("1,200 stars, 3.5x faster on 2026-10-12 (M3.§2, E1)")).toEqual(["1200", "3.5", "2026", "10", "12"]);
    expect(missingNumbers("posted September 30, 2026", ["on September 30, 2026"])).toEqual([]);
    expect(missingNumbers("runs 99 agents", ["We run 12 agents"])).toEqual(["99"]);
  });

  test("rerank answers naming no candidate are dropped, a bad main falls back to self", () => {
    const cand = { key: "x:1", kind: "post", source: "x", queries: ["q1"], text: "t", author: "a", at: 0, post: null, paper: null, links: [{ url: "https://example.com/a", card: false }], relevance: 0.5, engagement: null, order: 0 } as Candidate;
    const numbered = numberPool([{ cand, rrf: 50 }]);
    const answers = parseRerank(JSON.stringify({ items: [{ c: "c1", score: 140, main: "c1.z", subtopic: "nope" }, { c: "c7", score: 50, main: "self" }] }), numbered, TOPIC);
    expect([...answers.keys()]).toEqual(["c1"]);
    expect(answers.get("c1")).toEqual({ score: 100, main: "self", subtopic: null, doubt: null });
  });

  test("the registry numbers by canonical URL and cuts sections", async () => {
    const written = new Map<string, string>();
    const reg = new MaterialRegistry("runs/r", { write: async (p, c) => void written.set(p, c) });
    const a = await reg.register({ url: "https://example.com/post?utm_source=x", title: "T", author: null, publishedAt: null, reader: "web", facts: {}, sections: [{ heading: null, text: "one" }, { heading: "Two", text: "two" }] });
    const b = await reg.register({ url: "https://example.com/post", title: "T", author: null, publishedAt: null, reader: "web", facts: {}, sections: [] });
    expect(b.id).toBe(a.id);
    expect(a.sections.map((s) => s.id)).toEqual(["M1.§1", "M1.§2"]);
    expect(reg.text("M1.§2")).toBe("two");
    expect(reg.has("M2")).toBe(false);
    expect([...written.keys()]).toEqual(["runs/r/materials/M1.json"]);
  });

  test("question caps, asked-once, and repeats of an answer", () => {
    expect([0, 1, 2, 3, 9].map(questionCap)).toEqual([3, 3, 3, 1, 1]);
    const topic = { ...TOPIC, answers: [{ asked: "Do you want funding news about AI chip design?", answer: "No", at: 0 }] };
    let queue = enqueue([], [
      { text: "Do you want funding news about AI chip design?", source: "model", template: null, about: [] },
      { text: "Should robotics labs count?", source: "model", template: null, about: [] },
      { text: "Should robotics labs count?", source: "model", template: null, about: [] },
      { text: "Do weather models belong here?", source: "model", template: null, about: [] },
    ], topic, 1);
    expect(queue.map((q) => q.text)).toEqual(["Should robotics labs count?", "Do weather models belong here?"]);
    const first = pickQuestions(queue, new Set(), 1, "r1", 2);
    expect(first.asked.map((q) => q.text)).toEqual(["Should robotics labs count?"]);
    queue = enqueue(first.queue, [{ text: "Should robotics labs count?", source: "model", template: null, about: [] }], topic, 3);
    const second = pickQuestions(queue, new Set(), 3, "r2", 4);
    expect(second.asked.map((q) => q.text)).toEqual(["Do weather models belong here?"]);
  });

  test("a subtopic quiet for 7 days is asked about", () => {
    const stats: ResultStats = { candidates: { x: 0, arxiv: 0 }, passedFloor: 0, pooled: 0, reranked: true, avoidBlocked: {}, subtopicItems: { s1: 2 }, modelCalls: 0 };
    const past = ["2026-10-06", "2026-10-10", "2026-10-13"].map((date) => ({ date, stats }) as TopicSearchResult);
    const asked = metricQuestions(TOPIC, "2026-10-14", stats, past);
    expect(asked.map((q) => q.template?.params.subtopic)).toEqual(["Materials"]);
  });
});

test("with the X pages spent, a post on X is not opened and stays as the search page showed it", async () => {
  const files = memoryFiles();
  const opened: string[] = [];
  let asked = 0;
  const spent = { take: async () => (asked++, false) };
  const now = Date.parse("2026-10-14T12:00:00Z");
  const out = await makeResultBuilder(deps({ files, log: [], today: "2026-10-14", opened }))({
    topic: TOPIC, kind: "first", x: xRead(POSTS), since: now - 30 * 86_400_000, runDir: RUN_DIR, xPages: spent, signal: new AbortController().signal,
  });
  const result = parseResultFile(files.files.get(out.resultFile!)!)!;
  expect(asked).toBeGreaterThan(0);
  expect(opened.filter((u) => new URL(u).hostname === "x.com")).toEqual([]);
  expect(result.items.find((i) => i.key === `x:${post("thePandaily").id}`)?.title).not.toBe("SRHarness: an open-source runtime for agents");
  // Pages off X still open.
  expect(opened.some((u) => !u.includes("x.com"))).toBe(true);
});

test("the write-up asks to read papers in full: one is read whole, one cannot be, and the item says how deep", async () => {
  const files = memoryFiles();
  const log: TopicModelCall[] = [];
  const now = Date.parse("2026-10-14T12:00:00Z");
  const scripted = scriptedModel(log);
  let asked = false;
  const d = deps({ files, log, today: "2026-10-14" });
  d.model = async (call) => {
    if (call.site !== "write" || asked) return scripted(call);
    asked = true;
    log.push(call);
    const papers = [...call.user.matchAll(/<material id="(E\d+)">\n\1 · paper/g)].map((m) => m[1]);
    return JSON.stringify({ deeper: papers });
  };
  const out = await makeResultBuilder(d)({ topic: TOPIC, kind: "first", x: xRead(POSTS), since: now - 30 * 86_400_000, runDir: RUN_DIR, xPages: ANY_PAGES, signal: new AbortController().signal });
  const result = parseResultFile(files.files.get(out.resultFile!)!)!;
  const writes = log.filter((c) => c.site === "write");
  expect(writes[0].system).toContain("you may ask to read up to 5 of these papers in full");
  expect(writes[0].user).toContain("Paper read: the abstract and the start of the body");

  const agentic = result.items.find((i) => i.key === "arxiv:2609.31562")!;
  const materials = result.items.find((i) => i.key === "arxiv:2610.00001")!;
  expect(agentic.facts).toMatchObject({ kind: "paper", depth: "full" });
  expect(materials.facts).toMatchObject({ kind: "paper", depth: "abstract" });
  const whole = result.materials.find((m) => agentic.materials.includes(m.id))!;
  expect(whole.url).toBe("https://arxiv.org/html/2609.31562");
  expect(whole.facts).toMatchObject({ depth: "full", body: "whole HTML" });
  // The head read cut the method short; the whole read has all of it.
  expect(whole.sections.reduce((n, s) => n + s.chars, 0)).toBeGreaterThan(8000);
  expect(result.stats.deepReads).toEqual({ read: [agentic.id], failed: [materials.id], refused: [] });

  // The write-up after the reads: the whole paper in, the unread one told, no more asking.
  expect(writes[1].user).toContain("Paper read: the whole paper, below.");
  expect(writes[1].tail?.join("\n")).toContain(`Read in full: ${agentic.id}.`);
  expect(writes[1].tail?.join("\n")).toContain(`Could not be read: ${materials.id}`);
  expect(writes[1].system).not.toContain("you may ask to read");
  expect(result.writeup).toBe("model");
});

describe("a study asks about one item of its brief (docs/info/91 「攒着问」)", () => {
  const now = Date.parse("2026-10-14T12:00:00Z");
  async function build(topic: TopicSearch, labels: TopicLabel[] | null) {
    const files = memoryFiles();
    const scripted = deps({ files, log: [], today: "2026-10-14" });
    // The materials paper scores near the line between entry and Note.
    const model: TopicModel = async (call) => {
      const answer = await scripted.model(call);
      if (call.site !== "rerank") return answer;
      const parsed = JSON.parse(answer) as { items: { score: number }[] };
      for (const i of parsed.items) if (i.score === 70) i.score = 47;
      return JSON.stringify(parsed);
    };
    const d = { ...scripted, model };
    const out = await makeResultBuilder(labels ? { ...d, labels: async () => labels } : d)({
      topic, kind: "first", x: xRead(POSTS), since: now - 30 * 86_400_000, runDir: RUN_DIR, xPages: ANY_PAGES, signal: new AbortController().signal,
    });
    const result = parseResultFile(files.files.get(out.resultFile!)!)!;
    const queue = JSON.parse(files.files.get(QUESTIONS_FILE)!).topics[topic.id].questions as PendingQuestion[];
    return { result, queue };
  }
  const labelled = (key: string): TopicLabel => ({
    id: `tl-${key.length.toString(16).padStart(8, "0")}`, searchId: TOPIC.id, item: key, title: key, label: "yes", reason: "it is", source: "line", evidence: "", at: 1, brief: null, criteria: 1,
  });

  test("a study's result carries it last, from its items, and the queue has it as asked", async () => {
    const { result, queue } = await build({ ...TOPIC, once: true }, []);
    const expected = labelQuestion(result.items, new Set(), [], { version: 1, criteria: TOPIC.revision });
    expect(expected!.about).toEqual(["arxiv:2610.00001"]);
    const last = result.questions[result.questions.length - 1];
    expect(last.template).toEqual(expected!.template);
    expect(result.questions.length).toBeLessThanOrEqual(3);
    expect(queue.find((q) => q.template?.code === "label-item")?.askedIn).toBe(result.id);
  });

  test("an item labelled already is not asked about; a search that is not a study asks none", async () => {
    const first = await build({ ...TOPIC, once: true }, []);
    const asked = first.result.questions.find((q) => q.template?.code === "label-item")!.template!.params.item as string;
    const again = await build({ ...TOPIC, once: true }, [labelled(asked)]);
    expect(again.result.questions.some((q) => q.template?.code === "label-item" && q.template.params.item === asked)).toBe(false);
    const daily = await build(TOPIC, []);
    expect(daily.result.questions.some((q) => q.template?.code === "label-item")).toBe(false);
  });
});

test("a study reads its papers in full before the write-up and keeps each entry's seven parts", async () => {
  const files = memoryFiles();
  const log: TopicModelCall[] = [];
  const now = Date.parse("2026-10-14T12:00:00Z");
  const scripted = scriptedModel(log);
  const d = deps({ files, log, today: "2026-10-14" });
  d.model = async (call) => {
    if (call.site !== "write") return scripted(call);
    log.push(call);
    // Each entry tells what was done, citing the first section its block shows (a discrepancy's evidence names the head read the whole one replaced).
    const blocks = [...call.user.matchAll(/<material id="(E\d+)">\n[\s\S]*?<\/material>/g)];
    const items = blocks.map((b) => ({
      e: b[1],
      conclusion: "Work on the topic.",
      method: [[{ text: "A model reads the data.", cite: [/^(M\d+\.§\d+) /m.exec(b[0])?.[1] ?? "M0.§1"] }]],
      results: [],
    }));
    return JSON.stringify({ overview: { text: `Agent markets lead; see ${blocks[0][1]}.`, cites: [blocks[0][1]] }, items });
  };
  const study = { ...TOPIC, once: true };
  const out = await makeResultBuilder(d)({ topic: study, kind: "first", x: xRead(POSTS), since: now - 30 * 86_400_000, runDir: RUN_DIR, xPages: ANY_PAGES, signal: new AbortController().signal });
  const result = parseResultFile(files.files.get(out.resultFile!)!)!;
  const writes = log.filter((c) => c.site === "write");
  const agentic = result.items.find((i) => i.key === "arxiv:2609.31562")!;
  const materials = result.items.find((i) => i.key === "arxiv:2610.00001")!;

  // Read before the first write-up call, and no deeper read offered after.
  expect(writes[0].user).toContain("Paper read: the whole paper, below.");
  expect(writes[0].system).not.toContain("you may ask to read");
  expect(writes[0].system).toContain("background: why this work is worth doing.");
  expect(result.stats.deepReads).toEqual({ read: [agentic.id], failed: [materials.id], refused: [] });
  expect(agentic.parts!.confidence.read).toEqual({ depth: "full", cut: false, through: "2 Method" });
  expect(agentic.parts!.method[0][0].cites[0]).toMatch(/^M\d+\.§1$/);
  expect(agentic.materials).toContain(agentic.parts!.method[0][0].cites[0].split(".")[0]);
  expect(agentic.body).toEqual(["A model reads the data."]);
  expect(result.items.filter((i) => !i.continuing).every((i) => i.parts)).toBe(true);
  expect(result.writeup).toBe("model");
});
