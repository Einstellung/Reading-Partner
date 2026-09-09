// One sheet on the desk (docs/63). A page card is the EPUB counterpart of a
// PDF page box: paper-coloured, shadowed, PAGE_WIDTH by PAGE_HEIGHT in unscaled
// units, scaled as a whole by a transform. Inside, a shadow root holds the
// spine document laid out in columns (page-mount.ts), translated so that the
// column this page is on shows through the clip.
//
// Which column is found from the page's own start CFI, resolved in this card's
// tree and located in this card's layout — not from the page's ordinal. On the
// device that cut the table the two agree; on a device whose layout drifted a
// line, the page still begins where the table says it begins, and the sheet
// clips whatever runs past its foot.
//
// The card also carries what the annotation layer will hang on: an overlay in
// page coordinates, and the two conversions between the page's unscaled
// coordinates and the viewport's.

import { parseCfiStart, parseEpubRangeCfi, rangeToCfi, resolvePoint, resolveRange } from "./cfi";
import { PAGE_FRAME } from "../engine/page-frame";
import { BODY_WIDTH, PAGE_HEIGHT, PAGE_WIDTH, columnOf } from "./page-geometry";
import { mountDocument, type MountedDocument, type PageResources } from "./page-mount";
import type { SpineDocument } from "./parse";

export interface PagePoint2 {
  x: number;
  y: number;
}

export interface PageCard {
  /** The sheet: what the desk positions and scales. */
  el: HTMLElement;
  shadow: ShadowRoot;
  /** The document currently on the sheet, and what was mounted for it. */
  spine: number | null;
  mounted: MountedDocument | null;
  /** The overlay in page coordinates, for marks and the quote highlight. */
  overlay: HTMLElement | null;
  /** Put a page on the sheet: the document, and the CFI the page begins at. */
  show(doc: SpineDocument, startCfi: string, ordinal: number): Promise<void>;
  clear(): void;
  setScale(scale: number): void;
  /** Viewport coordinates of a point in unscaled page space. */
  toViewport(p: PagePoint2): PagePoint2;
  /** Unscaled page coordinates of a viewport point. */
  fromViewport(p: PagePoint2): PagePoint2;
  /** A live Range for a range CFI in this card's tree, or null. */
  rangeOf(cfi: string): Range | null;
  /** A range CFI for a live Range in this card's tree, or null. */
  cfiOf(range: Range): string | null;
  /** Page-space rects of a live Range, clipped to nothing: the caller clips. */
  rectsOf(range: Range): DOMRect[];
}

export function createPageCard(owner: Document, resources: PageResources): PageCard {
  const el = owner.createElement("div");
  el.className = "rp-page";
  el.style.cssText = [
    `width:${PAGE_WIDTH}px`,
    `height:${PAGE_HEIGHT}px`,
    "position:absolute",
    "left:0",
    "top:0",
    "transform-origin:0 0",
    `background:${PAGE_FRAME.pageBackground}`,
    `box-shadow:${PAGE_FRAME.pageEdge}`,
    "overflow:hidden",
    "contain:paint",
  ].join(";");
  const shadow = el.attachShadow({ mode: "open" });
  let scale = 1;
  let doc: SpineDocument | null = null;

  const card: PageCard = {
    el,
    shadow,
    spine: null,
    mounted: null,
    overlay: null,

    async show(next, startCfi, ordinal) {
      if (doc !== next) {
        doc = next;
        card.spine = next.index;
        card.mounted = mountDocument(shadow, next, resources);
        card.overlay = card.mounted.overlay;
        await card.mounted.ready;
      }
      const m = card.mounted;
      if (!m) return;
      const column = columnOfCfi(m, startCfi) ?? ordinal;
      m.columns.style.transform = `translateX(${-column * BODY_WIDTH}px)`;
    },

    clear() {
      doc = null;
      card.spine = null;
      card.mounted = null;
      card.overlay = null;
      shadow.replaceChildren();
    },

    setScale(s) {
      scale = s;
      el.style.transform = `scale(${s})`;
    },

    toViewport(p) {
      const box = el.getBoundingClientRect();
      return { x: box.left + p.x * scale, y: box.top + p.y * scale };
    },

    fromViewport(p) {
      const box = el.getBoundingClientRect();
      return { x: (p.x - box.left) / scale, y: (p.y - box.top) / scale };
    },

    rangeOf(cfi) {
      const m = card.mounted;
      if (!m) return null;
      const parsed = parseEpubRangeCfi(cfi);
      if (parsed) return resolveRange(m.root, parsed);
      const point = parseCfiStart(cfi);
      if (!point) return null;
      const at = resolvePoint(m.root, point);
      if (!at) return null;
      const range = owner.createRange();
      range.setStart(at.node, at.offset);
      range.collapse(true);
      return range;
    },

    cfiOf(range) {
      return doc ? rangeToCfi(range, doc.index, doc.idref) : null;
    },

    rectsOf(range) {
      const box = el.getBoundingClientRect();
      return Array.from(range.getClientRects()).map(
        (r) => new DOMRect((r.left - box.left) / scale, (r.top - box.top) / scale, r.width / scale, r.height / scale),
      );
    },
  };
  return card;
}

// The column a page's start lands in, in this card's own layout. Measured with
// the columns box untransformed, so the answer is a column index and not one
// shifted by whatever page the card showed before.
function columnOfCfi(m: MountedDocument, cfi: string): number | null {
  const parsed = parseCfiStart(cfi);
  if (!parsed) return null;
  const at = resolvePoint(m.root, parsed);
  if (!at) return null;
  const previous = m.columns.style.transform;
  m.columns.style.transform = "none";
  try {
    const origin = m.columns.getBoundingClientRect().left;
    const owner = m.root.ownerDocument;
    const range = owner.createRange();
    if (at.node.nodeType === 3) {
      const text = at.node as Text;
      range.setStart(text, at.offset);
      range.setEnd(text, Math.min(text.data.length, at.offset + 1));
    } else {
      range.selectNode(at.node);
    }
    for (const r of Array.from(range.getClientRects())) {
      if (r.width > 0 || r.height > 0) return columnOf(r.left - origin, BODY_WIDTH);
    }
    const box = range.getBoundingClientRect();
    return box.width > 0 || box.height > 0 ? columnOf(box.left - origin, BODY_WIDTH) : null;
  } finally {
    m.columns.style.transform = previous;
  }
}
