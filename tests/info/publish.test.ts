// What the collector publishes for the readers (src/info/briefing/publish.ts):
// which items get a body, what is taken out of it, and how a reader tells a
// matched pair from a briefing whose text has not arrived yet (docs/36).
// Run: bun test.

import { expect, test } from "bun:test";
import {
  bodiesMatch,
  buildPublishedBodies,
  tieredItemIds,
} from "../../src/info/briefing/publish";
import type { CachedArticle } from "../../src/info/briefing/store";
import type { Briefing } from "../../src/info/briefing/types";
import type { InfoItem } from "../../src/info/sources/item";

function meta(id: string) {
  return {
    title: `title ${id}`,
    url: `https://example.test/${id}`,
    source: "src",
    sourceName: "Source",
    publishedAt: "2026-08-12T00:00:00Z",
  };
}

function briefing(over: Partial<Briefing> = {}): Briefing {
  return {
    date: "2026-08-12",
    generatedAt: 1_000,
    overview: "a day",
    mustRead: [{ itemId: "a", reason: "because" }],
    oneLiners: [{ itemId: "b", line: "the point" }],
    outOfLane: [{ itemId: "c", reason: "widening" }],
    filtered: [{ itemId: "d", category: "vendor PR" }],
    items: { a: meta("a"), b: meta("b"), c: meta("c"), d: meta("d") },
    ...over,
  };
}

function item(id: string, over: Partial<InfoItem> = {}): InfoItem {
  return {
    id,
    source: "src",
    sourceName: "Source",
    title: `title ${id}`,
    url: `https://example.test/${id}`,
    publishedAt: "2026-08-12T00:00:00Z",
    summary: "",
    ...over,
  } as InfoItem;
}

test("only the three tiers are published", () => {
  expect(tieredItemIds(briefing())).toEqual(["a", "b", "c"]);
});

test("a published body is the text and the html", () => {
  const articles: Record<string, CachedArticle> = {
    a: { textContent: "the text", contentHtml: "<p>hi</p>" },
  };
  const out = buildPublishedBodies(briefing(), articles, [item("a")]);
  expect(out.date).toBe("2026-08-12");
  expect(out.generatedAt).toBe(1_000);
  expect(out.bodies.a).toEqual({ text: "the text", html: "<p>hi</p>", summaryOnly: false });
});

// The inlined images are the weight (a base64 body outweighs its article by two
// orders of magnitude); a remote image is a URL. Keeping the remote ones is what
// makes a phone and a desktop show the same article, and what a reader keeps
// from either device the same snapshot.
test("a published body drops the inlined images and keeps the remote ones", () => {
  const articles: Record<string, CachedArticle> = {
    a: {
      textContent: "the text",
      contentHtml:
        '<p>one</p><img src="data:image/png;base64,AAAA"><p>two</p>' +
        '<img src="https://cdn.example.test/a.jpg" loading="lazy"><p>three</p>',
    },
  };
  const out = buildPublishedBodies(briefing(), articles, [item("a")]);
  expect(out.bodies.a.html).toBe(
    '<p>one</p><p>two</p><img src="https://cdn.example.test/a.jpg" loading="lazy"><p>three</p>',
  );
});

// A source with no full text at all still gets an entry: the reader has to be
// able to say "this source only publishes summaries", and that has to read
// differently from "the text has not arrived yet".
test("a tiered item with no body still gets an entry", () => {
  const out = buildPublishedBodies(briefing(), {}, [item("b", { summaryOnly: true })]);
  expect(out.bodies.b).toEqual({ text: "", html: "", summaryOnly: true });
});

// Unknown provenance is evidence-incomplete, so nothing downstream quotes a
// summary as if it were the article.
test("an item the snapshot lost counts as summary-only", () => {
  const out = buildPublishedBodies(briefing(), { c: { textContent: "text" } }, []);
  expect(out.bodies.c.summaryOnly).toBe(true);
});

test("the filtered list carries no bodies", () => {
  const out = buildPublishedBodies(briefing(), { d: { textContent: "text" } }, [item("d")]);
  expect(out.bodies.d).toBeUndefined();
});

// The two files reconcile independently, so a reader can hold a new briefing
// beside the previous bodies for one sync interval. That is what the pairing is
// for; anything but an exact match means the text is still on its way.
test("a pair is only a pair when both halves agree", () => {
  const b = briefing();
  expect(bodiesMatch(b, { date: "2026-08-12", generatedAt: 1_000 })).toBe(true);
  expect(bodiesMatch(b, { date: "2026-08-12", generatedAt: 999 })).toBe(false);
  expect(bodiesMatch(b, { date: "2026-08-11", generatedAt: 1_000 })).toBe(false);
  expect(bodiesMatch(b, null)).toBe(false);
  expect(bodiesMatch(null, { date: "2026-08-12", generatedAt: 1_000 })).toBe(false);
});
