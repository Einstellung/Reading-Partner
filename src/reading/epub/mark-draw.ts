// The primitives both mark views share: where a text mark is in a tree, and
// what a highlight, an underline and a selection look like once it is found.
// The sheets (mark-layer.ts) and the reflow column (flow-marks.ts) mount their
// overlays differently and measure in different coordinates, so each one keeps
// its own mounting and hit-testing; only what is identical is here, and writing
// a mark down is mark-write.ts.
//
// Every rect here is already in the caller's own coordinates: this file draws
// what it is handed and converts nothing.

import type { Annotation } from "../../platform/app/reader-contract";
import { MARKUP_OPACITY } from "../engine/convert";
import {
  DEFAULT_MARK_COLOR,
  epubPositionOf,
  epubSortOffset,
  findQuoteSpan,
  quoteSelectorOf,
  sameWords,
} from "./annotation";
import { epubRangeCfi, textSteps } from "./cfi";
import { underlineBand, unionRect, type PageRect } from "./mark-geometry";
import { runAt, type DocumentText, type TextRun } from "./text";

/** The book's side of one spine item, as the mark views need it. */
export interface SpineText {
  index: number;
  idref: string;
  /** The ingestion tree: what the offsets and the pagination were taken on. */
  root: Element;
  text: DocumentText;
  runs: Map<Node, TextRun>;
}

/** The one view-specific half of finding a mark: its tree and its spine item. */
export interface MarkRangeSource {
  /** A live Range on the view's own tree for a CFI, or null. */
  rangeOfCfi(cfi: string): Range | null;
  /** The ingestion side of the spine item the view is showing, or null. */
  spine(): SpineText | null;
}

/** A live Range on the view's tree for a span of the ingestion text. */
function rangeOfSpan(source: MarkRangeSource, spine: SpineText, span: { start: number; end: number }): Range | null {
  const from = runAt(spine.text.runs, span.start);
  const to = runAt(spine.text.runs, span.end);
  if (!from || !to) return null;
  const startLocal = textSteps(from.node, from.offset);
  const endLocal = textSteps(to.node, to.offset);
  if (startLocal === null || endLocal === null) return null;
  return source.rangeOfCfi(epubRangeCfi(spine.index, spine.idref, startLocal, endLocal));
}

/**
 * Where a text mark is in this view. The CFI first; the quote when the CFI
 * resolves to nothing, or to words that are not the ones that were marked.
 */
export function rangeForMark(source: MarkRangeSource, ann: Annotation): Range | null {
  const position = epubPositionOf(ann);
  if (!position) return null;
  const quote = quoteSelectorOf(ann);
  const byCfi = source.rangeOfCfi(position.value);
  if (byCfi && !byCfi.collapsed && (!quote || sameWords(byCfi.toString(), quote.exact))) return byCfi;
  if (!quote) return byCfi && !byCfi.collapsed ? byCfi : null;
  const spine = source.spine();
  if (!spine) return null;
  const near = epubSortOffset(ann.sortIndex) ?? undefined;
  const span = findQuoteSpan(spine.text.text, quote, near);
  if (!span) return null;
  return rangeOfSpan(source, spine, span);
}

/** The mark's colour, or the default when it carries none this view can paint. */
export function colorOf(ann: Annotation): string {
  const color = ann.color;
  return typeof color === "string" && /^#[0-9a-fA-F]{6}$/.test(color) ? color : DEFAULT_MARK_COLOR;
}

export interface MarkPainter {
  /** The named sublayer of an overlay, created on first use. */
  sublayer(overlay: HTMLElement, name: string): HTMLElement;
  rectDiv(r: PageRect, css: string): HTMLElement;
  drawStroke(into: HTMLElement, kind: "highlight" | "underline", rects: PageRect[], color: string): void;
  /** The one selected mark's outline. The shell selects at most one at a time. */
  drawSelection(into: HTMLElement, rects: PageRect[], color: string): void;
}

export function createMarkPainter(owner: Document): MarkPainter {
  function rectDiv(r: PageRect, css: string): HTMLElement {
    const el = owner.createElement("div");
    el.style.cssText = `position:absolute;left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;${css}`;
    return el;
  }

  return {
    sublayer(overlay, name) {
      const existing = overlay.querySelector<HTMLElement>(`.${name}`);
      if (existing) return existing;
      const el = owner.createElement("div");
      el.className = name;
      el.style.cssText = "position:absolute;inset:0;pointer-events:none";
      overlay.append(el);
      return el;
    },

    rectDiv,

    drawStroke(into, kind, rects, color) {
      for (const r of rects) {
        const box = kind === "underline" ? underlineBand(r) : r;
        into.append(rectDiv(box, `background:${color};opacity:${MARKUP_OPACITY};border-radius:1px`));
      }
    },

    drawSelection(into, rects, color) {
      const box = unionRect(rects);
      if (!box) return;
      const grown = { left: box.left - 3, top: box.top - 3, width: box.width + 6, height: box.height + 6 };
      into.append(rectDiv(grown, `border:1.5px solid ${color};border-radius:3px;box-sizing:border-box;opacity:0.9`));
    },
  };
}
