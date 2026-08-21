// A quoted citation in an AI reply, rendered through the real markdown
// pipeline (src/ui/components/markdown/MarkdownRenderer.tsx). What the shape
// test alongside this one cannot say is whether the parse actually produces the
// nodes that rule reads, and whether the block that comes out of it is one
// button that hands the host the same citation the chip would have — including
// the quote, which is what makes the reader's jump land on the right words.
//
// Under a real DOM rather than renderToStaticMarkup: pressing the block is half
// of what is being tested.
//
// Run: bun test.

import { afterEach, expect, test } from "bun:test";
import { createElement, type ReactNode } from "react";
import type { Citation } from "../../../src/reading/prep/anchors";
import MarkdownRenderer from "../../../src/ui/components/markdown/MarkdownRenderer";
import {
  CitationContext,
  QuoteCheckContext,
  type QuoteCheck,
} from "../../../src/ui/components/markdown/Markdown";
import { useDom } from "../../support/dom";

const { cleanup, fireEvent, render } = await useDom();
afterEach(cleanup);

const QUOTE = "attention is the scarce resource";

function show(text: string, opts: { onCitation?: (c: Citation) => void; verifyQuote?: QuoteCheck } = {}) {
  const tree: ReactNode = createElement(
    CitationContext.Provider,
    { value: opts.onCitation ?? (() => {}) },
    createElement(
      QuoteCheckContext.Provider,
      { value: opts.verifyQuote ?? null },
      createElement(MarkdownRenderer, { text }),
    ),
  );
  const { container } = render(tree);
  return {
    container,
    block: container.querySelector("button"),
    chips: [...container.querySelectorAll<HTMLAnchorElement>('a[href^="#rp-"]')],
    text: container.textContent ?? "",
  };
}

test("a quoted citation on its own paragraph prints the book's words", () => {
  const { block, chips, text } = show(`Here is the claim.\n\n[p.72 "${QUOTE}"]\n\nAnd here is what it means.`);
  expect(block).not.toBeNull();
  expect(block?.textContent).toContain(QUOTE);
  // The page it came from stays readable under the quote — the reader has to
  // know which page they are being shown.
  expect(block?.textContent).toContain("p.72");
  // The quote is the block's text now, not a chip's hidden payload.
  expect(chips).toHaveLength(0);
  expect(text).toContain("And here is what it means.");
});

test("pressing the block jumps with the same citation the chip would have sent", () => {
  const seen: Citation[] = [];
  const { block } = show(`[p.72 "${QUOTE}"]`, { onCitation: (c) => seen.push(c) });
  fireEvent.click(block!);
  expect(seen).toEqual([{ kind: "page", page: 72, quote: QUOTE }]);
});

test("the same citation inside a sentence stays an inline chip", () => {
  const { block, chips, text } = show(`As the book says [p.72 "${QUOTE}"], attention is what runs out.`);
  expect(block).toBeNull();
  expect(chips).toHaveLength(1);
  expect(chips[0].textContent).toBe("p.72");
  expect(text).not.toContain(QUOTE);
});

test("a citation with no quote is the chip it has always been", () => {
  const { block, chips, text } = show("[p.72]");
  expect(block).toBeNull();
  expect(chips.map((a) => a.getAttribute("href"))).toEqual(["#rp-page-72"]);
  expect(text.trim()).toBe("p.72");
});

test("two quoted citations in one paragraph both stay chips", () => {
  const { block, chips, text } = show(`[p.72 "${QUOTE}"] [p.80 "and the rest follows"]`);
  expect(block).toBeNull();
  expect(chips).toHaveLength(2);
  expect(text).not.toContain(QUOTE);
});

// The whole point of the check: words the book does not contain must not be
// printed as the book's. The page number is still true, so the chip survives.
test("a quote that is not on its page falls back to the chip", () => {
  const { block, chips, text } = show(`[p.72 "${QUOTE}"]`, { verifyQuote: () => false });
  expect(block).toBeNull();
  expect(chips).toHaveLength(1);
  expect(text).not.toContain(QUOTE);
});

test("a quote the check confirms is printed", () => {
  const asked: Array<[number, string]> = [];
  const { block } = show(`[p.72 "${QUOTE}"]`, {
    verifyQuote: (page, quote) => {
      asked.push([page, quote]);
      return true;
    },
  });
  expect(asked).toEqual([[72, QUOTE]]);
  expect(block?.textContent).toContain(QUOTE);
});

// No book text on this surface to check against (a note panel, or the moment
// before extraction finishes). Withholding a real quote there costs more than
// showing one that later turns out to be off.
test("with no checker at all the quote is shown", () => {
  const { block } = show(`[p.72 "${QUOTE}"]`);
  expect(block?.textContent).toContain(QUOTE);
});

// A prepped paper's text is not on this side, so there is nothing for the check
// to be right about; it is not consulted.
test("a paper citation's quote is shown whatever the page check says", () => {
  const seen: Citation[] = [];
  const { block } = show(`[smith-2024 p.3 "${QUOTE}"]`, {
    onCitation: (c) => seen.push(c),
    verifyQuote: () => false,
  });
  expect(block?.textContent).toContain(QUOTE);
  fireEvent.click(block!);
  expect(seen).toEqual([{ kind: "paper", slug: "smith-2024", page: 3, quote: QUOTE }]);
});

// Mid-stream the closing quotation mark has not arrived, the bracket is not a
// citation the grammar understands, and the chip is what shows. It becoming a
// block once the quote closes is the accepted jump; a block appearing and then
// vanishing is not, which is why the unfinished state must not draw one.
test("an unfinished quote does not draw a block", () => {
  const { block } = show('[p.72 "attention is the sc');
  expect(block).toBeNull();
});

// Ordinary prose must not have gained a wrapper.
test("a paragraph without citations is still a paragraph", () => {
  const { container } = show("The reply is mostly ordinary prose.");
  expect(container.querySelectorAll("p")).toHaveLength(1);
  expect(container.querySelector("button")).toBeNull();
});
