// qbitai adapter (src/info/qbitai.ts): RSS parse (pure) and the collect logic
// with an injected fetch + extractor (DOM-free). Run: bun test.

import { expect, test } from "bun:test";
import { collectQbitai, parseQbitaiFeed, type ExtractReadable } from "../../src/info/qbitai";

const FEED = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
  <title>量子位</title>
  <item>
    <title><![CDATA[大模型又出新活]]></title>
    <link>https://www.qbitai.com/2026/07/100001.html</link>
    <pubDate>Mon, 20 Jul 2026 10:00:00 +0800</pubDate>
    <category><![CDATA[大模型]]></category>
  </item>
  <item>
    <title>没有链接不算</title>
    <pubDate>Mon, 20 Jul 2026 09:00:00 +0800</pubDate>
  </item>
  <item>
    <title>第二篇</title>
    <link>https://www.qbitai.com/2026/07/100002.html</link>
    <pubDate>Mon, 20 Jul 2026 08:00:00 +0800</pubDate>
    <category>芯片</category>
  </item>
</channel></rss>`;

test("parseQbitaiFeed reads items, decodes CDATA, drops link-less entries", () => {
  const items = parseQbitaiFeed(FEED);
  expect(items.length).toBe(2);
  expect(items[0].title).toBe("大模型又出新活");
  expect(items[0].link).toBe("https://www.qbitai.com/2026/07/100001.html");
  expect(items[0].category).toBe("大模型");
  expect(items[1].title).toBe("第二篇");
});

test("parseQbitaiFeed tolerates garbage", () => {
  expect(parseQbitaiFeed("<rss></rss>")).toEqual([]);
  expect(parseQbitaiFeed("not xml")).toEqual([]);
});

test("collectQbitai fetches each article and runs the injected extractor", async () => {
  const fetchFn = async (url: string) => {
    if (url.endsWith("/feed")) return new Response(FEED, { status: 200 });
    return new Response(`<html><body>page for ${url}</body></html>`, { status: 200 });
  };
  const extract: ExtractReadable = (_html, url) => ({
    title: "Extracted title",
    contentHtml: `<p>body of ${url}</p>`,
    textContent: `plain body of ${url}`,
  });
  const items = await collectQbitai({ fetchFn, extract });
  expect(items.length).toBe(2);
  expect(items[0].source).toBe("qbitai");
  expect(items[0].id).toMatch(/^qbitai-/);
  expect(items[0].title).toBe("Extracted title");
  expect(items[0].textContent).toContain("plain body of");
  // pubDate normalized to ISO.
  expect(items[0].publishedAt).toContain("2026-07-20");
});

test("collectQbitai keeps an item when extraction returns null", async () => {
  const fetchFn = async (url: string) =>
    url.endsWith("/feed")
      ? new Response(FEED, { status: 200 })
      : new Response("<html></html>", { status: 200 });
  const extract: ExtractReadable = () => null;
  const items = await collectQbitai({ fetchFn, extract });
  expect(items.length).toBe(2);
  expect(items[0].contentHtml).toBeUndefined();
  expect(items[0].title).toBe("大模型又出新活");
});
