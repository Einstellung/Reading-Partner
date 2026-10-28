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
import { epubRangeCfi, textSteps } from "./file/cfi";
import { lineBands, underlineBand, unionRect, type PageRect } from "./mark-geometry";
import { runAt, type DocumentText, type TextRun } from "./file/text";

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
export function rangeOfSpan(source: MarkRangeSource, spine: SpineText, span: { start: number; end: number }): Range | null {
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

// Node.TEXT_NODE and NodeFilter.SHOW_TEXT, which are not globals outside a browser.
const TEXT_NODE = 3;
const SHOW_TEXT = 0x4;

/**
 * The boxes of the text a range covers, in viewport coordinates. Not the
 * range's own client rects: those also hold the border box of every element
 * the range wholly contains, so a paragraph inside a selection comes back as
 * one block as tall as the paragraph and as wide as the column, and every
 * line of it merges into that block (docs/pitfall/675, 444). Each text node
 * the range touches is measured on its own, cut to the range at both ends.
 * `measure` is the engine's Range.getClientRects, replaceable in tests.
 */
export function textRectsOf(
  range: Range,
  measure: (piece: Range) => ArrayLike<DOMRect> = (piece) => piece.getClientRects(),
): DOMRect[] {
  const first = range.startContainer;
  const owner = first.ownerDocument;
  if (!owner) return [];
  const out: DOMRect[] = [];
  const piece = owner.createRange();
  const add = (node: Text): void => {
    const start = node === range.startContainer ? range.startOffset : 0;
    const end = node === range.endContainer ? range.endOffset : node.data.length;
    if (end <= start) return;
    piece.setStart(node, start);
    piece.setEnd(node, end);
    for (const r of Array.from(measure(piece))) out.push(r);
  };
  const root = range.commonAncestorContainer;
  if (root.nodeType === TEXT_NODE) {
    add(root as Text);
    return out;
  }
  const walker = owner.createTreeWalker(root, SHOW_TEXT);
  walker.currentNode = first;
  let node: Node | null = first.nodeType === TEXT_NODE ? first : walker.nextNode();
  while (node) {
    // The text from here on starts past the range's end.
    if (range.comparePoint(node, 0) > 0) break;
    if (range.intersectsNode(node)) add(node as Text);
    walker.currentNode = node;
    node = walker.nextNode();
  }
  return out;
}

/** The mark's colour, or the default when it carries none this view can paint. */
export function colorOf(ann: Annotation): string {
  const color = ann.color;
  return typeof color === "string" && /^#[0-9a-fA-F]{6}$/.test(color) ? color : DEFAULT_MARK_COLOR;
}

// The same violet the PDF side paints an AI-cited quote in
// (reading/engine/EmbedPdfView.tsx), at the same opacity.
const QUOTE_COLOR = "#4a3a9e";
const QUOTE_OPACITY = "0.24";

export interface MarkPainter {
  /** The named sublayer of an overlay, created on first use. */
  sublayer(overlay: HTMLElement, name: string): HTMLElement;
  rectDiv(r: PageRect, css: string): HTMLElement;
  drawStroke(into: HTMLElement, kind: "highlight" | "underline", rects: PageRect[], color: string): void;
  /** The one selected mark's outline. The shell selects at most one at a time. */
  drawSelection(into: HTMLElement, rects: PageRect[], color: string): void;
  /** The band over a passage the AI cited. Not a mark: nothing is written for it. */
  drawQuote(into: HTMLElement, rects: PageRect[]): void;
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

    // Both translucent paints go through lineBands: one line set in several
    // text nodes (a word in an <em>) comes as several boxes, painted once.
    drawStroke(into, kind, rects, color) {
      for (const r of lineBands(rects)) {
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

    drawQuote(into, rects) {
      for (const r of lineBands(rects)) into.append(rectDiv(r, `background:${QUOTE_COLOR};opacity:${QUOTE_OPACITY};border-radius:2px;`));
    },
  };
}
