// Page-anchor citations in chat replies, pure. The prompt asks the model to
// cite the survey as [p.12] and a prepped paper as [paper-slug p.3]; before
// rendering we rewrite those into markdown links with fragment hrefs (#rp-…),
// which pass react-markdown's URL sanitizer, and the renderer's <a> component
// turns them back into navigation via parseCitationHref.

export type Citation =
  | { kind: "page"; page: number; quote?: string }
  | { kind: "paper"; slug: string; page: number; quote?: string }
  | { kind: "figure"; id: string };

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
    return /^\d+[a-z]?$/.test(id) ? { kind: "figure", id } : null;
  }
  return null;
}

// An optional trailing verbatim quote: a double-quoted snippet after the page,
// e.g. [p.12 "exact words"]. Backslash escapes are allowed inside so the model
// can embed a literal quote; length is bounded to keep it a snippet.
const QUOTE_TAIL = `(?:\\s+"((?:\\\\.|[^"\\\\]){1,200})")?`;
// [p.12] or [pp.12-14] (linked to the first page); a survey citation. May carry
// a quote: [p.12 "exact words"].
const SURVEY_RE = new RegExp(`\\[(pp?\\.\\s?(\\d+)(?:\\s?[-–]\\s?\\d+)?)${QUOTE_TAIL}\\]`, "g");
// [some-slug p.3] — a paper citation. The slug charset matches slugify's output.
const PAPER_RE = new RegExp(`\\[([a-z0-9][a-z0-9-]*)\\s+p\\.\\s?(\\d+)${QUOTE_TAIL}\\]`, "g");
// [fig:3] / [fig:3a] — a figure citation (M9). The label keeps the "fig:N" text.
const FIGURE_RE = /\[fig:\s?(\d+[a-z]?)\]/gi;

// Unescape backslash-escaped chars the model may put inside the quote (e.g. \").
function unescapeQuote(q: string | undefined): string | undefined {
  const s = q?.replace(/\\(.)/g, "$1").trim();
  return s ? s : undefined;
}

// Rewrite citation shorthands into markdown links. A match already followed by
// "(" is an existing markdown link's text — left alone. The chip's visible text
// stays the bare "p.N" / "slug p.N"; any quote is payload carried in the href.
export function linkifyCitations(text: string): string {
  const figPass = text.replace(FIGURE_RE, (match, id: string, offset: number, s: string) => {
    if (s[offset + match.length] === "(") return match;
    return `[fig:${id.toLowerCase()}](${figureCitationHref(id.toLowerCase())})`;
  });
  const paperPass = figPass.replace(
    PAPER_RE,
    (match, slug: string, page: string, quote: string | undefined, offset: number, s: string) => {
      if (s[offset + match.length] === "(") return match;
      return `[${slug} p.${page}](${paperCitationHref(slug, Number(page), unescapeQuote(quote))})`;
    },
  );
  return paperPass.replace(
    SURVEY_RE,
    (match, label: string, page: string, quote: string | undefined, offset: number, s: string) => {
      if (s[offset + match.length] === "(") return match;
      return `[${label}](${pageCitationHref(Number(page), unescapeQuote(quote))})`;
    },
  );
}
