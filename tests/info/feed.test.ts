// Feed parser (src/info/feed.ts): RSS 2.0, Atom, RDF, CDATA, and field
// selection. Run: bun test.

import { expect, test } from "bun:test";
import { parseFeed, feedFieldBody } from "../../src/info/sources/feed";

const RSS = `<?xml version="1.0"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/">
<channel>
  <item>
    <title>First post</title>
    <link>https://ex.com/a/1</link>
    <pubDate>Mon, 20 Jul 2026 10:00:00 +0000</pubDate>
    <description><![CDATA[<p>A short teaser with a number 42.</p>]]></description>
    <content:encoded><![CDATA[<p>The full body of the first post, much longer.</p>]]></content:encoded>
    <category>models</category>
  </item>
  <item>
    <title>Second</title>
    <link>https://ex.com/a/2</link>
  </item>
</channel></rss>`;

const ATOM = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <title>Willison post</title>
    <link rel="alternate" href="https://simonwillison.net/2026/x"/>
    <link rel="self" href="https://simonwillison.net/self"/>
    <published>2026-07-20T09:00:00Z</published>
    <summary type="html">&lt;p&gt;The real body lives in summary here.&lt;/p&gt;</summary>
  </entry>
</feed>`;

// RDF / RSS 1.0 shape (Nature): items are siblings, link is text.
const RDF = `<?xml version="1.0"?>
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns="http://purl.org/rss/1.0/" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <item rdf:about="https://nature.com/x">
    <title>Nature item</title>
    <link>https://nature.com/x</link>
    <dc:date>2026-07-20</dc:date>
    <description>A one-line abstract.</description>
  </item>
</rdf:RDF>`;

test("parseFeed reads RSS 2.0 with content:encoded and CDATA", () => {
  const entries = parseFeed(RSS);
  expect(entries.length).toBe(2);
  expect(entries[0].title).toBe("First post");
  expect(entries[0].link).toBe("https://ex.com/a/1");
  expect(entries[0].description).toContain("teaser");
  expect(entries[0].contentEncoded).toContain("full body");
  expect(entries[0].category).toBe("models");
  expect(entries[0].publishedAt).toContain("2026-07-20");
});

test("parseFeed reads Atom, taking the alternate link and summary body", () => {
  const entries = parseFeed(ATOM);
  expect(entries.length).toBe(1);
  expect(entries[0].link).toBe("https://simonwillison.net/2026/x");
  expect(entries[0].summary).toContain("real body lives in summary");
});

test("parseFeed reads an RDF feed without crashing", () => {
  const entries = parseFeed(RDF);
  expect(entries.length).toBe(1);
  expect(entries[0].title).toBe("Nature item");
  expect(entries[0].link).toBe("https://nature.com/x");
  expect(entries[0].description).toContain("abstract");
});

test("parseFeed tolerates garbage", () => {
  expect(parseFeed("not xml")).toEqual([]);
  expect(parseFeed("<rss></rss>")).toEqual([]);
});

test("feedFieldBody selects the named field with sane fallbacks", () => {
  const [e] = parseFeed(RSS);
  expect(feedFieldBody(e, "content:encoded")).toContain("full body");
  expect(feedFieldBody(e, "description")).toContain("teaser");
  // Atom summary source: "summary" reaches the body, "content:encoded" falls back.
  const [a] = parseFeed(ATOM);
  expect(feedFieldBody(a, "summary")).toContain("real body");
  expect(feedFieldBody(a, "content:encoded")).toContain("real body");
});
