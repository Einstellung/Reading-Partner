// Page-anchor citations in chat replies, pure. The prompt asks the model to
// cite the survey as [p.12] and a prepped paper as [paper-slug p.3]; before
// rendering we rewrite those into markdown links with fragment hrefs (#rp-…),
// which pass react-markdown's URL sanitizer, and the renderer's <a> component
// turns them back into navigation via parseCitationHref.

export type Citation =
  | { kind: "page"; page: number }
  | { kind: "paper"; slug: string; page: number };

const PAGE_HREF = "#rp-page-";
const PAPER_HREF = "#rp-paper-";

export function pageCitationHref(page: number): string {
  return `${PAGE_HREF}${page}`;
}

export function paperCitationHref(slug: string, page: number): string {
  return `${PAPER_HREF}${slug}--${page}`;
}

export function parseCitationHref(href: string | undefined): Citation | null {
  if (!href) return null;
  if (href.startsWith(PAGE_HREF)) {
    const page = Number(href.slice(PAGE_HREF.length));
    return Number.isFinite(page) && page > 0 ? { kind: "page", page } : null;
  }
  if (href.startsWith(PAPER_HREF)) {
    const rest = href.slice(PAPER_HREF.length);
    const sep = rest.lastIndexOf("--");
    if (sep <= 0) return null;
    const slug = rest.slice(0, sep);
    const page = Number(rest.slice(sep + 2));
    return slug && Number.isFinite(page) && page > 0 ? { kind: "paper", slug, page } : null;
  }
  return null;
}

// [p.12] or [pp.12-14] (linked to the first page); a survey citation.
const SURVEY_RE = /\[(pp?\.\s?(\d+)(?:\s?[-–]\s?\d+)?)\]/g;
// [some-slug p.3] — a paper citation. The slug charset matches slugify's output.
const PAPER_RE = /\[([a-z0-9][a-z0-9-]*)\s+p\.\s?(\d+)\]/g;

// Rewrite citation shorthands into markdown links. A match already followed by
// "(" is an existing markdown link's text — left alone.
export function linkifyCitations(text: string): string {
  const paperPass = text.replace(PAPER_RE, (match, slug: string, page: string, offset: number, s: string) => {
    if (s[offset + match.length] === "(") return match;
    return `[${slug} p.${page}](${paperCitationHref(slug, Number(page))})`;
  });
  return paperPass.replace(SURVEY_RE, (match, label: string, page: string, offset: number, s: string) => {
    if (s[offset + match.length] === "(") return match;
    return `[${label}](${pageCitationHref(Number(page))})`;
  });
}
