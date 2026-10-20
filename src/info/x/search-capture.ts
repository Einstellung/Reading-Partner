// Reading the answers X's own page receives (docs/info/88 「取材 / X」,
// docs/research/X搜索响应被动捕获可行性.md).
//
// The X reader opens its browse session with `X_CAPTURE_SCRIPT` as the
// session's document-start script. On an X page it wraps `fetch` and
// `XMLHttpRequest`; for an answer to one of the GraphQL calls in
// graphql-post.ts it keeps a copy of the body (`Response.clone()` for fetch,
// the finished XHR's own text), and hands the copies over through one named
// global, `window.__readingPartnerXCapture`, which the reader empties with
// `X_CAPTURE_DRAIN` between screens. It adds no request, changes none, and
// does not touch the page's own copy. It hides nothing either: the wrappers
// are plain functions and the global is a plain property. On any other site
// the script does nothing.
//
// What the reader does with the posts: `withCaptured` puts the whole text,
// the links and the exact counts over what the search card showed (for an X
// Article, whose card shows no text, its title and preview), and
// `captureMismatch` cross-checks the two. The DOM stays the primary reading
// and the fallback; a post the answers do not cover is read exactly as before.

import { isObject } from "../../platform/std/json";
import { postsOfAnswer, X_CAPTURED_OPERATIONS, type XCapturedPost } from "./graphql-post";
import type { XLinkOut, XQuoted, XSearchPost } from "./search-page";
import { snowflakeTime } from "./snowflake";
import { linkKey } from "./text-links";

/** The global the page script hands the copies over through. */
export const X_CAPTURE_CHANNEL = "__readingPartnerXCapture";

/** The page hosts the script works on; anywhere else it does nothing. */
export const X_CAPTURE_HOSTS = ["x.com", "twitter.com"] as const;

/** Bodies the page keeps until the next drain; the oldest goes first past this. */
const KEEP_BODIES = 40;
/** A body longer than this, in characters, is not kept. */
const MAX_BODY_CHARS = 8_000_000;

/**
 * The document-start script for an X browse session. `hosts` is where it
 * works (subdomains included); tests point it at a local page.
 */
export function xCaptureScript(hosts: readonly string[] = X_CAPTURE_HOSTS): string {
  const ops = X_CAPTURED_OPERATIONS.join("|");
  return String.raw`(() => {
  const hosts = ${JSON.stringify(hosts)};
  const here = location.hostname;
  if (!hosts.some((h) => here === h || here.endsWith("." + h))) return;
  if (window.${X_CAPTURE_CHANNEL}) return;
  const opOf = (url) => {
    const m = /\/graphql\/[^/?#]+\/(${ops})(?:[?#]|$)/.exec(String(url || ""));
    return m ? m[1] : null;
  };
  const bodies = [];
  let seen = 0;
  let dropped = 0;
  const keep = (op, text) => {
    seen++;
    if (typeof text !== "string" || text.length === 0 || text.length > ${MAX_BODY_CHARS}) { dropped++; return; }
    if (bodies.length >= ${KEEP_BODIES}) { bodies.shift(); dropped++; }
    bodies.push({ op, text });
  };
  window.${X_CAPTURE_CHANNEL} = {
    drain() {
      const out = { bodies: bodies.splice(0), seen, dropped };
      seen = 0;
      dropped = 0;
      return out;
    },
  };
  const pageFetch = window.fetch;
  if (typeof pageFetch === "function") {
    window.fetch = function (input) {
      const answer = pageFetch.apply(this, arguments);
      const op = opOf(input && typeof input === "object" && "url" in input ? input.url : input);
      if (op) {
        answer.then((res) => {
          if (res && res.ok) res.clone().text().then((text) => keep(op, text), () => {});
        }, () => {});
      }
      return answer;
    };
  }
  const XHR = window.XMLHttpRequest;
  if (typeof XHR === "function") {
    const ops = new WeakMap();
    const open = XHR.prototype.open;
    const send = XHR.prototype.send;
    XHR.prototype.open = function (method, url) {
      ops.set(this, opOf(url));
      return open.apply(this, arguments);
    };
    XHR.prototype.send = function () {
      const op = ops.get(this);
      if (op) {
        this.addEventListener("load", () => {
          if (this.status < 200 || this.status >= 300) return;
          try {
            const type = this.responseType;
            if (type === "" || type === "text") keep(op, this.responseText);
            else if (type === "json") keep(op, JSON.stringify(this.response));
          } catch (e) {}
        });
      }
      return send.apply(this, arguments);
    };
  }
})();`;
}

export const X_CAPTURE_SCRIPT = xCaptureScript();

/** Evaluated in the page: the bodies kept since the last drain, and the page forgets them. Null when the script is not there. */
export const X_CAPTURE_DRAIN = `(() => { const c = window.${X_CAPTURE_CHANNEL}; return c && typeof c.drain === "function" ? c.drain() : null; })()`;

/** What one drain gave. `hooked` is false when the page has no capture at all. */
export interface XCaptureDrain {
  hooked: boolean;
  /** Bodies handed over, and how many of them parsed. */
  bodies: number;
  parsed: number;
  /** Answers the page saw since the last drain, kept or not; and those not kept. */
  seen: number;
  dropped: number;
  posts: Map<string, XCapturedPost>;
}

/** Read what X_CAPTURE_DRAIN answered into posts, merged into `into` when given. */
export function parseCaptureDrain(value: unknown, into: Map<string, XCapturedPost> = new Map()): XCaptureDrain {
  const out: XCaptureDrain = { hooked: false, bodies: 0, parsed: 0, seen: 0, dropped: 0, posts: into };
  if (!isObject(value) || !Array.isArray(value.bodies)) return out;
  out.hooked = true;
  out.seen = typeof value.seen === "number" ? value.seen : 0;
  out.dropped = typeof value.dropped === "number" ? value.dropped : 0;
  for (const body of value.bodies) {
    if (!isObject(body) || typeof body.text !== "string") continue;
    out.bodies++;
    let answer: unknown;
    try {
      answer = JSON.parse(body.text);
    } catch {
      continue;
    }
    out.parsed++;
    postsOfAnswer(answer, into);
  }
  return out;
}

/** A captured link as the search reading keeps one. */
function linkOut(l: XCapturedPost["links"][number]): XLinkOut {
  return { tco: l.tco, url: l.url, card: l.card };
}

/** Links added to `links`, each once: the same t.co, or the same target. */
export function mergeLinks(links: readonly XLinkOut[], more: readonly XLinkOut[]): XLinkOut[] {
  const merged = [...links];
  for (const l of more) {
    const same = merged.findIndex(
      (m) => (l.tco !== null && m.tco === l.tco) || (l.url !== null && m.url !== null && linkKey(m.url) === linkKey(l.url)),
    );
    if (same < 0) merged.push(l);
    else if (l.url && !merged[same].url) merged[same] = { ...merged[same], url: l.url, card: merged[same].card && l.card };
  }
  return merged;
}

/**
 * An X Article's text as far as the answer has it: the post's own words, the
 * title, the preview, each left out when what comes before already holds it.
 * Empty when there is none of them.
 */
function articleText(own: string, article: NonNullable<XCapturedPost["article"]>): string {
  const parts: string[] = [];
  for (const part of [own.trim(), article.title, article.preview]) {
    if (part && !squash(parts.join(" ")).includes(squash(part))) parts.push(part);
  }
  return parts.join("\n\n");
}

function quotedFrom(dom: XQuoted | null, cap: XCapturedPost): XQuoted {
  return {
    id: cap.id,
    handle: cap.handle ?? dom?.handle ?? null,
    name: dom?.name || cap.name || "",
    text: cap.text || dom?.text || (cap.article ? articleText("", cap.article) : ""),
    postedAt: snowflakeTime(cap.id) ?? dom?.postedAt ?? null,
    truncated: cap.article !== null,
    links: cap.links.filter((l) => l.url !== null).map((l) => l.url as string),
  };
}

/**
 * A search card with what the page's own answer says about the same post: the
 * whole text, the links out, exact counts, the quoted post whole. An X
 * Article's card shows no text: it takes the article's title and preview from
 * the answer, and its id and title are kept on the post. It is still cut short,
 * since its body is not in the answer. The quoted post's links stay on the
 * quoted post.
 */
export function withCaptured(post: XSearchPost, cap: XCapturedPost): XSearchPost {
  const article = post.article || cap.article !== null;
  const text = !article ? cap.text || post.text : cap.article ? articleText(cap.text || post.text, cap.article) : post.text;
  const counts = { ...post.counts };
  for (const k of Object.keys(counts) as (keyof typeof counts)[]) counts[k] = cap.counts[k] ?? counts[k];
  return {
    ...post,
    name: post.name || cap.name || "",
    text,
    truncated: article ? true : cap.text ? false : post.truncated,
    article,
    ...(cap.article?.id ? { articleId: cap.article.id } : {}),
    ...(cap.article?.title ? { articleTitle: cap.article.title } : {}),
    counts,
    links: mergeLinks(post.links, cap.links.map(linkOut)),
    quoted: cap.quoted ? quotedFrom(post.quoted, cap.quoted) : post.quoted,
  };
}

/**
 * Text as both readings can agree on it: links left out (the card spells a
 * link as it shows it, the answer as it expands it), emoji variation selectors
 * dropped (the page's text leaves out some the answer has: "❤️♾" for
 * "❤️♾️"), whitespace collapsed, case ignored.
 */
function squash(s: string): string {
  return s
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[\uFE0E\uFE0F]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * Why the search card and the captured answer do not look like the same post,
 * or null when they agree: the handle, and the start of the text as `squash`
 * leaves it. An Article's card text is not the post's text, so it is not
 * compared.
 */
export function captureMismatch(post: Pick<XSearchPost, "handle" | "text" | "article">, cap: XCapturedPost): string | null {
  if (cap.handle && cap.handle.toLowerCase() !== post.handle.toLowerCase()) return `handle @${post.handle} on the page, @${cap.handle} in the answer`;
  if (post.article || cap.article) return null;
  const page = squash(post.text).slice(0, 40);
  const answer = squash(cap.text).slice(0, 40);
  if (!page || !answer) return null;
  const n = Math.min(page.length, answer.length);
  if (page.slice(0, n) === answer.slice(0, n)) return null;
  return `text starts "${page}" on the page, "${answer}" in the answer`;
}
