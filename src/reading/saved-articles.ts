// Saved articles (docs/21, first slice): an info article the reader kept, filed
// under a topic. Store + display only — nothing here reaches the AI yet, and no
// TopicMaterial / fulltext is involved. The point of landing it now is that the
// records accumulate, so the later AI path reads real data instead of nothing.
//
// Its own records file rather than a field on Topic: topics.json merges a whole
// topic record at a time, so two devices each saving an article on the same day
// would overwrite each other's. Here the record is the article, so both survive.
//
// The body is kept twice: `text` for the future AI path, `html` for reading it
// today. The html keeps its external image URLs — they render through the img:
// proxy (docs/pitfall/30) — but any data: image is stripped, since a base64
// body would dominate a record that syncs. Same rule and same function as the
// bodies the collector publishes (info/briefing/publish.ts), so an article read
// from the briefing and the copy kept from it hold the same markup.

import {
  BaseDirectory,
  exists,
  readTextFile,
} from "@tauri-apps/plugin-fs";
import { writeTextAtomic } from "../platform/app/atomic-fs";
import { sanitizeArticleHtml, stripDataImages } from "../info/extract/sanitize";

export const SAVED_ARTICLES_FILE = "saved-articles.json";

export interface SavedArticle {
  // Identity: the article's normalized URL (see savedArticleId). Not the
  // briefing's itemId — that one is scoped to a day's briefing, so the same
  // article saved tomorrow would arrive as a second record.
  id: string;
  topicId: string;
  url: string;
  title: string;
  // Source descriptor id and its display name, denormalized so a saved article
  // renders after the source is unsubscribed.
  source: string;
  sourceName: string;
  // ISO-ish, as the feed gave it; "" when the feed gave none. Stored because a
  // quote without a date turns a three-month-old article into news (docs/21).
  publishedAt: string;
  savedAt: number;
  // True when only a summary/headline was ever obtained (paywall, JS-only page,
  // discovery-layer-only source). A first-class state, not an error: whoever
  // quotes this must say the full text was never read.
  summaryOnly: boolean;
  // Plain text of the body, for the future AI path. "" when there is none.
  text: string;
  // Sanitized HTML of the body, for reading it now. "" when there is none.
  html: string;
}

// Everything a caller supplies; id/savedAt and the image stripping are ours.
export type SavedArticleInput = Omit<SavedArticle, "id" | "savedAt">;

// --- pure helpers (unit-tested) --------------------------------------------

// Query keys that identify the click, not the article. Dropped so the same
// article arriving through a briefing link and through a share link is one
// record. Deliberately short: a key that might select content (id, p, page)
// stays, because merging two different articles into one is the worse failure.
const TRACKING_PARAMS = /^(?:utm_[a-z_]+|fbclid|gclid|msclkid|spm|from|ref_src)$/i;

// The URL reduced to what identifies the article: scheme and host lowercased,
// default port and fragment gone, tracking params gone, remaining params sorted
// (so the same link with reordered params is the same id), no trailing slash.
// A string that is not a URL is returned trimmed — an id we cannot normalize is
// still a stable id.
export function normalizeArticleUrl(url: string): string {
  const raw = url.trim();
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return raw;
  }
  u.hash = "";
  u.protocol = u.protocol.toLowerCase();
  u.hostname = u.hostname.toLowerCase();
  const keep = [...u.searchParams.entries()].filter(([k]) => !TRACKING_PARAMS.test(k));
  keep.sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : 1) : a[0] < b[0] ? -1 : 1));
  u.search = "";
  for (const [k, v] of keep) u.searchParams.append(k, v);
  if (u.pathname.length > 1 && u.pathname.endsWith("/")) u.pathname = u.pathname.slice(0, -1);
  return u.toString();
}

// The record id for an article. The normalized URL, so saving the same article
// twice — from a fresh briefing, or on the other device — is one record. Feeds
// that ship no link fall back to the title; with neither there is no identity
// and the caller must not save (returns "").
export function savedArticleId(url: string, title: string): string {
  const normalized = normalizeArticleUrl(url);
  if (normalized !== "") return normalized;
  const t = title.trim();
  return t === "" ? "" : `title:${t}`;
}

// A record from what the caller collected. Strips inlined images from both
// bodies and derives the id; savedAt comes from the caller's clock so a test can
// pin it.
export function buildSavedArticle(input: SavedArticleInput, savedAt: number): SavedArticle {
  return {
    id: savedArticleId(input.url, input.title),
    topicId: input.topicId,
    url: input.url,
    title: input.title,
    source: input.source,
    sourceName: input.sourceName,
    publishedAt: input.publishedAt,
    savedAt,
    summaryOnly: input.summaryOnly,
    text: input.text.trim(),
    html: stripDataImages(input.html),
  };
}

// Add one article, or refresh the one already there. Saving the same article
// twice must not produce a second record; the earlier savedAt is kept so the
// list does not reshuffle on a re-save, and the newer body/topic wins (the
// second save may have caught a full text the first one missed).
export function upsertSavedArticle(list: SavedArticle[], article: SavedArticle): SavedArticle[] {
  const at = list.findIndex((a) => a.id === article.id);
  if (at < 0) return [...list, article];
  const next = [...list];
  next[at] = { ...article, savedAt: list[at].savedAt };
  return next;
}

export function removeSavedArticleById(list: SavedArticle[], id: string): SavedArticle[] {
  return list.filter((a) => a.id !== id);
}

// One topic's saved articles, most recently saved first.
export function savedArticlesForTopic(list: SavedArticle[], topicId: string): SavedArticle[] {
  return list.filter((a) => a.topicId === topicId).sort((a, b) => b.savedAt - a.savedAt);
}

// The publication date as a reader-facing line. Feeds hand over anything from a
// full ISO timestamp to a bare date to nothing at all, so an unparseable value
// is shown verbatim rather than swallowed — a wrong-looking date is still better
// than none when the whole point is knowing how old the piece is.
export function formatPublishedAt(publishedAt: string): string {
  const raw = publishedAt.trim();
  if (raw === "") return "";
  const at = new Date(raw);
  return Number.isNaN(at.getTime()) ? raw : at.toLocaleDateString();
}

// Parse a saved-articles.json body, dropping anything that is not a record with
// an id — one malformed entry must not blank the list, and a record without an
// identity would make the whole file fall back to opaque merging.
//
// The body is sanitized here, on the way out of the file, and not only in
// buildSavedArticle on the way in. This file lives in the synced folder and
// merges record by record (platform/sync/merge/records.ts), so a record can
// arrive without ever having passed through this device's write path: a folder
// the reader shared, a second device, the Drive account. What SavedArticleView
// does with `html` is dangerouslySetInnerHTML, so the guard belongs at the read,
// same as the published briefing bodies (info/briefing/reader.ts). Doing it on
// write as well is not wasted — it keeps the stored file clean — but write-side
// alone guards nothing, because the attacker writes the file.
export function parseSavedArticles(text: string): SavedArticle[] {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return [];
  }
  if (!Array.isArray(data)) return [];
  return data
    .filter(
      (a): a is SavedArticle =>
        !!a && typeof a === "object" && typeof (a as SavedArticle).id === "string" && (a as SavedArticle).id !== "",
    )
    .map((a) => ({ ...a, html: sanitizeStoredHtml(a.html) }));
}

// One stored body, made safe to render. Not a string at all when the file was
// hand-edited or corrupted, hence the type check before the sanitizer (which
// takes a string). stripDataImages runs after sanitizeArticleHtml because the
// sanitizer keeps an inline data: image when nothing else in the tag is a usable
// URL; this drops it for size, and it is the one that keeps a synced file from
// growing 4MB of base64.
//
// Cutting a tag out of the sanitizer's output can leave text in a position the
// sanitizer would have written differently — an <img> at the head of a <pre>
// was standing between the start tag and a newline the next parse eats — so
// when it cuts anything, the result goes back through. This runs on every read
// of the file, and the whole point of it is that a record reads back the same
// every time; the second parse is charged only to the read that drops the
// image, because what it writes has none left to drop.
export function sanitizeStoredHtml(html: unknown): string {
  if (typeof html !== "string" || html === "") return "";
  const clean = sanitizeArticleHtml(html);
  const stripped = stripDataImages(clean);
  return stripped === clean ? clean : sanitizeArticleHtml(stripped);
}

// --- filesystem ------------------------------------------------------------

export async function loadSavedArticles(): Promise<SavedArticle[]> {
  try {
    if (!(await exists(SAVED_ARTICLES_FILE, { baseDir: BaseDirectory.AppData }))) return [];
    return parseSavedArticles(
      await readTextFile(SAVED_ARTICLES_FILE, { baseDir: BaseDirectory.AppData }),
    );
  } catch {
    return [];
  }
}

async function save(list: SavedArticle[]): Promise<void> {
  await writeTextAtomic(SAVED_ARTICLES_FILE, JSON.stringify(list, null, 2));
}

// Save one article under a topic. Returns the record written, or null when the
// article has no identity (no URL and no title) and so cannot be de-duplicated.
export async function saveArticle(input: SavedArticleInput): Promise<SavedArticle | null> {
  const article = buildSavedArticle(input, Date.now());
  if (article.id === "") return null;
  await save(upsertSavedArticle(await loadSavedArticles(), article));
  return article;
}

// Un-save an article: a real removal, not an archive (docs/21).
export async function removeSavedArticle(id: string): Promise<void> {
  await save(removeSavedArticleById(await loadSavedArticles(), id));
}
