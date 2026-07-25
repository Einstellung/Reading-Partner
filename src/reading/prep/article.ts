// Main-content extraction from a web article's HTML, pure. A user can paste a
// link to a web page (docs/09 link ingestion); this pulls the readable body out
// of the surrounding chrome so it can be digested and read like a paper.
//
// String/regex based rather than DOMParser so it runs identically in bun tests
// and the webview (same posture as arxiv.ts's Atom reader — DOMParser is absent
// in bun). The heuristic: drop non-content elements (script/style/nav/header/
// footer/aside/form), then prefer an <article> or <main> region, else fall back
// to the whole cleaned body. Block tags become paragraph breaks; the rest is
// stripped to text, entity-decoded, and whitespace-collapsed.

// Cap on the extracted text so a huge page can't blow up the digest prompt or
// the fulltext cache. Longer content is cut with a visible marker.
export const ARTICLE_MAX_CHARS = 200_000;
export const TRUNCATION_MARKER = "\n\n[content truncated]";

export interface ExtractedArticle {
  // Refined title (from <title> or the first <h1>), or null when neither exists.
  title: string | null;
  // The plain-text article body, paragraph breaks preserved.
  text: string;
  truncated: boolean;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, "&");
}

// Remove elements whose text is never article content, plus comments.
function stripNoise(html: string): string {
  let out = html.replace(/<!--[\s\S]*?-->/g, "");
  for (const tag of ["script", "style", "noscript", "nav", "header", "footer", "aside", "form", "svg"]) {
    out = out.replace(new RegExp(`<${tag}\\b[\\s\\S]*?</${tag}>`, "gi"), " ");
  }
  return out;
}

// Turn an HTML fragment into plain text: block-level tags become newlines, all
// other tags drop out, entities decode, runs of blank lines collapse.
function htmlToText(fragment: string): string {
  const withBreaks = fragment
    .replace(/<\/(p|div|section|article|header|figure|figcaption|li|ul|ol|tr|table|blockquote)>/gi, "\n\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(h[1-6])>/gi, "\n\n");
  const text = decodeEntities(withBreaks.replace(/<[^>]+>/g, " "));
  return text
    .split("\n")
    .map((l) => l.replace(/[ \t\f\v ]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// The first match of a region tag, or "" when the page has none. Non-greedy, so
// on a page with several <article>s it takes the first; good enough — the common
// case is exactly one.
function firstRegion(html: string, tag: string): string {
  const m = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, "i").exec(html);
  return m ? m[1] : "";
}

export function extractArticleTitle(html: string): string | null {
  const t = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  if (t && decodeEntities(t[1]).trim()) return decodeEntities(t[1]).replace(/\s+/g, " ").trim();
  const h1 = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
  if (h1) {
    const text = htmlToText(h1[1]);
    if (text) return text;
  }
  return null;
}

export function extractArticle(html: string): ExtractedArticle {
  const title = extractArticleTitle(html);
  const cleaned = stripNoise(html);

  // Prefer a semantic content region; otherwise the whole cleaned body (nav/
  // header/footer are already gone, so this is a reasonable "largest text block").
  const article = firstRegion(cleaned, "article");
  const main = article || firstRegion(cleaned, "main");
  const bodyMatch = /<body\b[^>]*>([\s\S]*?)<\/body>/i.exec(cleaned);
  const region = main || (bodyMatch ? bodyMatch[1] : cleaned);

  const full = htmlToText(region);
  const truncated = full.length > ARTICLE_MAX_CHARS;
  const text = truncated ? full.slice(0, ARTICLE_MAX_CHARS) + TRUNCATION_MARKER : full;
  return { title, text, truncated };
}
