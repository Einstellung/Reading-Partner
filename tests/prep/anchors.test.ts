// Unit tests for citation anchors (src/prep/anchors.ts). Run: bun test.

import { expect, test } from "bun:test";
import {
  figureCitationHref,
  linkifyCitations,
  pageCitationHref,
  paperCitationHref,
  parseCitationHref,
} from "../../src/prep/anchors";

test("survey page citations become fragment links", () => {
  expect(linkifyCitations("See [p.12] for details.")).toBe(
    "See [p.12](#rp-page-12) for details.",
  );
  expect(linkifyCitations("[p. 3]")).toBe("[p. 3](#rp-page-3)");
});

test("page ranges link to the first page", () => {
  expect(linkifyCitations("[pp.12-14]")).toBe("[pp.12-14](#rp-page-12)");
});

test("paper citations carry the slug", () => {
  expect(linkifyCitations("Grounding in [rt-1-robotics p.3].")).toBe(
    "Grounding in [rt-1-robotics p.3](#rp-paper-rt-1-robotics--3).",
  );
});

test("existing markdown links are left alone", () => {
  const already = "[p.12](https://example.com)";
  expect(linkifyCitations(already)).toBe(already);
  const paper = "[rt-1 p.3](#rp-paper-rt-1--3)";
  expect(linkifyCitations(paper)).toBe(paper);
});

test("plain brackets that are not citations pass through", () => {
  expect(linkifyCitations("array[0] and [12] and [see p.9 above]")).toBe(
    "array[0] and [12] and [see p.9 above]",
  );
});

test("figure citations become fragment links (M9)", () => {
  expect(linkifyCitations("See [fig:3] for the pipeline.")).toBe(
    "See [fig:3](#rp-fig-3) for the pipeline.",
  );
  expect(linkifyCitations("[fig:3a]")).toBe("[fig:3a](#rp-fig-3a)");
  expect(linkifyCitations("[FIG:2]")).toBe("[fig:2](#rp-fig-2)"); // case-normalized
});

test("an already-linked figure citation is left alone", () => {
  const already = "[fig:3](#rp-fig-3)";
  expect(linkifyCitations(already)).toBe(already);
});

test("hrefs round-trip through parseCitationHref", () => {
  expect(parseCitationHref(pageCitationHref(12))).toEqual({ kind: "page", page: 12 });
  expect(parseCitationHref(paperCitationHref("rt-1-robotics", 3))).toEqual({
    kind: "paper",
    slug: "rt-1-robotics",
    page: 3,
  });
  expect(parseCitationHref(figureCitationHref("3a"))).toEqual({ kind: "figure", id: "3a" });
});

test("a quoted page citation carries the quote as payload, not display text", () => {
  expect(linkifyCitations('See [p.13 "gradient descent converges"] here.')).toBe(
    "See [p.13](#rp-page-13--q=gradient%20descent%20converges) here.",
  );
  // The chip label stays the bare page; the quote lives only in the href.
  expect(linkifyCitations('[pp.4-6 "the key lemma"]')).toBe(
    "[pp.4-6](#rp-page-4--q=the%20key%20lemma)",
  );
});

test("a quoted paper citation carries slug, page and quote", () => {
  expect(linkifyCitations('per [rt-1 p.3 "action tokens"].')).toBe(
    "per [rt-1 p.3](#rp-paper-rt-1--3--q=action%20tokens).",
  );
});

test("page/paper quotes round-trip through parse", () => {
  const q = 'she said "hi" & left';
  expect(parseCitationHref(pageCitationHref(9, q))).toEqual({ kind: "page", page: 9, quote: q });
  expect(parseCitationHref(paperCitationHref("a-b", 2, q))).toEqual({
    kind: "paper",
    slug: "a-b",
    page: 2,
    quote: q,
  });
  // No quote → no quote field.
  expect(parseCitationHref(pageCitationHref(9))).toEqual({ kind: "page", page: 9 });
});

test("escaped quotes inside a citation are unescaped into the payload", () => {
  // The model may escape an inner double-quote: [p.5 "say \"hi\""].
  const href = linkifyCitations('[p.5 "say \\"hi\\""]');
  expect(href).toBe(`[p.5](${pageCitationHref(5, 'say "hi"')})`);
  expect(parseCitationHref(pageCitationHref(5, 'say "hi"'))).toEqual({
    kind: "page",
    page: 5,
    quote: 'say "hi"',
  });
});

test("a plain (unquoted) citation is unchanged by the quote extension", () => {
  expect(linkifyCitations("See [p.12] for details.")).toBe("See [p.12](#rp-page-12) for details.");
});

test("parseCitationHref rejects foreign or malformed hrefs", () => {
  expect(parseCitationHref(undefined)).toBeNull();
  expect(parseCitationHref("https://example.com")).toBeNull();
  expect(parseCitationHref("#rp-page-abc")).toBeNull();
  expect(parseCitationHref("#rp-paper-noseparator")).toBeNull();
  expect(parseCitationHref("#rp-fig-")).toBeNull();
  expect(parseCitationHref("#rp-fig-xyz")).toBeNull();
});
