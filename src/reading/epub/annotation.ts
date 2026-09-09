// A mark on an EPUB: the shape it takes on disk, and the two ways it is found
// again. No renderer and no foliate here — a range CFI is a string, a quote is
// a string, and both halves of "where was this drawn" are decided by functions
// a unit test can call (docs/39 §5).
//
// The on-disk shape is the one Zotero writes for an EPUB annotation: `position`
// is a FragmentSelector holding a range CFI. Two fields ride beside it that
// Zotero does not have to carry, because this app counts positions the same way
// on both formats: `position.pageIndex` is the position block the mark starts
// in (0-based, exactly as a PDF mark's page is), so `annotationPage()` answers
// for an EPUB mark without knowing it is one, and `[p.N]` means the same N.
//
// The CFI is the primary anchor and the quote is the repair. A CFI addresses
// nodes by their index among their siblings, so it survives everything except a
// change to the sanitizer or to the book's own bytes — and when it does not
// survive, the words are still in the book. The quote carries its neighbours so
// a passage the book repeats is found at the copy that was marked.

import { runAt, type DocumentText } from "./text";

/** What a FragmentSelector holding an EPUB CFI declares itself to conform to. */
export const CFI_CONFORMS_TO = "http://www.idpf.org/epub/linking/cfi/epub-cfi.html";

/** How many characters of context a quote selector keeps on each side. */
export const QUOTE_CONTEXT = 32;

export interface EpubPosition {
  type: "FragmentSelector";
  conformsTo: string;
  /** A range CFI: `epubcfi(/6/8!/4/2,/1:10,/1:24)`. */
  value: string;
  /** The position block the mark starts in, 0-based (paginate.ts). */
  pageIndex: number;
}

/** The Web Annotation quote selector, kept beside the CFI as the repair. */
export interface TextQuoteSelector {
  type: "TextQuoteSelector";
  exact: string;
  prefix: string;
  suffix: string;
}

/** A span of the extracted text, half-open. */
export interface TextSpan {
  start: number;
  end: number;
}

// ------------------------------------------------------------- sort index ---

function pad(n: number, width: number): string {
  return String(Math.max(0, Math.round(n))).padStart(width, "0");
}

/**
 * The document-order key the trace list sorts on, for an EPUB: the spine item
 * and the character offset inside it, both zero-padded so the string orders the
 * way the numbers do.
 *
 * Zotero's PDF key is three fields (page, top, left) and this one is two; the
 * two are never mixed, because a book is one format for its whole life
 * (reading/engine/convert.ts: makeSortIndex).
 */
export function makeEpubSortIndex(spineIndex: number, charOffset: number): string {
  return `${pad(spineIndex, 5)}|${pad(charOffset, 7)}`;
}

// ----------------------------------------------------------------- quotes ---

/** The words at a span, with the neighbours that tell two copies of them apart. */
export function quoteSelectorAt(text: string, span: TextSpan): TextQuoteSelector {
  const start = Math.max(0, Math.min(span.start, text.length));
  const end = Math.max(start, Math.min(span.end, text.length));
  return {
    type: "TextQuoteSelector",
    exact: text.slice(start, end),
    prefix: text.slice(Math.max(0, start - QUOTE_CONTEXT), start),
    suffix: text.slice(end, Math.min(text.length, end + QUOTE_CONTEXT)),
  };
}

/** Every place a needle occurs, counted one character at a time. */
function occurrences(hay: string, needle: string): number[] {
  if (needle === "") return [];
  const out: number[] = [];
  for (let at = hay.indexOf(needle); at >= 0; at = hay.indexOf(needle, at + 1)) out.push(at);
  return out;
}

function nearest(list: number[], near: number | undefined): number | null {
  if (list.length === 0) return null;
  if (near === undefined) return list[0];
  let best = list[0];
  for (const at of list) {
    if (Math.abs(at - near) < Math.abs(best - near)) best = at;
  }
  return best;
}

/**
 * The span the quote occupies in a document's text now, or null when the words
 * are not in it any more.
 *
 * Most exact first: the passage with both neighbours, then with one, then bare.
 * The neighbours are what make a repeated sentence resolvable, so they are only
 * given up once they have failed — and when only the bare words are left, the
 * occurrence nearest `near` wins, `near` being where the mark last was.
 */
export function findQuoteSpan(
  text: string,
  quote: TextQuoteSelector,
  near?: number,
): TextSpan | null {
  const { exact, prefix, suffix } = quote;
  if (exact === "") return null;
  const withContext: Array<{ needle: string; lead: number }> = [];
  if (prefix !== "" && suffix !== "") withContext.push({ needle: prefix + exact + suffix, lead: prefix.length });
  if (prefix !== "") withContext.push({ needle: prefix + exact, lead: prefix.length });
  if (suffix !== "") withContext.push({ needle: exact + suffix, lead: 0 });
  for (const { needle, lead } of withContext) {
    const at = nearest(occurrences(text, needle), near === undefined ? undefined : near - lead);
    if (at === null) continue;
    const start = at + lead;
    return { start, end: start + exact.length };
  }
  // The bare words, once the neighbours have failed: the copy closest to where
  // the mark last was.
  const at = nearest(occurrences(text, exact), near);
  if (at === null) return null;
  return { start: at, end: at + exact.length };
}

// ------------------------------------------------------------- comparing ----

/** A string with every space, tab and newline taken out. */
export function compactWords(s: string): string {
  return s.replace(/\s+/g, "");
}

/**
 * Whether two readings of the same passage are the same words.
 *
 * Whitespace is dropped from both rather than collapsed. The extraction puts a
 * newline at every block boundary and drops the markup's own indentation, while
 * a DOM range reports whatever whitespace the file happens to have — so
 * "one\ntwo" and "onetwo" are the same passage read twice, and only stripping
 * makes them say so. The comparison is of the head of the passage, which is
 * where a locator points; a range that starts in the right place and ends in
 * the wrong one is still on the right words.
 */
export function sameWords(a: string, b: string, head = 24): boolean {
  const x = compactWords(a);
  const y = compactWords(b);
  if (x === "" || y === "") return x === y;
  return x.slice(0, head) === y.slice(0, head);
}

/** The character offset an EPUB sort key was built from, or null. */
export function epubSortOffset(sortIndex: unknown): number | null {
  if (typeof sortIndex !== "string") return null;
  const parts = sortIndex.split("|");
  if (parts.length !== 2) return null;
  const offset = Number(parts[1]);
  return Number.isFinite(offset) ? offset : null;
}

// ------------------------------------------------------------ the ranges ----

/**
 * A DOM range over a span of a document's extracted text. Null when the
 * document has no text, or when the span is empty.
 */
export function rangeAtSpan(doc: Document, text: DocumentText, span: TextSpan): Range | null {
  if (span.end <= span.start) return null;
  const from = runAt(text.runs, span.start);
  const to = runAt(text.runs, span.end);
  if (!from || !to) return null;
  const range = doc.createRange();
  range.setStart(from.node, from.offset);
  range.setEnd(to.node, to.offset);
  return range.collapsed ? null : range;
}

// -------------------------------------------------------- reading a mark ----

/** The EPUB position of a mark, or null when it does not carry one. */
export function epubPositionOf(
  ann: { position?: unknown; [key: string]: unknown } | null | undefined,
): EpubPosition | null {
  const raw = ann?.position as Partial<EpubPosition> | undefined;
  if (!raw || typeof raw !== "object") return null;
  if (raw.type !== "FragmentSelector") return null;
  if (typeof raw.value !== "string" || raw.value === "") return null;
  const pageIndex =
    typeof raw.pageIndex === "number" && Number.isInteger(raw.pageIndex) && raw.pageIndex >= 0
      ? raw.pageIndex
      : 0;
  return {
    type: "FragmentSelector",
    conformsTo: typeof raw.conformsTo === "string" ? raw.conformsTo : CFI_CONFORMS_TO,
    value: raw.value,
    pageIndex,
  };
}

/** The repair quote of a mark, or null when it was written without one. */
export function quoteSelectorOf(
  ann: { quote?: unknown; [key: string]: unknown } | null | undefined,
): TextQuoteSelector | null {
  const raw = ann?.quote as Partial<TextQuoteSelector> | undefined;
  if (!raw || typeof raw !== "object") return null;
  if (typeof raw.exact !== "string" || raw.exact === "") return null;
  return {
    type: "TextQuoteSelector",
    exact: raw.exact,
    prefix: typeof raw.prefix === "string" ? raw.prefix : "",
    suffix: typeof raw.suffix === "string" ? raw.suffix : "",
  };
}

/** How a mark is drawn. Null for anything this renderer does not paint. */
export function markStroke(
  ann: { type?: unknown; [key: string]: unknown } | null | undefined,
): "highlight" | "underline" | null {
  const type = ann?.type;
  if (type === "highlight") return "highlight";
  // The AI pen is the underline tool in a fixed purple; what tells it apart is
  // the thread hanging off it, not the stroke (reader-contract.ts: MarkPen).
  if (type === "underline") return "underline";
  return null;
}

// -------------------------------------------------------- writing a mark ----

/** The one colour a mark falls back to, the same as the PDF side's. */
export const DEFAULT_MARK_COLOR = "#ffd400";

export interface NewEpubMark {
  id: string;
  stroke: "highlight" | "underline";
  color: string;
  cfi: string;
  spineIndex: number;
  span: TextSpan;
  pageIndex: number;
  pageLabel: string;
  quote: TextQuoteSelector;
  authorName: string;
  now: string;
}

/**
 * The entry a pen leaves behind. Everything the shell reads off a mark is
 * filled in here — the trace list's page label and excerpt, distillation's
 * text, the sort key — so nothing downstream has to ask which format it is.
 */
export function newEpubMark(args: NewEpubMark): Record<string, unknown> {
  return {
    id: args.id,
    type: args.stroke,
    color: args.color,
    text: args.quote.exact,
    comment: "",
    tags: [],
    pageLabel: args.pageLabel,
    sortIndex: makeEpubSortIndex(args.spineIndex, args.span.start),
    position: {
      type: "FragmentSelector",
      conformsTo: CFI_CONFORMS_TO,
      value: args.cfi,
      pageIndex: args.pageIndex,
    } satisfies EpubPosition,
    quote: args.quote,
    dateCreated: args.now,
    dateModified: args.now,
    authorName: args.authorName,
    isAuthorNameAuthoritative: true,
  };
}
