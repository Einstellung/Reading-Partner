// The factory-preset descriptors (src/info/sources/builtins.ts): ids are unique,
// every descriptor is structurally valid, and the four premium sources added from
// the 2026-08-11 research keep the shape that round verified — the discovery
// layer and the caveat text a user must hear before connecting them. No network.
// Run: bun test.

import { expect, test } from "bun:test";
import { BUILTIN_SOURCES, builtinById, builtinCaveat } from "../../src/info/sources/builtins";
import { pollIntervalMs, validateDescriptor } from "../../src/info/sources/descriptor";

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

test("every Bloomberg section that carries articles is present", () => {
  for (const [id, slug] of BLOOMBERG_SECTIONS) {
    const d = builtinById(id);
    expect(d?.discovery).toEqual({
      kind: "feed",
      url: `https://www.bloomberg.com/feeds/${slug}/news.rss`,
      format: "rss",
    });
    expect(d?.limit).toBe(20);
  }
});

test("the business section is not a section, whatever its feed says", () => {
  // Fetched for real: 20 rows, zero articles — 14-15 podcast episodes and 4-5
  // web copies of a newsletter, with "Source: Bloomberg, 6:21" (a duration) for
  // a description. A feed that parses is not a feed that carries anything.
  expect(builtinById("bloomberg-business")).toBeUndefined();
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
    "arxiv-cs-ro",
    "hacker-news",
    "techcrunch-robotics",
    "bair-blog",
    "mit-tech-review",
    "xinzhiyuan",
  ]) {
    expect(builtinById(id)).toBeUndefined();
  }
  // And what is kept: two Chinese sources, Bloomberg, Nature, Science, the
  // Economist.
  expect(builtinById("jiqizhixin")).toBeTruthy();
  expect(builtinById("jiemian")).toBeTruthy();
  expect(BUILTIN_SOURCES.length).toBe(24);
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
  const d = builtinById("nature");
  expect(d?.discovery).toEqual({ kind: "feed", url: "https://www.nature.com/nature.rss", format: "rdf" });
  // The editorial summary rides in content:encoded; the engine's field fallback
  // picks it up, so the descriptor does not have to claim a full text it lacks.
  expect(d?.fulltext.mode).toBe("none");
  const c = builtinCaveat("nature") ?? "";
  expect(c).toMatch(/content:encoded/);
  expect(c).toMatch(/406/);
  expect(c).toMatch(/rate-limit/);
  expect(c).toMatch(/webview/);
  expect(builtinById("nature-machine-intelligence")?.fulltext.mode).toBe("none");
  expect(builtinCaveat("nature-machine-intelligence")).toMatch(/406/);
});

test("Science news is a feed and Science research discovers through Crossref", () => {
  const news = builtinById("science-news");
  expect(news?.discovery).toEqual({
    kind: "feed",
    url: "https://www.science.org/rss/news_current.xml",
    format: "rdf",
  });
  expect(news?.fulltext.mode).toBe("none");

  const journal = builtinById("science-journal");
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
    expect(builtinById(id)?.pollMinutes).toBe(180);
    expect(pollIntervalMs(builtinById(id)!)).toBe(3 * 60 * 60_000);
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
  for (const id of daily) expect(builtinById(id)?.pollMinutes).toBe(24 * 60);
});

test("a builtin with no measured window states no interval and takes the default", () => {
  // Guessing at an interval for a feed nobody timed would be the same mistake in
  // the other direction: a number in the file reads as a measurement.
  const stated = BUILTIN_SOURCES.filter((s) => s.pollMinutes !== undefined).map((s) => s.id);
  expect(stated).not.toContain("jiemian");
  expect(stated).not.toContain("jiqizhixin");
  expect(pollIntervalMs(builtinById("jiqizhixin")!)).toBe(pollIntervalMs({}));
});
