// Marks drawn on an AI reply, in the DOM (docs/09). The pure half — which words
// a mark names and where they sit in a rendering — is reading/chat-marks.ts;
// this is the part that has to touch nodes: reading the rendering off the
// element the reader dragged over, turning an offset back into a Range, and the
// boxes that Range paints as.
//
// The rendering is read here and nowhere else, so the string a mark is anchored
// against when it is drawn and the string it is looked up in when it is redrawn
// are produced by the same walk. Selection.toString() is not that string — it
// puts a newline between block elements — and an anchor taken from it would not
// be findable in this one.

import type { MarkPen } from "../../../platform/app/reader-contract";
import type { ChatMarkSpan } from "../../../reading/chat-marks";

// A text node and where its characters start in the rendering.
export interface TextRun {
  node: Text;
  at: number;
}

export interface RenderedText {
  text: string;
  runs: TextRun[];
  // Offsets in `text` where one block's words end and the next block's begin —
  // the seams the walk left nothing at. Ascending, and never 0 or text.length.
  breaks: number[];
}

const TEXT_NODE = 3;
const ELEMENT_NODE = 1;

// The tags that end a line of reading. A rendered reply is Markdown, so this is
// what react-markdown emits, not the whole of HTML; anything not named here is
// inline and its words run on. Tag names rather than computed style because a
// headless DOM lays nothing out and would report every element the same.
const SEPARATES = new Set([
  "P", "DIV", "BR", "HR", "LI", "UL", "OL", "DL", "DT", "DD",
  "BLOCKQUOTE", "PRE", "TABLE", "THEAD", "TBODY", "TR", "TD", "TH",
  "H1", "H2", "H3", "H4", "H5", "H6",
  "SECTION", "ARTICLE", "HEADER", "FOOTER", "FIGURE", "FIGCAPTION", "ASIDE",
]);

// The words of a rendered reply, in document order, with the map back to the
// nodes they came from, and where the blocks met. Empty text nodes are left
// out: they carry no position a reader can select and would make two runs share
// one offset.
//
// Nothing is inserted between blocks — an offset in this string has to name the
// same characters when the mark is drawn and when it is drawn again, so the walk
// stays lossless and reports the seams instead (spacedSlice).
export function indexRendered(root: Node | null | undefined): RenderedText {
  const runs: TextRun[] = [];
  const breaks: number[] = [];
  let text = "";
  let seam = false;
  const walk = (node: Node): void => {
    if (node.nodeType === TEXT_NODE) {
      const value = (node as Text).data;
      if (value === "") return;
      if (seam && text !== "") breaks.push(text.length);
      seam = false;
      runs.push({ node: node as Text, at: text.length });
      text += value;
      return;
    }
    if (node.nodeType !== ELEMENT_NODE) return;
    const block = SEPARATES.has((node as Element).tagName);
    if (block) seam = true;
    for (const child of Array.from(node.childNodes)) walk(child);
    if (block) seam = true;
  };
  if (root) walk(root);
  return { text, runs, breaks };
}

// The same words as a person reads them: the slice, with a space where a block
// ended inside it. The anchor string glues "the model." to "The next step" —
// deliberately, because both directions of a mark are the one walk — and that
// string must not be the one shown in the trace list, handed to read_annotations
// or replayed to the model.
//
// A seam the rendering already has whitespace on either side of is left alone:
// the gap is there, and a second space would be one the reply never had.
export function spacedSlice(
  index: Pick<RenderedText, "text" | "breaks">,
  start: number,
  end: number,
): string {
  let out = "";
  let at = start;
  for (const seam of index.breaks) {
    if (seam <= start || seam >= end) continue;
    if (/\s/.test(index.text[seam - 1] ?? "") || /\s/.test(index.text[seam] ?? "")) continue;
    out += `${index.text.slice(at, seam)} `;
    at = seam;
  }
  return out + index.text.slice(at, end);
}

// A DOM position as an offset into the rendering, or null when it is not in it.
//
// A Range endpoint is not always in a text node — a selection that swept a whole
// paragraph reports (element, childIndex) — so an element position is resolved
// to the first run at or after the child it names, and one past the last child
// to the end of the element's own text.
export function offsetOf(
  index: RenderedText,
  node: Node | null | undefined,
  offset: number,
): number | null {
  if (!node) return null;
  if (node.nodeType === TEXT_NODE) {
    const run = index.runs.find((r) => r.node === node);
    if (!run) return null;
    return run.at + Math.max(0, Math.min(offset, (node as Text).data.length));
  }
  if (node.nodeType !== ELEMENT_NODE) return null;
  const children = Array.from(node.childNodes);
  for (let i = Math.max(0, offset); i < children.length; i++) {
    const run = index.runs.find((r) => children[i].contains(r.node));
    if (run) return run.at;
  }
  // Past every child that holds words: the end of the last of them.
  for (let i = index.runs.length - 1; i >= 0; i--) {
    const run = index.runs[i];
    if (node.contains(run.node)) return run.at + run.node.data.length;
  }
  return null;
}

export interface DomPoint {
  node: Text;
  offset: number;
}

// The rendering's offset as a DOM position. A boundary between two runs belongs
// to the later one — that is where a Range wants to start — except at the very
// end, which has no later run.
export function pointAt(index: RenderedText, at: number): DomPoint | null {
  if (at < 0) return null;
  for (let i = 0; i < index.runs.length; i++) {
    const run = index.runs[i];
    const end = run.at + run.node.data.length;
    const last = i === index.runs.length - 1;
    if (at < end || (last && at === end)) {
      return { node: run.node, offset: Math.max(0, at - run.at) };
    }
  }
  return null;
}

// A located mark as a Range, so its client rects can be measured. Null when
// either end falls outside the rendering, which a span located against this same
// rendering never does.
export function rangeOfSpan(
  index: RenderedText,
  span: ChatMarkSpan,
  doc: Document,
): Range | null {
  const start = pointAt(index, span.start);
  const end = pointAt(index, span.end);
  if (!start || !end) return null;
  const range = doc.createRange();
  range.setStart(start.node, start.offset);
  range.setEnd(end.node, end.offset);
  return range;
}

// --- what a mark is painted as --------------------------------------------

export interface RectLike {
  left: number;
  top: number;
  width: number;
  height: number;
}

// One painted piece of a mark, in the coordinates of the element it is drawn
// over. A mark that wraps across lines is several.
export interface MarkBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

export const UNDERLINE_THICKNESS = 2;

// A Range's client rects moved into the drawing element's box. Empty rects are
// dropped: a Range that ends at a line break reports one, and it would paint a
// stray dot.
export function toBoxes(
  rects: readonly RectLike[],
  origin: { left: number; top: number },
): MarkBox[] {
  const out: MarkBox[] = [];
  for (const r of rects) {
    if (r.width <= 0 || r.height <= 0) continue;
    out.push({
      left: r.left - origin.left,
      top: r.top - origin.top,
      width: r.width,
      height: r.height,
    });
  }
  return out;
}

// The same boxes as a rule along the bottom of each line.
export function underlineBoxes(boxes: readonly MarkBox[]): MarkBox[] {
  return boxes.map((b) => ({
    left: b.left,
    top: b.top + Math.max(0, b.height - UNDERLINE_THICKNESS),
    width: b.width,
    height: UNDERLINE_THICKNESS,
  }));
}

// What a pen paints: the highlight fills the line box, the two underlines rule
// under it.
export function paintBoxes(boxes: readonly MarkBox[], pen: MarkPen): MarkBox[] {
  return pen === "highlight" ? [...boxes] : underlineBoxes(boxes);
}

// A hex color at an alpha. Anything that is not #rgb or #rrggbb is handed back
// untouched — the palette is hex (platform/app/annotations.ts) and a file synced
// from a build with a different one still has to draw something.
export function withAlpha(color: string, alpha: number): string {
  const hex = color.trim();
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(hex);
  const long = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!short && !long) return color;
  const parts = short
    ? [short[1] + short[1], short[2] + short[2], short[3] + short[3]]
    : [long![1], long![2], long![3]];
  const [r, g, b] = parts.map((p) => parseInt(p, 16));
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// A highlight sits behind the words rather than over them, so it is drawn at
// enough alpha to read as a marker and still leave the text black.
export const HIGHLIGHT_ALPHA = 0.42;

export function markFill(color: string, pen: MarkPen): string {
  return pen === "highlight" ? withAlpha(color, HIGHLIGHT_ALPHA) : color;
}

// Whether a point (in the drawing element's coordinates) is on a mark. Hit
// against the line boxes, never against the painted ones: a 2px rule is not a
// target, and the words above it are what the reader is pressing.
export function boxesHold(boxes: readonly MarkBox[], x: number, y: number): boolean {
  return boxes.some(
    (b) => x >= b.left && x <= b.left + b.width && y >= b.top && y <= b.top + b.height,
  );
}
