// The string helpers the language does not ship: trimming a snippet for a
// prompt or a line of UI, folding whitespace, escaping markup, counting things
// in English. Pure, and this file imports nothing.
//
// Several of these come in near-identical variants that are NOT
// interchangeable — a caller picked one because of where its output lands. The
// contract of each is spelled out; read it before swapping one for another.

// --- trimming ---------------------------------------------------------------

/**
 * Trim to `max` characters on a word boundary, adding an ellipsis when cut.
 * Whitespace inside the text is left alone, newlines included. The cut falls
 * back to a hard slice when the last space sits in the first 60% — a CJK
 * paragraph has no spaces at all. The ellipsis is extra, so the result can be
 * `max` + 1 characters long.
 */
export function clipWords(text: string, max: number): string {
  const t = text.trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const sp = cut.lastIndexOf(" ");
  return (sp > max * 0.6 ? cut.slice(0, sp) : cut).trimEnd() + "…";
}

/**
 * Fold to one line and cut after `max` characters, adding an ellipsis when cut.
 * The ellipsis is extra, so the result can be `max` + 1 characters long; for a
 * budget that has to include it, use `clipLineTight`.
 */
export function clipLine(text: string, max: number): string {
  const t = oneLine(text);
  return t.length <= max ? t : t.slice(0, max).trimEnd() + "…";
}

/**
 * Fold to one line, with the whole result — ellipsis included — at most `max`
 * characters. The tight form for a slot with a real width.
 */
export function clipLineTight(text: string, max: number): string {
  const t = oneLine(text);
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/** Every run of whitespace folded to a single space, and the ends trimmed. */
export function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** A sentence with no terminator in it is still a sentence; this is where it stops. */
const RUNAWAY_SENTENCE = 240;

/**
 * The first sentence of a block. Ends at the first terminator — ASCII or CJK
 * (`.!?。！？`) — that is followed by a space or by nothing, so "v1.2" and
 * "Dr. Who" do not end one; a block with no terminator at all is cut at a
 * length rather than sent whole.
 */
export function firstSentence(text: string): string {
  const at = /[.!?。！？](\s|$)/.exec(text);
  if (at) return text.slice(0, at.index + 1);
  return text.length <= RUNAWAY_SENTENCE ? text : `${text.slice(0, RUNAWAY_SENTENCE).trimEnd()}…`;
}

// --- markup -----------------------------------------------------------------

/**
 * A text node or a double-quoted attribute value in XML. Escapes the four
 * characters an XML parser reads as markup; the apostrophe is left bare, which
 * is well-formed everywhere a value is written in double quotes.
 */
export function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * A text node in serialized HTML that will be parsed again. A literal CR is
 * written as `&#13;` because the next parse's input preprocessing would
 * otherwise turn it into LF and render the same string differently
 * (docs/pitfall/127).
 */
export function escapeHtmlText(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\r/g, "&#13;");
}

/**
 * A double-quoted attribute value in serialized HTML. "&" goes first, so what
 * the next reader decodes is the value that was checked here. CR is left alone:
 * unlike in a text node, the parser normalizes it away on read either way.
 */
export function escapeHtmlAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// --- counting ---------------------------------------------------------------

/** "1 book", "2 books" — the count and its unit, pluralized the easy way. */
export function plural(n: number, unit: string): string {
  return `${n} ${unit}${n === 1 ? "" : "s"}`;
}

/** Two digits, zero-padded: the hour, minute and month of a formatted date. */
export function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * A number as `width` zero-padded digits, so the strings sort the way the
 * numbers do. Rounded and clamped at zero — the callers are sort keys built
 * from coordinates and offsets, where a negative would sort wrong anyway.
 */
export function padInt(n: number, width: number): string {
  return String(Math.max(0, Math.round(n))).padStart(width, "0");
}
