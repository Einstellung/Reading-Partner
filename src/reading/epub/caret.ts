// Where in the book's text a pointer is, inside a page card's shadow root.
//
// A drag with a pen in hand is not a native selection: the reading surface has
// `user-select: none` on it (docs/pitfall/49, 262), and the marks are painted
// by this app rather than by the browser. So the two ends of a stroke are
// resolved here, from viewport coordinates to a text node and a character
// offset, and the Range between them is built by hand.
//
// `caretRangeFromPoint` is the engine's own answer and is used when it reaches
// into the shadow root. ShadowRoot does not carry it on WebKit, and the one on
// Document stops at the shadow host in WKWebView and in WebKitGTK 2.52 alike
// (docs/pitfall/278, 442). Both are still tried, and every answer is checked to
// be inside the card's own content root, a range that stopped at the host being
// no answer.
//
// Behind them is a measuring fallback: the text node nearest the point, then a
// binary search over the caret boxes inside it. On iOS and on the Linux desktop
// it is the path that runs (docs/pitfall/435, 442). The search is logarithmic because it runs
// on every move of a live drag, and it orders the boxes by the node's own line
// boxes, because a document laid out as columns puts later text higher up.

export interface CaretPoint {
  node: Text;
  offset: number;
}

type CaretCapable = { caretRangeFromPoint?: (x: number, y: number) => Range | null };

function inside(root: Element, node: Node | null): boolean {
  return !!node && (node === root || root.contains(node));
}

function asCaret(root: Element, range: Range | null): CaretPoint | null {
  if (!range) return null;
  const node = range.startContainer;
  if (node.nodeType === 3 && inside(root, node)) {
    return { node: node as Text, offset: range.startOffset };
  }
  return null;
}

/**
 * The caret at a viewport point in a card's tree, or null when the point is on
 * nothing the reader could have meant.
 */
export function caretAtPoint(
  shadow: ShadowRoot,
  root: Element,
  clientX: number,
  clientY: number,
): CaretPoint | null {
  const native = (shadow as unknown as CaretCapable).caretRangeFromPoint;
  if (typeof native === "function") {
    const hit = asCaret(root, native.call(shadow, clientX, clientY));
    if (hit) return hit;
  }
  const owner = root.ownerDocument;
  const fromDocument = (owner as unknown as CaretCapable | null)?.caretRangeFromPoint;
  if (typeof fromDocument === "function") {
    const hit = asCaret(root, fromDocument.call(owner, clientX, clientY));
    if (hit) return hit;
  }
  return searchForCaret(shadow, root, clientX, clientY);
}

/** How far outside its box a point may be and still be read as on that line. */
const LINE_SLACK = 4;

function distanceTo(rects: readonly DOMRect[], x: number, y: number): number | null {
  let best: number | null = null;
  for (const r of rects) {
    if (r.width === 0 && r.height === 0) continue;
    const dx = x < r.left ? r.left - x : x > r.right ? x - r.right : 0;
    const dy = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0;
    const d = dx * dx + dy * dy;
    if (best === null || d < best) best = d;
  }
  return best;
}

/**
 * The caret found by measuring. Two passes: the text node whose boxes come
 * nearest the point, then the character boundary inside it.
 */
function searchForCaret(shadow: ShadowRoot, root: Element, clientX: number, clientY: number): CaretPoint | null {
  // The book's topmost element under the point, looked for through whatever
  // the shell lays over the page (Lumen in its corner): a stroke that runs
  // under it still reaches the words there.
  const el = shadow.elementsFromPoint(clientX, clientY).find((e) => inside(root, e));
  // Nothing of the book under the point: the sheet's margin, or its paper.
  if (!el) return null;
  const owner = root.ownerDocument;
  if (!owner) return null;
  const range = owner.createRange();
  const walker = owner.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let best: { node: Text; distance: number } | null = null;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node as Text;
    if (text.data.length === 0) continue;
    range.selectNodeContents(text);
    const distance = distanceTo(Array.from(range.getClientRects()), clientX, clientY);
    if (distance === null) continue;
    if (!best || distance < best.distance) best = { node: text, distance };
    if (distance === 0) break;
  }
  if (!best) return null;
  range.selectNodeContents(best.node);
  const lines = Array.from(range.getClientRects()).filter((r) => r.width > 0 || r.height > 0);
  const text = best.node;
  const offset = nearestOffset(text.data.length, (i) => caretRect(range, text, i), lines, clientX, clientY);
  return { node: text, offset };
}

// The box of the boundary before a character, read off that character's own
// box: its left edge, or the last character's right edge at the node's end. A
// collapsed range is not measured, because inside CSS columns WebKit places it
// as if the columns were one (docs/pitfall/436).
function caretRect(range: Range, text: Text, offset: number): Box {
  const length = text.data.length;
  for (let at = Math.min(offset, length - 1); at >= 0; at--) {
    range.setStart(text, at);
    range.setEnd(text, at + 1);
    const r = range.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    const x = at === offset ? r.left : r.right;
    return { left: x, right: x, top: r.top, bottom: r.bottom };
  }
  return { left: 0, right: 0, top: 0, bottom: 0 };
}

export interface Box {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/**
 * Which of a text node's line boxes a box is on: the one holding its middle;
 * else, of the lines at its height, the nearest; else the nearest of all. The
 * line boxes come in document order, so a line's index is its place in
 * reading order. Comparing heights alone is not: in a paged document laid out
 * as CSS columns, the top line of one column is read after the bottom line of
 * the column before it. A point past the end of a paragraph's short last line
 * is on that line, however far along: the full line above is nearer in a
 * straight line but not at the point's height.
 */
export function lineOf(lines: readonly Box[], r: Box): number {
  const cx = (r.left + r.right) / 2;
  const cy = (r.top + r.bottom) / 2;
  let best = 0;
  let bestLevel = false;
  let bestDistance = Infinity;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const dx = cx < l.left ? l.left - cx : cx > l.right ? cx - l.right : 0;
    const dy = cy < l.top - LINE_SLACK ? l.top - cy : cy > l.bottom + LINE_SLACK ? cy - l.bottom : 0;
    const d = dx * dx + dy * dy;
    if (d === 0) return i;
    const level = dy === 0;
    if ((level && !bestLevel) || (level === bestLevel && d < bestDistance)) {
      best = i;
      bestLevel = level;
      bestDistance = d;
    }
  }
  return best;
}

/**
 * The character boundary of one text node nearest a viewport point, by binary
 * search over its caret boxes. `caretBox(i)` is the box of boundary i; `lines`
 * are the node's line boxes in document order (Range.getClientRects), which is
 * what puts the boxes in reading order. With no line boxes the order falls
 * back to top-to-bottom, left-to-right.
 */
export function nearestOffset(
  length: number,
  caretBox: (offset: number) => Box,
  lines: readonly Box[],
  clientX: number,
  clientY: number,
): number {
  const point = { left: clientX, right: clientX, top: clientY, bottom: clientY };
  const pointLine = lines.length > 0 ? lineOf(lines, point) : 0;
  const before = (r: Box): boolean => {
    if (lines.length > 0) {
      const line = lineOf(lines, r);
      if (line !== pointLine) return line < pointLine;
    } else {
      if (clientY > r.bottom) return true; // the point is on a later line
      if (clientY < r.top) return false; // the point is on an earlier line
    }
    return r.left < clientX;
  };
  let low = 0;
  let high = length;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if (before(caretBox(mid))) low = mid;
    else high = mid - 1;
  }
  if (low >= length) return length;
  // Between two boundaries: the nearer one, so a stroke that ends past the
  // middle of a glyph takes that glyph in.
  const here = caretBox(low);
  const next = caretBox(low + 1);
  const sameLine =
    lines.length > 0 ? lineOf(lines, next) === lineOf(lines, here) : Math.abs(next.top - here.top) <= LINE_SLACK;
  if (!sameLine) return low;
  return Math.abs(clientX - next.left) < Math.abs(clientX - here.left) ? low + 1 : low;
}

/**
 * A Range between two carets in the same tree, in document order whichever way
 * the pen went. Null when the two are the same place.
 */
export function rangeBetween(owner: Document, a: CaretPoint, b: CaretPoint): Range | null {
  const range = owner.createRange();
  try {
    range.setStart(a.node, a.offset);
    range.setEnd(a.node, a.offset);
    const backwards = range.comparePoint(b.node, b.offset) < 0;
    if (backwards) range.setStart(b.node, b.offset);
    else range.setEnd(b.node, b.offset);
  } catch {
    return null;
  }
  return range.collapsed ? null : range;
}
