// Light article-HTML sanitizer for the info article view (docs/16). The input
// is a third-party news page's body: keep the readable formatting, strip
// anything active or off-device-executing. Pure (regex, no DOM) so it runs in
// bun tests; not a general-purpose sanitizer, but the article view renders the
// result with dangerouslySetInnerHTML, so it removes every script/handler/plugin
// vector and neutralizes javascript: URLs. Remote images are kept (news pages
// are mostly images) but forced to referrerpolicy="no-referrer" — the CDNs use
// Referer-based hotlink protection, so a referrer leak would blank them out.

// Whole elements dropped with their content (they carry no readable text).
const DROP_WITH_CONTENT = ["script", "style", "noscript", "iframe", "object", "embed", "video", "audio", "canvas", "svg", "form", "head"];
// Stray tags removed on sight (self-closing or unbalanced).
const DROP_TAGS = ["link", "meta", "base", "title", "input", "button", "textarea", "select"];

function stripHandlersAndJs(tag: string): string {
  // on*="..." / on*='...' inline handlers.
  let out = tag.replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, "").replace(/\son[a-z]+\s*=\s*'[^']*'/gi, "");
  // Any attribute whose value is a javascript: URL (href/src/formaction/...).
  out = out.replace(/\s[a-z-]+\s*=\s*"\s*javascript:[^"]*"/gi, "").replace(/\s[a-z-]+\s*=\s*'\s*javascript:[^']*'/gi, "");
  // Presentational/identity attributes: drop so the page renders in our prose
  // styles rather than the source site's (and no style-based exfiltration).
  out = out.replace(/\s(?:class|style|id|width|height|align|bgcolor|data-[a-z-]+)\s*=\s*"[^"]*"/gi, "");
  out = out.replace(/\s(?:class|style|id|width|height|align|bgcolor|data-[a-z-]+)\s*=\s*'[^']*'/gi, "");
  return out;
}

function keepImg(tag: string): string {
  const src = /\ssrc\s*=\s*"([^"]*)"/i.exec(tag) || /\ssrc\s*=\s*'([^']*)'/i.exec(tag);
  const url = src?.[1]?.trim() ?? "";
  // Drop an image with no http(s)/data src (lazy-load placeholders, tracking px).
  if (!/^https?:\/\//i.test(url) && !/^data:image\//i.test(url)) return "";
  return `<img src="${url.replace(/"/g, "&quot;")}" referrerpolicy="no-referrer" loading="lazy">`;
}

function keepAnchor(tag: string): string {
  const href = /\shref\s*=\s*"([^"]*)"/i.exec(tag) || /\shref\s*=\s*'([^']*)'/i.exec(tag);
  const url = href?.[1]?.trim() ?? "";
  if (!/^https?:\/\//i.test(url)) return "<a>";
  return `<a href="${url.replace(/"/g, "&quot;")}" target="_blank" rel="noreferrer noopener">`;
}

export function sanitizeArticleHtml(html: string): string {
  let out = html;
  // Comments.
  out = out.replace(/<!--[\s\S]*?-->/g, "");
  // Elements dropped with their content.
  for (const tag of DROP_WITH_CONTENT) {
    out = out.replace(new RegExp(`<${tag}\\b[\\s\\S]*?</${tag}>`, "gi"), "");
    // Unbalanced opener left behind.
    out = out.replace(new RegExp(`<\\/?${tag}\\b[^>]*>`, "gi"), "");
  }
  // Stray void/metadata tags.
  out = out.replace(new RegExp(`<\\/?(?:${DROP_TAGS.join("|")})\\b[^>]*>`, "gi"), "");
  // Rebuild <img> and <a> opening tags from scratch (only safe attributes),
  // then scrub handlers/js/presentational attributes from every other tag.
  out = out.replace(/<img\b[^>]*>/gi, (m) => keepImg(m));
  out = out.replace(/<a\b[^>]*>/gi, (m) => keepAnchor(m));
  out = out.replace(/<(?!\/?(?:img|a)\b)[a-z][a-z0-9]*\b[^>]*>/gi, (m) => stripHandlersAndJs(m));
  return out.trim();
}

// Plain text of an HTML fragment, block tags becoming line breaks. Used for an
// item's textContent (triage input, chat context) when a feed hands us HTML.
export function htmlToText(html: string): string {
  let out = html.replace(/<!--[\s\S]*?-->/g, "");
  for (const tag of ["script", "style", "noscript", "svg"]) {
    out = out.replace(new RegExp(`<${tag}\\b[\\s\\S]*?</${tag}>`, "gi"), " ");
  }
  out = out
    .replace(/<\/(p|div|section|article|header|figure|figcaption|li|ul|ol|tr|table|blockquote|h[1-6])>/gi, "\n\n")
    .replace(/<br\s*\/?>/gi, "\n");
  const text = decodeEntities(out.replace(/<[^>]+>/g, " "));
  return text
    .split("\n")
    .map((l) => l.replace(/[ \t\f\v ]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function decodeEntities(s: string): string {
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
