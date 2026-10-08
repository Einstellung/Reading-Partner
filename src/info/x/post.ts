// An X post as the embed endpoint gives it (docs/84 「实测」, pitfall 493).
//
// `cdn.syndication.twimg.com/tweet-result` answers without a session and on
// every platform, in under two seconds, with the author, the time, the photos,
// the card and the links already expanded. What it does not give is the whole
// text of a long post or the body of an Article: those come back cut at
// `display_text_range` with a `note_tweet` or an `article` pointer beside them,
// still HTTP 200. So the text is only taken as whole for a post that has
// neither, and `shape` says which of the three this one is.

import { isObject } from "../../platform/std/json";

/** A post a link points at. */
export interface XPostRef {
  id: string;
  /** The author's handle as the link spells it, when it names one. */
  handle?: string;
}

const X_HOSTS = new Set([
  "x.com",
  "www.x.com",
  "mobile.x.com",
  "twitter.com",
  "www.twitter.com",
  "mobile.twitter.com",
]);

export function isXHost(host: string): boolean {
  return X_HOSTS.has(host.toLowerCase());
}

const HANDLE_STATUS = /^\/([A-Za-z0-9_]{1,15})\/status(?:es)?\/(\d{5,25})(?:\/|$)/;
const WEB_STATUS = /^\/i\/(?:web\/)?status\/(\d{5,25})(?:\/|$)/;

/** The post an x.com or twitter.com link is about, or null for any other link. */
export function xPostOfUrl(raw: string): XPostRef | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (!isXHost(url.hostname)) return null;
  const named = HANDLE_STATUS.exec(url.pathname);
  if (named && named[1].toLowerCase() !== "i") return { id: named[2], handle: named[1] };
  const bare = WEB_STATUS.exec(url.pathname);
  return bare ? { id: bare[1] } : null;
}

/** The permalink page of a post. */
export function xPostUrl(handle: string, id: string): string {
  return `https://x.com/${handle}/status/${id}`;
}

/** The token the embed endpoint wants beside the id, derived from the id alone. */
export function syndicationToken(id: string): string {
  return ((Number(id) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, "");
}

export function syndicationUrl(id: string): string {
  return `https://cdn.syndication.twimg.com/tweet-result?id=${id}&lang=en&token=${syndicationToken(id)}`;
}

/**
 * What a post is, which decides where its text can come from: a short post's
 * text is whole in the embed, a long post's and an Article's are not.
 */
export type XPostShape = "short" | "long" | "article";

export interface XAuthor {
  name: string;
  handle: string;
}

export interface XSyndicatedPost {
  id: string;
  author: XAuthor;
  /** ISO datetime. */
  postedAt: string;
  /** The text as the embed shows it, links expanded. Whole only for a short post. */
  text: string;
  shape: XPostShape;
  article?: { title: string; preview: string; cover?: string };
  /** Photo URLs at their large size. */
  photos: string[];
  /** Videos and GIFs, which are kept as the post's link and not downloaded. */
  videos: number;
  /** Outbound links the embed already expanded, in the order the text has them. */
  links: string[];
  /** The card's link, still a t.co when the text did not carry it too. */
  cardUrl?: string;
  quoted?: XSyndicatedPost;
}

/** The answer for a post that is gone or protected: a tombstone, not a post. */
export const UNAVAILABLE = "unavailable" as const;

const str = (value: unknown): string => (typeof value === "string" ? value : "");

const ENTITIES: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'" };

// The embed escapes the text as HTML; the record and the documents want it plain.
function unescapeText(text: string): string {
  return text.replace(/&(?:amp|lt|gt|quot|#39);/g, (m) => ENTITIES[m] ?? m);
}

/** A pbs.twimg.com picture at its large size, as a JPEG every reader can show. */
export function largePhoto(url: string): string {
  try {
    const u = new URL(url);
    if (u.hostname !== "pbs.twimg.com") return url;
    const ext = /\.(jpe?g|png|webp)$/i.exec(u.pathname);
    if (ext) u.pathname = u.pathname.slice(0, -ext[0].length);
    u.search = "";
    u.searchParams.set("format", ext ? ext[1].toLowerCase().replace("jpeg", "jpg") : "jpg");
    u.searchParams.set("name", "large");
    return u.toString();
  } catch {
    return url;
  }
}

// x.com/i/article/<id> is the Article itself (the post's own or a quoted one),
// which is read from its post, never fetched as a link.
const ARTICLE_LINK = /^https?:\/\/(?:www\.)?(?:x|twitter)\.com\/i\/article\//i;

/** Read one post out of the endpoint's JSON. Null when it is not a post at all. */
export function parseSyndication(raw: unknown): XSyndicatedPost | typeof UNAVAILABLE | null {
  if (!isObject(raw)) return null;
  if (raw.__typename === "TweetTombstone") return UNAVAILABLE;
  const id = str(raw.id_str);
  const user = isObject(raw.user) ? raw.user : null;
  if (id === "" || !user) return null;

  const fullText = str(raw.text);
  const range = Array.isArray(raw.display_text_range) ? raw.display_text_range : null;
  const chars = Array.from(fullText);
  const start = typeof range?.[0] === "number" ? range[0] : 0;
  const end = typeof range?.[1] === "number" ? range[1] : chars.length;
  let text = chars.slice(start, end).join("");

  const entities = isObject(raw.entities) ? raw.entities : {};
  const urls = Array.isArray(entities.urls) ? entities.urls.filter(isObject) : [];
  const links: string[] = [];
  const tcos = new Set<string>();
  for (const u of urls) {
    const short = str(u.url);
    const expanded = str(u.expanded_url);
    if (short !== "") tcos.add(short);
    if (expanded === "") continue;
    if (short !== "") text = text.split(short).join(ARTICLE_LINK.test(expanded) ? "" : expanded);
    if (!ARTICLE_LINK.test(expanded) && !links.includes(expanded)) links.push(expanded);
  }

  const card = isObject(raw.card) ? raw.card : null;
  const bindings = card && isObject(card.binding_values) ? card.binding_values : {};
  const cardValue = isObject(bindings.card_url) ? str(bindings.card_url.string_value) : "";
  const cardUrl = cardValue || (card ? str(card.url) : "");

  const media = Array.isArray(raw.mediaDetails) ? raw.mediaDetails.filter(isObject) : [];
  const photos = media.filter((m) => m.type === "photo").map((m) => largePhoto(str(m.media_url_https)));
  const videos = media.filter((m) => m.type === "video" || m.type === "animated_gif").length;

  const article = isObject(raw.article) ? raw.article : null;
  const cover =
    article && isObject(article.cover_media) && isObject(article.cover_media.media_info)
      ? str(article.cover_media.media_info.original_img_url)
      : "";
  const quoted = parseSyndication(raw.quoted_tweet);

  const post: XSyndicatedPost = {
    id,
    author: { name: str(user.name), handle: str(user.screen_name) },
    postedAt: str(raw.created_at),
    text: unescapeText(text).trim(),
    shape: article ? "article" : raw.note_tweet ? "long" : "short",
    photos: photos.filter((p) => p !== ""),
    videos,
    links,
  };
  if (article) {
    post.article = {
      title: str(article.title).trim(),
      preview: str(article.preview_text).trim(),
      ...(cover === "" ? {} : { cover: largePhoto(cover) }),
    };
  }
  if (cardUrl !== "" && !tcos.has(cardUrl) && !links.includes(cardUrl)) post.cardUrl = cardUrl;
  if (quoted && quoted !== UNAVAILABLE) post.quoted = quoted;
  return post;
}
