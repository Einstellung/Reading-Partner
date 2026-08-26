// Page-anchor citations in chat replies, pure. The prompt asks the model to
// cite the survey as [p.12] and a prepped paper as [paper-slug p.3]; before
// rendering we rewrite those into markdown links with fragment hrefs (#rp-…),
// which pass react-markdown's URL sanitizer, and the renderer's <a> component
// turns them back into navigation via parseCitationHref.
//
// Recognition is one wide scan for bracketed candidates plus one parser
// (parseAnchor), not a regex per citation shape. Narrow regexes only ever
// matched the shapes someone thought of: a real thread lost most of its paper
// citations to page ranges, page lists and non-ASCII slugs, all of which the
// survey form already accepted. One grammar keeps the two forms in step.
//
// The wide scan's risk is the mirror image: swallowing a bracket that is prose.
// What holds it back is the head, not the length — a candidate is a citation
// only if it opens with "p.N" or "slug p.N", and code spans are skipped
// wholesale. tests/reading/prep/anchors.test.ts pins a table of brackets that
// must survive untouched.

import { FIGURE_ID_PATTERN, FIGURE_ID_RE } from "../figures/lookup";

export type Citation =
  | { kind: "page"; page: number; quote?: string }
  | { kind: "paper"; slug: string; page: number; quote?: string }
  | { kind: "figure"; id: string };

// A parsed bracket: the citation it denotes plus the text the chip should show.
export type Anchor = Citation & { label: string };

const PAGE_HREF = "#rp-page-";
const PAPER_HREF = "#rp-paper-";
const FIGURE_HREF = "#rp-fig-";
// A page/paper citation may carry a short verbatim quote from the source, used
// to highlight the referenced text after the jump. It rides in the fragment
// after this sentinel, URL-encoded. `=` never appears in encodeURIComponent
// output, so the sentinel cannot collide with an encoded quote or a slug.
const QUOTE_SEP = "--q=";

function withQuote(base: string, quote?: string): string {
  return quote ? `${base}${QUOTE_SEP}${encodeURIComponent(quote)}` : base;
}

export function pageCitationHref(page: number, quote?: string): string {
  return withQuote(`${PAGE_HREF}${page}`, quote);
}

export function paperCitationHref(slug: string, page: number, quote?: string): string {
  return withQuote(`${PAPER_HREF}${slug}--${page}`, quote);
}

export function figureCitationHref(id: string): string {
  return `${FIGURE_HREF}${id}`;
}

export function parseCitationHref(href: string | undefined): Citation | null {
  if (!href) return null;
  let quote: string | undefined;
  const qi = href.indexOf(QUOTE_SEP);
  if (qi !== -1) {
    try {
      quote = decodeURIComponent(href.slice(qi + QUOTE_SEP.length)) || undefined;
    } catch {
      quote = undefined;
    }
    href = href.slice(0, qi);
  }
  if (href.startsWith(PAGE_HREF)) {
    const page = Number(href.slice(PAGE_HREF.length));
    return Number.isFinite(page) && page > 0 ? { kind: "page", page, ...(quote ? { quote } : {}) } : null;
  }
  if (href.startsWith(PAPER_HREF)) {
    const rest = href.slice(PAPER_HREF.length);
    const sep = rest.lastIndexOf("--");
    if (sep <= 0) return null;
    const slug = rest.slice(0, sep);
    const page = Number(rest.slice(sep + 2));
    return slug && Number.isFinite(page) && page > 0
      ? { kind: "paper", slug, page, ...(quote ? { quote } : {}) }
      : null;
  }
  if (href.startsWith(FIGURE_HREF)) {
    const id = href.slice(FIGURE_HREF.length);
    return FIGURE_ID_RE.test(id) ? { kind: "figure", id } : null;
  }
  return null;
}

// --- the grammar -----------------------------------------------------------

// [fig:3] / [fig: 3a] / [fig:3.8] / [fig:3-1] — a figure citation (M9).
// Case-normalized. The id shape is the figures module's (lookup.ts), not a
// second opinion about it: a chapter-numbered book's figures are "3-1", and a
// citation shape that only knew about bare integers left every one of them as
// literal text.
const FIGURE_INNER = new RegExp(`^fig\\s*:\\s*(${FIGURE_ID_PATTERN})$`, "i");
// The page number a citation opens with: p.12 / pp. 12 / P.12.
const PAGE_HEAD = /^pp?\.\s*(\d+)/i;
// A slug in front of the page number, in the charset plan.ts's slugify emits:
// letters and numbers from any script joined by hyphens, so a paper filed as
// π0-a-vision-language-action-flow-model-for-general is citable, and so is one
// whose title was Chinese. Which of those shapes is a citation is not something
// the charset can answer — see KnownSlugs.
const SLUG_HEAD = /^([\p{L}\p{N}][\p{L}\p{N}-]*[\p{L}\p{N}])\s+/u;

// What may follow the first page number and still belong to the citation.
// A range, further pages, a verbatim quote, and one trailing label such as
// ", Table I". The link always goes to the first page.
const RANGE = /^\s*[-–—]\s*\d+/;
const MORE_PAGES = /^\s*,\s*pp?\.\s*\d+(?:\s*[-–—]\s*\d+)?/i;
const TRAILING_LABEL = /^\s*,\s*[^,]{1,40}$/;
// The quote may be in ASCII, curly or CJK quotation marks — the model matches
// the language it is answering in, and a reply in Chinese quotes with 「」.
// Backslash escapes are allowed inside the ASCII form so an inner " can be
// embedded; length is bounded to keep it a snippet.
const QUOTE =
  /^\s*(?:"((?:\\.|[^"\\]){1,200})"|“([^”]{1,200})”|「([^」]{1,200})」|『([^』]{1,200})』)/;

// Unescape backslash-escaped chars the model may put inside the quote (e.g. \").
function unescapeQuote(q: string | undefined): string | undefined {
  const s = q?.replace(/\\(.)/g, "$1").trim();
  return s ? s : undefined;
}

interface Tail {
  // Where the quote sat in the inner text, so the label can drop it.
  quoteAt: [number, number] | null;
  quote?: string;
  // False when something was left over that the grammar does not recognize.
  understood: boolean;
}

function parseTail(inner: string, from: number): Tail {
  let at = from;
  let m = RANGE.exec(inner.slice(at));
  if (m) at += m[0].length;
  for (;;) {
    m = MORE_PAGES.exec(inner.slice(at));
    if (!m) break;
    at += m[0].length;
  }
  let quoteAt: [number, number] | null = null;
  let quote: string | undefined;
  m = QUOTE.exec(inner.slice(at));
  if (m) {
    quote = unescapeQuote(m[1] ?? m[2] ?? m[3] ?? m[4]);
    quoteAt = [at, at + m[0].length];
    at += m[0].length;
  }
  const rest = inner.slice(at);
  const understood = rest.trim() === "" || TRAILING_LABEL.test(rest);
  return { quoteAt, quote, understood };
}

// The chip's text: the bracket's own words minus the quote, which is payload in
// the href rather than something to read twice.
function labelOf(inner: string, quoteAt: [number, number] | null): string {
  const s = quoteAt ? inner.slice(0, quoteAt[0]) + inner.slice(quoteAt[1]) : inner;
  return s.replace(/\s+/g, " ").trim().replace(/[,\s]+$/, "");
}

// The slugs a [slug p.N] citation is allowed to name: the prep list the model
// was actually handed. No charset rule can stand in for it — a slug is whatever
// slugify emitted, in any script, so "[表2 p.5]" and a Chinese paper's real slug
// are the same shape, and the only thing that tells them apart is whether the
// paper is there.
//
// Null (or absent) means the list is not known here, and then a candidate links
// on its shape alone. That is deliberate: the prep list arrives a moment after a
// book opens, and striking out a real citation for that moment is worse than
// linking one that turns out to be wrong, which the click check catches.
export type KnownSlugs = ReadonlySet<string> | null | undefined;

// Parse the text between one pair of brackets. Returns null — leave the text
// exactly as written — for anything that is not plainly a citation.
export function parseAnchor(inner: string, knownSlugs?: KnownSlugs): Anchor | null {
  const s = inner.trim();
  if (!s) return null;

  const fig = FIGURE_INNER.exec(s);
  if (fig) {
    const id = fig[1].toLowerCase();
    return { kind: "figure", id, label: `fig:${id}` };
  }

  const page = PAGE_HEAD.exec(s);
  if (page) {
    const n = Number(page[1]);
    if (n <= 0) return null;
    const tail = parseTail(s, page[0].length);
    // A bracket opening with "p.N" is a page citation whatever trails it; an
    // unrecognized tail only means the whole bracket stays as the chip's text
    // and nothing is read as a quote.
    return tail.understood
      ? { kind: "page", page: n, label: labelOf(s, tail.quoteAt), ...(tail.quote ? { quote: tail.quote } : {}) }
      : { kind: "page", page: n, label: labelOf(s, null) };
  }

  const head = SLUG_HEAD.exec(s);
  if (!head) return null;
  // slugify only ever emits lowercase, so case in the citation carries no
  // meaning and would only miss the paper. The label keeps what was written.
  const slug = head[1].toLowerCase();
  if (knownSlugs && !knownSlugs.has(slug)) return null;
  const after = PAGE_HEAD.exec(s.slice(head[0].length));
  if (!after) return null;
  const n = Number(after[1]);
  if (n <= 0) return null;
  const tail = parseTail(s, head[0].length + after[0].length);
  // Unlike the page form, the head here is an arbitrary word, so a tail the
  // grammar cannot account for means this was prose: "[see p.9 above]".
  if (!tail.understood) return null;
  return {
    kind: "paper",
    slug,
    page: n,
    label: labelOf(s, tail.quoteAt),
    ...(tail.quote ? { quote: tail.quote } : {}),
  };
}

// --- scanning --------------------------------------------------------------

// Candidate brackets. The length cap only bounds the scan; what decides a match
// is the head parseAnchor demands.
const ANCHOR_RE = /\[([^\[\]\n]{1,240})\]/g;

// The stretches of `text` markdown renders as code — fenced blocks and inline
// spans. A citation shorthand inside one is a literal the model wanted shown,
// so it is left alone. An unterminated fence runs to the end: mid-stream that is
// exactly right, and it keeps a half-written block from being rewritten.
function codeRanges(text: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  let pos = 0;
  let fence: { char: string; len: number; start: number } | null = null;
  for (const line of text.split("\n")) {
    const start = pos;
    pos += line.length + 1;
    const m = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (!fence) {
      if (m) fence = { char: m[1][0], len: m[1].length, start };
    } else if (m && m[1][0] === fence.char && m[1].length >= fence.len) {
      ranges.push([fence.start, pos]);
      fence = null;
    }
  }
  if (fence) ranges.push([fence.start, text.length]);
  const fenced = ranges.slice();
  const runs: Array<{ start: number; len: number }> = [];
  const tick = /`+/g;
  let t: RegExpExecArray | null;
  while ((t = tick.exec(text))) {
    if (!inRanges(fenced, t.index)) runs.push({ start: t.index, len: t[0].length });
  }
  for (let i = 0; i < runs.length; i++) {
    for (let j = i + 1; j < runs.length; j++) {
      if (runs[j].len === runs[i].len) {
        ranges.push([runs[i].start, runs[j].start + runs[j].len]);
        i = j;
        break;
      }
    }
  }
  return ranges;
}

function inRanges(ranges: Array<[number, number]>, i: number): boolean {
  return ranges.some(([a, b]) => i >= a && i < b);
}

// Walk every bracket outside code, handing the inner text to `rewrite`. Return
// null from it to leave the bracket exactly as written.
function scanAnchors(
  text: string,
  rewrite: (a: Anchor, raw: string) => string | null,
  knownSlugs?: KnownSlugs,
): string {
  if (!text.includes("[")) return text;
  const skip = codeRanges(text);
  let out = "";
  let last = 0;
  ANCHOR_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ANCHOR_RE.exec(text))) {
    const end = m.index + m[0].length;
    // Already a markdown link's text, or an escaped bracket the model meant to
    // show literally.
    if (text[end] === "(" || text[m.index - 1] === "\\") continue;
    if (inRanges(skip, m.index)) continue;
    const anchor = parseAnchor(m[1], knownSlugs);
    if (!anchor) continue;
    const replacement = rewrite(anchor, m[0]);
    if (replacement === null) continue;
    out += text.slice(last, m.index) + replacement;
    last = end;
  }
  return last === 0 ? text : out + text.slice(last);
}

function renderAnchor(a: Anchor): string {
  if (a.kind === "figure") return `[${a.label}](${figureCitationHref(a.id)})`;
  if (a.kind === "page") return `[${a.label}](${pageCitationHref(a.page, a.quote)})`;
  return `[${a.label}](${paperCitationHref(a.slug, a.page, a.quote)})`;
}

// Rewrite citation shorthands into markdown links. The chip's visible text stays
// the words the model wrote minus any quote, which is payload in the href.
//
// `knownSlugs` is the prep list a [slug p.N] may name; without one every
// well-shaped candidate links. A citation the list does not know stays plain
// text on purpose — a chip that leads nowhere is worse than no chip, because it
// looks exactly like one that leads somewhere.
export function linkifyCitations(text: string, knownSlugs?: KnownSlugs): string {
  return scanAnchors(text, renderAnchor, knownSlugs);
}

// Rewrite only the [fig:N] shorthands, leaving every other bracket byte for byte
// as the model wrote it. For the surfaces that have the book's figures but no
// reader under them — a retell, a rehearsal note, the coach — where a figure
// opens in place and a page citation has nowhere to go. Those two answers used
// to be one switch, so turning figures on there would also have turned [p.12]
// into a chip that leads nowhere.
//
// Nothing is reconstructed on the way back: a page bracket is never rewritten,
// so there is no label to un-strip and no quote to put back.
export function linkifyFigureCitations(text: string): string {
  return scanAnchors(text, (a) => (a.kind === "figure" ? renderAnchor(a) : null));
}

// A prep note's page anchors mean pages of *that* paper, but they are written
// bare — [p.3], the same shape a survey citation has. Copied into a reply or a
// prompt they land in the survey's namespace and jump to the wrong book; one
// note body carries 26 of them on a single line. Qualify them on the way out of
// storage so every anchor the model ever sees names its own paper.
//
// Anchors that already name a paper, and figure anchors, are left alone. So is
// any page anchor the qualified form would not parse back — prefixing a slug
// must not turn a live anchor into a dead one.
export function requalifyNoteAnchors(body: string, slug: string): string {
  if (!slug) return body;
  // The one paper this body may name is its own, so the round-trip check knows
  // the slug exists whatever script it is in.
  const own: ReadonlySet<string> = new Set([slug.toLowerCase()]);
  return scanAnchors(body, (a, raw) => {
    if (a.kind !== "page") return null;
    const qualified = `[${slug} ${raw.slice(1, -1).trim()}]`;
    return parseAnchor(qualified.slice(1, -1), own)?.kind === "paper" ? qualified : null;
  });
}
