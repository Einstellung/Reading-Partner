// Saved articles (src/reading/saved-articles.ts, pure parts). The fs read/write
// paths need the Tauri plugin; only the pure helpers run here. Three things must
// not silently regress: the same article saved twice stays one record, an
// inlined base64 image never reaches the records file (a day's article cache is
// 4MB of them), and publishedAt / summaryOnly survive the trip — docs/21 needs
// both the moment anything quotes a saved article.
// Run: bun test.

import { expect, test } from "bun:test";
import {
  buildSavedArticle,
  formatPublishedAt,
  normalizeArticleUrl,
  parseSavedArticles,
  removeSavedArticleById,
  savedArticleId,
  savedArticlesForTopic,
  stripDataImages,
  upsertSavedArticle,
  type SavedArticleInput,
} from "../../src/reading/saved-articles";
import { resolveSummaryOnly } from "../../src/ui/components/info/saveArticle";
import type { InfoItem } from "../../src/info/sources/item";

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

// --- stripDataImages --------------------------------------------------------

test("stripDataImages drops inlined base64 images, tag and all", () => {
  const html =
    '<p>one</p><img src="data:image/jpeg;base64,AAAA" referrerpolicy="no-referrer" loading="lazy"><p>two</p>';
  expect(stripDataImages(html)).toBe("<p>one</p><p>two</p>");
});

test("stripDataImages leaves an external image alone", () => {
  const html = '<img src="https://cdn.example.com/x.jpg" referrerpolicy="no-referrer">';
  expect(stripDataImages(html)).toBe(html);
});

test("stripDataImages drops every inlined image, not just the first", () => {
  const html = '<img src="data:image/png;base64,A"><p>x</p><img src="data:image/png;base64,B">';
  expect(stripDataImages(html)).toBe("<p>x</p>");
});

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

test("parseSavedArticles drops entries without an identity and survives garbage", () => {
  const good = buildSavedArticle(input(), 1);
  const text = JSON.stringify([good, { title: "no id" }, { id: "" }, null]);
  expect(parseSavedArticles(text).map((a) => a.id)).toEqual([good.id]);
  expect(parseSavedArticles("not json")).toEqual([]);
  expect(parseSavedArticles('{"articles":[]}')).toEqual([]);
});

test("formatPublishedAt shows an unparseable date verbatim and nothing for none", () => {
  expect(formatPublishedAt("")).toBe("");
  expect(formatPublishedAt("  ")).toBe("");
  expect(formatPublishedAt("last Tuesday")).toBe("last Tuesday");
  expect(formatPublishedAt("2026-07-20T08:00:00Z")).toBe(
    new Date("2026-07-20T08:00:00Z").toLocaleDateString(),
  );
});

// --- resolveSummaryOnly (ui/components/info/saveArticle.ts) -----------------

function item(over: Partial<InfoItem> = {}): InfoItem {
  return {
    id: "i1",
    source: "src",
    sourceName: "Source",
    title: "T",
    url: "https://example.com/a",
    publishedAt: "",
    ...over,
  };
}

test("resolveSummaryOnly reads the day's item snapshot", () => {
  expect(resolveSummaryOnly([item({ id: "i1", summaryOnly: true })], "i1")).toBe(true);
  expect(resolveSummaryOnly([item({ id: "i1", summaryOnly: false })], "i1")).toBe(false);
  // An item that never carried the flag had its full text fetched.
  expect(resolveSummaryOnly([item({ id: "i1" })], "i1")).toBe(false);
});

// The conservative direction: with the day's snapshot gone (regenerated, pruned),
// the article is marked evidence-incomplete rather than quotable as full text.
test("resolveSummaryOnly is true when the item is not in the snapshot", () => {
  expect(resolveSummaryOnly([], "i1")).toBe(true);
  expect(resolveSummaryOnly([item({ id: "other", summaryOnly: false })], "i1")).toBe(true);
});
