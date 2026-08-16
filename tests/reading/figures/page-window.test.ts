// The visual window around a highlight (src/reading/figures/page-window.ts):
// which pages it covers, when it is worth sending at all, what it says to the
// model, and what it leaves behind once the turn is over. Run: bun test.

import { expect, test } from "bun:test";
import type { Fulltext } from "../../../src/fulltext/types";
import type { Figure } from "../../../src/reading/figures/types";
import {
  ANCHOR_PAGE_WIDTH_PX,
  NEIGHBOUR_PAGE_WIDTH_PX,
  SPARSE_PAGE_CHARS,
  attachPageWindow,
  pageImageTokens,
  pageRangeLabel,
  pageWindowGate,
  pageWindowMarker,
  pageWindowPages,
  pageWindowPrompt,
  planPageWindow,
  type WindowMessage,
} from "../../../src/reading/figures/page-window";

function figure(page: number): Figure {
  return { id: "3", page, caption: "Figure 3: a schematic", bbox: null };
}

// A document whose pages are ordinary typeset prose: plenty of text, no figures.
function prose(pages = 6, status: "ok" | "no-text-layer" = "ok"): Fulltext {
  return {
    version: 1,
    status,
    pages: Array.from({ length: pages }, (_, i) => `page ${i + 1}. `.repeat(120)),
    outline: [],
  };
}

const image = (n: number) => ({ data: `img-${n}`, mediaType: "image/jpeg" });

test("the window is the marked page and one page either side", () => {
  expect(pageWindowPages(5, 20)).toEqual([
    { page: 4, widthPx: NEIGHBOUR_PAGE_WIDTH_PX, anchor: false },
    { page: 5, widthPx: ANCHOR_PAGE_WIDTH_PX, anchor: true },
    { page: 6, widthPx: NEIGHBOUR_PAGE_WIDTH_PX, anchor: false },
  ]);
});

test("the window is clamped to the document at both ends", () => {
  expect(pageWindowPages(1, 3).map((p) => p.page)).toEqual([1, 2]);
  expect(pageWindowPages(3, 3).map((p) => p.page)).toEqual([2, 3]);
  expect(pageWindowPages(1, 1).map((p) => p.page)).toEqual([1]);
  // Past the end of a known document there is no window at all.
  expect(pageWindowPages(9, 3)).toEqual([]);
});

// The extract can still be running when the reader marks something. The lower
// clamp is all there is to go on then, and a render off the end fails on its own.
test("an unknown page count clamps only at the bottom", () => {
  expect(pageWindowPages(1, null).map((p) => p.page)).toEqual([1, 2]);
});

test("the anchor page is rendered larger than its neighbours", () => {
  expect(ANCHOR_PAGE_WIDTH_PX).toBeGreaterThan(NEIGHBOUR_PAGE_WIDTH_PX);
  // A letter page at these widths: ~1.7k tokens for the anchor, ~0.7k each side.
  expect(pageImageTokens(1000, 1294)).toBeLessThan(2000);
  expect(pageImageTokens(640, 828)).toBeLessThan(800);
});

test("a window of plain prose sends nothing", () => {
  expect(pageWindowGate([4, 5, 6], [], prose())).toBeNull();
});

test("one figure anywhere in the window opens the gate", () => {
  expect(pageWindowGate([4, 5, 6], [figure(6)], prose())).toBe("figures");
  expect(pageWindowGate([4, 5, 6], [figure(7)], prose())).toBeNull();
});

// The arm scanned documents come in on. Figure detection is caption-anchored, so
// a page image with no text layer under it produces no figures to gate on; the
// absent text is the signal instead.
test("a page with no extractable text opens the gate", () => {
  const scanned = prose(6, "no-text-layer");
  expect(pageWindowGate([1, 2], [], scanned)).toBe("sparse-text");

  const mixed = prose();
  mixed.pages[5] = "Plate IV";
  expect(pageWindowGate([4, 5, 6], [], mixed)).toBe("sparse-text");
  expect(mixed.pages[5].length).toBeLessThan(SPARSE_PAGE_CHARS);
});

test("with no extract yet, only the figure index can open the gate", () => {
  expect(pageWindowGate([4, 5, 6], [], null)).toBeNull();
  expect(pageWindowGate([4, 5, 6], [figure(5)], null)).toBe("figures");
});

test("a text-only model is never planned a window", () => {
  const plan = planPageWindow({
    anchor: 5,
    pageCount: 20,
    figures: [figure(5)],
    fulltext: prose(20),
    modelSupportsImages: false,
  });
  expect(plan).toBeNull();
});

test("a turn with no position is never planned a window", () => {
  const plan = planPageWindow({
    anchor: null,
    pageCount: 20,
    figures: [figure(5)],
    fulltext: prose(20),
    modelSupportsImages: true,
  });
  expect(plan).toBeNull();
});

test("the plan carries the pages, their widths and why it fired", () => {
  const plan = planPageWindow({
    anchor: 5,
    pageCount: 20,
    figures: [figure(4)],
    fulltext: prose(20),
    modelSupportsImages: true,
  });
  expect(plan).not.toBeNull();
  expect(plan!.anchor).toBe(5);
  expect(plan!.gate).toBe("figures");
  expect(plan!.pages.map((p) => p.page)).toEqual([4, 5, 6]);
});

test("the prompt names the anchor page and says the mark is not a crop", () => {
  const plan = planPageWindow({
    anchor: 5,
    pageCount: 20,
    figures: [figure(5)],
    fulltext: prose(20),
    modelSupportsImages: true,
  })!;
  const prompt = pageWindowPrompt(plan);
  expect(prompt).toContain("p.5, the page their highlight is on");
  expect(prompt).toContain("p.4");
  expect(prompt).toContain("p.6");
  expect(prompt).toContain("not a region to look at");
});

test("the page range reads as one page or as a run", () => {
  expect(pageRangeLabel(pageWindowPages(5, 20))).toBe("pp.4–6");
  expect(pageRangeLabel(pageWindowPages(1, 1))).toBe("p.1");
});

// The hard requirement: one window in context, whatever the length of the
// conversation. Earlier turns keep the fact and lose the pixels.
test("the images ride the current message and history keeps a line instead", () => {
  const plan = planPageWindow({
    anchor: 5,
    pageCount: 20,
    figures: [figure(5)],
    fulltext: prose(20),
    modelSupportsImages: true,
  })!;
  const thread: WindowMessage[] = [
    { role: "user", text: "explain this" },
    { role: "ai", text: "it is a residual block" },
    { role: "user", text: "and the arrow?" },
  ];
  const out = attachPageWindow(
    thread,
    plan,
    [image(1), image(2), image(3)],
  );
  expect(out[0].images).toBeUndefined();
  expect(out[0].text).toBe("explain this\n\n[page images of pp.4–6 were attached here]");
  expect(out[1].text).toBe("it is a residual block");
  expect(out[1].images).toBeUndefined();
  expect(out[2].text).toBe("and the arrow?");
  expect(out[2].images).toHaveLength(3);
  expect(pageWindowMarker(plan)).toBe("[page images of pp.4–6 were attached here]");
});

test("images the reader attached themselves are kept alongside the window", () => {
  const plan = planPageWindow({
    anchor: 2,
    pageCount: 20,
    figures: [figure(2)],
    fulltext: prose(20),
    modelSupportsImages: true,
  })!;
  const out = attachPageWindow(
    [{ role: "user", text: "like this?", images: [image(0)] }] as WindowMessage[],
    plan,
    [image(1)],
  );
  expect(out[0].images).toEqual([image(0), image(1)]);
});

test("nothing rendered means nothing is said about it", () => {
  const plan = planPageWindow({
    anchor: 2,
    pageCount: 20,
    figures: [figure(2)],
    fulltext: prose(20),
    modelSupportsImages: true,
  })!;
  const msgs: WindowMessage[] = [{ role: "user", text: "explain this" }];
  expect(attachPageWindow(msgs, plan, [])).toEqual(msgs);
});
