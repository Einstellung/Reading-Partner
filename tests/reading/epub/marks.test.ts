// What a mark on a sheet has to get right without a browser: the page
// coordinates it is painted and pressed in, the shape ink takes on disk, and
// the trip a stroke makes from a live Range to the fields written down and back
// to a Range on the card's own clone of the document.
//
// The measuring half — client rects, carets, the sheet's scale — is a webview's
// and is verified by driving the desktop app; everything below is arithmetic
// and tree walking, which is testable here and is where the mistakes are.

import { describe, expect, test } from "bun:test";
import {
  BODY_BOX,
  PAGE_BOX,
  clampPoint,
  clipRect,
  clipRects,
  pathToPoints,
  pathsBounds,
  pathsHit,
  pointsToPath,
  polylinePoints,
  popupRect,
  rectsHit,
  shouldAppendInkPoint,
  underlineBand,
  unionRect,
} from "../../../src/reading/epub/mark-geometry";
import {
  epubInkOf,
  markKind,
  newEpubInk,
  newEpubMark,
  quoteSelectorAt,
} from "../../../src/reading/epub/annotation";
import { epubRangeCfi, parseEpubRangeCfi, rangeToCfi, resolveSteps, textSteps } from "../../../src/reading/epub/cfi";
import { PAGE_HEIGHT, PAGE_PAD_X, PAGE_PAD_Y, PAGE_WIDTH } from "../../../src/reading/epub/page-geometry";
import { parseEpub } from "../../../src/reading/epub/parse";
import { extractDocumentText, indexRuns, offsetOfPoint, runAt } from "../../../src/reading/epub/text";
import { annotationPage } from "../../../src/platform/app/reader-contract";
import { buildEpub, prose } from "./fixture";

// ---------------------------------------------------------------- geometry --

describe("a mark is clipped to the text block, not to the sheet", () => {
  test("a rect inside the body survives whole", () => {
    const r = { left: 100, top: 200, width: 60, height: 18 };
    expect(clipRect(r)).toEqual(r);
  });

  test("the part of a line that ran into the next column is cut off", () => {
    // The layout lays the next page's column beside this one; the clip box
    // hides it, and a rect painted there would sit in the margin.
    const next = { left: BODY_BOX.right + 20, top: 300, width: 80, height: 18 };
    expect(clipRect(next)).toBeNull();
  });

  test("a rect straddling the foot keeps only what is on the page", () => {
    const straddling = { left: 100, top: BODY_BOX.bottom - 10, width: 60, height: 40 };
    expect(clipRect(straddling)).toEqual({ left: 100, top: BODY_BOX.bottom - 10, width: 60, height: 10 });
  });

  test("clipRects drops what is gone and keeps the order of what is left", () => {
    const rects = [
      { left: 100, top: 200, width: 60, height: 18 },
      { left: BODY_BOX.right + 50, top: 200, width: 60, height: 18 },
      { left: 120, top: 240, width: 30, height: 18 },
    ];
    expect(clipRects(rects).map((r) => r.left)).toEqual([100, 120]);
  });

  test("the body box is the page's margins, and ink may use the whole sheet", () => {
    expect(BODY_BOX.left).toBe(PAGE_PAD_X);
    expect(BODY_BOX.top).toBe(PAGE_PAD_Y);
    expect(PAGE_BOX).toEqual({ left: 0, top: 0, right: PAGE_WIDTH, bottom: PAGE_HEIGHT });
    expect(clampPoint({ x: -40, y: PAGE_HEIGHT + 90 })).toEqual({ x: 0, y: PAGE_HEIGHT });
  });
});

describe("what is painted for a stroke", () => {
  test("an underline is a band at the foot of the line, not the whole line", () => {
    const line = { left: 60, top: 100, width: 200, height: 20 };
    expect(underlineBand(line, 2)).toEqual({ left: 60, top: 118, width: 200, height: 2 });
  });

  test("a band never grows past a line shorter than itself", () => {
    expect(underlineBand({ left: 0, top: 0, width: 10, height: 1 }, 4)).toEqual({
      left: 0,
      top: 0,
      width: 10,
      height: 1,
    });
  });

  test("the selection outline is drawn around every line of the mark", () => {
    const box = unionRect([
      { left: 100, top: 100, width: 50, height: 20 },
      { left: 60, top: 130, width: 200, height: 20 },
    ]);
    expect(box).toEqual({ left: 60, top: 100, width: 200, height: 50 });
    expect(unionRect([])).toBeNull();
  });
});

describe("pressing a mark", () => {
  const rects = [{ left: 100, top: 100, width: 80, height: 20 }];

  test("a press inside the words hits", () => {
    expect(rectsHit(rects, { x: 140, y: 110 })).toBe(true);
  });

  test("a press just outside still hits, a press well outside does not", () => {
    expect(rectsHit(rects, { x: 182, y: 110 }, 3)).toBe(true);
    expect(rectsHit(rects, { x: 220, y: 110 }, 3)).toBe(false);
    expect(rectsHit(rects, { x: 140, y: 60 }, 3)).toBe(false);
  });

  test("a press near an ink stroke hits, one away from it does not", () => {
    const stroke = [[10, 10, 60, 10, 60, 60]];
    expect(pathsHit(stroke, { x: 35, y: 12 }, 4)).toBe(true);
    expect(pathsHit(stroke, { x: 60, y: 40 }, 4)).toBe(true);
    expect(pathsHit(stroke, { x: 35, y: 40 }, 4)).toBe(false);
  });

  test("a stroke of one point is a dot with a radius", () => {
    expect(pathsHit([[20, 20]], { x: 22, y: 21 }, 4)).toBe(true);
    expect(pathsHit([[20, 20]], { x: 40, y: 20 }, 4)).toBe(false);
  });

  test("the popup is anchored on the mark in viewport coordinates", () => {
    // A sheet at (30, 50) drawn at half scale.
    const toViewport = (p: { x: number; y: number }) => ({ x: 30 + p.x * 0.5, y: 50 + p.y * 0.5 });
    expect(popupRect({ left: 100, top: 200, width: 80, height: 20 }, toViewport)).toEqual([80, 150, 120, 160]);
  });
});

// --------------------------------------------------------------------- ink --

describe("a free stroke on a sheet", () => {
  test("points go to a flat path and back", () => {
    const points = [
      { x: 10.04, y: 20.06 },
      { x: 30, y: 40 },
    ];
    const flat = pointsToPath(points);
    expect(flat).toEqual([10, 20.1, 30, 40]);
    expect(pathToPoints(flat)).toEqual([
      { x: 10, y: 20.1 },
      { x: 30, y: 40 },
    ]);
    expect(polylinePoints(flat)).toBe("10,20.1 30,40");
  });

  test("a stroke records a point only once the pen has moved", () => {
    expect(shouldAppendInkPoint(undefined, { x: 0, y: 0 })).toBe(true);
    expect(shouldAppendInkPoint({ x: 10, y: 10 }, { x: 10.5, y: 10.5 })).toBe(false);
    expect(shouldAppendInkPoint({ x: 10, y: 10 }, { x: 12, y: 10 })).toBe(true);
  });

  test("the strokes' bounds are what a press and a selection are tested against", () => {
    expect(pathsBounds([[10, 20, 40, 60], [5, 90]])).toEqual({ left: 5, top: 20, width: 35, height: 70 });
    expect(pathsBounds([])).toBeNull();
  });

  test("the entry written down carries the page, the points and the width", () => {
    const ink = newEpubInk({
      id: "i1",
      color: "#a28ae5",
      paths: [[10, 20, 30, 40]],
      width: 2,
      pageIndex: 6,
      pageLabel: "12",
      spineIndex: 3,
      charOffset: 900,
      authorName: "Reading-Partner",
      now: "2026-09-09T00:00:00.000Z",
    });
    expect(ink.type).toBe("ink");
    expect(ink.position).toEqual({ pageIndex: 6, paths: [[10, 20, 30, 40]], width: 2 });
    expect(ink.sortIndex).toBe("00003|0000900");
    expect(ink.pageLabel).toBe("12");
    // The page reads off an EPUB stroke the way it reads off a PDF one.
    expect(annotationPage(ink as { position?: { pageIndex?: number } })).toBe(7);
    expect(markKind(ink)).toBe("ink");
    expect(epubInkOf(ink)).toEqual({ pageIndex: 6, paths: [[10, 20, 30, 40]], width: 2 });
  });

  test("a stroke with nothing drawable in it is not a stroke", () => {
    expect(epubInkOf({ position: { pageIndex: 1, paths: [], width: 2 } })).toBeNull();
    expect(epubInkOf({ position: { pageIndex: 1, paths: [[1]], width: 2 } })).toBeNull();
    expect(epubInkOf({ position: { pageIndex: 1 } })).toBeNull();
    expect(epubInkOf(null)).toBeNull();
  });

  test("the three text pens are drawn, everything else is not", () => {
    expect(markKind({ type: "highlight" })).toBe("highlight");
    expect(markKind({ type: "underline" })).toBe("underline");
    expect(markKind({ type: "note" })).toBeNull();
  });
});

// ------------------------------------------------------------- the anchors --

// The book the write path is exercised on. A card holds a clone of the very
// same sanitized tree, so a second parse of the same markup stands in for one.
async function book() {
  const parsed = parseEpub(
    buildEpub({
      docs: [
        { name: "c1.xhtml", body: `<h1>One</h1>${prose(6, 300)}` },
        { name: "c2.xhtml", body: `<h1>Two</h1><p>alpha beta gamma</p>${prose(5, 260)}` },
      ],
    }),
  );
  return parsed;
}

function cloneOf(html: string): Element {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "application/xhtml+xml");
  const root = doc.documentElement;
  if (!root) throw new Error("no content root");
  return root;
}

describe("a stroke becomes a mark and is found again", () => {
  test("the offsets written down are the ones the CFI resolves back to", async () => {
    const parsed = await book();
    for (const doc of parsed.docs) {
      const runs = indexRuns(doc.text);
      const root = doc.doc.documentElement;
      expect(root).not.toBeNull();
      for (const start of [12, 180, 500]) {
        const span = { start, end: start + 40 };
        const from = runAt(doc.text.runs, span.start);
        const to = runAt(doc.text.runs, span.end);
        expect(from).not.toBeNull();
        expect(to).not.toBeNull();
        if (!from || !to || !root) continue;

        // What the card hands back when the pen lifts.
        const range = doc.doc.createRange();
        range.setStart(from.node, from.offset);
        range.setEnd(to.node, to.offset);
        const cfi = rangeToCfi(range, doc.index, doc.idref);
        expect(cfi).not.toBeNull();
        if (!cfi) continue;

        // What is written down: the offsets, taken back off the ingestion tree
        // rather than off the node identities of a clone (pitfall 267).
        const back = parseEpubRangeCfi(cfi);
        expect(back).not.toBeNull();
        if (!back) continue;
        expect(back.spineIndex).toBe(doc.index);
        const a = resolveSteps(root, back.start.steps, back.start.offset);
        const b = resolveSteps(root, back.end.steps, back.end.offset);
        expect(a).not.toBeNull();
        expect(b).not.toBeNull();
        if (!a || !b) continue;
        expect(offsetOfPoint(doc.text, runs, a.node, a.offset)).toBe(span.start);
        expect(offsetOfPoint(doc.text, runs, b.node, b.offset)).toBe(span.end);
      }
    }
  });

  test("the CFI a card writes resolves on another copy of the same document", async () => {
    const parsed = await book();
    const doc = parsed.docs[1];
    const root = doc.doc.documentElement;
    if (!root) throw new Error("no content root");
    const span = { start: 20, end: 64 };
    const from = runAt(doc.text.runs, span.start);
    const to = runAt(doc.text.runs, span.end);
    if (!from || !to) throw new Error("no runs");
    const range = doc.doc.createRange();
    range.setStart(from.node, from.offset);
    range.setEnd(to.node, to.offset);
    const cfi = rangeToCfi(range, doc.index, doc.idref);
    if (!cfi) throw new Error("no cfi");

    // The card's tree: the same markup parsed a second time.
    const clone = cloneOf(doc.html);
    const back = parseEpubRangeCfi(cfi);
    if (!back) throw new Error("no parse");
    const a = resolveSteps(clone, back.start.steps, back.start.offset);
    const b = resolveSteps(clone, back.end.steps, back.end.offset);
    if (!a || !b) throw new Error("no resolve");
    const onClone = clone.ownerDocument.createRange();
    onClone.setStart(a.node, a.offset);
    onClone.setEnd(b.node, b.offset);
    expect(onClone.toString()).toBe(range.toString());
  });

  test("the repair walks a quote's span onto the card without a stored CFI", async () => {
    const parsed = await book();
    const doc = parsed.docs[0];
    const span = { start: 40, end: 96 };
    const quote = quoteSelectorAt(doc.text.text, span);
    expect(quote.exact.length).toBe(56);

    // What the layer does when a stored CFI stops resolving: the span found by
    // the quote, turned into steps on the ingestion tree and resolved on the
    // card's.
    const from = runAt(doc.text.runs, span.start);
    const to = runAt(doc.text.runs, span.end);
    if (!from || !to) throw new Error("no runs");
    const startLocal = textSteps(from.node, from.offset);
    const endLocal = textSteps(to.node, to.offset);
    expect(startLocal).not.toBeNull();
    expect(endLocal).not.toBeNull();
    if (startLocal === null || endLocal === null) return;
    const cfi = epubRangeCfi(doc.index, doc.idref, startLocal, endLocal);
    const clone = cloneOf(doc.html);
    const back = parseEpubRangeCfi(cfi);
    if (!back) throw new Error("no parse");
    const a = resolveSteps(clone, back.start.steps, back.start.offset);
    const b = resolveSteps(clone, back.end.steps, back.end.offset);
    if (!a || !b) throw new Error("no resolve");
    const range = clone.ownerDocument.createRange();
    range.setStart(a.node, a.offset);
    range.setEnd(b.node, b.offset);
    expect(range.toString().replace(/\s+/g, "")).toBe(quote.exact.replace(/\s+/g, ""));
  });

  test("a card's own extraction agrees with the ingestion's, character for character", async () => {
    const parsed = await book();
    for (const doc of parsed.docs) {
      expect(extractDocumentText(cloneOf(doc.html)).text).toBe(doc.text.text);
    }
  });

  test("a text mark and a stroke on the same page answer the same page number", () => {
    const mark = newEpubMark({
      id: "m1",
      stroke: "highlight",
      color: "#ffd400",
      cfi: "epubcfi(/6/4!/4/2,/1:0,/1:10)",
      spineIndex: 1,
      span: { start: 100, end: 110 },
      pageIndex: 4,
      pageLabel: "9",
      quote: { type: "TextQuoteSelector", exact: "ten chars.", prefix: "", suffix: "" },
      authorName: "Reading-Partner",
      now: "2026-09-09T00:00:00.000Z",
    });
    const ink = newEpubInk({
      id: "i1",
      color: "#a28ae5",
      paths: [[1, 2, 3, 4]],
      width: 2,
      pageIndex: 4,
      pageLabel: "9",
      spineIndex: 1,
      charOffset: 80,
      authorName: "Reading-Partner",
      now: "2026-09-09T00:00:00.000Z",
    });
    expect(annotationPage(mark as { position?: { pageIndex?: number } })).toBe(5);
    expect(annotationPage(ink as { position?: { pageIndex?: number } })).toBe(5);
    expect(mark.pageLabel).toBe(ink.pageLabel);
  });
});
