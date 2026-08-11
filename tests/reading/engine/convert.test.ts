// Headless coverage of the zotero <-> EmbedPDF annotation converters
// (src/reading/engine/convert.ts). Pure functions, no engine — run with
// `bun test`. Mirrors the test style of tests/fulltext.test.ts.

import { test, expect } from "bun:test";
import { PdfAnnotationSubtype } from "@embedpdf/models";
import type { PdfHighlightAnnoObject, PdfInkAnnoObject, Rect } from "@embedpdf/models";
import {
  boundingRect,
  embedRectToZotero,
  embedToZotero,
  makeSortIndex,
  markupColorOf,
  markupColorPatch,
  zoteroRectToEmbed,
  zoteroToEmbed,
  MARKUP_OPACITY,
  MARKUP_TOOL_OVERRIDES,
  type ZoteroAnnotation,
} from "../../../src/reading/engine/convert";

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
  // adapter patches contents/colour only).
  const patched = {
    ...embed,
    contents: "edited",
    ...markupColorPatch("#2ea8e5"),
  } as PdfHighlightAnnoObject;
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

// --- what a markup is drawn with (pitfall 105) ----------------------------
// A markup has to look the same the instant it is drawn and after the book is
// reopened. The engine draws it from `strokeColor` and `opacity`; the shell's
// JSON stores neither, so both have to come from the same place on both paths.

test("an imported markup carries the colour in strokeColor, not only the deprecated alias", () => {
  for (const type of ["highlight", "underline"]) {
    const embed = zoteroToEmbed(
      { id: "m1", type, color: "#5fb236", position: { pageIndex: 0, rects: [[72, 700, 500, 712]] } },
      PAGE_H,
    ) as PdfHighlightAnnoObject;
    // `color` alone leaves the renderer on its own fallback yellow.
    expect(embed.strokeColor).toBe("#5fb236");
    expect(embed.color).toBe("#5fb236");
  }
});

test("markupColorPatch moves both colour fields together", () => {
  expect(markupColorPatch("#2ea8e5")).toEqual({ color: "#2ea8e5", strokeColor: "#2ea8e5" });
});

test("markupColorOf prefers strokeColor and still reads legacy objects", () => {
  expect(markupColorOf({ strokeColor: "#5fb236", color: "#ffd400" }, "#000000")).toBe("#5fb236");
  expect(markupColorOf({ color: "#ffd400" }, "#000000")).toBe("#ffd400");
  expect(markupColorOf({}, "#000000")).toBe("#000000");
});

test("a freshly drawn markup and a re-imported one share one opacity", () => {
  const embed = zoteroToEmbed(
    { id: "m2", type: "highlight", color: "#ffd400", position: { pageIndex: 0, rects: [[72, 700, 500, 712]] } },
    PAGE_H,
  ) as PdfHighlightAnnoObject;
  // The tool defaults handed to the annotation plugin are what a new markup is
  // created with; the import path is this object. Same number or the colour
  // changes under the reader on the first reopen.
  for (const tool of MARKUP_TOOL_OVERRIDES) {
    expect(tool.defaults.opacity).toBe(MARKUP_OPACITY);
  }
  expect(embed.opacity).toBe(MARKUP_OPACITY);
  expect(MARKUP_TOOL_OVERRIDES.map((t) => t.id).sort()).toEqual(["highlight", "underline"]);
});

test("a colour survives create -> save -> reopen unchanged", () => {
  // What the engine builds when the reader draws with the tool colour set.
  const created = {
    id: "m3",
    type: PdfAnnotationSubtype.HIGHLIGHT,
    pageIndex: 0,
    rect: { origin: { x: 72, y: 80 }, size: { width: 428, height: 12 } },
    segmentRects: [{ origin: { x: 72, y: 80 }, size: { width: 428, height: 12 } }],
    opacity: MARKUP_OPACITY,
    ...markupColorPatch("#e56eee"),
  } as unknown as PdfHighlightAnnoObject;
  const saved = embedToZotero(created, PAGE_H)!;
  expect(saved.color).toBe("#e56eee");
  const reopened = zoteroToEmbed(saved, PAGE_H) as PdfHighlightAnnoObject;
  expect(reopened.strokeColor).toBe(created.strokeColor);
  expect(reopened.opacity).toBe(created.opacity);
});

// --- non-supported shapes -------------------------------------------------

test("retired image annotations are not converted to EmbedPDF", () => {
  expect(zoteroToEmbed({ id: "img", type: "image", position: { pageIndex: 0 } }, PAGE_H)).toBeNull();
});
