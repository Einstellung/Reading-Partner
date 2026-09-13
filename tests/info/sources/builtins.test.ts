// The factory-preset descriptors (src/info/sources/builtins.ts): ids are unique,
// every descriptor is structurally valid, and the four premium sources added from
// the 2026-08-11 research keep the shape that round verified — the discovery
// layer and the caveat text a user must hear before connecting them. No network.
// Run: bun test.

import { expect, test } from "bun:test";
import { BUILTIN_SOURCES, builtinCaveat } from "../../../src/info/sources/builtins";
import { pollIntervalMs, validateDescriptor } from "../../../src/info/sources/descriptor";
import { arxivQueryTerms } from "../../../src/scholar/arxiv";

test("builtin ids are unique and every descriptor validates", () => {
  const ids = BUILTIN_SOURCES.map((s) => s.id);
  expect(new Set(ids).size).toBe(ids.length);
  for (const s of BUILTIN_SOURCES) {
    expect(validateDescriptor(s).ok).toBe(true);
    expect(s.builtin).toBe(true);
    expect(s.enabled).toBe(false);
  }
});

const BLOOMBERG_SECTIONS = [
  ["bloomberg-markets", "markets"],
  ["bloomberg-economics", "economics"],
  ["bloomberg-industries", "industries"],
  ["bloomberg-technology", "technology"],
  ["bloomberg-politics", "politics"],
  ["bloomberg-crypto", "crypto"],
  // The opinion section's feed slug is bview.
  ["bloomberg-opinion", "bview"],
] as const;

test("every Bloomberg section that carries articles is present, with the webview pipe", () => {
  for (const [id, slug] of BLOOMBERG_SECTIONS) {
    const d = BUILTIN_SOURCES.find((s) => s.id === id);
    expect(d?.discovery).toEqual({
      kind: "feed",
      url: `https://www.bloomberg.com/feeds/${slug}/news.rss`,
      format: "rss",
    });
    expect(d?.limit).toBe(20);
    // The article page answers 403 to a plain fetch and serves a real browser
    // engine, so bodies come through the hidden webview — and the sign-in page
    // rides along, because anonymous gets the preview and a session gets the
    // article.
    expect(d?.fulltext).toEqual({
      mode: "webview",
      signInUrl: "https://www.bloomberg.com/account/signin",
    });
  }
});

test("the business section is not a section, whatever its feed says", () => {
  // Fetched for real: 20 rows, zero articles — 14-15 podcast episodes and 4-5
  // web copies of a newsletter, with "Source: Bloomberg, 6:21" (a duration) for
  // a description. A feed that parses is not a feed that carries anything.
  expect(BUILTIN_SOURCES.find((s) => s.id === "bloomberg-business")).toBeUndefined();
});

test("the preset list is the sites that get read, not everything that was researched", () => {
  // The AI/robotics newsletter tier went; their research is in the ingestion
  // memory. A preset nobody enables still has to be maintained.
  for (const id of [
    "qbitai",
    "simonwillison",
    "interconnects",
    "therobotreport",
    "ieee-spectrum-robotics",
    "hacker-news",
    "techcrunch-robotics",
    "bair-blog",
    "mit-tech-review",
    "xinzhiyuan",
  ]) {
    expect(BUILTIN_SOURCES.find((s) => s.id === id)).toBeUndefined();
  }
  // And what is kept: two Chinese sources, Bloomberg, Nature, Science, the
  // Economist — plus the seven index queries (docs/69), which are a different
  // kind of preset: a query the product runs, not a site somebody must read.
  expect(BUILTIN_SOURCES.find((s) => s.id === "jiqizhixin")).toBeTruthy();
  expect(BUILTIN_SOURCES.find((s) => s.id === "jiemian")).toBeTruthy();
  expect(BUILTIN_SOURCES.length).toBe(31);
});

// --- index queries (docs/69) ---------------------------------------------------

const INDEX_TEMPLATES: Record<string, { provider: string; query: Record<string, unknown>; limit: number; poll: number; fulltext: string }> = {
  "arxiv-cs-ro": { provider: "arxiv", query: { categories: ["cs.RO"], days: 2 }, limit: 100, poll: 1440, fulltext: "none" },
  "arxiv-embodied": {
    provider: "arxiv",
    query: { categories: ["cs.RO", "cs.CV", "cs.LG"], terms: ["vision-language-action"], days: 3 },
    limit: 50,
    poll: 1440,
    fulltext: "none",
  },
  "github-trending-python": {
    provider: "github",
    query: { mode: "trending", language: "Python", period: "day" },
    limit: 30,
    poll: 720,
    fulltext: "fetch-page",
  },
  "github-new-robotics": {
    provider: "github",
    query: { mode: "search", topics: ["robotics", "embodied-ai", "vla"], days: 14, minStars: 30 },
    limit: 30,
    poll: 720,
    fulltext: "fetch-page",
  },
  "hf-daily-papers": { provider: "huggingface", query: { kind: "papers", days: 1 }, limit: 50, poll: 720, fulltext: "none" },
  "hf-models-robotics": {
    provider: "huggingface",
    query: { kind: "models", pipelineTag: "robotics", sort: "trending" },
    limit: 30,
    poll: 720,
    fulltext: "none",
  },
  "hf-datasets-lerobot": {
    provider: "huggingface",
    query: { kind: "datasets", tags: ["LeRobot"], sort: "created" },
    limit: 30,
    poll: 720,
    fulltext: "none",
  },
};

test("the embodied-AI room's index queries are present, one query each, with the library's rhythm", () => {
  for (const [id, want] of Object.entries(INDEX_TEMPLATES)) {
    const d = BUILTIN_SOURCES.find((s) => s.id === id);
    expect(d?.discovery).toEqual({ kind: "index", provider: want.provider, query: want.query });
    expect(d?.limit).toBe(want.limit);
    expect(d?.pollMinutes).toBe(want.poll);
    expect(d?.fulltext.mode).toBe(want.fulltext);
  }
  // Every index preset is one of these; no query slipped in unlisted.
  const indexIds = BUILTIN_SOURCES.filter((s) => s.discovery.kind === "index").map((s) => s.id);
  expect(indexIds.sort()).toEqual(Object.keys(INDEX_TEMPLATES).sort());
});

test("the arXiv term is one the scholar client's cleaning keeps whole", () => {
  // A hyphenated term split into three words would AND "vision", "language" and
  // "action" and match half of cs.CV; kept whole it is one all: clause.
  expect(arxivQueryTerms("vision-language-action")).toEqual(["vision-language-action"]);
});

test("the index caveats carry the docs/69 pitfalls: fake stars, request-count downloads, the arXiv limiter", () => {
  for (const id of ["github-trending-python", "github-new-robotics"]) {
    const c = builtinCaveat(id) ?? "";
    expect(c).toMatch(/fake stars/);
    expect(c).toMatch(/OSS Insight/);
    expect(c).toMatch(/60 requests/);
  }
  for (const id of ["hf-daily-papers", "hf-models-robotics", "hf-datasets-lerobot"]) {
    const c = builtinCaveat(id) ?? "";
    expect(c).toMatch(/request counts/);
    expect(c).toMatch(/fine-tunes/);
  }
  for (const id of ["arxiv-cs-ro", "arxiv-embodied"]) {
    const c = builtinCaveat(id) ?? "";
    expect(c).toMatch(/sortBy=submittedDate/);
    expect(c).toMatch(/pitfall\/72/);
  }
});

test("Bloomberg's caveat carries the 403 wall, the short window, and the terms", () => {
  for (const [id] of BLOOMBERG_SECTIONS) {
    const c = builtinCaveat(id) ?? "";
    expect(c).toMatch(/403/);
    expect(c).toMatch(/PerimeterX/);
    expect(c).toMatch(/20 items/);
    expect(c).toMatch(/2-4 hours/);
    expect(c).toMatch(/scraper/);
    expect(c).toMatch(/redistribut/i);
    // The screening material, measured per section rather than rounded to one
    // number for all of them.
    expect(c).toMatch(/206 characters for markets/);
  }
});

test("Nature is an RDF feed read as discovery-only, with the 406/rate-limit caveat", () => {
  const d = BUILTIN_SOURCES.find((s) => s.id === "nature");
  expect(d?.discovery).toEqual({ kind: "feed", url: "https://www.nature.com/nature.rss", format: "rdf" });
  // The editorial summary rides in content:encoded; the engine's field fallback
  // picks it up, so the descriptor does not have to claim a full text it lacks.
  expect(d?.fulltext.mode).toBe("none");
  const c = builtinCaveat("nature") ?? "";
  expect(c).toMatch(/content:encoded/);
  expect(c).toMatch(/406/);
  expect(c).toMatch(/rate-limit/);
  expect(c).toMatch(/webview/);
  expect(BUILTIN_SOURCES.find((s) => s.id === "nature-machine-intelligence")?.fulltext.mode).toBe("none");
  expect(builtinCaveat("nature-machine-intelligence")).toMatch(/406/);
});

test("Science news is a feed and Science research discovers through Crossref", () => {
  const news = BUILTIN_SOURCES.find((s) => s.id === "science-news");
  expect(news?.discovery).toEqual({
    kind: "feed",
    url: "https://www.science.org/rss/news_current.xml",
    format: "rdf",
  });
  expect(news?.fulltext.mode).toBe("none");

  const journal = BUILTIN_SOURCES.find((s) => s.id === "science-journal");
  expect(journal?.discovery.kind).toBe("json-api");
  const disc = journal?.discovery as { listUrl: string; itemsPath?: string; fields: Record<string, unknown> };
  expect(disc.listUrl).toContain("api.crossref.org/journals/0036-8075/works");
  // Crossref's polite pool wants a contact address.
  expect(disc.listUrl).toContain("mailto=");
  expect(disc.itemsPath).toBe("message.items");
  // title is an array in Crossref rows; dotPath indexes it by property name.
  expect(disc.fields.title).toBe("title.0");
  expect(disc.fields.summary).toBe("abstract");
  expect(journal?.fulltext.mode).toBe("none");
  expect(builtinCaveat("science-journal")).toMatch(/2375-2548/);
  expect(builtinCaveat("science-news")).toMatch(/Cloudflare/);
});

test("Economist sections share one pipe and one caveat", () => {
  const sections = BUILTIN_SOURCES.filter((s) => s.id.startsWith("economist-"));
  expect(sections.length).toBeGreaterThanOrEqual(10);
  for (const s of sections) {
    const disc = s.discovery as { kind: string; url: string };
    expect(disc.kind).toBe("feed");
    expect(disc.url).toMatch(/^https:\/\/www\.economist\.com\/[a-z-]+\/rss\.xml$/);
    expect(s.fulltext.mode).toBe("none");
    const c = builtinCaveat(s.id) ?? "";
    expect(c).toMatch(/300 items/);
    expect(c).toMatch(/three weeks/);
    expect(c).toMatch(/Cloudflare/);
    expect(c).toMatch(/\/pro/);
  }
  // The bare-domain default is the whole-magazine feed.
  expect(BUILTIN_SOURCES.find((s) => s.id.startsWith("economist"))?.id).toBe("economist-latest");
});

// --- how often each one is worth asking (docs/35) ----------------------------
//
// The interval is not a preference, it is the feed's window divided by a margin:
// a source is polled often enough that what it published is still on the page
// when the poll arrives. The windows below are the measured ones.

test("Bloomberg is polled every three hours, because its window is six", () => {
  for (const [id] of BLOOMBERG_SECTIONS) {
    expect(BUILTIN_SOURCES.find((s) => s.id === id)?.pollMinutes).toBe(180);
    expect(pollIntervalMs(BUILTIN_SOURCES.find((s) => s.id === id)!)).toBe(3 * 60 * 60_000);
  }
});

test("the three-week and one-week windows are polled daily", () => {
  const daily = [
    "nature",
    "nature-machine-intelligence",
    "science-news",
    "science-journal",
    ...BUILTIN_SOURCES.filter((s) => s.id.startsWith("economist-")).map((s) => s.id),
  ];
  for (const id of daily) expect(BUILTIN_SOURCES.find((s) => s.id === id)?.pollMinutes).toBe(24 * 60);
});

test("a builtin with no measured window states no interval and takes the default", () => {
  // Guessing at an interval for a feed nobody timed would be the same mistake in
  // the other direction: a number in the file reads as a measurement.
  const stated = BUILTIN_SOURCES.filter((s) => s.pollMinutes !== undefined).map((s) => s.id);
  expect(stated).not.toContain("jiemian");
  expect(stated).not.toContain("jiqizhixin");
  expect(pollIntervalMs(BUILTIN_SOURCES.find((s) => s.id === "jiqizhixin")!)).toBe(pollIntervalMs({}));
});
