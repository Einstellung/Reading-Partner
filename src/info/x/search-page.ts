// Reading X's search page in the browse session (docs/info/88 「取材 / X」).
//
// Signed in, x.com marks a post's parts with `data-testid` (unlike the
// signed-out permalink page, permalink.ts): `tweetText`, `User-Name`, the
// count buttons, `tweet-text-show-more-link`. A quoted post sits inside its
// quoting post's <article> as a `div[role="link"]` with its own User-Name and
// tweetText, and no link to its own status. The script reads every post in the
// DOM with where it sits on screen, and this file turns that into the fields
// the program writes: the id, the handle, the time decoded from the id (a post
// whose page time disagrees by more than a day is dropped), the counts, the
// links out, whether the text is cut, the quoted post.
//
// A link in a post's text is a t.co anchor whose text is the whole target URL,
// the part past the shown width in aria-hidden spans, so the page itself
// expands it. A link card's anchor carries only t.co and the domain; that one
// is expanded off t.co's redirect by the caller (outbound.ts).

import { isObject } from "../../platform/std/json";
import { xPostUrl } from "./post";
import { snowflakeAgrees, snowflakeTime } from "./snowflake";

export type XSearchOrder = "top" | "live";

/** One search page: the query, its order, and an optional `since:`/`until:` window (YYYY-MM-DD). */
export interface XSearchLineSpec {
  query: string;
  order: XSearchOrder;
  since?: string;
  until?: string;
}

/** The search page for a line. Retweets are left out; `f=live` is newest first, no `f` is X's "Top". */
export function xSearchUrl(line: XSearchLineSpec): string {
  const q = [line.query, line.since && `since:${line.since}`, line.until && `until:${line.until}`, "-filter:retweets"]
    .filter(Boolean)
    .join(" ");
  const params = new URLSearchParams({ q, src: "typed_query" });
  if (line.order === "live") params.set("f", "live");
  return `https://x.com/search?${params.toString()}`;
}

/** Wait condition for a search page: posts showed, the page went somewhere else, or it said why not. */
export const SEARCH_READY = String.raw`(() => {
  if (document.querySelectorAll("article time").length > 0) return true;
  if (!location.pathname.startsWith("/search")) return true;
  const t = document.body ? document.body.innerText : "";
  return /Something went wrong|No results for|Try again|rate limit/i.test(t);
})()`;

/**
 * Evaluated in the page; its value is JSON. Reads only: it never changes the
 * page, since the page goes on being scrolled after it.
 */
export const SEARCH_PAGE_SCRIPT = String.raw`(() => {
  const view = innerHeight;
  const inQuote = (article, el) => {
    const q = el.closest('div[role="link"]');
    return q !== null && article.contains(q) && q !== article;
  };
  const own = (article, sel) => Array.from(article.querySelectorAll(sel)).filter((el) => !inQuote(article, el));
  const inside = (root, sel) => Array.from(root.querySelectorAll(sel));
  // Text as shown, emoji pictures as their characters, a t.co link as the
  // whole URL it stands for (its hidden spans hold the rest), no ellipsis.
  const textOf = (el) => {
    let out = "";
    const walk = (node) => {
      if (node.nodeType === 3) { out += node.nodeValue; return; }
      if (node.nodeType !== 1) return;
      if (node.tagName === "IMG") { out += node.getAttribute("alt") || ""; return; }
      if (node.tagName === "A" && /^https:\/\/t\.co\//.test(node.getAttribute("href") || "")) {
        out += (node.textContent || "").replace(/…$/, "");
        return;
      }
      for (const c of Array.from(node.childNodes)) walk(c);
    };
    walk(el);
    return out;
  };
  const label = (el) => (el ? el.getAttribute("aria-label") || "" : null);
  const posts = [];
  for (const article of Array.from(document.querySelectorAll("article"))) {
    if (article.parentElement && article.parentElement.closest("article")) continue;
    const time = own(article, "time")[0] || null;
    const link = time ? time.closest("a[href]") : null;
    const quoteBox = Array.from(article.querySelectorAll('div[role="link"]')).find((d) => d.querySelector('[data-testid="User-Name"]')) || null;
    const rect = article.getBoundingClientRect();
    const tweetText = own(article, '[data-testid="tweetText"]')[0] || null;
    const links = [];
    for (const a of own(article, 'a[href^="https://t.co/"]')) {
      links.push({ href: a.getAttribute("href"), text: textOf(a), label: a.getAttribute("aria-label") || "", card: !!a.closest('[data-testid="card.wrapper"]') });
    }
    let quote = null;
    if (quoteBox) {
      const qt = quoteBox.querySelector('[data-testid="tweetText"]');
      const qtime = quoteBox.querySelector("time");
      quote = {
        userName: textOf(quoteBox.querySelector('[data-testid="User-Name"]')),
        text: qt ? textOf(qt) : "",
        datetime: qtime ? qtime.getAttribute("datetime") : null,
        paths: inside(quoteBox, 'a[href*="/status/"]').map((a) => a.getAttribute("href")),
        showMore: !!quoteBox.querySelector('[data-testid="tweet-text-show-more-link"]'),
      };
    }
    posts.push({
      path: link ? link.getAttribute("href") : null,
      datetime: time ? time.getAttribute("datetime") : null,
      userName: (own(article, '[data-testid="User-Name"]')[0] && textOf(own(article, '[data-testid="User-Name"]')[0])) || "",
      text: tweetText ? textOf(tweetText) : "",
      showMore: own(article, '[data-testid="tweet-text-show-more-link"]').length > 0,
      article: own(article, '[data-testid="article-cover-image"]').length > 0,
      counts: {
        reply: label(own(article, '[data-testid="reply"]')[0]),
        retweet: label(own(article, '[data-testid="retweet"], [data-testid="unretweet"]')[0]),
        like: label(own(article, '[data-testid="like"], [data-testid="unlike"]')[0]),
        bookmark: label(own(article, '[data-testid="bookmark"], [data-testid="removeBookmark"]')[0]),
        views: label(own(article, 'a[href$="/analytics"]')[0]),
      },
      links,
      quote,
      top: Math.round(rect.top),
      bottom: Math.round(rect.bottom),
      chars: (article.innerText || article.textContent || "").length,
    });
  }
  const col = document.querySelector('[data-testid="primaryColumn"]') || document.body;
  let chrome = "";
  if (col) {
    const walker = document.createTreeWalker(col, 4);
    for (let n = walker.nextNode(); n && chrome.length < 3000; n = walker.nextNode()) {
      if (n.parentElement && n.parentElement.closest("article")) continue;
      const t = (n.nodeValue || "").trim();
      if (t) chrome += t + "\n";
    }
  }
  const root = document.scrollingElement || document.documentElement;
  return {
    path: location.pathname,
    href: location.href,
    title: document.title,
    textChars: ((document.body && (document.body.innerText || document.body.textContent)) || "").length,
    viewport: view,
    scrollY: Math.round(scrollY),
    height: root ? root.scrollHeight : 0,
    loginWall: !!document.querySelector('[data-testid="loginButton"], [data-testid="signupButton"], a[href="/login"], a[href="/i/flow/login"]'),
    chrome,
    posts,
  };
})()`;

export interface XCounts {
  replies: number | null;
  reposts: number | null;
  likes: number | null;
  bookmarks: number | null;
  views: number | null;
  /** The search page never shows quote counts; only a permalink page does. */
  quotes: number | null;
}

export interface XLinkOut {
  /** The t.co link the post carries. */
  tco: string;
  /** The real target: from the page when it spells it out, else from t.co's redirect, else null. */
  url: string | null;
  /** A card's link (title and domain only on the page) rather than one in the text. */
  card: boolean;
}

export interface XQuoted {
  /** Null when the page does not link the quoted post (it usually does not). */
  id: string | null;
  handle: string | null;
  name: string;
  text: string;
  postedAt: number | null;
  truncated: boolean;
}

/** One post off a search page: every field written by the program, none by a model. */
export interface XSearchPost {
  id: string;
  handle: string;
  name: string;
  /** The post's own text as the page shows it, links spelled out. Cut when `truncated`. */
  text: string;
  /** Time decoded from the id (snowflake), epoch ms. */
  postedAt: number;
  /** Time the page showed, epoch ms; agrees with `postedAt` within a day. */
  shownAt: number | null;
  counts: XCounts;
  links: XLinkOut[];
  /** The page shows only the start: a long post ("Show more") or an X Article. */
  truncated: boolean;
  article: boolean;
  quoted: XQuoted | null;
  permalink: string;
}

/** A post as the page answered it, with where it sits on screen this read. */
export interface XScreenPost {
  post: XSearchPost;
  /** Some of it is inside the viewport. */
  onScreen: boolean;
  /** Characters a reader reads in it: its text and the quoted post's. */
  readChars: number;
  /** Characters in the whole post as laid out: names, time, counts, card titles too. */
  wholeChars: number;
}

export interface XSearchRead {
  path: string;
  href: string;
  textChars: number;
  viewport: number;
  scrollY: number;
  height: number;
  loginWall: boolean;
  /** Page text outside every post, where error and limit messages are. */
  chrome: string;
  posts: XScreenPost[];
  /** Posts read but not kept: no status link, or a page time a day off the id's. */
  dropped: { id: string | null; reason: "no-id" | "time-mismatch" }[];
}

const STATUS_PATH = /^\/([A-Za-z0-9_]{1,15})\/status\/(\d{1,20})(?:\/|$)/;
const HANDLE_IN_NAME = /@([A-Za-z0-9_]{1,15})/;

/** The first whole number in an aria-label ("1,234 Likes. Like"); a label with none is 0. */
export function countOf(label: unknown): number | null {
  if (typeof label !== "string") return null;
  const m = /(\d[\d,.]*)/.exec(label);
  if (!m) return 0;
  const n = Number(m[1].replace(/[,.]/g, ""));
  return Number.isFinite(n) ? n : null;
}

/** The display name: what User-Name shows before the @handle. */
function nameOf(userName: string): string {
  const at = userName.search(HANDLE_IN_NAME);
  return (at >= 0 ? userName.slice(0, at) : userName).trim();
}

/** A t.co anchor's text when it spells out an http(s) URL. */
function spelledUrl(text: string): string | null {
  const t = text.trim();
  if (!/^https?:\/\/\S+$/.test(t)) return null;
  try {
    return new URL(t).toString();
  } catch {
    return null;
  }
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function parseQuote(raw: unknown): XQuoted | null {
  if (!isObject(raw)) return null;
  const userName = str(raw.userName);
  const handle = HANDLE_IN_NAME.exec(userName)?.[1] ?? null;
  const paths = Array.isArray(raw.paths) ? raw.paths.map(str) : [];
  const status = paths.map((p) => STATUS_PATH.exec(p)).find((m) => m !== null) ?? null;
  const id = status ? status[2] : null;
  const shown = typeof raw.datetime === "string" ? Date.parse(raw.datetime) : NaN;
  return {
    id,
    handle: handle ?? status?.[1] ?? null,
    name: nameOf(userName),
    text: str(raw.text).trim(),
    postedAt: id !== null ? snowflakeTime(id) : Number.isFinite(shown) ? shown : null,
    truncated: raw.showMore === true,
  };
}

/** What SEARCH_PAGE_SCRIPT answered, or null when it is not that shape. */
export function parseSearchRead(value: unknown): XSearchRead | null {
  if (!isObject(value) || !Array.isArray(value.posts)) return null;
  const viewport = num(value.viewport);
  const posts: XScreenPost[] = [];
  const dropped: XSearchRead["dropped"] = [];
  for (const raw of value.posts) {
    if (!isObject(raw)) continue;
    const status = STATUS_PATH.exec(str(raw.path));
    if (!status) {
      dropped.push({ id: null, reason: "no-id" });
      continue;
    }
    const [, handle, id] = status;
    const postedAt = snowflakeTime(id);
    if (postedAt === null) {
      dropped.push({ id, reason: "no-id" });
      continue;
    }
    const shown = typeof raw.datetime === "string" ? Date.parse(raw.datetime) : NaN;
    const shownAt = Number.isFinite(shown) ? shown : null;
    if (shownAt !== null && !snowflakeAgrees(id, shownAt)) {
      dropped.push({ id, reason: "time-mismatch" });
      continue;
    }
    const counts = isObject(raw.counts) ? raw.counts : {};
    const links: XLinkOut[] = [];
    for (const l of Array.isArray(raw.links) ? raw.links : []) {
      if (!isObject(l)) continue;
      const tco = str(l.href);
      if (!/^https:\/\/t\.co\/\w+$/.test(tco)) continue;
      const url = spelledUrl(str(l.text));
      const at = links.findIndex((x) => x.tco === tco);
      if (at >= 0) {
        if (url && !links[at].url) links[at] = { ...links[at], url, card: false };
        continue;
      }
      links.push({ tco, url, card: l.card === true && !url });
    }
    const article = raw.article === true;
    const quoted = parseQuote(raw.quote);
    const text = str(raw.text).trim();
    const top = num(raw.top);
    const bottom = num(raw.bottom);
    posts.push({
      post: {
        id,
        handle,
        name: nameOf(str(raw.userName)),
        text,
        postedAt,
        shownAt,
        counts: {
          replies: countOf(counts.reply),
          reposts: countOf(counts.retweet),
          likes: countOf(counts.like),
          bookmarks: countOf(counts.bookmark),
          views: countOf(counts.views),
          quotes: null,
        },
        links,
        truncated: raw.showMore === true || article,
        article,
        quoted,
        permalink: xPostUrl(handle, id),
      },
      onScreen: viewport > 0 ? bottom > 0 && top < viewport : true,
      readChars: text.length + (quoted ? quoted.text.length : 0),
      wholeChars: num(raw.chars),
    });
  }
  return {
    path: str(value.path),
    href: str(value.href),
    textChars: num(value.textChars),
    viewport,
    scrollY: num(value.scrollY),
    height: num(value.height),
    loginWall: value.loginWall === true,
    chrome: str(value.chrome),
    posts,
    dropped,
  };
}

/** Why a run must stop touching X now (docs/info/88 「停手」). */
export type XHaltKind = "signed-out" | "challenge" | "rate-limited" | "structure";

export interface XHalt {
  kind: XHaltKind;
  detail: string;
}

const LOGIN_PATH = /^\/(i\/flow\/login|login|i\/flow\/signup|logout)(\/|$)/;
const CHALLENGE_PATH = /^\/(account\/access|i\/flow\/(consent|challenge)|account\/(locked|suspended))/;
const CHALLENGE_TEXT = /verify (you are|you're) (a )?human|confirm (it'?s|that it'?s) you|unusual (login )?activity|account (is )?(locked|suspended)|Arkose|captcha|验证你是|账号已被锁定/i;
const LIMIT_TEXT = /rate limit|try again later|too many requests|Something went wrong|稍后再试|请求过多|出错了/i;

/**
 * Whether the page in front of the reader means stop. Only the page's own
 * words and where it landed count: the page's background calls answering 403
 * signed in is normal (docs/pitfall/494).
 */
export function pageHalt(read: Pick<XSearchRead, "path" | "loginWall" | "chrome">, expect: "search" | "status"): XHalt | null {
  const path = read.path;
  if (LOGIN_PATH.test(path) || read.loginWall) return { kind: "signed-out", detail: `landed on ${path}${read.loginWall ? " with a sign-in wall" : ""}` };
  if (CHALLENGE_PATH.test(path)) return { kind: "challenge", detail: `landed on ${path}` };
  if (CHALLENGE_TEXT.test(read.chrome)) return { kind: "challenge", detail: firstMatch(read.chrome, CHALLENGE_TEXT) };
  if (LIMIT_TEXT.test(read.chrome)) return { kind: "rate-limited", detail: firstMatch(read.chrome, LIMIT_TEXT) };
  if (expect === "search" && !path.startsWith("/search")) return { kind: "signed-out", detail: `left the search page for ${path}` };
  if (expect === "status" && !STATUS_PATH.test(path)) return { kind: "signed-out", detail: `left the post for ${path}` };
  return null;
}

function firstMatch(text: string, re: RegExp): string {
  const line = text.split("\n").find((l) => re.test(l)) ?? "";
  return `page says "${line.slice(0, 120)}"`;
}

/** X says the search has nothing (more) to show. */
export function noResults(read: Pick<XSearchRead, "chrome">): boolean {
  return /No results for|未找到|没有结果/i.test(read.chrome);
}

/** Page text outside the posts, for the permalink page's halt check. Same walk as the search script. */
export const PAGE_CHROME_SCRIPT = String.raw`(() => {
  let chrome = "";
  const col = document.querySelector('[data-testid="primaryColumn"]') || document.body;
  if (col) {
    const walker = document.createTreeWalker(col, 4);
    for (let n = walker.nextNode(); n && chrome.length < 3000; n = walker.nextNode()) {
      if (n.parentElement && n.parentElement.closest("article")) continue;
      const t = (n.nodeValue || "").trim();
      if (t) chrome += t + "\n";
    }
  }
  return { path: location.pathname, chrome,
    loginWall: !!document.querySelector('[data-testid="loginButton"], [data-testid="signupButton"], a[href="/login"], a[href="/i/flow/login"]') };
})()`;
