// One pass over a sanitized spine document that produces everything the rest of
// the ingestion needs: the plain text, and a way to go from any point in that
// text back to the node it came from and forward to the elements that sit at a
// given offset.
//
// One pass rather than four, because four would each have their own idea of
// where a paragraph starts. The pagination cuts the text, the outline turns a
// nav href into a position, the figure index says which position a picture sits
// at, and a locator says where a position begins in the tree — all four are
// answered by the offsets recorded here, so they cannot disagree.
//
// The offsets are into this document's extracted text, not into the archive's
// bytes. That makes them stable against everything except a change to this
// extraction, which is the one thing a change to the pagination table has to be
// weighed against (see paginate.ts).

const BLOCK_ELEMENTS = new Set([
  "address", "article", "aside", "blockquote", "body", "caption", "dd", "details", "div", "dl",
  "dt", "figcaption", "figure", "footer", "h1", "h2", "h3", "h4", "h5", "h6", "header", "hgroup",
  "hr", "li", "main", "nav", "ol", "p", "pre", "section", "summary", "table", "tbody", "td",
  "tfoot", "th", "thead", "tr", "ul",
]);

// Never contributes text: the metadata half of the document.
const SKIP = new Set(["head", "title"]);

/** One text node's span in the extracted text. */
export interface TextRun {
  node: Text;
  /** Offset of this run's first character in the extracted text. */
  start: number;
  length: number;
}

export interface DocumentText {
  text: string;
  runs: TextRun[];
  /** Each element's start offset in the extracted text, in document order. */
  offsets: Map<Element, number>;
  /** Elements carrying an id, for resolving a nav href's fragment. */
  ids: Map<string, Element>;
}

export function extractDocumentText(doc: Document): DocumentText {
  const parts: string[] = [];
  const runs: TextRun[] = [];
  const offsets = new Map<Element, number>();
  const ids = new Map<string, Element>();
  let length = 0;
  // Whether the last thing written was a block boundary, so a run of nested
  // block elements produces one newline rather than six.
  let atBoundary = true;

  function pushText(node: Text): void {
    const value = node.nodeValue ?? "";
    if (value === "") return;
    // Whitespace at a block boundary is layout, not text. Counting it would put
    // the first character of the book at offset 1 whenever the markup has a
    // newline between </head> and <body>, and every anchor in the document
    // would then land one past where it points.
    if (atBoundary && value.trim() === "") return;
    runs.push({ node, start: length, length: value.length });
    parts.push(value);
    length += value.length;
    if (value.trim() !== "") atBoundary = false;
  }

  function boundary(): void {
    if (atBoundary) return;
    parts.push("\n");
    length += 1;
    atBoundary = true;
  }

  function walk(node: Node): void {
    if (node.nodeType === 3 || node.nodeType === 4) {
      pushText(node as Text);
      return;
    }
    if (node.nodeType !== 1) return;
    const el = node as Element;
    const tag = el.localName.toLowerCase();
    if (SKIP.has(tag)) return;
    const block = BLOCK_ELEMENTS.has(tag);
    if (block) boundary();
    offsets.set(el, length);
    const id = el.getAttribute("id");
    if (id && !ids.has(id)) ids.set(id, el);
    for (const child of Array.from(el.childNodes)) walk(child);
    if (block) boundary();
  }

  if (doc.documentElement) walk(doc.documentElement);
  return { text: parts.join(""), runs, offsets, ids };
}

/**
 * The text node holding a given offset, and the offset inside it. Null when the
 * document has no text at all; an offset past the end lands on the last run, so
 * a position block's end is addressable.
 */
export function runAt(runs: TextRun[], offset: number): { node: Text; offset: number } | null {
  if (runs.length === 0) return null;
  let lo = 0;
  let hi = runs.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (runs[mid].start <= offset) lo = mid;
    else hi = mid - 1;
  }
  const run = runs[lo];
  return { node: run.node, offset: Math.min(Math.max(0, offset - run.start), run.length) };
}
