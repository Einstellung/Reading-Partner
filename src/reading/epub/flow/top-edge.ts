// Where the reader is in a flow column: the place under the viewport's top edge,
// as local CFI steps into one spine document. flow-view.ts supplies the probe
// points and the two hit tests; what is decided here is which answer counts.
//
// A caret is the exact answer. A picture, a rule or an empty box has no caret,
// and a probe band that lands only on one of those is still somewhere in the
// book: the element itself is the place. Without that the reader fell back to
// the first page of the spine document, so a picture book whose story is one
// document read "page 2" over every illustration, and a relayout sent it back
// to that page.

import { pointSteps, textSteps } from "../file/cfi";
import type { CaretPoint } from "../caret";

export interface TopEdgeProbe {
  /** The element at a viewport point, in the document's shadow tree. */
  hit(x: number, y: number): Element | null;
  /** The caret at a viewport point inside the document's content root. */
  caret(x: number, y: number): CaretPoint | null;
}

/**
 * Local steps for the first caret any point resolves to, in the order given;
 * failing that, for the first element of the book a point landed on. Null when
 * every point fell on the root, the body or outside the book.
 */
export function topEdgeSteps(
  root: Element,
  points: readonly { x: number; y: number }[],
  probe: TopEdgeProbe,
): string | null {
  let first: Element | null = null;
  for (const { x, y } of points) {
    const el = probe.hit(x, y);
    if (!el || el === root || el.localName === "body" || !root.contains(el)) continue;
    const caret = probe.caret(x, y);
    const local = caret ? textSteps(caret.node, caret.offset) : null;
    if (local !== null) return local;
    first ??= el;
  }
  return first ? pointSteps(first, null) : null;
}
