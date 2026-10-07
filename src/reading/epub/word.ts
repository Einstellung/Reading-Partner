// The word a hold begins with and the span a drag grows from it (docs/82).
// Shared by every EPUB surface a finger selects on: the phone's column
// (flow/flow-marks.ts) and the iPad's sheets (paged/mark-layer.ts).

import { rangeBetween, type CaretPoint } from "./caret";

const WORD_BREAK = /\s/;
// CJK and other scripts written without spaces: one character is the unit, or a
// hold would take the whole paragraph.
const UNSPACED = /[\u2E80-\u2FFF\u3000-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF]/;

/**
 * The word around an offset in a text node, as the span a hold begins with:
 * back to the whitespace before it and on to the whitespace after. On a space
 * the word before it; in a script written without spaces, one character.
 */
export function wordBoundsAt(text: string, offset: number): { start: number; end: number } {
  const at = Math.max(0, Math.min(offset, text.length));
  if (at < text.length && UNSPACED.test(text[at])) return { start: at, end: at + 1 };
  let anchor = at;
  if (at === text.length || WORD_BREAK.test(text[at])) {
    if (at === 0 || WORD_BREAK.test(text[at - 1])) return { start: at, end: at };
    anchor = at - 1;
    if (UNSPACED.test(text[anchor])) return { start: anchor, end: at };
  }
  const inWord = (c: string) => !WORD_BREAK.test(c) && !UNSPACED.test(c);
  let start = anchor;
  let end = anchor;
  while (start > 0 && inWord(text[start - 1])) start--;
  while (end < text.length && inWord(text[end])) end++;
  return { start, end };
}

/** A held word, as the two caret points around it. */
export interface HeldWord {
  start: CaretPoint;
  end: CaretPoint;
}

export function wordOf(caret: CaretPoint): HeldWord {
  const w = wordBoundsAt(caret.node.data, caret.offset);
  return { start: { node: caret.node, offset: w.start }, end: { node: caret.node, offset: w.end } };
}

/**
 * The selection from the word a hold began on to the word under a point, in
 * whichever direction the point is: the far edge of each word, so a drag never
 * cuts one.
 */
export function spanTo(owner: Document, from: HeldWord, to: CaretPoint): Range | null {
  const target = wordOf(to);
  const probe = owner.createRange();
  try {
    probe.setStart(from.start.node, from.start.offset);
    probe.collapse(true);
    if (probe.comparePoint(to.node, to.offset) < 0) return rangeBetween(owner, target.start, from.end);
  } catch {
    return null;
  }
  return rangeBetween(owner, from.start, target.end);
}

/**
 * A handle was dragged: that end of the selection follows the caret to the
 * edge of the word under it, growing from the end that stays the way a drag
 * grows from the held word. Null when the end that stays is not in text.
 */
export function movedEnd(owner: Document, range: Range, end: "start" | "end", caret: CaretPoint): Range | null {
  const node = end === "start" ? range.endContainer : range.startContainer;
  if (node.nodeType !== Node.TEXT_NODE) return null;
  const at: CaretPoint = { node: node as Text, offset: end === "start" ? range.endOffset : range.startOffset };
  return spanTo(owner, { start: at, end: at }, caret);
}
