// What the EPUB reading pane decides, without a renderer under it.

import { describe, expect, test } from "bun:test";
import type { ViewState } from "../../../src/platform/app/reader-contract";
import { extractDocumentText } from "../../../src/reading/epub/text";
import { paginate, type Pagination } from "../../../src/reading/epub/paginate";
import { parseEpub } from "../../../src/reading/epub/parse";
import {
  DEFAULT_FONT_STEP,
  FONT_SIZES,
  blockIndexAt,
  canGrow,
  canResetType,
  canShrink,
  cfiForBlock,
  clampFontStep,
  flowFor,
  fontSizeAt,
  indexRuns,
  keyTurn,
  labelForBlock,
  offsetOfPoint,
  openingFontStep,
  quoteQueries,
  restoreTarget,
  statsOf,
  swipeTurn,
  tapZone,
  viewStateOf,
} from "../../../src/reading/epub/reader-logic";
import { buildEpub, prose } from "./fixture";

const paged = (blocks: Pagination["blocks"]): Pagination => ({
  version: 1,
  kind: "epub",
  source: "synthetic",
  blockChars: 1800,
  spineCount: 2,
  blocks,
});

describe("type size", () => {
  test("the steps run in one direction and the default is one of them", () => {
    expect([...FONT_SIZES]).toEqual([...FONT_SIZES].sort((a, b) => a - b));
    expect(FONT_SIZES[DEFAULT_FONT_STEP]).toBeGreaterThan(0);
  });

  test("a step outside the table is pulled back into it", () => {
    expect(clampFontStep(-3)).toBe(0);
    expect(clampFontStep(99)).toBe(FONT_SIZES.length - 1);
    expect(clampFontStep(Number.NaN)).toBe(DEFAULT_FONT_STEP);
    expect(fontSizeAt(99)).toBe(FONT_SIZES[FONT_SIZES.length - 1]);
  });

  test("the buttons go dead at the ends and reset goes dead at the default", () => {
    expect(canShrink(0)).toBe(false);
    expect(canGrow(0)).toBe(true);
    expect(canGrow(FONT_SIZES.length - 1)).toBe(false);
    expect(canResetType(DEFAULT_FONT_STEP)).toBe(false);
    expect(canResetType(DEFAULT_FONT_STEP + 1)).toBe(true);
  });

  test("a saved size comes back as the step that wrote it", () => {
    for (let step = 0; step < FONT_SIZES.length; step++) {
      const state = viewStateOf({ pageIndex: 0, cfi: null, fontStep: step, layout: "vertical" });
      expect(openingFontStep(state)).toBe(step);
    }
  });

  test("a size from another engine opens at the nearest step, not at the default", () => {
    // "auto" is the sentinel a book that was never opened carries.
    expect(openingFontStep({ pageIndex: 0, scale: "auto", scrollMode: 0 })).toBe(DEFAULT_FONT_STEP);
    expect(openingFontStep(null)).toBe(DEFAULT_FONT_STEP);
    const nearest = openingFontStep({ pageIndex: 0, scale: FONT_SIZES[0] + 0.4, scrollMode: 0 });
    expect(nearest).toBe(0);
  });
});

describe("layout", () => {
  test("the two layouts are the renderer's two flows", () => {
    expect(flowFor("vertical")).toBe("scrolled");
    expect(flowFor("paged")).toBe("paginated");
  });
});

describe("where the reader is", () => {
  const pagination = paged([
    { spine: 0, charOffset: 0, cfi: "epubcfi(/6/2[c1]!/4/2/1:0)", label: "1" },
    { spine: 0, charOffset: 900, cfi: "epubcfi(/6/2[c1]!/4/6/1:0)", label: "2" },
    { spine: 1, charOffset: 0, cfi: "epubcfi(/6/4[c2]!/4/2/1:0)", label: null },
  ]);

  test("a block number is the CFI the renderer is sent to", () => {
    expect(cfiForBlock(pagination, 1)).toBe("epubcfi(/6/2[c1]!/4/6/1:0)");
    expect(cfiForBlock(pagination, 99)).toBeNull();
  });

  test("a saved CFI is preferred over the block number beside it", () => {
    const state: ViewState = {
      pageIndex: 0,
      scale: 19,
      scrollMode: 0,
      cfi: "epubcfi(/6/4[c2]!/4/2/1:12)",
    };
    expect(restoreTarget(pagination, state)).toBe("epubcfi(/6/4[c2]!/4/2/1:12)");
  });

  test("a state with no CFI restores by block, and no state opens at the start", () => {
    expect(restoreTarget(pagination, { pageIndex: 2, scale: "auto", scrollMode: 0 })).toBe(
      "epubcfi(/6/4[c2]!/4/2/1:0)",
    );
    expect(restoreTarget(pagination, null)).toBeNull();
  });

  test("a point in a spine document is the block it falls in, 0-based", () => {
    expect(blockIndexAt(pagination, 0, 0)).toBe(0);
    expect(blockIndexAt(pagination, 0, 899)).toBe(0);
    expect(blockIndexAt(pagination, 0, 900)).toBe(1);
    expect(blockIndexAt(pagination, 1, 5)).toBe(2);
  });

  test("the printed page number is shown when the book printed one", () => {
    expect(labelForBlock(pagination, 0)).toBe("1");
    expect(labelForBlock(pagination, 2)).toBeNull();
    // With no printed number the position block's own number is what shows.
    expect(statsOf({ pageIndex: 2, pagination, fontStep: 2, layout: "paged" }).pageLabel).toBe("3");
    expect(statsOf({ pageIndex: 0, pagination, fontStep: 2, layout: "paged" }).pageLabel).toBe("1");
  });

  test("the stats say how many blocks the book has and which layout it is in", () => {
    const stats = statsOf({ pageIndex: 1, pagination, fontStep: 0, layout: "vertical" });
    expect(stats.pagesCount).toBe(3);
    expect(stats.layout).toBe("vertical");
    expect(stats.canZoomOut).toBe(false);
    expect(stats.canZoomIn).toBe(true);
  });

  test("a state without a CFI does not carry an empty one", () => {
    const state = viewStateOf({ pageIndex: 3, cfi: null, fontStep: 1, layout: "paged" });
    expect("cfi" in state).toBe(false);
    expect(state.pageIndex).toBe(3);
    expect(state.layout).toBe("paged");
  });
});

describe("a range in the frame becomes an offset", () => {
  const bytes = buildEpub({
    docs: [{ name: "c1.xhtml", body: `<p id="a">${prose(1, 120)}</p><p id="b">Second one.</p>` }],
  });
  const book = parseEpub(bytes);
  const doc = book.docs[0];
  const runs = indexRuns(doc.text);

  test("a text node's own offset is where its run starts", () => {
    const second = doc.doc.getElementById("b")!;
    const node = second.firstChild!;
    const at = offsetOfPoint(doc.text, runs, node, 0);
    expect(doc.text.text.slice(at, at + 6)).toBe("Second");
    expect(offsetOfPoint(doc.text, runs, node, 7)).toBe(at + 7);
  });

  test("an element container answers with its own start", () => {
    const second = doc.doc.getElementById("b")!;
    expect(offsetOfPoint(doc.text, runs, second, 0)).toBe(doc.text.offsets.get(second)!);
  });

  test("a node the extraction never saw answers with the start of the book", () => {
    const stray = doc.doc.createElement("style");
    expect(offsetOfPoint(doc.text, runs, stray, 0)).toBe(0);
    expect(offsetOfPoint(doc.text, runs, null, 0)).toBe(0);
  });

  test("the round trip lands in the block the pagination cut", () => {
    const big = parseEpub(
      buildEpub({ docs: [{ name: "c1.xhtml", body: prose(30, 400) }] }),
    );
    const pagination = paginate(big);
    const text = big.docs[0].text;
    const index = indexRuns(text);
    for (const [i, block] of pagination.blocks.entries()) {
      const run = text.runs.find((r) => r.start + r.length > block.charOffset) ?? text.runs[0];
      const at = offsetOfPoint(text, index, run.node, block.charOffset - run.start);
      expect(blockIndexAt(pagination, 0, at)).toBe(i);
    }
  });
});

describe("the events the frame cannot hear", () => {
  test("the edges turn the page and the middle does not", () => {
    expect(tapZone("paged", 10, 800)).toBe("prev");
    expect(tapZone("paged", 790, 800)).toBe("next");
    expect(tapZone("paged", 400, 800)).toBe("none");
  });

  test("nothing taps a page turn in continuous scroll", () => {
    expect(tapZone("vertical", 10, 800)).toBe("none");
    expect(tapZone("vertical", 790, 800)).toBe("none");
  });

  test("a right-to-left book turns the other way", () => {
    expect(tapZone("paged", 10, 800, true)).toBe("next");
    expect(tapZone("paged", 790, 800, true)).toBe("prev");
  });

  test("a swipe needs distance and an axis", () => {
    expect(swipeTurn("paged", -120, 4)).toBe("next");
    expect(swipeTurn("paged", 120, 4)).toBe("prev");
    // Too short.
    expect(swipeTurn("paged", -20, 2)).toBe("none");
    // Mostly vertical: that is a scroll, or nothing.
    expect(swipeTurn("paged", -60, 90)).toBe("none");
    // Continuous scroll never swipes: the container scrolls itself.
    expect(swipeTurn("vertical", -200, 0)).toBe("none");
  });

  test("the arrow keys turn in both layouts", () => {
    expect(keyTurn("ArrowRight")).toBe("next");
    expect(keyTurn("ArrowLeft")).toBe("prev");
    expect(keyTurn("PageDown")).toBe("next");
    expect(keyTurn("ArrowRight", true)).toBe("prev");
    expect(keyTurn("a")).toBe("none");
  });
});

describe("finding a cited quote", () => {
  test("the exact quote is tried first, then the collapsed one, then its head", () => {
    expect(quoteQueries("one\n two")).toEqual(["one\n two", "one two"]);
    expect(quoteQueries("plain")).toEqual(["plain"]);
    expect(quoteQueries("   ")).toEqual([]);
  });

  test("a long quote falls back to a leading run of it", () => {
    const long = `${"word ".repeat(30)}end`;
    const queries = quoteQueries(long);
    // Already single-spaced, so there is no collapsed form to try in between.
    expect(queries.length).toBe(2);
    expect(long.startsWith(queries[1])).toBe(true);
    expect(queries[1].length).toBeLessThanOrEqual(40);
  });

  test("a quote too short to shorten is not shortened", () => {
    expect(quoteQueries("a b").length).toBe(1);
  });
});

test("the extraction of a frame document is the extraction of the archive's", () => {
  // The pane reads the live frame with the same walker the ingestion used, and
  // the two have to agree or every position drifts.
  const bytes = buildEpub({ docs: [{ name: "c1.xhtml", body: "<p>One.</p><p>Two.</p>" }] });
  const book = parseEpub(bytes);
  const again = extractDocumentText(book.docs[0].doc);
  expect(again.text).toBe(book.docs[0].text.text);
});
