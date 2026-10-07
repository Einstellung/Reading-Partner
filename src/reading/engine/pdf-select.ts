// A finger's selection on the PDF pages (docs/82): the view's half of the hold
// the touch router times (GestureTextSelect), the handles' end moves, and the
// save that turns the selection into a highlight or the underline an Ask
// leaves. Which glyphs are covered is finger-select.ts; this file reaches the
// pages on screen, the engine and the shell.
//
// Every page carries an inset:0 layer that paints the selection
// (EmbedPdfView: FingerSelectionLayer) and doubles as the page's box on
// screen, which is how a viewport point becomes a page point and a page rect
// becomes the viewport rect the shell draws handles at. A page scrolled out of
// the DOM has no box, so its part of the selection has no handle either.

import type { PdfAnnotationObject, PdfPageGeometry, Rect } from "@embedpdf/models";

import type {
  Annotation,
  ReaderSelection,
  ScreenRect,
  SelectionMarkSpec,
} from "../../platform/app/reader-contract";
import type { GestureTextSelect } from "./gesture/context";
import { embedRectToZotero, zoteroToEmbed, type ZoteroAnnotation } from "./convert";
import {
  glyphNear,
  glyphUnder,
  moveSpanEnd,
  spanRects,
  spanSlices,
  spanToWord,
  wordAround,
  type GlyphSpan,
} from "./finger-select";

/** The attribute every page's selection layer carries, with its page index. */
export const FINGER_PAGE_ATTR = "data-finger-page";

export interface PdfSelectHost {
  /** The scroll container the pages are in, once the router has it. */
  viewport(): HTMLElement | null;
  geometry(page: number): PdfPageGeometry | undefined;
  pageSize(page: number): { width: number; height: number } | undefined;
  /** What every page's layer paints: page-space rects by page, or nothing. */
  paint(rects: Map<number, Rect[]> | null): void;
  text(slices: { pageIndex: number; charIndex: number; charCount: number }[]): Promise<string[]>;
  create(pageIndex: number, annotation: PdfAnnotationObject): void;
  authorName(): string;
  onSelection(selection: ReaderSelection | null): void;
}

export interface PdfSelect extends GestureTextSelect {
  moveEnd(end: "start" | "end", clientX: number, clientY: number): void;
  save(spec: SelectionMarkSpec): Annotation[];
}

interface PagePoint {
  page: number;
  x: number;
  y: number;
}

export function createPdfSelect(host: PdfSelectHost): PdfSelect {
  let held: GlyphSpan | null = null;
  let span: GlyphSpan | null = null;
  let selecting = false;
  // The selection's words, read once it settles; a save made before they
  // arrive waits for them.
  let text: Promise<string> | null = null;
  let words = "";

  function pageBoxes(): { page: number; box: DOMRect }[] {
    const root = host.viewport();
    if (!root) return [];
    const out: { page: number; box: DOMRect }[] = [];
    for (const el of Array.from(root.querySelectorAll<HTMLElement>(`[${FINGER_PAGE_ATTR}]`))) {
      const page = Number(el.getAttribute(FINGER_PAGE_ATTR));
      if (Number.isInteger(page)) out.push({ page, box: el.getBoundingClientRect() });
    }
    return out;
  }

  function scaleOf(page: number, box: DOMRect): number {
    const size = host.pageSize(page);
    return size && size.width > 0 ? box.width / size.width : 0;
  }

  function pointOn(page: number, box: DOMRect, clientX: number, clientY: number): PagePoint | null {
    const s = scaleOf(page, box);
    return s > 0 ? { page, x: (clientX - box.left) / s, y: (clientY - box.top) / s } : null;
  }

  // The page under a viewport point.
  function pageAt(clientX: number, clientY: number): PagePoint | null {
    for (const { page, box } of pageBoxes()) {
      if (clientX >= box.left && clientX <= box.right && clientY >= box.top && clientY <= box.bottom) {
        return pointOn(page, box, clientX, clientY);
      }
    }
    return null;
  }

  // The page a point that left the pages is nearest to vertically, then
  // horizontally: a drag into the gap between two sheets still reaches one.
  function pageNear(clientX: number, clientY: number): PagePoint | null {
    let best: { page: number; box: DOMRect } | null = null;
    let bestDist = Infinity;
    for (const b of pageBoxes()) {
      const dy = clientY < b.box.top ? b.box.top - clientY : clientY > b.box.bottom ? clientY - b.box.bottom : 0;
      const dx = clientX < b.box.left ? b.box.left - clientX : clientX > b.box.right ? clientX - b.box.right : 0;
      const d = dy * 4 + dx;
      if (d < bestDist) {
        bestDist = d;
        best = b;
      }
    }
    return best ? pointOn(best.page, best.box, clientX, clientY) : null;
  }

  function wordNear(clientX: number, clientY: number): GlyphSpan | null {
    const at = pageAt(clientX, clientY) ?? pageNear(clientX, clientY);
    const geo = at ? host.geometry(at.page) : undefined;
    if (!at || !geo) return null;
    const g = glyphNear(geo, at.page, at.x, at.y);
    return g ? wordAround(geo, g) : null;
  }

  // Where the selection is on screen: its line boxes on every page still in
  // the DOM, in viewport coordinates.
  function report(): ReaderSelection | null {
    if (!span || selecting) return null;
    const rects = spanRects(span, host.geometry);
    const boxes = new Map(pageBoxes().map((b) => [b.page, b.box]));
    const out: ScreenRect[] = [];
    for (const [page, list] of [...rects.entries()].sort((a, b) => a[0] - b[0])) {
      const box = boxes.get(page);
      if (!box) continue;
      const s = scaleOf(page, box);
      for (const r of list) {
        out.push({
          left: box.left + r.origin.x * s,
          top: box.top + r.origin.y * s,
          width: r.size.width * s,
          height: r.size.height * s,
        });
      }
    }
    return out.length > 0 ? { rects: out, text: words } : null;
  }

  function paint(): void {
    host.paint(span ? spanRects(span, host.geometry) : null);
  }

  function readText(): void {
    const s = span;
    if (!s) return;
    const slices = spanSlices(s, host.geometry).map((p) => ({
      pageIndex: p.page,
      charIndex: p.from,
      charCount: p.to - p.from + 1,
    }));
    text = host.text(slices).then(
      (parts) => parts.join(" ").replace(/\s+/g, " ").trim(),
      () => "",
    );
  }

  // The selection stopped moving: say where it is, and again with its words
  // once the engine has read them.
  function settle(): void {
    words = "";
    readText();
    host.onSelection(report());
    const s = span;
    void text?.then((w) => {
      if (span !== s || selecting) return;
      words = w;
      host.onSelection(report());
    });
  }

  function clear(): void {
    if (!span && !held) return;
    held = null;
    span = null;
    selecting = false;
    text = null;
    words = "";
    paint();
    host.onSelection(null);
  }

  // The marks a selection becomes: one per page it touches, as the engine
  // would write them, the first carrying the conversation an Ask opens. The
  // host is handed them by the engine's own create events, words included.
  function save(spec: SelectionMarkSpec): Annotation[] {
    const s = span;
    if (!s || selecting) return [];
    const rects = spanRects(s, host.geometry);
    const pending = text ?? Promise.resolve("");
    const now = new Date().toISOString();
    const made: ZoteroAnnotation[] = [];
    for (const [page, list] of [...rects.entries()].sort((a, b) => a[0] - b[0])) {
      const size = host.pageSize(page);
      if (!size) continue;
      made.push({
        id: crypto.randomUUID(),
        type: spec.stroke,
        color: spec.color,
        position: { pageIndex: page, rects: list.map((r) => embedRectToZotero(r, size.height)) },
        pageLabel: String(page + 1),
        authorName: host.authorName(),
        dateCreated: now,
        dateModified: now,
        ...(made.length === 0 && spec.aiThreadId ? { aiThreadId: spec.aiThreadId } : {}),
      });
    }
    clear();
    if (made.length === 0) return [];
    void pending.then((words) => {
      for (const ann of made) {
        const size = host.pageSize(ann.position?.pageIndex ?? 0);
        const obj = size ? zoteroToEmbed({ ...ann, text: words }, size.height) : null;
        if (obj) host.create(obj.pageIndex, obj);
      }
    });
    return made as unknown as Annotation[];
  }

  return {
    wordsAt(clientX, clientY) {
      const at = pageAt(clientX, clientY);
      const geo = at ? host.geometry(at.page) : undefined;
      return !!at && !!geo && glyphUnder(geo, at.page, at.x, at.y) !== null;
    },
    begin(clientX, clientY) {
      const at = pageAt(clientX, clientY);
      const geo = at ? host.geometry(at.page) : undefined;
      const g = at && geo ? glyphUnder(geo, at.page, at.x, at.y) : null;
      if (!g || !geo) return false;
      held = wordAround(geo, g);
      span = held;
      selecting = true;
      text = null;
      paint();
      host.onSelection(null);
      return true;
    },
    extend(clientX, clientY) {
      if (!held || !selecting) return;
      const target = wordNear(clientX, clientY);
      if (!target) return;
      span = spanToWord(held, target);
      paint();
    },
    commit() {
      if (!span) return;
      selecting = false;
      settle();
    },
    cancel: clear,
    active: () => span !== null,
    clear,
    moveEnd(end, clientX, clientY) {
      if (!span || selecting) return;
      const target = wordNear(clientX, clientY);
      if (!target) return;
      span = moveSpanEnd(span, end, target);
      paint();
      settle();
    },
    save,
    moved() {
      if (span && !selecting) host.onSelection(report());
    },
  };
}
