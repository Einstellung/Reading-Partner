// Reading a post's permalink page in the hidden webview (docs/84 「实测」 3).
//
// Signed out, x.com serves a front end with no `data-testid` at all, so nothing
// here leans on them or on class names, which change with every release. Each
// `<article>` is one post: the first is the one the link is about, the next ones
// are replies, and the author's own replies right after it are the readable
// start of a thread. A post's text is its article's innerText with the author's
// name in front and the time and the counts behind; those are cut off here.
//
// The script runs once, after the fetcher's own wait has seen the page stop
// changing, and it touches the page before reading it: <style> and <script> go
// (an Article once carried 17 000 characters of CSS into innerText), emoji
// pictures become their characters, and every content picture is replaced in
// the text by a marker line, so the pictures keep their places in the body.

import { escapeHtmlAttr, escapeHtmlText } from "../../platform/std/text";
import { isObject } from "../../platform/std/json";
import { isXHost, largePhoto } from "./post";

/** Evaluated in the page; its value is JSON (workshop/extract/webview-page). */
export const PERMALINK_SCRIPT = `(function () {
  for (const el of Array.from(document.querySelectorAll("style, script, noscript"))) el.remove();
  const external = (href) => {
    try {
      const host = new URL(href).hostname;
      return !/(^|\\.)(x|twitter)\\.com$/.test(host);
    } catch (e) {
      return false;
    }
  };
  // A quoted post is an <article> inside the quoting one; it is read as part
  // of that one's text, never as a post of its own.
  const top = Array.from(document.querySelectorAll("article")).filter(
    (a) => !(a.parentElement && a.parentElement.closest("article")),
  );
  const posts = top.slice(0, 12).map((article) => {
    const anchors = Array.from(article.querySelectorAll("a[href]")).map((a) => ({
      href: a.href,
      path: a.getAttribute("href") || "",
      text: (a.innerText || "").trim().slice(0, 200),
    }));
    const images = [];
    for (const img of Array.from(article.querySelectorAll("img"))) {
      const src = img.getAttribute("src") || "";
      if (/\\/emoji\\//.test(src)) {
        img.replaceWith(document.createTextNode(img.getAttribute("alt") || ""));
        continue;
      }
      if (!/^https:\\/\\/pbs\\.twimg\\.com\\/media\\//.test(src)) continue;
      const anchor = img.closest("a");
      const path = anchor ? anchor.getAttribute("href") || "" : "";
      if (path && !/\\/(photo|media)\\/\\d+$/.test(path)) continue;
      const marker = document.createElement("div");
      marker.textContent = "[[rp-img:" + images.length + "]]";
      (anchor || img).before(marker);
      images.push(src);
    }
    for (const a of Array.from(article.querySelectorAll("a[href]"))) {
      const text = (a.innerText || "").trim();
      if (external(a.href) && !/^https?:\\/\\/t\\.co\\//.test(a.href) && text && !/\\s/.test(text) && text.includes(".")) {
        a.textContent = a.href;
      }
    }
    return { anchors, images, videos: article.querySelectorAll("video").length, text: article.innerText || "" };
  });
  return { url: location.href, title: document.title, posts };
})()`;

export interface PageAnchor {
  /** Absolute. */
  href: string;
  /** As the page spells it: relative for x.com's own links. */
  path: string;
  text: string;
}

export interface PagePost {
  /** The author's handle, from the avatar link every post opens with. */
  handle: string | null;
  /** Status ids the post links to, in page order: its own, a quoted post's. */
  statusIds: string[];
  text: string;
  images: string[];
  videos: number;
  anchors: PageAnchor[];
}

export interface PermalinkRead {
  title: string;
  posts: PagePost[];
}

const PROFILE_PATH = /^\/([A-Za-z0-9_]{1,15})$/;
const STATUS_PATH = /^\/[A-Za-z0-9_]{1,15}\/status\/(\d+)$/;

/** What the script answered, or null when it is not that shape. */
export function parsePermalinkResult(value: unknown): PermalinkRead | null {
  if (!isObject(value) || !Array.isArray(value.posts)) return null;
  const posts: PagePost[] = [];
  for (const raw of value.posts) {
    if (!isObject(raw)) continue;
    const anchors: PageAnchor[] = (Array.isArray(raw.anchors) ? raw.anchors : [])
      .filter(isObject)
      .map((a) => ({
        href: typeof a.href === "string" ? a.href : "",
        path: typeof a.path === "string" ? a.path : "",
        text: typeof a.text === "string" ? a.text : "",
      }));
    const profile = anchors.map((a) => PROFILE_PATH.exec(a.path)).find((m) => m !== null);
    const statusIds = anchors
      .map((a) => STATUS_PATH.exec(a.path)?.[1])
      .filter((id): id is string => id !== undefined);
    posts.push({
      handle: profile ? profile[1] : null,
      statusIds: [...new Set(statusIds)],
      text: typeof raw.text === "string" ? raw.text : "",
      images: (Array.isArray(raw.images) ? raw.images : []).filter(
        (s): s is string => typeof s === "string",
      ),
      videos: typeof raw.videos === "number" ? raw.videos : 0,
      anchors,
    });
  }
  return { title: typeof value.title === "string" ? value.title : "", posts };
}

/** The post the page is about, and the author's own replies straight after it. */
export function focalPost(
  read: PermalinkRead,
  id: string,
  handle: string,
): { focal: PagePost; selfReplies: PagePost[] } | null {
  const at = read.posts.findIndex((p) => p.statusIds.includes(id));
  if (at < 0) return null;
  const same = (p: PagePost) => p.handle !== null && p.handle.toLowerCase() === handle.toLowerCase();
  const selfReplies: PagePost[] = [];
  for (const post of read.posts.slice(at + 1)) {
    if (!same(post)) break;
    selfReplies.push(post);
  }
  return { focal: read.posts[at], selfReplies };
}

// Interface words the signed-out page puts between the name and the text.
const CHROME_LINES = new Set(["Show translation", "Translate post", "Show more", "Show original", "·"]);
// A count under a post: 142, 2K, 3.3K, 1,204, 234.2K.
const COUNT_LINE = /^[\d.,]+\s?[KMB万亿]?$/;
// The post's own time, "2:03 AM · Oct 5, 2026" or "下午2:03 · 2026年10月5日".
const TIME_LINE = /\d{1,2}:\d{2}.*·|·.*\d{1,2}:\d{2}/;
// A date under a name: "Oct 4", "5h", "Sep 30, 2025", "10月4日".
const SHORT_DATE = /^(?=.*\d).{1,16}$/;
const MARKER = /^\[\[rp-img:(\d+)\]\]$/;
// The line a link card ends with, under its title.
const CARD_SOURCE = /^(?:From|来自)\s+[\w.-]+\.[a-z]{2,}$/i;

export interface BodyOptions {
  handle: string;
  /** Start after this line: an Article's title, below the post that announces it. */
  after?: string;
  /** A reply: its date line follows the handle, and it has no time line. */
  reply?: boolean;
  /** Keep a quoted post's block in the body, as an Article's embedded posts. */
  keepQuotes?: boolean;
}

/**
 * The lines of a post's own text out of its article's innerText, image markers
 * included. Blank lines are kept single, as paragraph breaks.
 */
export function postBodyLines(text: string, opts: BodyOptions): string[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n").map((l) => l.replace(/\s+$/, ""));
  const handleLine = `@${opts.handle}`.toLowerCase();
  let start = lines.findIndex((l) => l.trim().toLowerCase() === handleLine) + 1;
  if (opts.reply) {
    while (start < lines.length && lines[start].trim() === "") start++;
    if (start < lines.length && SHORT_DATE.test(lines[start].trim())) start++;
  }
  if (opts.after) {
    const title = opts.after.trim();
    const at = lines.findIndex((l, i) => i >= start && l.trim() === title);
    if (at >= 0) start = at + 1;
  }
  let end = lines.findIndex((l, i) => i >= start && TIME_LINE.test(l));
  if (end < 0) end = lines.length;
  let body = lines.slice(start, end).filter((l) => !CHROME_LINES.has(l.trim()));

  if (!opts.keepQuotes) {
    // A quoted post: a name, its @handle alone on a line, and a short date.
    const quote = body.findIndex((l, i) => {
      if (!/^@[A-Za-z0-9_]{1,15}$/.test(l.trim())) return false;
      const next = body.slice(i + 1).find((n) => n.trim() !== "");
      return next !== undefined && SHORT_DATE.test(next.trim()) && !MARKER.test(next.trim());
    });
    if (quote >= 0) {
      let cut = quote;
      while (cut > 0 && body[cut - 1].trim() === "") cut--;
      if (cut > 0) cut--; // the quoted author's name
      body = body.slice(0, cut);
    }
  }

  // Runs of counts: under an Article's title, and closing a reply.
  const kept: string[] = [];
  for (let i = 0; i < body.length; ) {
    if (!COUNT_LINE.test(body[i].trim())) {
      kept.push(body[i++]);
      continue;
    }
    let j = i;
    let counts = 0;
    while (j < body.length && (body[j].trim() === "" || COUNT_LINE.test(body[j].trim()))) {
      if (body[j].trim() !== "") counts++;
      j++;
    }
    if (counts >= 3 || j === body.length) i = j;
    else kept.push(body[i++]);
  }

  // A link card: its title, then "From github.com". The link itself is kept
  // with the post's links; the card's words are not the author's.
  for (let i = kept.length - 1; i >= 0; i--) {
    if (!CARD_SOURCE.test(kept[i].trim())) continue;
    let title = i - 1;
    while (title >= 0 && kept[title].trim() === "") title--;
    kept.splice(Math.max(title, 0), i - Math.max(title, 0) + 1);
    i = title;
  }

  const out: string[] = [];
  for (const line of kept) {
    if (line.trim() === "" && (out.length === 0 || out[out.length - 1] === "")) continue;
    out.push(line.trim() === "" ? "" : line);
  }
  while (out.length > 0 && out[out.length - 1] === "") out.pop();
  return out;
}

/** The text of body lines, without the picture markers. */
export function bodyText(lines: readonly string[]): string {
  return lines
    .filter((l) => !MARKER.test(l.trim()))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const URL_IN_TEXT = /https?:\/\/[^\s<>"]+/g;

function linkified(line: string): string {
  let html = "";
  let last = 0;
  for (const m of line.matchAll(URL_IN_TEXT)) {
    html += escapeHtmlText(line.slice(last, m.index));
    html += `<a href="${escapeHtmlAttr(m[0])}">${escapeHtmlText(m[0])}</a>`;
    last = (m.index ?? 0) + m[0].length;
  }
  return html + escapeHtmlText(line.slice(last));
}

/** Body lines as HTML: paragraphs at blank lines, each marker its picture. */
export function bodyHtml(lines: readonly string[], images: readonly string[]): string {
  const blocks: string[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length > 0) blocks.push(`<p>${para.map(linkified).join("<br>")}</p>`);
    para = [];
  };
  for (const line of lines) {
    const marker = MARKER.exec(line.trim());
    if (marker) {
      flush();
      const src = images[Number(marker[1])];
      if (src) blocks.push(`<figure><img src="${escapeHtmlAttr(largePhoto(src))}" alt=""></figure>`);
    } else if (line === "") {
      flush();
    } else {
      para.push(line);
    }
  }
  flush();
  return blocks.join("\n");
}

/** The links a post's text and card point out of X, t.co ones still unexpanded. */
export function outboundAnchors(post: PagePost): string[] {
  const out: string[] = [];
  for (const a of post.anchors) {
    let host: string;
    try {
      host = new URL(a.href).hostname;
    } catch {
      continue;
    }
    if (isXHost(host) || out.includes(a.href)) continue;
    out.push(a.href);
  }
  return out;
}
