// Headless coverage of the zotero <-> EmbedPDF annotation converters
// (src/reader-embedpdf/convert.ts). Pure functions, no engine — run with
// `bun test`. Mirrors the test style of tests/fulltext.test.ts.

import { test, expect } from "bun:test";
import { PdfAnnotationSubtype } from "@embedpdf/models";
import type { PdfHighlightAnnoObject, PdfInkAnnoObject, Rect } from "@embedpdf/models";
import {
  boundingRect,
  embedRectToZotero,
  embedToZotero,
  makeSortIndex,
  zoteroRectToEmbed,
  zoteroToEmbed,
  type ZoteroAnnotation,
} from "../src/reader-embedpdf/convert";

const PAGE_H = 792; // US Letter height in PDF points.

// --- geometry: the Y flip (spike item 3) ---------------------------------

test("zotero rect (bottom-left) maps to EmbedPDF rect (top-left)", () => {
  // A line near the bottom of the page: yBottom=650, yTop=662.
  const embed = zoteroRectToEmbed([100, 650, 300, 662], PAGE_H);
  expect(embed.origin.x).toBe(100);
  // Top edge (pdf y=662) sits 792-662=130 from the top.
  expect(embed.origin.y).toBe(130);
  expect(embed.size.width).toBe(200);
  expect(embed.size.height).toBe(12);
});

test("rect flip round-trips exactly", () => {
  const z = [72, 100.5, 523.25, 118.75];
  const back = embedRectToZotero(zoteroRectToEmbed(z, PAGE_H), PAGE_H);
  expect(back).toEqual(z);
});

test("boundingRect unions segment rects", () => {
  const segs: Rect[] = [
    { origin: { x: 10, y: 20 }, size: { width: 30, height: 10 } },
    { origin: { x: 50, y: 25 }, size: { width: 40, height: 12 } },
  ];
  expect(boundingRect(segs)).toEqual({
    origin: { x: 10, y: 20 },
    size: { width: 80, height: 17 },
  });
});

// --- highlight round-trip -------------------------------------------------

test("highlight round-trips through EmbedPDF and back", () => {
  const zot: ZoteroAnnotation = {
    id: "abc12345",
    type: "highlight",
    color: "#ff6666",
    comment: "note here",
    text: "the selected sentence",
    tags: [{ name: "important" }],
    pageLabel: "3",
    position: { pageIndex: 2, rects: [[100, 650, 300, 662], [100, 636, 250, 648]] },
    dateCreated: "2026-07-12T06:34:25.037Z",
    dateModified: "2026-07-12T06:34:25.037Z",
    authorName: "Reading-Partner",
    aiThreadId: "thread-xyz",
    starred: true,
  };

  const embed = zoteroToEmbed(zot, PAGE_H) as PdfHighlightAnnoObject;
  expect(embed.type).toBe(PdfAnnotationSubtype.HIGHLIGHT);
  expect(embed.color).toBe("#ff6666");
  expect(embed.contents).toBe("note here");
  expect(embed.segmentRects.length).toBe(2);
  // Custom carries everything EmbedPDF cannot model (spike item 7).
  expect(embed.custom.text).toBe("the selected sentence");
  expect(embed.custom.aiThreadId).toBe("thread-xyz");
  expect(embed.custom.starred).toBe(true);
  expect(embed.custom.tags).toEqual([{ name: "important" }]);

  const back = embedToZotero(embed, PAGE_H) as ZoteroAnnotation;
  expect(back.type).toBe("highlight");
  expect(back.id).toBe("abc12345");
  expect(back.color).toBe("#ff6666");
  expect(back.comment).toBe("note here");
  expect(back.text).toBe("the selected sentence");
  expect(back.aiThreadId).toBe("thread-xyz");
  expect(back.starred).toBe(true);
  expect(back.tags).toEqual([{ name: "important" }]);
  expect(back.pageLabel).toBe("3");
  expect(back.position!.rects).toEqual(zot.position!.rects);
});

test("aiThreadId survives a color/comment update round-trip (spike item 7)", () => {
  const zot: ZoteroAnnotation = {
    id: "u1",
    type: "underline",
    color: "#a28ae5",
    position: { pageIndex: 0, rects: [[72, 700, 500, 712]] },
    aiThreadId: "keep-me",
  };
  const embed = zoteroToEmbed(zot, PAGE_H)!;
  // Simulate a host-side edit: change contents, keep custom untouched (the
  // adapter patches contents/color only).
  const patched = { ...embed, contents: "edited", color: "#2ea8e5" } as PdfHighlightAnnoObject;
  const back = embedToZotero(patched, PAGE_H)!;
  expect(back.aiThreadId).toBe("keep-me");
  expect(back.comment).toBe("edited");
  expect(back.color).toBe("#2ea8e5");
});

// --- ink round-trip -------------------------------------------------------

test("ink strokes round-trip with Y flip and stroke width", () => {
  const zot: ZoteroAnnotation = {
    id: "ink1",
    type: "ink",
    color: "#a28ae5",
    position: {
      pageIndex: 1,
      width: 3,
      paths: [
        [100, 700, 120, 690, 140, 695],
        [200, 600, 210, 610],
      ],
    },
  };
  const embed = zoteroToEmbed(zot, PAGE_H) as PdfInkAnnoObject;
  expect(embed.type).toBe(PdfAnnotationSubtype.INK);
  expect(embed.strokeWidth).toBe(3);
  expect(embed.inkList.length).toBe(2);
  // First point: pdf (100,700) -> top-left (100, 792-700=92).
  expect(embed.inkList[0].points[0]).toEqual({ x: 100, y: 92 });

  const back = embedToZotero(embed, PAGE_H)!;
  expect(back.type).toBe("ink");
  expect(back.position!.width).toBe(3);
  expect(back.position!.paths).toEqual(zot.position!.paths);
});

// --- doc-order key (replaces sortIndex) -----------------------------------

test("makeSortIndex orders by page, then top-to-bottom, then left", () => {
  const a = makeSortIndex(0, 100, 50); // page 0, near top
  const b = makeSortIndex(0, 300, 10); // page 0, lower
  const c = makeSortIndex(1, 10, 10); // page 1
  expect(a < b).toBe(true);
  expect(b < c).toBe(true);
  // Two marks on the same line: smaller x sorts first.
  expect(makeSortIndex(0, 100, 10) < makeSortIndex(0, 100, 90)).toBe(true);
});

test("embedToZotero synthesizes a sortIndex from top-left geometry", () => {
  const embed = zoteroToEmbed(
    { id: "s1", type: "highlight", position: { pageIndex: 4, rects: [[100, 650, 300, 662]] } },
    PAGE_H,
  )!;
  const back = embedToZotero(embed, PAGE_H)!;
  // page 4, top edge 130 from top, x=100.
  expect(back.sortIndex).toBe(makeSortIndex(4, 130, 100));
});

// --- non-supported shapes -------------------------------------------------

test("retired image annotations are not converted to EmbedPDF", () => {
  expect(zoteroToEmbed({ id: "img", type: "image", position: { pageIndex: 0 } }, PAGE_H)).toBeNull();
});
