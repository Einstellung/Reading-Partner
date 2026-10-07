// Which sheet a text mark is painted on. The table numbers a mark by the page
// its first character falls in; a sheet shows the column its page's start
// lands in on this device. When the table was cut on a device that laid the
// spine document a few lines apart (docs/pitfall/485), the words on the sheet
// for page N are ones the table puts on page N-1, and a mark drawn there is
// numbered N-1. It must still be painted where its words are.
//
// The layout is the webview's; here a fake sheet stands in for it, showing
// every word of its document inside the text block, which is what the sheet
// for the drifted page does with the words the pen went over.

import { describe, expect, test } from "bun:test";
import type { Annotation } from "../../../../src/platform/app/reader-contract";
import { parseEpub } from "../../../../src/reading/epub/file/parse";
import { parseEpubRangeCfi, resolveRange } from "../../../../src/reading/epub/file/cfi";
import { extractDocumentText, runAt } from "../../../../src/reading/epub/file/text";
import { newEpubInk } from "../../../../src/reading/epub/annotation";
import { BODY_BOX } from "../../../../src/reading/epub/mark-geometry";
import { createSpineTexts, textMarkOf } from "../../../../src/reading/epub/mark-write";
import { characterRuler, paginate } from "../../../../src/reading/epub/paginate";
import { createMarkLayer } from "../../../../src/reading/epub/paged/mark-layer";
import type { PageCard } from "../../../../src/reading/epub/paged/page-card";
import { sheetMayShowMark, sheetsForMark } from "../../../../src/reading/epub/reader-logic";
import { buildEpub, prose } from "../fixture";

async function book() {
  const parsed = parseEpub(
    buildEpub({
      docs: [
        { name: "c1.xhtml", body: `<h1>One</h1>${prose(6, 300)}` },
        { name: "c2.xhtml", body: `<h1>Two</h1>${prose(5, 260)}` },
      ],
    }),
  );
  const pagination = await paginate(parsed, characterRuler(250));
  return { parsed, pagination, spineOf: createSpineTexts(parsed) };
}

// A sheet whose column shows every word of its document inside the text block.
function fakeSheet(html: string, spine: number): { card: PageCard; root: Element; owner: Document } {
  const owner = new DOMParser().parseFromString(html, "application/xhtml+xml");
  const root = owner.documentElement as Element;
  const overlay = owner.createElement("div");
  const card = {
    el: owner.createElement("div"),
    shadow: null as unknown as ShadowRoot,
    spine,
    mounted: { root, clip: overlay, columns: overlay, overlay, ready: Promise.resolve() },
    overlay,
    show: async () => {},
    clear: () => {},
    setScale: () => {},
    toViewport: (p: { x: number; y: number }) => p,
    fromViewport: (p: { x: number; y: number }) => p,
    rangeOf: (cfi: string) => {
      const parsed = parseEpubRangeCfi(cfi);
      return parsed ? resolveRange(root, parsed) : null;
    },
    rectsOf: () => [{ left: BODY_BOX.left + 10, top: BODY_BOX.top + 10, width: 80, height: 18 }] as unknown as DOMRect[],
    showColumnOf: () => false,
  } satisfies PageCard;
  return { card, root, owner };
}

function painted(card: PageCard): number {
  return card.overlay?.querySelector(".rp-marks")?.children.length ?? 0;
}

describe("a text mark is painted where its words are, not only on the page it is numbered", () => {
  test("the sheet for the next page paints a mark the table numbers on the page before", async () => {
    const { parsed, pagination, spineOf } = await book();
    const doc = parsed.docs[0];
    // Pages 0 and 1 are both the first document's.
    expect(pagination.blocks[0].spine).toBe(0);
    expect(pagination.blocks[1].spine).toBe(0);

    const { card, root, owner } = fakeSheet(doc.html, doc.index);
    const text = extractDocumentText(root);
    const from = runAt(text.runs, 20);
    const to = runAt(text.runs, 60);
    if (!from || !to) throw new Error("no runs");
    const range = owner.createRange();
    range.setStart(from.node, from.offset);
    range.setEnd(to.node, to.offset);
    const mark = textMarkOf(range, {
      spine: doc.index,
      stroke: "highlight",
      color: "#ffd400",
      spineOf,
      pagination,
      authorName: "Reader",
      now: "2026-09-27T08:00:00.000Z",
      id: "m1",
    });
    if (!mark) throw new Error("no mark");
    expect((mark.position as { pageIndex: number }).pageIndex).toBe(0);

    const ink = newEpubInk({
      id: "i1",
      color: "#ffd400",
      paths: [[100, 100, 200, 120]],
      width: 3,
      pageIndex: 0,
      pageLabel: "1",
      spineIndex: 0,
      charOffset: 0,
      authorName: "Reader",
      now: "2026-09-27T08:00:00.000Z",
    }) as Annotation;

    const layer = createMarkLayer({
      owner,
      authorName: "Reader",
      cardAt: () => card,
      pageOfCard: () => 1,
      cardOfPage: (i) => (i === 1 ? card : null),
      pagination,
      spineOf,
      onSave: () => {},
      onSelect: () => {},
      onPopup: () => {},
      onSelection: () => {},
    });

    // A mark saved while the sheet was up: the sheet for page 1 repaints.
    layer.reset([]);
    layer.setAnnotations([mark]);
    expect(painted(card)).toBe(1);

    // Opening on page 1 with the mark and an ink stroke of page 0 on disk: the
    // words are on this sheet, the ink is page 0's drawing and is not.
    layer.reset([mark, ink]);
    layer.paint(card, 1);
    expect(painted(card)).toBe(1);
  });
});

describe("the sheets a mark may show on", () => {
  test("a text mark: every page of its spine document; ink: its own page", async () => {
    const { pagination } = await book();
    const first = pagination.blocks.map((b, i) => (b.spine === 0 ? i : -1)).filter((i) => i >= 0);
    const second = pagination.blocks.map((b, i) => (b.spine === 1 ? i : -1)).filter((i) => i >= 0);
    expect(first.length).toBeGreaterThan(1);
    expect(sheetsForMark(pagination, first[0], false)).toEqual(first);
    expect(sheetsForMark(pagination, first[0], true)).toEqual([first[0]]);
    expect(sheetMayShowMark(pagination, first[0], false, first[1])).toBe(true);
    expect(sheetMayShowMark(pagination, first[0], true, first[1])).toBe(false);
    expect(sheetMayShowMark(pagination, first[0], false, second[0])).toBe(false);
  });
});
