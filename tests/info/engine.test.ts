// The generic collection engine (src/info/engine.ts): the three discovery pipes
// (json-api with a detail endpoint, json-api with inline bodies, feed + fetched
// page, feed-field, listpage), per-item failure degradation, and per-source
// isolation + health in collectAll. Injected fetch + extract keep it DOM-free.
// Run: bun test.

import { expect, test } from "bun:test";
import { collectSource, collectAll, type CollectEvent } from "../../src/info/engine";
import type { ExtractReadable, SourceDescriptor } from "../../src/info/descriptor";

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

test("collectAll emits per-source progress: start for every source, done/error as they settle", async () => {
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

  const events: CollectEvent[] = [];
  await collectAll([good, bad, disabled], { fetchFn, now: () => 1000, onProgress: (e) => events.push(e) });

  // Only enabled sources emit; the disabled one never starts.
  const starts = events.filter((e) => e.kind === "source-start");
  expect(starts.length).toBe(2);
  expect(starts.every((e) => e.total === 2)).toBe(true);
  expect(starts.map((e) => e.source).sort()).toEqual(["bad", "good"]);
  expect(events.some((e) => e.source === "off")).toBe(false);

  const goodDone = events.find((e) => e.kind === "source-done" && e.source === "good");
  expect(goodDone).toBeDefined();
  expect(goodDone!.kind === "source-done" && goodDone!.items).toBe(2);

  const badErr = events.find((e) => e.kind === "source-error" && e.source === "bad");
  expect(badErr).toBeDefined();
  expect(badErr!.kind === "source-error" && badErr!.error).toBeTruthy();

  // Exactly one settle (done|error) per enabled source.
  const settles = events.filter((e) => e.kind !== "source-start");
  expect(settles.length).toBe(2);
});
