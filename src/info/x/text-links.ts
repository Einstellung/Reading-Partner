// Links a post's text names with nothing under them that the page linked (docs/info/88
// 「取材 / X」, pitfall 657): a URL spelled out ("Paper: https://arxiv.org/abs/…"),
// a paper named by its arXiv id ("arxiv 2605.24043"), a GitHub repository or a
// known short link without its scheme ("github.com/org/repo", "goo.gle/abc").
// Pure; nothing is fetched. A short link is passed on as it is: the page read
// that opens it follows its redirect.

import type { XLinkOut, XSearchPost } from "./search-page";

// X writes a t.co link as the URL it stands for and an ellipsis when the page
// shows only its start; read with its hidden parts ("https://" is one), the
// whole URL is before the ellipsis.
const URL_IN_TEXT = /https?:\/\/[^\s<>"'`…]+/gi;
const ARXIV_ID = /\barxiv(?:\s*:\s*|\s+)(\d{4}\.\d{4,5})(?:v\d+)?\b/gi;
// Hosts worth a link with no scheme in front: papers, code, and short links.
const BARE_HOSTS = ["arxiv.org", "github.com", "huggingface.co", "goo.gle", "bit.ly", "buff.ly", "ow.ly", "lnkd.in", "youtu.be", "hf.co"];
const BARE_LINK = new RegExp(
  `(?<![\\w@/.:-])((?:www\\.)?(?:${BARE_HOSTS.map((h) => h.replace(/\./g, "\\.")).join("|")})\\/[^\\s<>"'\`…]+)`,
  "gi",
);

/** The key two links are the same link by: no protocol, `www.`, fragment or trailing slash; case aside. */
export function linkKey(url: string): string {
  return url
    .replace(/^https?:\/\/(?:www\.)?/i, "")
    .replace(/#.*$/, "")
    .replace(/\/+$/, "")
    .toLowerCase();
}

/** A URL off the text without the sentence's punctuation after it, or null when it does not parse. */
function cleaned(raw: string): string | null {
  let url = raw.replace(/[.,;:!?'"]+$/, "");
  // A closing bracket belongs to the URL only when the URL opened one.
  while (/[)\]]$/.test(url) && (url.match(/[(\[]/g)?.length ?? 0) < (url.match(/[)\]]/g)?.length ?? 0)) {
    url = url.slice(0, -1).replace(/[.,;:!?'"]+$/, "");
  }
  try {
    return new URL(url).toString();
  } catch {
    return null;
  }
}

/**
 * Every link out of a post the reader knows of, each once: the ones the page
 * linked with a target known, then the ones only its text names. A quoted
 * post's text is not the post's own and is left out.
 */
export function postLinksOut(post: Pick<XSearchPost, "links" | "text">): { url: string; card: boolean }[] {
  const out = post.links.filter((l): l is XLinkOut & { url: string } => l.url !== null).map((l) => ({ url: l.url, card: l.card }));
  const keys = new Set(out.map((l) => linkKey(l.url)));
  for (const url of linksInText(post.text)) {
    if (keys.has(linkKey(url))) continue;
    keys.add(linkKey(url));
    out.push({ url, card: false });
  }
  return out;
}

/** The links a text names, in the order it names them, each once. */
export function linksInText(text: string): string[] {
  const found: { at: number; url: string }[] = [];
  for (const m of text.matchAll(URL_IN_TEXT)) {
    const url = cleaned(m[0]);
    if (url) found.push({ at: m.index ?? 0, url });
  }
  for (const m of text.matchAll(BARE_LINK)) {
    // Without its scheme in front the hidden part of X's display was not read
    // either: what comes before an ellipsis is only the start of the link.
    if (text[(m.index ?? 0) + m[0].length] === "…") continue;
    const url = cleaned(`https://${m[1]}`);
    if (url) found.push({ at: m.index ?? 0, url });
  }
  for (const m of text.matchAll(ARXIV_ID)) found.push({ at: m.index ?? 0, url: `https://arxiv.org/abs/${m[1]}` });
  found.sort((a, b) => a.at - b.at);
  const out: string[] = [];
  const keys = new Set<string>();
  for (const { url } of found) {
    const key = linkKey(url);
    if (keys.has(key)) continue;
    keys.add(key);
    out.push(url);
  }
  return out;
}
