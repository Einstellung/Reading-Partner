// An X link read (docs/84, docs/86): the post itself as a source record, the
// content it is in its own right (a long post, an Article, the author's own
// thread) whose whole text was read, and every link out of it, t.co expanded,
// with where on the post it was found. Nothing here decides what to follow or
// whether the post is a lead: the link agent (info/links) weighs that, and the
// rule-based fan-out still in use until the switch does it in rules.ts.
//
// Two ways to read a post, layered (docs/84 「建议」). The embed endpoint, one
// request on every platform, is enough for a short post. A long post's and an
// Article's text is only on the permalink page, which the signed-out hidden
// webview reads; where there is none (iOS, Windows) that text is not taken at
// all, because the embed's version of it is cut short without saying so
// (pitfall 493) and a cut-short document must never be filed.

import { oneLine } from "../../platform/std/text";
import { rejection, type FetchBytes, type Rejection } from "../../workshop/bindery";
import {
  bodyHtml,
  bodyText,
  focalPost,
  parsePermalinkResult,
  postBodyLines,
  type PagePost,
  type PermalinkRead,
} from "./permalink";
import {
  isXHost,
  largePhoto,
  parseSyndication,
  syndicationUrl,
  UNAVAILABLE,
  xPostOfUrl,
  xPostUrl,
  type XPostShape,
  type XSyndicatedPost,
} from "./post";

/** One load of a permalink page with PERMALINK_SCRIPT run in it. */
export interface PageAttempt {
  /** What the script evaluated to; null when it did not run or threw. */
  value: unknown;
  /** Why the load or the script came up short, when it did. */
  detail: string | null;
}

export interface XReadDeps {
  /** The embed endpoint, and nothing else. */
  fetch: FetchBytes;
  /** The signed-out hidden webview, or null where this device has none. */
  readPage: ((url: string) => Promise<PageAttempt>) | null;
  /** Where a t.co link goes, one redirect, without fetching the target. Null when unknown. */
  resolveRedirect: (url: string) => Promise<string | null>;
  /** Whether a registered site adapter reads this link (workshop/bindery's registry). */
  claimedBySite: (url: string) => boolean;
}

/** What is kept of a post, whatever else comes of it. Stored, so plain data. */
export interface XPostRecord {
  id: string;
  url: string;
  author: { name: string; handle: string };
  postedAt: string;
  shape: XPostShape;
  /** The post's own words: whole when `textComplete`, else the embed's opening. */
  text: string;
  textComplete: boolean;
  articleTitle?: string;
  images: string[];
  /** Videos are not downloaded; the post's URL is the way to them. */
  videos: number;
  /** Every link out of the post, expanded where that was possible. */
  links: string[];
  /** The author's own replies right under it, as far as a signed-out page shows. */
  selfReplies?: string[];
  quoted?: XPostRecord;
}

/** Content that is the post itself, ready to hand the bindery as HTML. */
export interface XOwnDocument {
  postId: string;
  shape: XPostShape;
  title: string;
  author: string;
  publishedAt: string;
  sourceUrl: string;
  html: string;
  chars: number;
}

/** Something about the post that was not taken, and why, for the receipt. */
export interface XSkip {
  /** The link, or the post when it is the post's own text that was not taken. */
  subject: string;
  reason: string;
  /** No hidden webview here: the desktop app can read it (docs/36). */
  needsDesktop?: boolean;
}

/** Where on the post a link was found. */
export type XLinkOrigin = "body" | "card" | "self-reply" | "quoted" | "article";

/** A link out of a post, t.co expanded once read through. */
export interface XLink {
  url: string;
  /** The anchor's words on the page; empty for the embed's links. */
  anchor: string;
  origin: XLinkOrigin;
  /** The post it came out of. */
  postId: string;
}

export interface XPostRead {
  ok: true;
  record: XPostRecord;
  /**
   * The content that is a post in its own right and was read whole: the pasted
   * post's first when it is, then the quoted one's. A cut-short text is never
   * here (pitfall 493); a quoted short post is put under the post quoting it.
   */
  own: XOwnDocument[];
  /** Every link out, in the order found, expanded and deduplicated. */
  links: XLink[];
  skipped: XSkip[];
}

// Fewer characters than this from the page, against the embed's cut-short
// opening, means the page did not hold the post.
const PAGE_SHORTFALL = 0.9;
// A thread of short posts is content once it is as long as one long post.
const THREAD_CHARS = 280;
const TITLE_CHARS = 80;

function titleOf(text: string): string {
  const first = text.split("\n").find((l) => l.trim() !== "") ?? "";
  const line = oneLine(first);
  return line.length > TITLE_CHARS ? `${line.slice(0, TITLE_CHARS - 1).trimEnd()}…` : line;
}

async function syndicated(id: string, deps: XReadDeps): Promise<XSyndicatedPost | Rejection> {
  let res;
  try {
    res = await deps.fetch(syndicationUrl(id));
  } catch {
    return rejection("unreachable", "X's embed endpoint could not be reached");
  }
  if (res.status === 404) return rejection("empty", "the post does not exist or is not public");
  if (!res.ok) return rejection("unreachable", `X's embed endpoint answered HTTP ${res.status}`);
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder("utf-8").decode(res.bytes));
  } catch {
    return rejection("unreachable", "X's embed endpoint did not answer with a post");
  }
  const post = parseSyndication(json);
  if (post === UNAVAILABLE) return rejection("empty", "the post was deleted or is not public");
  if (!post) return rejection("unreachable", "X's embed endpoint did not answer with a post");
  return post;
}

// The permalink page, read once and once more when the first load showed no
// post (the page's own scripts can still be filling it when the fetcher's wait
// ends). A string is why it could not be read.
async function permalink(
  url: string,
  read: (url: string) => Promise<PageAttempt>,
): Promise<PermalinkRead | string> {
  let why = "the page showed no post";
  for (let attempt = 0; attempt < 2; attempt++) {
    let page: PageAttempt;
    try {
      page = await read(url);
    } catch (e) {
      return `the page could not be loaded (${e instanceof Error ? e.message : String(e)})`;
    }
    const parsed = parsePermalinkResult(page.value);
    if (parsed && parsed.posts.length > 0) return parsed;
    if (page.detail) why = `the page showed no post (${page.detail})`;
  }
  return why;
}

interface PostOutcome {
  record: XPostRecord;
  /** The post's own document, when it is content and its whole text was read. */
  document: XOwnDocument | null;
  /** Links out of it, t.co ones unexpanded, in order. */
  links: XLink[];
  skipped: XSkip[];
}

function baseRecord(post: XSyndicatedPost): XPostRecord {
  const images = [...post.photos];
  if (post.article?.cover) images.unshift(post.article.cover);
  return {
    id: post.id,
    url: xPostUrl(post.author.handle, post.id),
    author: post.author,
    postedAt: post.postedAt,
    shape: post.shape,
    text: post.text,
    textComplete: post.shape === "short",
    ...(post.article ? { articleTitle: post.article.title } : {}),
    images,
    videos: post.videos,
    links: [...post.links, ...(post.cardUrl ? [post.cardUrl] : [])],
  };
}

// The links on a page post that leave X, with their words, each once.
function pageLinks(post: PagePost, origin: XLinkOrigin, postId: string): XLink[] {
  const out: XLink[] = [];
  for (const a of post.anchors) {
    let host: string;
    try {
      host = new URL(a.href).hostname;
    } catch {
      continue;
    }
    if (isXHost(host) || out.some((l) => l.url === a.href)) continue;
    out.push({ url: a.href, anchor: a.text, origin, postId });
  }
  return out;
}

// One post read the way docs/84 「建议」 reads it, its quoted post aside.
async function readOne(post: XSyndicatedPost, deps: XReadDeps, quoted: boolean): Promise<PostOutcome> {
  const record = baseRecord(post);
  const skipped: XSkip[] = [];
  const author = post.author.name ? `${post.author.name} (@${post.author.handle})` : `@${post.author.handle}`;
  // An Article's embed link is the Article itself; its references are on the page.
  const embedOrigin = quoted ? ("quoted" as const) : ("body" as const);
  const links: XLink[] =
    post.shape === "article"
      ? []
      : [
          ...post.links.map((url) => ({ url, anchor: "", origin: embedOrigin, postId: post.id })),
          ...(post.cardUrl
            ? [{ url: post.cardUrl, anchor: "", origin: quoted ? ("quoted" as const) : ("card" as const), postId: post.id }]
            : []),
        ];
  if (post.shape === "short") return { record, document: null, links, skipped };

  const what = post.shape === "article" ? "the Article's body" : "the post's full text";
  if (!deps.readPage) {
    skipped.push({
      subject: record.url,
      reason: `${what} is only on the post's page, which this device cannot read; the embed gives only its opening`,
      needsDesktop: true,
    });
    return { record, document: null, links, skipped };
  }
  const page = await permalink(record.url, deps.readPage);
  const found = typeof page === "string" ? null : focalPost(page, post.id, post.author.handle);
  if (!found) {
    skipped.push({
      subject: record.url,
      reason: `${what} could not be read: ${typeof page === "string" ? page : "the page did not show this post"}`,
    });
    return { record, document: null, links, skipped };
  }

  const isArticle = post.shape === "article";
  const lines = postBodyLines(found.focal.text, {
    handle: post.author.handle,
    ...(isArticle && post.article?.title ? { after: post.article.title, keepQuotes: true } : {}),
  });
  const text = bodyText(lines);
  const floor = isArticle ? (post.article?.preview.length ?? 0) : post.text.length;
  if (text.length < floor * PAGE_SHORTFALL) {
    skipped.push({
      subject: record.url,
      reason: `${what} could not be read: the page held less text (${text.length} characters) than the embed's opening`,
    });
    return { record, document: null, links, skipped };
  }

  const replies = isArticle ? [] : found.selfReplies;
  const replyLines = replies.map((r) => postBodyLines(r.text, { handle: post.author.handle, reply: true }));
  const replyTexts = replyLines.map(bodyText).filter((t) => t !== "");
  record.text = isArticle ? record.text : text;
  record.textComplete = !isArticle;
  if (replyTexts.length > 0) record.selfReplies = replyTexts;
  const pageImages = found.focal.images;
  if (pageImages.length > 0) {
    record.images = [...new Set([...record.images, ...pageImages.map(largePhoto)])];
  }
  if (isArticle) links.push(...pageLinks(found.focal, "article", post.id));
  else {
    links.push(...pageLinks(found.focal, embedOrigin, post.id));
    for (const r of replies) links.push(...pageLinks(r, quoted ? "quoted" : "self-reply", post.id));
  }

  const parts = [bodyHtml(lines, pageImages)];
  replies.forEach((r: PagePost, i) => {
    if (bodyText(replyLines[i]) !== "") parts.push(bodyHtml(replyLines[i], r.images));
  });
  const chars = text.length + replyTexts.reduce((n, t) => n + t.length, 0);
  return {
    record,
    document: {
      postId: post.id,
      shape: post.shape,
      title: isArticle && post.article?.title ? post.article.title : titleOf(text),
      author,
      publishedAt: post.postedAt,
      sourceUrl: record.url,
      html: parts.join("\n<hr>\n"),
      chars,
    },
    links,
    skipped,
  };
}

// A short post with the author's thread under it is content once the thread is
// long. The embed never shows the thread, so this only happens to posts whose
// page was read for another reason; kept as one rule so it is not forgotten.
function isContent(outcome: PostOutcome): boolean {
  return outcome.document !== null && (outcome.record.shape !== "short" || outcome.document.chars >= THREAD_CHARS);
}

function quotedHtml(record: XPostRecord): string {
  const who = record.author.name ? `${record.author.name} (@${record.author.handle})` : `@${record.author.handle}`;
  const para = (s: string) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c] ?? c);
  return `<blockquote><p>${para(who)}</p><p>${para(record.text).replace(/\n/g, "<br>")}</p></blockquote>`;
}

/** The key two links are the same link by: no protocol, `www.`, fragment or trailing slash. */
function linkKey(url: string): string {
  return url
    .replace(/^https?:\/\/(?:www\.)?/i, "")
    .replace(/#.*$/, "")
    .replace(/\/+$/, "");
}

/**
 * Read the post a link is about: its record, its own content where it was read
 * whole, and every link out of it. A rejection is a post that could not be read
 * at all (gone, private, X unreachable); anything less is in `skipped` beside
 * whatever could be read.
 */
export async function readPost(url: string, deps: XReadDeps): Promise<XPostRead | Rejection> {
  const ref = xPostOfUrl(url);
  if (!ref) return rejection("no-adapter", "the link is not an X post");
  const post = await syndicated(ref.id, deps);
  if ("ok" in post) return post;

  const main = await readOne(post, deps, false);
  const own: XOwnDocument[] = [];
  const skipped = [...main.skipped];
  const found: XLink[] = [...main.links];
  if (main.document && isContent(main)) own.push(main.document);

  if (post.quoted) {
    // The quoted post is read the same way. When it is not content of its own,
    // its words go where X shows them: under the quoting post.
    const quoted = await readOne(post.quoted, deps, true);
    main.record.quoted = quoted.record;
    skipped.push(...quoted.skipped);
    found.push(...quoted.links);
    if (quoted.document && isContent(quoted)) own.push(quoted.document);
    else if (own[0]?.postId === post.id) {
      own[0] = { ...own[0], html: `${own[0].html}\n${quotedHtml(quoted.record)}` };
    }
  }

  const links: XLink[] = [];
  const seen = new Set<string>();
  for (const link of found) {
    let target = link.url;
    if (/^https?:\/\/t\.co\//i.test(target)) {
      const expanded = await deps.resolveRedirect(target).catch(() => null);
      if (!expanded) {
        skipped.push({ subject: target, reason: "the t.co link did not resolve" });
        continue;
      }
      target = expanded;
      const record = link.postId === post.id ? main.record : main.record.quoted;
      if (record) record.links = record.links.map((l) => (l === link.url ? expanded : l));
    }
    const key = linkKey(target);
    if (seen.has(key)) continue;
    seen.add(key);
    links.push({ ...link, url: target });
  }
  for (const record of [main.record, main.record.quoted]) {
    if (record) record.links = [...new Set(record.links)];
  }
  return { ok: true, record: main.record, own, links, skipped };
}
