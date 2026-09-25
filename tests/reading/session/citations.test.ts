// A citation chip on the shell's side (src/reading/session/citations.ts): where
// a click goes, what it logs, which names a reply may cite, and whether a quote
// is on its page. Run: bun test.

import { expect, test } from "bun:test";
import {
  citationLogDetail,
  citationSources,
  createQuoteCheck,
  quoteSearchText,
  routeCitation,
  type CitationTargets,
} from "../../../src/reading/session/citations";

const supplement = { title: "Some Article", hash: "sup-hash", addedAt: 1 };
const targets: CitationTargets = {
  figures: [{ id: "Fig. 3", page: 7 }],
  supplements: [supplement],
  papers: [{ slug: "attention" }],
};

test("a page citation jumps to its page, zero-based, with its quote", () => {
  expect(routeCitation({ kind: "page", page: 5, quote: "the words" }, targets)).toEqual({
    kind: "page",
    pageIndex: 4,
    quote: "the words",
  });
  expect(routeCitation({ kind: "page", page: 1 }, targets)).toEqual({ kind: "page", pageIndex: 0, quote: undefined });
});

test("a figure citation jumps to the figure's page, or warns when there is no such figure", () => {
  expect(routeCitation({ kind: "figure", id: "Fig. 3" }, targets)).toEqual({ kind: "page", pageIndex: 6 });
  expect(routeCitation({ kind: "figure", id: "Fig. 9" }, targets)).toEqual({
    kind: "warn",
    message: "No figure Fig. 9 in this document.",
  });
  expect(routeCitation({ kind: "figure", id: "Fig. 3" }, { ...targets, figures: [] }).kind).toBe("warn");
});

test("a citation naming a supplement's title opens that supplement at the page", () => {
  const route = routeCitation({ kind: "paper", slug: "some  ARTICLE", page: 4, quote: "q" }, targets);
  expect(route).toEqual({ kind: "supplement", supplement, pageIndex: 3, quote: "q" });
});

test("a supplement wins over the prep list check", () => {
  const route = routeCitation({ kind: "paper", slug: "Some Article", page: 2 }, { ...targets, papers: [] });
  expect(route.kind).toBe("supplement");
});

test("a prepped paper opens in the prep panel", () => {
  expect(routeCitation({ kind: "paper", slug: "attention", page: 3 }, targets)).toEqual({
    kind: "prep",
    slug: "attention",
  });
});

test("an unprepped paper warns once the prep list is loaded, and opens the panel before", () => {
  expect(routeCitation({ kind: "paper", slug: "ghost", page: 3 }, targets)).toEqual({
    kind: "warn",
    message: 'No prepped paper "ghost" — the reply cited one that isn\'t here.',
  });
  expect(routeCitation({ kind: "paper", slug: "ghost", page: 3 }, { ...targets, papers: undefined })).toEqual({
    kind: "prep",
    slug: "ghost",
  });
});

test("the log records the kind and its one identifying field", () => {
  expect(citationLogDetail({ kind: "page", page: 5, quote: "x" })).toEqual({ kind: "page", page: 5 });
  expect(citationLogDetail({ kind: "figure", id: "Fig. 1" })).toEqual({ kind: "figure", id: "Fig. 1" });
  expect(citationLogDetail({ kind: "paper", slug: "attention", page: 2 })).toEqual({ kind: "paper", slug: "attention" });
});

test("citation sources: null slugs until prep loads, an empty set after", () => {
  expect(citationSources(null, "").slugs).toBeNull();
  expect([...(citationSources("", "").slugs as Set<string>)]).toEqual([]);
  expect([...(citationSources("a\nb", "").slugs as Set<string>)]).toEqual(["a", "b"]);
});

test("citation sources: titles are keyed the way a citation is matched", () => {
  const { titles } = citationSources(null, "Some Article\nOther");
  expect(titles?.size).toBe(2);
  expect(titles?.has("some article")).toBe(true);
  expect(citationSources(null, "").titles?.size).toBe(0);
});

test("a quote check finds a quote on its page and not on another", () => {
  const check = createQuoteCheck({ pages: ["The quick brown fox jumps.", "Nothing here."] });
  expect(check(1, "quick brown fox")).toBe(true);
  expect(check(2, "quick brown fox")).toBe(false);
});

test("a quote check passes when there is no text to check against", () => {
  expect(createQuoteCheck(null)(1, "anything")).toBe(true);
  const check = createQuoteCheck({ pages: ["", "text"] });
  expect(check(1, "anything")).toBe(true);
  expect(check(9, "anything")).toBe(true);
});

test("a quote check caches its answer per page and quote", () => {
  const pages = ["alpha beta gamma"];
  const check = createQuoteCheck({ pages });
  expect(check(1, "beta")).toBe(true);
  pages[0] = "something else";
  expect(check(1, "beta")).toBe(true);
  expect(check(1, "else")).toBe(true);
  expect(createQuoteCheck({ pages })(1, "beta")).toBe(false);
});

test("a followed quote is looked for in the page's own words", () => {
  // The model's rendering folds case and line breaks; the highlight has to find
  // what the page prints.
  const ft = { pages: ["Intro.", "The Machine\nthinks well."] };
  expect(quoteSearchText(ft, 1, "the machine thinks")).toBe("The Machine\nthinks");
});

test("a quote that is not on its page is looked for as written", () => {
  const ft = { pages: ["Intro.", "Nothing like it."] };
  expect(quoteSearchText(ft, 1, "the machine thinks")).toBe("the machine thinks");
  expect(quoteSearchText(null, 0, "the machine thinks")).toBe("the machine thinks");
  expect(quoteSearchText(ft, 9, "the machine thinks")).toBe("the machine thinks");
});
