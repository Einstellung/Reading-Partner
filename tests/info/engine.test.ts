// The generic collection engine (src/info/sources/engine.ts): the three discovery pipes
// (json-api with a detail endpoint, json-api with inline bodies, feed + fetched
// page, feed-field, listpage), per-item failure degradation, and per-source
// isolation + health in collectAll. Injected fetch + extract keep it DOM-free.
// Run: bun test.

import { expect, test } from "bun:test";
import {
  collectSource,
  collectAll,
  SOURCE_CONCURRENCY,
  type SourceSettled,
} from "../../src/info/sources/engine";
import type { ExtractReadable } from "../../src/info/extract/readable-select";
import type { SourceDescriptor } from "../../src/info/sources/descriptor";

const extract: ExtractReadable = (_html, url) => ({
  title: "Extracted title",
  contentHtml: `<p>body of ${url}</p>`,
  textContent: `plain body of ${url}`,
});

function res(body: string, status = 200): Response {
  return new Response(body, { status });
}

// --- json-api + detail endpoint (jiqizhixin shape) -------------------------

const JQX: SourceDescriptor = {
  id: "jqx",
  name: "机器之心",
  line: "AI",
  enabled: true,
  discovery: {
    kind: "json-api",
    listUrl: "https://jqx/list",
    itemsPath: "articles",
    urlTemplate: "https://jqx/articles/{id}",
    fields: {
      id: "slug",
      title: "title",
      publishedAt: ["publishedAt", "published_at"],
      summary: ["content", "summary"],
    },
  },
  fulltext: {
    mode: "detail-endpoint",
    urlTemplate: "https://jqx/api/{id}.json",
    contentPath: ["content", "body"],
    titlePath: "title",
  },
};

test("json-api + detail-endpoint pulls list then per-item body", async () => {
  const list = JSON.stringify({
    articles: [
      { slug: "s1", title: "T1", content: "<p>list summary</p>" },
      { title: "no slug, skipped" },
    ],
  });
  const detail = JSON.stringify({ title: "T1 full", content: "<p>The method reaches 42%.</p>" });
  const calls: string[] = [];
  const fetchFn = async (url: string) => {
    calls.push(url);
    return res(url.includes("/api/") ? detail : list);
  };
  const items = await collectSource(JQX, { fetchFn });
  expect(items.length).toBe(1);
  expect(items[0].source).toBe("jqx");
  expect(items[0].sourceName).toBe("机器之心");
  expect(items[0].id).toMatch(/^jqx-/);
  expect(items[0].title).toBe("T1 full");
  expect(items[0].textContent).toContain("42%");
  expect(items[0].summaryOnly).toBe(false);
  expect(calls.length).toBe(2); // 1 list + 1 detail
});

test("json-api keeps a summary-only item when the detail fetch fails", async () => {
  const list = JSON.stringify({ articles: [{ slug: "s1", title: "T1", summary: "just a blurb" }] });
  const fetchFn = async (url: string) => (url.includes("/api/") ? res("nope", 500) : res(list));
  const items = await collectSource(JQX, { fetchFn });
  expect(items.length).toBe(1);
  expect(items[0].textContent).toBeUndefined();
  expect(items[0].summary).toBe("just a blurb");
  expect(items[0].summaryOnly).toBe(true);
});

// --- json-api with inline bodies (wp-json / xinzhiyuan shape) ---------------

test("json-api feed-field reads the body inline with no second request", async () => {
  const desc: SourceDescriptor = {
    id: "wp",
    name: "新智元",
    line: "AI",
    enabled: true,
    discovery: {
      kind: "json-api",
      listUrl: "https://wp/posts",
      fields: {
        id: "id",
        title: "title.rendered",
        url: "link",
        publishedAt: "date",
        content: "content.rendered",
      },
    },
    fulltext: { mode: "feed-field" },
  };
  const list = JSON.stringify([
    { id: 5, title: { rendered: "Hi" }, link: "https://wp/5", date: "2026-07-20", content: { rendered: "<p>Full inline body.</p>" } },
  ]);
  const calls: string[] = [];
  const fetchFn = async (url: string) => {
    calls.push(url);
    return res(list);
  };
  const items = await collectSource(desc, { fetchFn });
  expect(calls.length).toBe(1);
  expect(items[0].title).toBe("Hi");
  expect(items[0].url).toBe("https://wp/5");
  expect(items[0].textContent).toContain("Full inline body");
  expect(items[0].summaryOnly).toBe(false);
});

// --- feed + fetch-page (qbitai shape) --------------------------------------

const RSS = `<rss version="2.0"><channel>
  <item><title>大模型又出新活</title><link>https://q/2026/1.html</link><pubDate>Mon, 20 Jul 2026 10:00:00 +0800</pubDate><category>大模型</category></item>
</channel></rss>`;

const QBIT: SourceDescriptor = {
  id: "qbit",
  name: "量子位",
  line: "AI",
  enabled: true,
  discovery: { kind: "feed", url: "https://q/feed" },
  fulltext: { mode: "fetch-page" },
};

test("feed + fetch-page fetches the page and runs the injected extractor", async () => {
  const fetchFn = async (url: string) => (url.endsWith("/feed") ? res(RSS) : res("<html>page</html>"));
  const items = await collectSource(QBIT, { fetchFn, extract });
  expect(items.length).toBe(1);
  expect(items[0].source).toBe("qbit");
  expect(items[0].title).toBe("Extracted title");
  expect(items[0].textContent).toContain("plain body of");
  expect(items[0].summaryOnly).toBe(false);
  expect(items[0].publishedAt).toContain("2026-07-20");
});

test("feed + fetch-page keeps a summary-only item when the page fetch fails", async () => {
  const fetchFn = async (url: string) => (url.endsWith("/feed") ? res(RSS) : res("boom", 500));
  const items = await collectSource(QBIT, { fetchFn, extract });
  expect(items.length).toBe(1);
  expect(items[0].contentHtml).toBeUndefined();
  expect(items[0].title).toBe("大模型又出新活");
  expect(items[0].summaryOnly).toBe(true);
});

// --- feed-field, none, truncation ------------------------------------------

test("feed-field 'none' yields a summary-only item with the summary set", async () => {
  const desc: SourceDescriptor = {
    id: "arx",
    name: "arXiv cs.RO",
    line: "robotics",
    enabled: true,
    discovery: { kind: "feed", url: "https://a/rss" },
    fulltext: { mode: "none" },
  };
  const rss = `<rss><channel><item><title>Paper</title><link>https://a/abs/1</link><description>An abstract here.</description></item></channel></rss>`;
  const items = await collectSource(desc, { fetchFn: async () => res(rss) });
  expect(items[0].summaryOnly).toBe(true);
  expect(items[0].summary).toContain("abstract");
  expect(items[0].textContent).toBeUndefined();
});

test("feed-field flags a truncated (paywalled) body as summary-only", async () => {
  const desc: SourceDescriptor = {
    id: "sub",
    name: "Interconnects",
    line: "AI",
    enabled: true,
    discovery: { kind: "feed", url: "https://s/feed" },
    fulltext: { mode: "feed-field", field: "content:encoded", truncationMarker: "Read more" },
  };
  const rss = `<rss xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel><item><title>Paid</title><link>https://s/1</link><content:encoded><![CDATA[<p>Intro paragraph. Read more</p>]]></content:encoded></item></channel></rss>`;
  const items = await collectSource(desc, { fetchFn: async () => res(rss) });
  expect(items[0].contentHtml).toContain("Intro paragraph");
  expect(items[0].summaryOnly).toBe(true);
});

// --- listpage (jiemian shape) ----------------------------------------------

test("listpage finds article links, dedups, and fetches each page", async () => {
  const desc: SourceDescriptor = {
    id: "ji",
    name: "界面新闻",
    line: "China tech",
    enabled: true,
    discovery: { kind: "listpage", url: "https://ji.com/lists/65.html", linkPattern: "/article/\\d+\\.html", base: "https://ji.com" },
    fulltext: { mode: "fetch-page" },
  };
  const listHtml = `<a href="/article/123.html">x</a> ... <a href="/article/123.html">dup</a> ... <a href="/article/456.html">y</a>`;
  const fetchFn = async (url: string) => (url.includes("/lists/") ? res(listHtml) : res("<html>art</html>"));
  const items = await collectSource(desc, { fetchFn, extract });
  expect(items.length).toBe(2);
  expect(items[0].url).toBe("https://ji.com/article/123.html");
  expect(items[0].textContent).toContain("plain body of");
});

// --- stream is reserved ----------------------------------------------------

test("stream discovery is rejected (M-info-3)", async () => {
  const desc = {
    id: "jin10",
    name: "金十",
    line: "markets",
    enabled: true,
    discovery: { kind: "stream", url: "https://flash" },
    fulltext: { mode: "none" },
  } as unknown as SourceDescriptor;
  await expect(collectSource(desc, { fetchFn: async () => res("{}") })).rejects.toThrow();
});

// --- collectAll: isolation + health ----------------------------------------

test("collectAll isolates a failing source and records health", async () => {
  const good: SourceDescriptor = {
    id: "good",
    name: "Good",
    line: "AI",
    enabled: true,
    discovery: { kind: "json-api", listUrl: "https://good/list", fields: { id: "id", title: "t", content: "c" } },
    fulltext: { mode: "feed-field" },
  };
  const bad: SourceDescriptor = {
    id: "bad",
    name: "Bad",
    line: "AI",
    enabled: true,
    discovery: { kind: "feed", url: "https://bad/feed" },
    fulltext: { mode: "none" },
  };
  const disabled: SourceDescriptor = { ...good, id: "off", enabled: false };
  const fetchFn = async (url: string) => {
    if (url.includes("good/list")) return res(JSON.stringify([{ id: "1", t: "Good one", c: "<p>body</p>" }]));
    return res("down", 500); // bad feed fails
  };
  const { items, health } = await collectAll([good, bad, disabled], { fetchFn, now: () => 1000 });
  expect(items.length).toBe(1);
  expect(items[0].source).toBe("good");
  expect(health.good.lastSuccess).toBe(1000);
  expect(health.good.lastError).toBeUndefined();
  expect(health.bad.lastError).toBeTruthy();
  expect(health.bad.lastErrorAt).toBe(1000);
  expect(health.off).toBeUndefined(); // disabled source not run
});

test("collectAll hands each source over as it settles, items and all, once per enabled source", async () => {
  const good: SourceDescriptor = {
    id: "good",
    name: "Good",
    line: "AI",
    enabled: true,
    discovery: { kind: "json-api", listUrl: "https://good/list", fields: { id: "id", title: "t", content: "c" } },
    fulltext: { mode: "feed-field" },
  };
  const bad: SourceDescriptor = {
    id: "bad",
    name: "Bad",
    line: "AI",
    enabled: true,
    discovery: { kind: "feed", url: "https://bad/feed" },
    fulltext: { mode: "none" },
  };
  const disabled: SourceDescriptor = { ...good, id: "off", enabled: false };
  const fetchFn = async (url: string) => {
    if (url.includes("good/list"))
      return res(JSON.stringify([{ id: "1", t: "Good one", c: "<p>body</p>" }, { id: "2", t: "Another", c: "<p>b</p>" }]));
    return res("down", 500); // bad feed fails after 5xx retries
  };

  const settled: SourceSettled[] = [];
  await collectAll([good, bad, disabled], {
    fetchFn,
    now: () => 1000,
    onSourceSettled: (r) => void settled.push(r),
  });

  // Exactly one settle per enabled source; the disabled one never runs.
  expect(settled.map((r) => r.source).sort()).toEqual(["bad", "good"]);

  const goodDone = settled.find((r) => r.source === "good")!;
  expect(goodDone.items.map((i) => i.title)).toEqual(["Good one", "Another"]);
  expect(goodDone.error).toBeUndefined();

  const badErr = settled.find((r) => r.source === "bad")!;
  expect(badErr.items).toEqual([]);
  expect(badErr.error).toBeTruthy();
});

// --- concurrency + cancellation --------------------------------------------

// A feed of n entries, so a source's per-article half has something to overlap.
function feedOf(n: number): string {
  const items = Array.from(
    { length: n },
    (_, i) => `<item><title>T${i}</title><link>https://q/${i}.html</link></item>`,
  ).join("");
  return `<rss version="2.0"><channel>${items}</channel></rss>`;
}

test("a source fetches its articles several at a time, in feed order", async () => {
  const pages: ((v: Response) => void)[] = [];
  let inFlight = 0;
  let peak = 0;
  const fetchFn = async (url: string) => {
    if (url.endsWith("/feed")) return res(feedOf(8));
    inFlight++;
    peak = Math.max(peak, inFlight);
    const body = await new Promise<Response>((resolve) => pages.push(resolve));
    inFlight--;
    return body;
  };
  const run = collectSource(QBIT, { fetchFn, extract });
  // Let the feed land and the first batch of page fetches go out.
  await new Promise<void>((r) => setTimeout(r, 0));
  expect(peak).toBeGreaterThan(1);
  // Answer in reverse, so completion order is the opposite of feed order.
  for (const resolve of [...pages].reverse()) resolve(res("<html>page</html>"));
  await new Promise<void>((r) => setTimeout(r, 0));
  for (const resolve of pages) resolve(res("<html>page</html>"));
  const items = await run;
  expect(items.map((i) => i.url)).toEqual(
    Array.from({ length: 8 }, (_, i) => `https://q/${i}.html`),
  );
});

test("an abort stops a source mid-collection and sends nothing more", async () => {
  const controller = new AbortController();
  let pageFetches = 0;
  const fetchFn = async (url: string) => {
    if (url.endsWith("/feed")) return res(feedOf(20));
    pageFetches++;
    // Slow enough that the abort lands while the first batch is in flight.
    await new Promise<void>((r) => setTimeout(r, 5));
    return res("<html>page</html>");
  };
  const run = collectSource(QBIT, { fetchFn, extract, signal: controller.signal });
  await new Promise<void>((r) => setTimeout(r, 0));
  controller.abort();
  await expect(run).rejects.toThrow();
  const sentBeforeAbort = pageFetches;
  await new Promise<void>((r) => setTimeout(r, 20));
  // Nothing left the queue after the abort: 20 articles, at most one batch sent.
  expect(pageFetches).toBe(sentBeforeAbort);
  expect(pageFetches).toBeLessThanOrEqual(SOURCE_CONCURRENCY);
});

test("a source already aborted is never fetched at all", async () => {
  const controller = new AbortController();
  controller.abort();
  let calls = 0;
  const fetchFn = async () => {
    calls++;
    return res(feedOf(1));
  };
  await expect(collectSource(QBIT, { fetchFn, extract, signal: controller.signal })).rejects.toThrow();
  expect(calls).toBe(0);
});

test("collectAll keeps the sources that settled and stays quiet about the aborted one", async () => {
  const controller = new AbortController();
  const fast: SourceDescriptor = {
    id: "fast",
    name: "Fast",
    line: "AI",
    enabled: true,
    discovery: { kind: "json-api", listUrl: "https://fast/list", fields: { id: "id", title: "t", content: "c" } },
    fulltext: { mode: "feed-field" },
  };
  const slow: SourceDescriptor = { ...QBIT, id: "slow", name: "Slow" };
  const fetchFn = async (url: string) => {
    if (url.includes("fast/list")) return res(JSON.stringify([{ id: "1", t: "One", c: "<p>b</p>" }]));
    if (url.endsWith("/feed")) return res(feedOf(20));
    await new Promise<void>((r) => setTimeout(r, 50));
    return res("<html>page</html>");
  };
  const settled: SourceSettled[] = [];
  const run = collectAll([fast, slow], {
    fetchFn,
    extract,
    now: () => 1000,
    signal: controller.signal,
    onSourceSettled: (r) => void settled.push(r),
  });
  await new Promise<void>((r) => setTimeout(r, 5));
  controller.abort();
  const { items, health } = await run;
  // The one that finished is kept and reported; the cancelled one is neither
  // reported nor blamed in the health sidecar, so it stays pending for a resume.
  expect(settled.map((r) => r.source)).toEqual(["fast"]);
  expect(items.map((i) => i.source)).toEqual(["fast"]);
  expect(health.fast.lastSuccess).toBe(1000);
  expect(health.slow).toBeUndefined();
});

test("a settled source reports how long it took", async () => {
  const desc: SourceDescriptor = {
    id: "timed",
    name: "Timed",
    line: "AI",
    enabled: true,
    discovery: { kind: "json-api", listUrl: "https://timed/list", fields: { id: "id", title: "t", content: "c" } },
    fulltext: { mode: "feed-field" },
  };
  let clock = 1000;
  const settled: SourceSettled[] = [];
  const { health } = await collectAll([desc], {
    fetchFn: async () => {
      clock += 250;
      return res(JSON.stringify([{ id: "1", t: "One", c: "<p>b</p>" }]));
    },
    now: () => clock,
    onSourceSettled: (r) => void settled.push(r),
  });
  expect(settled[0].durationMs).toBe(250);
  expect(health.timed.lastDurationMs).toBe(250);
  expect(health.timed.lastItems).toBe(1);
});
