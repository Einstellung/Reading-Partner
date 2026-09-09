// What the EPUB reading pane decides, without a desk under it.

import { describe, expect, test } from "bun:test";
import type { ViewState } from "../../../src/platform/app/reader-contract";
import { extractDocumentText } from "../../../src/reading/epub/text";
import { characterRuler, paginate, type Pagination } from "../../../src/reading/epub/paginate";
import { PAGE_GEOMETRY } from "../../../src/reading/epub/page-geometry";
import { parseEpub } from "../../../src/reading/epub/parse";
import {
  blockIndexAt,
  cfiForBlock,
  findQuoteAt,
  indexRuns,
  keyTurn,
  labelForBlock,
  offsetOfPoint,
  pageIndexOfCfi,
  bookLinkTarget,
  quoteQueries,
  restoreTarget,
  statsOf,
  claimsTouch,
  swipeTurn,
  tapZone,
  viewStateOf,
} from "../../../src/reading/epub/reader-logic";
import { buildEpub, prose } from "./fixture";

const ruler = characterRuler(700);

const paged = (blocks: Array<Omit<Pagination["blocks"][number], "endOffset">>): Pagination => ({
  version: 2,
  kind: "epub",
  source: "layout",
  geometry: { ...PAGE_GEOMETRY },
  spineCount: 2,
  blocks: blocks.map((b, i) => ({
    ...b,
    endOffset: blocks[i + 1]?.spine === b.spine ? blocks[i + 1].charOffset : b.charOffset + 900,
  })),
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

  test("a CFI names the page it falls in", () => {
    expect(pageIndexOfCfi(pagination, "epubcfi(/6/2[c1]!/4/2/1:0)")).toBe(0);
    expect(pageIndexOfCfi(pagination, "epubcfi(/6/2[c1]!/4/4/1:3)")).toBe(0);
    expect(pageIndexOfCfi(pagination, "epubcfi(/6/2[c1]!/4/6/1:0)")).toBe(1);
    expect(pageIndexOfCfi(pagination, "epubcfi(/6/2[c1]!/4/8/3:9)")).toBe(1);
    expect(pageIndexOfCfi(pagination, "epubcfi(/6/4[c2]!/4/2,/1:0,/1:5)")).toBe(2);
    expect(pageIndexOfCfi(pagination, "epubcfi(/6/8[c4]!/4/2/1:0)")).toBeNull();
    expect(pageIndexOfCfi(pagination, "nope")).toBeNull();
  });

  test("a saved CFI is preferred over the page number beside it", () => {
    const state: ViewState = {
      pageIndex: 0,
      scale: 1.2,
      scrollMode: 0,
      pageY: 300,
      cfi: "epubcfi(/6/4[c2]!/4/2/1:12)",
    };
    // The CFI names another page than the number: the offset was for that
    // page, so the new one opens at its top.
    expect(restoreTarget(pagination, state)).toEqual({ pageIndex: 2, pageX: 0, pageY: 0 });
    expect(restoreTarget(pagination, { ...state, pageIndex: 2 })).toEqual({ pageIndex: 2, pageX: 0, pageY: 300 });
  });

  test("a state with no CFI restores by page, and no state opens at the start", () => {
    expect(restoreTarget(pagination, { pageIndex: 2, scale: "auto", scrollMode: 0, pageY: 40 })).toEqual({
      pageIndex: 2,
      pageX: 0,
      pageY: 40,
    });
    expect(restoreTarget(pagination, { pageIndex: 99, scale: "auto", scrollMode: 0 }).pageIndex).toBe(2);
    expect(restoreTarget(pagination, null)).toEqual({ pageIndex: 0, pageX: 0, pageY: 0 });
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
    const zoom = { kind: "lock" as const, lock: "fit-page" as const };
    expect(statsOf({ pageIndex: 2, pagination, layout: "paged", zoom, scale: 1 }).pageLabel).toBe("3");
    expect(statsOf({ pageIndex: 0, pagination, layout: "paged", zoom, scale: 1 }).pageLabel).toBe("1");
  });

  test("the stats say how many blocks the book has and which layout it is in", () => {
    const lock = { kind: "lock" as const, lock: "fit-width" as const };
    const stats = statsOf({ pageIndex: 1, pagination, layout: "vertical", zoom: lock, scale: 0.5 });
    expect(stats.pagesCount).toBe(3);
    expect(stats.layout).toBe("vertical");
    expect(stats.canZoomOut).toBe(false);
    expect(stats.canZoomIn).toBe(true);
    expect(stats.canZoomReset).toBe(false);
    const pinched = statsOf({ pageIndex: 1, pagination, layout: "vertical", zoom: { kind: "scale", scale: 3 }, scale: 3 });
    expect(pinched.canZoomIn).toBe(false);
    expect(pinched.canZoomReset).toBe(true);
    // The paged flip's lock is fit-page; a fit-width lock there is a reset away.
    expect(statsOf({ pageIndex: 1, pagination, layout: "paged", zoom: lock, scale: 1 }).canZoomReset).toBe(true);
  });

  test("a state without a CFI does not carry an empty one", () => {
    const state = viewStateOf({ pageIndex: 3, cfi: null, scale: 1.25, layout: "paged" });
    expect("cfi" in state).toBe(false);
    expect(state.pageIndex).toBe(3);
    expect(state.layout).toBe("paged");
    expect(state.scale).toBe(1.25);
    expect("pageY" in state).toBe(false);
    const column = viewStateOf({ pageIndex: 3, cfi: "x", scale: 1, layout: "vertical", pageX: 0, pageY: 120 });
    expect(column.pageY).toBe(120);
    expect(column.cfi).toBe("x");
  });
});

describe("a range in the card becomes an offset", () => {
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

  test("the round trip lands in the page the pagination cut", async () => {
    const big = parseEpub(
      buildEpub({ docs: [{ name: "c1.xhtml", body: prose(30, 400) }] }),
    );
    const pagination = await paginate(big, ruler);
    const text = big.docs[0].text;
    const index = indexRuns(text);
    for (const [i, block] of pagination.blocks.entries()) {
      const run = text.runs.find((r) => r.start + r.length > block.charOffset) ?? text.runs[0];
      const at = offsetOfPoint(text, index, run.node, block.charOffset - run.start);
      expect(blockIndexAt(pagination, 0, at)).toBe(i);
    }
  });
});

describe("finding a cited quote in the text", () => {
  const text = "One two three.\nFour five six seven.\nEight nine ten.";
  test("the quote is found from the cited page first, then anywhere", () => {
    expect(findQuoteAt(text, "five six", 0)).toEqual({ start: 20, end: 28 });
    expect(findQuoteAt(text, "five six", 30)).toEqual({ start: 20, end: 28 });
    expect(findQuoteAt(text, "Four five\n six", 0)?.start).toBe(15);
    expect(findQuoteAt(text, "nothing like it", 0)).toBeNull();
  });
});

describe("the events on the desk", () => {
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

describe("the book's own links", () => {
  test("a path in the archive is followed inside the book", () => {
    expect(bookLinkTarget("chapter3.xhtml")).toEqual({ kind: "internal", href: "chapter3.xhtml" });
    expect(bookLinkTarget("../text/notes.xhtml#fn12")).toEqual({
      kind: "internal",
      href: "../text/notes.xhtml#fn12",
    });
  });

  test("a bare fragment stays in this document", () => {
    expect(bookLinkTarget("#fn12")).toEqual({ kind: "internal", href: "#fn12" });
  });

  test("the web goes to the system browser", () => {
    expect(bookLinkTarget("https://example.org/a")).toEqual({
      kind: "external",
      url: "https://example.org/a",
    });
    expect(bookLinkTarget("HTTP://example.org")).toEqual({
      kind: "external",
      url: "HTTP://example.org",
    });
  });

  test("nothing else is followed", () => {
    expect(bookLinkTarget("javascript:alert(1)")).toBeNull();
    expect(bookLinkTarget("data:text/html,x")).toBeNull();
    expect(bookLinkTarget("mailto:a@b.c")).toBeNull();
    expect(bookLinkTarget("blob:tauri://localhost/abc")).toBeNull();
    expect(bookLinkTarget("//example.org/a")).toBeNull();
    expect(bookLinkTarget("   ")).toBeNull();
    expect(bookLinkTarget(null)).toBeNull();
    expect(bookLinkTarget(undefined)).toBeNull();
  });

  test("the href is taken as written, surrounding space aside", () => {
    expect(bookLinkTarget("  chapter3.xhtml  ")).toEqual({
      kind: "internal",
      href: "chapter3.xhtml",
    });
  });
});

describe("the touch the reader takes off the browser", () => {
  test("a selection being dragged is claimed in either layout", () => {
    expect(claimsTouch("vertical", true)).toBe(true);
    expect(claimsTouch("paged", true)).toBe(true);
  });

  test("paged claims every touch, because nothing there scrolls", () => {
    expect(claimsTouch("paged", false)).toBe(true);
  });

  test("a finger on a scrolling page is left to the browser", () => {
    expect(claimsTouch("vertical", false)).toBe(false);
  });
});
