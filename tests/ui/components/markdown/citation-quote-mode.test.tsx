// Citations on a screen that has no pages: the phone's lesson (docs/74). There
// is nothing to jump to there, so [p.3 "…"] is drawn as the quotation it is —
// the paper's words with the page under them — and a bare [p.3] is the page
// number said quietly. Neither is a control, and before this the whole bracket
// was printed as the model typed it, square brackets and all.
//
// Under a real DOM rather than renderToStaticMarkup: what has to be true here
// is as much about what is *not* in the tree (no anchor, no button) as about
// what is.
//
// Run: bun test.

import { afterEach, expect, test } from "bun:test";
import { createElement, type ReactNode } from "react";
import type { Citation } from "../../../../src/reading/prep/anchors";
import MarkdownRenderer from "../../../../src/ui/components/markdown/MarkdownRenderer";
import {
  CitationContext,
  CitationModeContext,
  QuoteCheckContext,
  type QuoteCheck,
} from "../../../../src/ui/components/markdown/Markdown";
import { useDom } from "../../../support/dom";

const { cleanup, render } = await useDom();
afterEach(cleanup);

const QUOTE = "The input embeddings are the sum of the token and position embeddings";

function show(
  text: string,
  opts: { mode?: boolean; onCitation?: (c: Citation) => void; verifyQuote?: QuoteCheck } = {},
) {
  let tree: ReactNode = createElement(MarkdownRenderer, { text });
  if (opts.verifyQuote) {
    tree = createElement(QuoteCheckContext.Provider, { value: opts.verifyQuote }, tree);
  }
  if (opts.onCitation) {
    tree = createElement(CitationContext.Provider, { value: opts.onCitation }, tree);
  }
  if (opts.mode !== false) {
    tree = createElement(CitationModeContext.Provider, { value: "quote" as const }, tree);
  }
  const { container } = render(tree);
  return {
    container,
    quote: container.querySelector<HTMLElement>("[data-page-quote]"),
    links: [...container.querySelectorAll("a")],
    buttons: [...container.querySelectorAll("button")],
    text: container.textContent ?? "",
  };
}

test("a quoted citation on its own paragraph becomes a quotation block", () => {
  const { quote, links, buttons, text } = show(
    `Here is the claim.\n\n[p.3 "${QUOTE}"]\n\nAnd here is what it means.`,
  );
  expect(quote).not.toBeNull();
  expect(quote?.textContent).toContain(QUOTE);
  // The page stays readable under the words, as a line of its own.
  expect(quote?.textContent).toContain("p.3");
  // Nothing about it is pressable, and nothing is left of the shorthand.
  expect(links).toHaveLength(0);
  expect(buttons).toHaveLength(0);
  expect(text).not.toContain("[p.3");
  expect(text).toContain("And here is what it means.");
});

test("the paper's words are set in the display face", () => {
  const { quote } = show(`[p.3 "${QUOTE}"]`);
  const words = quote?.querySelector("span");
  expect(words?.textContent).toBe(QUOTE);
  expect(words?.className).toContain("font-display");
});

test("a bare page citation is a quiet page number, not a chip", () => {
  const { quote, links, buttons, text } = show("The method is stated on [p.7].");
  expect(quote).toBeNull();
  expect(links).toHaveLength(0);
  expect(buttons).toHaveLength(0);
  expect(text).toContain("The method is stated on p.7.");
  expect(text).not.toContain("[p.7]");
});

test("a quoted citation inside a sentence keeps the sentence whole", () => {
  const { quote, text } = show(`The paper says [p.3 "${QUOTE}"], which is the whole trick.`);
  expect(quote).toBeNull();
  expect(text).toContain("The paper says p.3, which is the whole trick.");
});

test("a figure shorthand is left exactly as the model wrote it", () => {
  const { text, links } = show("Figure 2 on p.5 [fig:2] is the architecture.");
  expect(text).toContain("[fig:2]");
  expect(links).toHaveLength(0);
});

test("without the mode the shorthand is the plain text it has always been", () => {
  const { quote, text } = show(`[p.3 "${QUOTE}"]`, { mode: false });
  expect(quote).toBeNull();
  expect(text).toContain(`[p.3 "${QUOTE}"]`);
});

test("a handler wins over the mode: the block that jumps is drawn instead", () => {
  const { quote, buttons } = show(`[p.3 "${QUOTE}"]`, { onCitation: () => {} });
  expect(quote).toBeNull();
  expect(buttons).toHaveLength(1);
  expect(buttons[0].textContent).toContain(QUOTE);
});

// The same rule the pressable block is under: words that are not on the page
// must not be printed as the paper's. Here the fallback is the page number,
// since there is no chip on this screen either.
test("a quote that is not on its page falls back to the page number", () => {
  const { quote, text } = show(`[p.3 "${QUOTE}"]`, { verifyQuote: () => false });
  expect(quote).toBeNull();
  expect(text).not.toContain(QUOTE);
  expect(text.trim()).toBe("p.3");
});

test("ordinary prose is still a paragraph", () => {
  const { container, quote } = show("The reply is mostly ordinary prose.");
  expect(container.querySelectorAll("p")).toHaveLength(1);
  expect(quote).toBeNull();
});
