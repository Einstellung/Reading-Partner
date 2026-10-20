// Posts out of the GraphQL answers the X web page receives on its own
// (docs/info/88 「取材 / X」, docs/research/X搜索响应被动捕获可行性.md): the
// search timeline (`SearchTimeline`) and a post's page (`TweetDetail`,
// `TweetResultByRestId`). The browse session only ever reads copies of what the
// page asked for itself (search-capture.ts); this file turns those bodies into
// the fields the program writes.
//
// What the answers give that the search page's DOM does not: a long post's
// whole text (`note_tweet`, the page shows about 275 characters, pitfall 657),
// every link already expanded (`expanded_url`, not t.co), the quoted post's
// whole text and links, exact counts. An X Article's body is not in them, only
// its id and title; that still takes the post's page.
//
// The shapes follow the public field names (twitter-web-exporter, MIT, was read
// for them; no code is taken from it). Posts are found by walking the whole
// answer rather than by its instruction layout, which changes more often than
// the post object does. A field that is not there is left out, never guessed:
// when X changes the answer, the reader falls back to the DOM.

import { isObject } from "../../platform/std/json";
import type { XCounts } from "./search-page";

/** A link out of a post, as the answer gives it. */
export interface XCapturedLink {
  /** The t.co link the post carries. */
  tco: string | null;
  /** Where it goes; null for a card's link the answer gives only as t.co. */
  url: string | null;
  card: boolean;
}

/** One post, every field read by the program off the answer. */
export interface XCapturedPost {
  id: string;
  handle: string | null;
  name: string | null;
  /** The whole text: `note_tweet` when the post has one, else `legacy.full_text` inside its display range; links spelled out. */
  text: string;
  /** The text came from `note_tweet`: a long post the search page cuts. */
  long: boolean;
  /** `legacy.created_at`, epoch ms. The program still dates a post by its id (snowflake). */
  createdAt: number | null;
  /** The post's own links out, quoted post's not included. X's own Article link is left out. */
  links: XCapturedLink[];
  counts: XCounts;
  media: boolean;
  /** An X Article: its id and title. The body is not in these answers. */
  article: { id: string | null; title: string } | null;
  /** The quoted post, whole; its links belong to it, not to this post. */
  quoted: XCapturedPost | null;
  /** The quoted post's id when the answer names it but leaves the post out. */
  quotedId: string | null;
  retweetOf: string | null;
  replyTo: { id: string; handle: string | null } | null;
}

/** The GraphQL operations whose answers are read. */
export const X_CAPTURED_OPERATIONS = ["SearchTimeline", "TweetDetail", "TweetResultByRestId"] as const;
export type XCapturedOperation = (typeof X_CAPTURED_OPERATIONS)[number];

const MAX_DEPTH = 64;

const str = (v: unknown): string => (typeof v === "string" ? v : "");

function count(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && /^\d+$/.test(v)) return Number(v);
  return null;
}

const ENTITIES: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'" };

function unescapeText(text: string): string {
  return text.replace(/&(?:amp|lt|gt|quot|#39);/g, (m) => ENTITIES[m] ?? m);
}

const ARTICLE_LINK = /^https?:\/\/(?:www\.)?(?:x|twitter)\.com\/i\/article\//i;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** `legacy.created_at` ("Wed Oct 14 01:58:00 +0000 2026"), epoch ms; null when it is not that shape. */
export function parseCreatedAt(text: string): number | null {
  const m = /^\w{3} (\w{3}) (\d{1,2}) (\d{2}):(\d{2}):(\d{2}) ([+-])(\d{2})(\d{2}) (\d{4})$/.exec(text.trim());
  if (!m) return null;
  const month = MONTHS.indexOf(m[1]);
  if (month < 0) return null;
  const offset = (m[6] === "-" ? -1 : 1) * (Number(m[7]) * 60 + Number(m[8])) * 60_000;
  return Date.UTC(Number(m[9]), month, Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5])) - offset;
}

/** Whether an object is a post: an id, and a `legacy` with the text. A user has `rest_id` and `legacy` too, but no `full_text`. */
function isPostObject(o: Record<string, unknown>): boolean {
  return typeof o.rest_id === "string" && /^\d{1,25}$/.test(o.rest_id) && isObject(o.legacy) && typeof o.legacy.full_text === "string";
}

/** The post inside a result: itself, or the one a `TweetWithVisibilityResults` wraps. */
function unwrap(result: unknown): Record<string, unknown> | null {
  if (!isObject(result)) return null;
  if (isPostObject(result)) return result;
  if (isObject(result.tweet) && isPostObject(result.tweet)) return result.tweet;
  return null;
}

function userOf(post: Record<string, unknown>): { handle: string | null; name: string | null } {
  const core = isObject(post.core) ? post.core : {};
  const results = isObject(core.user_results) ? core.user_results : {};
  const user = isObject(results.result) ? results.result : {};
  const legacy = isObject(user.legacy) ? user.legacy : {};
  const ucore = isObject(user.core) ? user.core : {};
  const handle = str(ucore.screen_name) || str(legacy.screen_name);
  const name = str(ucore.name) || str(legacy.name);
  return { handle: handle || null, name: name || null };
}

function urlEntities(entities: unknown): Record<string, unknown>[] {
  if (!isObject(entities) || !Array.isArray(entities.urls)) return [];
  return entities.urls.filter(isObject);
}

/** One post object, without walking into what it quotes beyond one level. */
function readPost(post: Record<string, unknown>, depth: number): XCapturedPost {
  const legacy = post.legacy as Record<string, unknown>;
  const note = isObject(post.note_tweet) && isObject(post.note_tweet.note_tweet_results) ? post.note_tweet.note_tweet_results.result : null;
  const noteText = isObject(note) ? str(note.text) : "";
  const long = noteText !== "";

  let text: string;
  if (long) {
    text = noteText;
  } else {
    const full = str(legacy.full_text);
    const chars = Array.from(full);
    const range = Array.isArray(legacy.display_text_range) ? legacy.display_text_range : null;
    const start = typeof range?.[0] === "number" ? range[0] : 0;
    const end = typeof range?.[1] === "number" ? range[1] : chars.length;
    text = chars.slice(start, end).join("");
  }

  // The long text's links are in the note's own entity set; the short text's,
  // and a card link the text does not carry, in `legacy.entities`.
  const entities = [...(long && isObject(note) ? urlEntities(note.entity_set) : []), ...urlEntities(legacy.entities)];
  const links: XCapturedLink[] = [];
  for (const e of entities) {
    const tco = str(e.url) || null;
    const expanded = str(e.expanded_url);
    if (tco && expanded) text = text.split(tco).join(ARTICLE_LINK.test(expanded) ? "" : expanded);
    if (!expanded || ARTICLE_LINK.test(expanded)) continue;
    if (links.some((l) => l.url === expanded || (tco !== null && l.tco === tco))) continue;
    links.push({ tco, url: expanded, card: false });
  }
  const card = isObject(post.card) ? post.card : null;
  const cardLegacy = card && isObject(card.legacy) ? card.legacy : null;
  const cardTco = cardLegacy ? str(cardLegacy.url) : "";
  if (/^https:\/\/t\.co\/\w+$/.test(cardTco) && !links.some((l) => l.tco === cardTco)) links.push({ tco: cardTco, url: null, card: true });

  const extended = isObject(legacy.extended_entities) ? legacy.extended_entities : {};
  const plainEntities = isObject(legacy.entities) ? legacy.entities : {};
  const media =
    (Array.isArray(extended.media) && extended.media.length > 0) || (Array.isArray(plainEntities.media) && plainEntities.media.length > 0);

  const articleResult =
    isObject(post.article) && isObject(post.article.article_results) && isObject(post.article.article_results.result)
      ? post.article.article_results.result
      : null;
  const article = articleResult ? { id: str(articleResult.rest_id) || null, title: str(articleResult.title).trim() } : null;

  const views = isObject(post.views) ? count(post.views.count) : null;
  const quotedPost = depth < 1 ? unwrap(isObject(post.quoted_status_result) ? post.quoted_status_result.result : null) : null;
  const quoted = quotedPost ? readPost(quotedPost, depth + 1) : null;
  const quotedId = quoted?.id ?? (str(legacy.quoted_status_id_str) || null);
  const retweeted = unwrap(isObject(legacy.retweeted_status_result) ? legacy.retweeted_status_result.result : null);
  const replyId = str(legacy.in_reply_to_status_id_str);

  return {
    id: post.rest_id as string,
    ...userOf(post),
    text: unescapeText(text).trim(),
    long,
    createdAt: parseCreatedAt(str(legacy.created_at)),
    links,
    counts: {
      replies: count(legacy.reply_count),
      reposts: count(legacy.retweet_count),
      likes: count(legacy.favorite_count),
      bookmarks: count(legacy.bookmark_count),
      views,
      quotes: count(legacy.quote_count),
    },
    media,
    article,
    quoted,
    quotedId,
    retweetOf: retweeted ? (retweeted.rest_id as string) : null,
    replyTo: replyId ? { id: replyId, handle: str(legacy.in_reply_to_screen_name) || null } : null,
  };
}

/** The one of two readings of the same post that says more. */
function richer(a: XCapturedPost, b: XCapturedPost): XCapturedPost {
  if (b.text.length !== a.text.length) return b.text.length > a.text.length ? b : a;
  return b.links.length > a.links.length || (b.quoted && !a.quoted) ? b : a;
}

/**
 * Every post in one parsed GraphQL answer, by id: the timeline's posts, the
 * ones they quote and the ones they repost, each also under its own id. Empty
 * for anything that is not such an answer.
 */
export function postsOfAnswer(answer: unknown, into: Map<string, XCapturedPost> = new Map()): Map<string, XCapturedPost> {
  const walk = (node: unknown, depth: number) => {
    if (depth > MAX_DEPTH || node === null || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item, depth + 1);
      return;
    }
    const o = node as Record<string, unknown>;
    if (isPostObject(o)) {
      const post = readPost(o, 0);
      const had = into.get(post.id);
      into.set(post.id, had ? richer(had, post) : post);
    }
    for (const value of Object.values(o)) walk(value, depth + 1);
  };
  walk(answer, 0);
  return into;
}

/** The operation a GraphQL URL calls, when it is one of those read. */
export function operationOfUrl(url: string): XCapturedOperation | null {
  const m = /\/graphql\/[^/?#]+\/([A-Za-z]+)(?:[?#]|$)/.exec(url);
  const op = m?.[1] as XCapturedOperation | undefined;
  return op && (X_CAPTURED_OPERATIONS as readonly string[]).includes(op) ? op : null;
}
