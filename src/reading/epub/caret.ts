// Where in the book's text a pointer is, inside a page card's shadow root.
//
// A drag with a pen in hand is not a native selection: the reading surface has
// `user-select: none` on it (docs/pitfall/49, 262), and the marks are painted
// by this app rather than by the browser. So the two ends of a stroke are
// resolved here, from viewport coordinates to a text node and a character
// offset, and the Range between them is built by hand.
//
// `caretRangeFromPoint` is the engine's own answer and is used when it reaches
// into the shadow root. Measured on WebKitGTK: ShadowRoot does not carry it at
// all, and the one on Document does resolve past a shadow host — so the two are
// tried in that order and every answer is checked to be inside the card's own
// content root, a range that stopped at the host being no answer.
//
// Behind them is a measuring fallback: the text node nearest the point, then a
// binary search over the caret boxes inside it. It is not dead weight — no
// engine is promised to have either method, and iOS has not been measured. Both
// paths were driven over the same words on the same sheet and wrote the same
// range CFI, character for character. The search is logarithmic because it runs
// on every move of a live drag.

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
  let el = shadow.elementFromPoint(clientX, clientY);
  while (el && !inside(root, el)) el = el.parentElement;
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
  return { node: best.node, offset: offsetInText(range, best.node, clientX, clientY) };
}

function caretRect(range: Range, text: Text, offset: number): DOMRect {
  range.setStart(text, offset);
  range.collapse(true);
  const own = range.getBoundingClientRect();
  if (own.width > 0 || own.height > 0) return own;
  // A collapsed range can report nothing at a line break; the character beside
  // the boundary always has a box.
  const at = Math.max(0, Math.min(text.data.length - 1, offset > 0 ? offset - 1 : 0));
  range.setStart(text, at);
  range.setEnd(text, at + 1);
  return range.getBoundingClientRect();
}

/** Whether a caret box sits before a point in reading order. */
function beforePoint(r: DOMRect, x: number, y: number): boolean {
  if (y > r.bottom) return true; // the point is on a later line
  if (y < r.top) return false; // the point is on an earlier line
  return r.left < x;
}

/**
 * The character boundary of one text node nearest a viewport point, by binary
 * search over its caret boxes.
 */
function offsetInText(range: Range, text: Text, clientX: number, clientY: number): number {
  const length = text.data.length;
  let low = 0;
  let high = length;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if (beforePoint(caretRect(range, text, mid), clientX, clientY)) low = mid;
    else high = mid - 1;
  }
  if (low >= length) return length;
  // Between two boundaries: the nearer one, so a stroke that ends past the
  // middle of a glyph takes that glyph in.
  const here = caretRect(range, text, low);
  const next = caretRect(range, text, low + 1);
  const sameLine = Math.abs(next.top - here.top) <= LINE_SLACK;
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
