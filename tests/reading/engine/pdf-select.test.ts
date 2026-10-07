// A finger's selection on the PDF pages (docs/82): what the shell is told, and
// what a save hands the engine. The pages are two boxes stacked on a fake
// viewport; the geometry is one line of words per page.

import { expect, test } from "bun:test";
import type { PdfAnnotationObject, PdfPageGeometry, Rect } from "@embedpdf/models";
import type { ReaderSelection } from "../../../src/platform/app/reader-contract";
import { FINGER_PAGE_ATTR, createPdfSelect } from "../../../src/reading/engine/pdf-select";

const last = <T>(list: T[]): T | undefined => list[list.length - 1];

function line(text: string): PdfPageGeometry {
  const glyphs = [...text].map((c, i) => ({ x: i * 10, y: 0, width: 10, height: 10, flags: c === " " ? 1 : 0 }));
  return { runs: [{ rect: { x: 0, y: 0, width: text.length * 10, height: 10 }, charStart: 0, glyphs, fontSize: 10 }] } as unknown as PdfPageGeometry;
}

// Page boxes on screen at scale 2: page 0 at y 0..400, page 1 at y 410..810.
function box(top: number): DOMRect {
  return { left: 0, top, right: 400, bottom: top + 400, width: 400, height: 400 } as DOMRect;
}

function setup() {
  const said: (ReaderSelection | null)[] = [];
  const painted: (Map<number, Rect[]> | null)[] = [];
  const created: { page: number; obj: PdfAnnotationObject }[] = [];
  const els = [0, 1].map((page) => ({
    getAttribute: (name: string) => (name === FINGER_PAGE_ATTR ? String(page) : null),
    getBoundingClientRect: () => box(page * 410),
  }));
  const viewport = { querySelectorAll: () => els } as unknown as HTMLElement;
  const sel = createPdfSelect({
    viewport: () => viewport,
    geometry: (page) => (page <= 1 ? line("alpha beta gamma") : undefined),
    pageSize: () => ({ width: 200, height: 200 }),
    paint: (rects) => void painted.push(rects),
    text: async () => ["beta gamma"],
    create: (page, obj) => void created.push({ page, obj }),
    authorName: () => "Reader",
    onSelection: (s) => void said.push(s),
  });
  return { sel, said, painted, created };
}

test("a hold on a word selects it; the shell hears of it only once the finger lifts", async () => {
  const { sel, said, painted } = setup();
  // "beta" is glyphs 6..9: x 60..100 in page space, 120..200 on screen.
  expect(sel.wordsAt(150, 10)).toBe(true);
  expect(sel.wordsAt(390, 10)).toBe(false);
  expect(sel.begin(150, 10)).toBe(true);
  expect(said).toEqual([null]);
  expect(last(painted)?.get(0)?.length).toBe(1);

  sel.extend(250, 10); // into "gamma"
  sel.commit();
  expect(sel.active()).toBe(true);
  const first = last(said);
  expect(first?.rects).toEqual([{ left: 120, top: 0, width: 200, height: 20 }]);
  await Promise.resolve();
  await Promise.resolve();
  expect(last(said)?.text).toBe("beta gamma");
});

test("Ask saves one mark per page, the first carrying the conversation", async () => {
  const { sel, created, said } = setup();
  sel.begin(150, 10);
  sel.extend(150, 420); // onto page 1
  sel.commit();
  const saved = sel.save({ stroke: "underline", color: "#a28ae5", aiThreadId: "t1" });
  expect(saved.map((a) => (a.position as { pageIndex: number }).pageIndex)).toEqual([0, 1]);
  expect(saved[0].aiThreadId).toBe("t1");
  expect(saved[1].aiThreadId).toBeUndefined();
  expect(sel.active()).toBe(false);
  expect(last(said)).toBeNull();
  // The engine is handed them once the words are read, with the same ids.
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  expect(created.map((c) => c.obj.id)).toEqual(saved.map((a) => a.id));
  expect(created.map((c) => c.page)).toEqual([0, 1]);
});

test("nothing is saved from nothing", () => {
  const { sel, created } = setup();
  expect(sel.save({ stroke: "highlight", color: "#ffd400" })).toEqual([]);
  expect(created).toEqual([]);
});
