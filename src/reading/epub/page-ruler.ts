// The webview as a ruler: lay a spine document out on the paper and say where
// each page begins (docs/64). This is the one place the pagination touches
// layout; paginate.ts turns the answers into the table and never sees a pixel.
//
// The document goes into an off-screen page card exactly as a visible card
// shows it — same shadow root, same baseline, same fonts, same resources — so
// the columns measured here are the columns the cards will show. A page begins
// at the first text character or the first picture whose box sits in a column
// no earlier atom reached; a column nothing lands in (a forced break leaving a
// blank) is not a page.
//
// Text is measured with Ranges: a text node's client rects say which columns it
// crosses, and a binary search over character offsets finds the first character
// in each. The search is over offsets, so a node of thirty thousand characters
// costs log of that per column, not thirty thousand rect calls.

import type { PagePoint, PageRuler } from "./paginate";
import { BODY_WIDTH, columnOf } from "./page-geometry";
import { createPageResources, mountDocument, readingFontsReady, type PageResources } from "./page-mount";
import type { EpubBook } from "./parse";

// Elements that are a page's first thing when nothing textual precedes them.
const ATOMIC = new Set(["img", "svg", "hr", "video", "image"]);

interface Measure {
  /** Column of the first laid-out box of the range [o, o+n) in a text node, or -1. */
  columnAt(node: Text, offset: number): number;
  columnOfRect(rect: DOMRect): number;
}

function measurer(originLeft: number, owner: Document): Measure {
  const range = owner.createRange();
  return {
    columnOfRect: (rect) => columnOf(rect.left - originLeft, BODY_WIDTH),
    columnAt(node, offset) {
      const n = node.data.length;
      for (let len = 1; len <= 8 && offset + len <= n; len++) {
        range.setStart(node, offset);
        range.setEnd(node, offset + len);
        for (const r of Array.from(range.getClientRects())) {
          if (r.width > 0 || r.height > 0) return columnOf(r.left - originLeft, BODY_WIDTH);
        }
      }
      return -1;
    },
  };
}

/** The smallest offset in [lo, hi] whose column is at least `col`. */
function firstOffsetInColumn(m: Measure, node: Text, col: number, lo: number, hi: number): number {
  let a = lo;
  let b = hi;
  while (a < b) {
    const mid = (a + b) >> 1;
    const c = m.columnAt(node, mid);
    if (c >= col) b = mid;
    else a = mid + 1;
  }
  return a;
}

export function measurePages(root: Element, columns: HTMLElement): PagePoint[] {
  const owner = root.ownerDocument;
  const origin = columns.getBoundingClientRect().left;
  const m = measurer(origin, owner);
  const body = root.getElementsByTagName("body")[0] ?? root;
  const walker = owner.createTreeWalker(body, 0x1 | 0x4);
  const points: PagePoint[] = [];
  let lastCol = 0;
  const range = owner.createRange();
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.nodeType === 3) {
      const text = node as Text;
      if (text.data.trim() === "") continue;
      range.selectNodeContents(text);
      const rects = Array.from(range.getClientRects()).filter((r) => r.width > 0 || r.height > 0);
      if (rects.length === 0) continue;
      const first = m.columnOfRect(rects[0]);
      let last = first;
      for (const r of rects) last = Math.max(last, m.columnOfRect(r));
      if (first > lastCol) {
        points.push({ node: text, offset: firstOffsetInColumn(m, text, first, 0, text.data.length - 1) });
        lastCol = first;
      }
      for (let col = lastCol + 1; col <= last; col++) {
        const offset = firstOffsetInColumn(m, text, col, 0, text.data.length - 1);
        points.push({ node: text, offset });
        lastCol = col;
      }
      continue;
    }
    const el = node as Element;
    if (!ATOMIC.has(el.localName.toLowerCase())) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 && rect.height <= 0) continue;
    const col = m.columnOfRect(rect);
    if (col > lastCol) {
      points.push({ node: el, offset: null });
      lastCol = col;
    }
  }
  return points;
}

/**
 * A ruler over a real layout. The card is mounted off-screen in `host` — an
 * element in the app's document, so the shadow root inherits nothing and the
 * fonts are the app's — and removed after each document.
 */
export function createLayoutRuler(host: HTMLElement, book: EpubBook): PageRuler & { dispose(): void } {
  const resources: PageResources & { revoke(): void } = createPageResources(book.zip);
  const owner = host.ownerDocument;
  const ruler: PageRuler = async (doc) => {
    await readingFontsReady();
    const card = owner.createElement("div");
    card.style.cssText =
      "position:absolute;left:-20000px;top:0;width:576px;height:864px;visibility:hidden;contain:strict;";
    host.append(card);
    try {
      const mounted = mountDocument(card.attachShadow({ mode: "open" }), doc, resources);
      await mounted.ready;
      return measurePages(mounted.root, mounted.columns);
    } finally {
      card.remove();
    }
  };
  return Object.assign(ruler, { dispose: () => resources.revoke() });
}
