// How wide a label is, without a DOM.
//
// A box has to be sized before it can be placed, and layout runs in a pure
// module with unit tests and (later) in a deck export that never mounts. So the
// width is estimated from the characters rather than measured, the way docs/32
// said it would have to be. The estimate is deliberately generous: every value
// below is at or above what the browser actually reports, and SAFETY adds a
// little more on top. Over-estimating costs a few roomy pixels; under-estimating
// puts "多头注意力机制" through the side of its box, which is the one failure
// this whole approach has to not have.
//
// Calibrated against Chrome's canvas measureText on the stack in FONT_STACK at
// 12.5px, over a corpus of Chinese, English and mixed labels: the estimate ran
// 1.00-1.19x the measured width, never under. See tests/reading/diagrams/text.test.ts.

// The one font stack the estimate is calibrated for. svg.ts sets exactly this on
// every <text> it emits — if the drawing used a different font the numbers below
// would be measuring nothing.
export const FONT_STACK =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";

// Extra width kept over the estimate, for the hinting and the fallback font a
// device may substitute for a glyph the stack does not have.
const SAFETY = 1.04;

// Advance widths as a fraction of the font size, per character. These are
// Helvetica/Arial's own metrics, which Liberation Sans matches exactly and the
// other fonts in the stack sit at or under — so the table is an upper bound on
// every platform the app runs on, before SAFETY is even applied.
//
// A table rather than three width buckets, because the buckets got it wrong in
// both directions at once: "W" is 0.944em and "i" is 0.222em, and any single
// number for "uppercase" is over one and under the other. The measured failure
// was "Q" (0.778em) estimated at 0.63em — narrower than the glyph, which is the
// one direction this must never go.
const LATIN: Record<string, number> = {
  " ": 0.278, "!": 0.278, '"': 0.355, "#": 0.556, $: 0.556, "%": 0.889, "&": 0.667,
  "'": 0.191, "(": 0.333, ")": 0.333, "*": 0.389, "+": 0.584, ",": 0.278, "-": 0.333,
  ".": 0.278, "/": 0.278, "0": 0.556, "1": 0.556, "2": 0.556, "3": 0.556, "4": 0.556,
  "5": 0.556, "6": 0.556, "7": 0.556, "8": 0.556, "9": 0.556, ":": 0.278, ";": 0.278,
  "<": 0.584, "=": 0.584, ">": 0.584, "?": 0.556, "@": 1.015,
  A: 0.667, B: 0.667, C: 0.722, D: 0.722, E: 0.667, F: 0.611, G: 0.778, H: 0.722,
  I: 0.278, J: 0.5, K: 0.667, L: 0.556, M: 0.833, N: 0.722, O: 0.778, P: 0.667,
  Q: 0.778, R: 0.722, S: 0.667, T: 0.611, U: 0.722, V: 0.667, W: 0.944, X: 0.667,
  Y: 0.667, Z: 0.611,
  "[": 0.278, "\\": 0.278, "]": 0.278, "^": 0.469, _: 0.556, "`": 0.333,
  a: 0.556, b: 0.556, c: 0.5, d: 0.556, e: 0.556, f: 0.278, g: 0.556, h: 0.556,
  i: 0.222, j: 0.222, k: 0.5, l: 0.222, m: 0.833, n: 0.556, o: 0.556, p: 0.556,
  q: 0.556, r: 0.333, s: 0.5, t: 0.278, u: 0.556, v: 0.5, w: 0.722, x: 0.5,
  y: 0.5, z: 0.5, "{": 0.334, "|": 0.26, "}": 0.334, "~": 0.584,
};

// Anything full-width is one em by definition. Anything latin-ish the table does
// not name (a Greek letter, an arrow, a dash) gets the widest lowercase advance
// rather than an average, so an unnamed glyph errs roomy.
const W_FULL = 1.0;
const W_UNKNOWN = 0.833;

// Full-width by rendering, not by Unicode category: the CJK ideograph blocks,
// kana, hangul, the CJK punctuation that sits on its own em, and the fullwidth
// forms. Anything in here is one em wide and may be broken before or after.
export function isFullWidth(ch: string): boolean {
  const c = ch.codePointAt(0) ?? 0;
  return (
    (c >= 0x1100 && c <= 0x115f) || // hangul jamo
    (c >= 0x2e80 && c <= 0x303e) || // CJK radicals, kangxi, CJK punctuation
    (c >= 0x3041 && c <= 0x33ff) || // kana, hangul compat, CJK compat
    (c >= 0x3400 && c <= 0x4dbf) || // extension A
    (c >= 0x4e00 && c <= 0x9fff) || // unified ideographs
    (c >= 0xa000 && c <= 0xa4cf) || // yi
    (c >= 0xac00 && c <= 0xd7a3) || // hangul syllables
    (c >= 0xf900 && c <= 0xfaff) || // compat ideographs
    (c >= 0xfe30 && c <= 0xfe4f) || // CJK compat forms
    (c >= 0xff00 && c <= 0xff60) || // fullwidth forms
    (c >= 0xffe0 && c <= 0xffe6) ||
    (c >= 0x20000 && c <= 0x3fffd) // extensions B+
  );
}

function charWidth(ch: string): number {
  if (isFullWidth(ch)) return W_FULL;
  return LATIN[ch] ?? W_UNKNOWN;
}

// The rendered width of one line, in px. Never below the browser's own answer.
export function measureLine(text: string, fontSize: number): number {
  let em = 0;
  for (const ch of text) em += charWidth(ch);
  return em * fontSize * SAFETY;
}

// --- line breaking ---------------------------------------------------------
//
// Latin breaks at spaces; CJK breaks between any two characters. The two rules
// meet in the same label often enough ("Multi-Head 注意力") that they are one
// pass rather than two code paths.

// Punctuation that may not start a line (CJK line-breaking rule). Breaking
// before one of these puts a full stop at the head of a line, which reads as a
// typo rather than as a wrap.
const NO_LINE_START = new Set("。，、．：；！？）〕］｝》」』〉”’%…—～!?,.:;)]}>");
// Punctuation that may not end a line.
const NO_LINE_END = new Set("（〔［｛《「『〈“‘([{<");

// Whether a line may break between `prev` and `next`.
function canBreakBetween(prev: string, next: string): boolean {
  if (next === " ") return false;
  if (prev === " ") return true;
  if (NO_LINE_START.has(next)) return false;
  if (NO_LINE_END.has(prev)) return false;
  // A CJK character on either side is a break opportunity.
  if (isFullWidth(prev) || isFullWidth(next)) return true;
  // Latin: after a hyphen or a slash inside a word.
  if (prev === "-" || prev === "/") return true;
  return false;
}

export interface WrapOptions {
  fontSize: number;
  // The width the text may not exceed, in px.
  maxWidth: number;
  // Lines past this are dropped and the last one gets an ellipsis. A label that
  // needs five lines is prose and belongs in a note, not in a box.
  maxLines?: number;
}

export interface WrappedText {
  lines: string[];
  // The widest line, in px. What the box is sized from.
  width: number;
}

// Break `text` into lines that each fit `maxWidth`. A single character wider
// than maxWidth still gets its own line — the box grows instead of the glyph
// being cut, because a clipped glyph is the failure this is here to avoid.
export function wrapText(text: string, opts: WrapOptions): WrappedText {
  const { fontSize, maxWidth } = opts;
  const maxLines = opts.maxLines ?? 3;
  const chars = [...text.trim().replace(/\s+/g, " ")];
  if (chars.length === 0) return { lines: [], width: 0 };

  const lines: string[] = [];
  let line = "";
  // The last index in `line` where a break was allowed, so an over-long line can
  // be backed up to it instead of broken mid-word.
  let lastBreak = -1;

  const flush = (upTo: number) => {
    lines.push(line.slice(0, upTo).trimEnd());
  };

  for (const ch of chars) {
    const next = line + ch;
    if (line !== "" && measureLine(next, fontSize) > maxWidth) {
      if (lastBreak > 0) {
        const rest = line.slice(lastBreak).trimStart();
        flush(lastBreak);
        line = rest + ch;
      } else {
        flush(line.length);
        line = ch === " " ? "" : ch;
      }
      lastBreak = -1;
      continue;
    }
    if (line !== "" && canBreakBetween(line[line.length - 1], ch)) lastBreak = line.length;
    line = next;
  }
  if (line.trim() !== "") lines.push(line.trimEnd());

  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    const last = kept[maxLines - 1];
    kept[maxLines - 1] = last.length > 1 ? `${last.slice(0, -1)}…` : `${last}…`;
    return { lines: kept, width: widestLine(kept, fontSize) };
  }
  return { lines, width: widestLine(lines, fontSize) };
}

function widestLine(lines: string[], fontSize: number): number {
  let w = 0;
  for (const l of lines) w = Math.max(w, measureLine(l, fontSize));
  return w;
}
