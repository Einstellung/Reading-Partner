// An X link read as a lead (docs/84): the post itself as a source record, the
// content it is in its own right (a long post, an Article, the author's own
// thread) as documents to build, and the links out of it that are worth
// following. Nothing here builds or files anything — the reading side hands the
// documents to the bindery and each followed link to the bindery's registry,
// and keeps the record beside what came of them.
//
// Two ways to read a post, layered (docs/84 「建议」). The embed endpoint, one
// request on every platform, is enough for a short post. A long post's and an
// Article's text is only on the permalink page, which the signed-out hidden
// webview reads; where there is none (iOS, Windows) that text is not taken at
// all, because the embed's version of it is cut short without saying so
// (pitfall 493) and a cut-short document must never be filed.

import { oneLine } from "../../platform/std/text";
import { rejection, type FetchBytes, type Rejection } from "../../workshop/bindery";
import { classifyOutbound } from "./outbound";
import {
  bodyHtml,
  bodyText,
  focalPost,
  outboundAnchors,
  parsePermalinkResult,
  postBodyLines,
  type PagePost,
  type PermalinkRead,
} from "./permalink";
import {
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

/** A link out of a post to hand the bindery's registry. */
export interface XTarget {
  url: string;
  kind: string;
  /** The post it came out of. */
  postId: string;
}

/** Something about the post that was not taken, and why, for the receipt. */
export interface XSkip {
  /** The link, or the post when it is the post's own text that was not taken. */
  subject: string;
  reason: string;
  /** No hidden webview here: the desktop app can read it (docs/36). */
  needsDesktop?: boolean;
}

export interface XReading {
  ok: true;
  record: XPostRecord;
  documents: XOwnDocument[];
  follow: XTarget[];
  skipped: XSkip[];
}

/** Links followed out of one pasted post, the quoted one's included. */
export const MAX_FOLLOW = 6;
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
  /** Links worth looking at, t.co ones unexpanded, in order. */
  candidates: string[];
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

// One post through the decision of docs/84 「建议」, its quoted post aside.
async function readOne(post: XSyndicatedPost, deps: XReadDeps): Promise<PostOutcome> {
  const record = baseRecord(post);
  const skipped: XSkip[] = [];
  const author = post.author.name ? `${post.author.name} (@${post.author.handle})` : `@${post.author.handle}`;
  // An Article's links are its references, not what it is about (docs/84 外链实测 6).
  const candidates = post.shape === "article" ? [] : [...record.links];
  if (post.shape === "short") return { record, document: null, candidates, skipped };

  const what = post.shape === "article" ? "the Article's body" : "the post's full text";
  if (!deps.readPage) {
    skipped.push({
      subject: record.url,
      reason: `${what} is only on the post's page, which this device cannot read; the embed gives only its opening`,
      needsDesktop: true,
    });
    return { record, document: null, candidates, skipped };
  }
  const page = await permalink(record.url, deps.readPage);
  const found = typeof page === "string" ? null : focalPost(page, post.id, post.author.handle);
  if (!found) {
    skipped.push({
      subject: record.url,
      reason: `${what} could not be read: ${typeof page === "string" ? page : "the page did not show this post"}`,
    });
    return { record, document: null, candidates, skipped };
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
    return { record, document: null, candidates, skipped };
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
  if (!isArticle) {
    for (const p of [found.focal, ...replies]) candidates.push(...outboundAnchors(p));
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
    candidates,
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

/**
 * Read the post a link is about: what to keep, build and follow. A rejection is
 * a post that could not be read at all (gone, private, X unreachable); anything
 * less is in `skipped` beside whatever could be read.
 */
export async function readXPost(url: string, deps: XReadDeps): Promise<XReading | Rejection> {
  const ref = xPostOfUrl(url);
  if (!ref) return rejection("no-adapter", "the link is not an X post");
  const post = await syndicated(ref.id, deps);
  if ("ok" in post) return post;

  const main = await readOne(post, deps);
  const documents: XOwnDocument[] = [];
  const skipped = [...main.skipped];
  const candidates: { url: string; postId: string }[] = main.candidates.map((u) => ({ url: u, postId: post.id }));
  if (main.document && isContent(main)) documents.push(main.document);

  if (post.quoted) {
    // The quoted post goes through the same decision. When it is not content
    // of its own, its words go where X shows them: under the quoting post.
    const quoted = await readOne(post.quoted, deps);
    main.record.quoted = quoted.record;
    skipped.push(...quoted.skipped);
    candidates.push(...quoted.candidates.map((u) => ({ url: u, postId: post.quoted!.id })));
    if (quoted.document && isContent(quoted)) documents.push(quoted.document);
    else if (documents[0]?.postId === post.id) {
      documents[0] = { ...documents[0], html: `${documents[0].html}\n${quotedHtml(quoted.record)}` };
    }
  }

  const follow: XTarget[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    let target = candidate.url;
    if (/^https?:\/\/t\.co\//i.test(target)) {
      const expanded = await deps.resolveRedirect(target).catch(() => null);
      if (!expanded) {
        skipped.push({ subject: target, reason: "the t.co link did not resolve" });
        continue;
      }
      target = expanded;
      const record = candidate.postId === post.id ? main.record : main.record.quoted;
      if (record) record.links = record.links.map((l) => (l === candidate.url ? expanded : l));
    }
    const key = target
      .replace(/^https?:\/\/(?:www\.)?/i, "")
      .replace(/#.*$/, "")
      .replace(/\/+$/, "");
    if (seen.has(key)) continue;
    seen.add(key);
    const verdict = classifyOutbound(target, deps.claimedBySite);
    if (!verdict.follow) {
      skipped.push({ subject: target, reason: verdict.reason });
      continue;
    }
    if (follow.length >= MAX_FOLLOW) {
      skipped.push({ subject: target, reason: `past the first ${MAX_FOLLOW} links` });
      continue;
    }
    follow.push({ url: target, kind: verdict.kind, postId: candidate.postId });
  }
  for (const record of [main.record, main.record.quoted]) {
    if (record) record.links = [...new Set(record.links)];
  }
  return { ok: true, record: main.record, documents, follow, skipped };
}
