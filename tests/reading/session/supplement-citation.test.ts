import { expect, test } from "bun:test";
import {
  citationKey,
  supplementForSlug,
  supplementTitles,
} from "../../../src/reading/session/supplement-citation";
import { linkifyCitations, parseAnchor, parseCitationHref } from "../../../src/reading/prep/anchors";

const REFS = [
  { hash: "h1", title: "Scaling Laws for Neural Language Models", addedAt: 1 },
  { hash: "h2", title: "注意力的代价", sourceUrl: "https://example.com/a", addedAt: 2 },
];

test("a title is matched case-folded and whitespace-collapsed", () => {
  expect(citationKey("  Scaling   Laws\nfor Neural Language Models ")).toBe(
    "scaling laws for neural language models",
  );
  expect(supplementForSlug("scaling laws for neural language models", REFS)?.hash).toBe("h1");
  expect(supplementForSlug("Scaling Laws  for Neural Language Models", REFS)?.hash).toBe("h1");
  expect(supplementForSlug("something else", REFS)).toBe(null);
});

test("a multi-word title cites, and comes back off the href whole", () => {
  const titles = supplementTitles(REFS);
  const out = linkifyCitations("As in [Scaling Laws for Neural Language Models p.4].", { titles });
  expect(out).toContain("](#rp-paper-");
  const href = /\((#rp-paper-[^)]+)\)/.exec(out)?.[1] ?? "";
  const cite = parseCitationHref(href);
  expect(cite).toEqual({
    kind: "paper",
    slug: "scaling laws for neural language models",
    page: 4,
  });
  expect(supplementForSlug((cite as { slug: string }).slug, REFS)?.hash).toBe("h1");
});

test("a bracket that names no supplement is left as prose", () => {
  const titles = supplementTitles(REFS);
  expect(linkifyCitations("[see p.9 above]", { titles })).toBe("[see p.9 above]");
  expect(linkifyCitations("[Some Other Paper p.2]", { titles })).toBe("[Some Other Paper p.2]");
});

test("with no titles known, a multi-word head is never a citation", () => {
  expect(parseAnchor("Scaling Laws for Neural Language Models p.4")).toBe(null);
  expect(parseAnchor("Scaling Laws for Neural Language Models p.4", { titles: new Set() })).toBe(null);
});

test("a title carrying a quote keeps the quote as payload", () => {
  const titles = supplementTitles(REFS);
  const a = parseAnchor('注意力的代价 p.3 "一句话"', { titles });
  expect(a).toMatchObject({ kind: "paper", slug: "注意力的代价", page: 3, quote: "一句话" });
});

test("the prep list and the titles are two lists, and either can carry a citation", () => {
  const known = { slugs: new Set(["some-paper"]), titles: supplementTitles(REFS) };
  expect(parseAnchor("some-paper p.2", known)).toMatchObject({ kind: "paper", slug: "some-paper" });
  expect(parseAnchor("注意力的代价 p.2", known)).toMatchObject({ kind: "paper", slug: "注意力的代价" });
  expect(parseAnchor("nobody p.2", known)).toBe(null);
});
