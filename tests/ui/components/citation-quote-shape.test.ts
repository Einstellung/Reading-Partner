// The rule that decides whether a paragraph is one pulled quote from the book
// (src/ui/components/markdown/citationBlock.ts), over hand-built hast nodes.
// The nodes here are the shapes react-markdown produces for the paragraphs that
// matter — a lone link, a link inside a sentence, two links — written out
// directly so the rule is tested as the plain function it is; that the real
// parse produces these shapes is what the rendering test alongside this one
// covers.
//
// Run: bun test.

import { expect, test } from "bun:test";
import { pageCitationHref, paperCitationHref, figureCitationHref } from "../../../src/reading/prep/anchors";
import { quotedCitationParagraph, type HastNode } from "../../../src/ui/components/markdown/citationBlock";

const QUOTE = "attention is the scarce resource";

function text(value: string): HastNode {
  return { type: "text", value };
}

function link(href: string, label: string): HastNode {
  return { type: "element", tagName: "a", properties: { href }, children: [text(label)] };
}

function paragraph(...children: HastNode[]): HastNode {
  return { type: "element", tagName: "p", properties: {}, children };
}

test("a paragraph holding only a quoted page citation is a quote block", () => {
  const found = quotedCitationParagraph(paragraph(link(pageCitationHref(72, QUOTE), "p.72")));
  expect(found).toEqual({ citation: { kind: "page", page: 72, quote: QUOTE }, quote: QUOTE, label: "p.72" });
});

// Markdown leaves a trailing newline inside the paragraph when the link ends the
// line, and that text node is not content anyone can see.
test("whitespace around the citation does not disqualify it", () => {
  const found = quotedCitationParagraph(
    paragraph(text("\n"), link(pageCitationHref(72, QUOTE), "p.72"), text("  \n")),
  );
  expect(found?.quote).toBe(QUOTE);
});

test("the source marker is the anchor's own label, ranges and all", () => {
  const found = quotedCitationParagraph(paragraph(link(pageCitationHref(72, QUOTE), "p.72-73")));
  expect(found?.label).toBe("p.72-73");
  // The link still points at the first page — the label is text, not a second
  // opinion about where the jump goes.
  expect(found?.citation).toEqual({ kind: "page", page: 72, quote: QUOTE });
});

test("a paper citation carrying a quote is a quote block too", () => {
  const found = quotedCitationParagraph(paragraph(link(paperCitationHref("smith-2024", 3, QUOTE), "smith-2024 p.3")));
  expect(found?.citation).toEqual({ kind: "paper", slug: "smith-2024", page: 3, quote: QUOTE });
});

test("a citation inside a sentence stays inline", () => {
  const found = quotedCitationParagraph(
    paragraph(text("As the book says "), link(pageCitationHref(72, QUOTE), "p.72"), text(", which is the point.")),
  );
  expect(found).toBeNull();
});

test("two quoted citations in one paragraph are not a block", () => {
  const found = quotedCitationParagraph(
    paragraph(link(pageCitationHref(72, QUOTE), "p.72"), text(" "), link(pageCitationHref(80, "and so on"), "p.80")),
  );
  expect(found).toBeNull();
});

test("a citation with no quote has nothing to print, so it stays a chip", () => {
  expect(quotedCitationParagraph(paragraph(link(pageCitationHref(72), "p.72")))).toBeNull();
});

// [fig:N] has its own card, which the paragraph rule must not intercept.
test("a figure citation is not a quote block", () => {
  expect(quotedCitationParagraph(paragraph(link(figureCitationHref("3-1"), "fig:3-1")))).toBeNull();
});

test("a lone ordinary link is not a quote block", () => {
  expect(quotedCitationParagraph(paragraph(link("https://example.com", "docs")))).toBeNull();
});

test("anything that is not a paragraph node is not a quote block", () => {
  expect(quotedCitationParagraph(undefined)).toBeNull();
  expect(quotedCitationParagraph(null)).toBeNull();
  expect(quotedCitationParagraph({})).toBeNull();
});
