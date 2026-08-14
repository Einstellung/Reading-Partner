// Saved articles (docs/21, first slice): an info article the reader kept, filed
// under a topic. Store + display only — nothing here reaches the AI yet, and no
// TopicMaterial / fulltext is involved. The point of landing it now is that the
// records accumulate, so the later AI path reads real data instead of nothing.
//
// Read through readGuardedJson, for the reason the shelf and settings are: the
// briefing a record came from is a day old and gone, keep/un-keep are both
// load-modify-save, and a read answered with "[]" would have the next un-keep
// write that over the file (docs/13).
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
  quarantineFile,
  readGuardedJson,
  writeTextAtomic,
  type CorruptFileReport,
  type GuardedRead,
} from "../platform/app/atomic-fs";
import { reportStoreError } from "../platform/app/store-errors";
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

// What one read of saved-articles.json produced.
export interface ParsedSavedArticles {
  articles: SavedArticle[];
  // True when the file held something no writer here produces: an entry that is
  // not an object, a record with no identity and nothing to derive one from, a
  // second copy of an id. Those entries are not in `articles`, so the bytes must
  // be set aside before the next write replaces them (see save below).
  repaired: boolean;
}

// Read the records out of a parsed saved-articles.json.
//
// A record is kept whenever it can be identified, however wrong the rest of it
// looks: the id is what the sync merge keys on (platform/sync/merge/records.ts)
// and what the reader un-keeps by, and a field this build does not recognise
// still belongs to the reader. A record with no id but a url or a title gets the
// id saveArticle would have given it, so it stops being unmergeable.
//
// Only three things are left out, and none of them can be carried: an entry that
// is not an object at all, one with no identity and no way to derive one, and a
// second record under an id already taken. Carrying those would not preserve
// them either — readCollection turns down a whole file that holds one, and the
// merge then falls back to copying one device's file over the other's, which
// loses real records. They stay in the quarantined copy instead.
//
// Null when the file is not an array: that is not this writer's shape at all,
// and readGuardedJson quarantines it.
//
// The body is sanitized here, on the way out of the file, and not only in
// buildSavedArticle on the way in. This file lives in the synced folder and
// merges record by record, so a record can arrive without ever having passed
// through this device's write path: a folder the reader shared, a second device,
// the Drive account. What SavedArticleView does with `html` is
// dangerouslySetInnerHTML, so the guard belongs at the read, same as the
// published briefing bodies (info/briefing/reader.ts). Doing it on write as well
// is not wasted — it keeps the stored file clean — but write-side alone guards
// nothing, because the attacker writes the file.
export function parseSavedArticles(raw: unknown): ParsedSavedArticles | null {
  if (!Array.isArray(raw)) return null;
  const articles: SavedArticle[] = [];
  const seen = new Set<string>();
  let repaired = false;
  for (const entry of raw) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      repaired = true;
      continue;
    }
    const record = entry as Partial<SavedArticle>;
    let id = typeof record.id === "string" ? record.id : "";
    if (id === "") {
      // Healed, not dropped: nothing is left behind, so this alone does not
      // make the file worth setting aside.
      id = savedArticleId(asText(record.url), asText(record.title));
      if (id === "") {
        repaired = true;
        continue;
      }
    }
    if (seen.has(id)) {
      repaired = true;
      continue;
    }
    seen.add(id);
    articles.push({ ...(entry as SavedArticle), id, html: sanitizeStoredHtml(record.html) });
  }
  return { articles, repaired };
}

// A field that should have been a string, from a file that may hold anything.
function asText(value: unknown): string {
  return typeof value === "string" ? value : "";
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

// The file access this store needs, as a parameter. A test hands it an
// in-memory AppData instead of rewriting the module registry with mock.module,
// which rewrites it for every other test file in the same worker (pitfall 119).
// Every exported call takes it last and defaults to the real one, so callers
// pass nothing.
export interface SavedArticlesIo {
  read(
    file: string,
    validate: (raw: unknown) => SavedArticle[] | null,
  ): Promise<GuardedRead<SavedArticle[]>>;
  write(file: string, contents: string): Promise<void>;
  quarantine(file: string): Promise<string | null>;
  reportCorrupt(report: CorruptFileReport): void;
}

export const savedArticlesIo: SavedArticlesIo = {
  read: readGuardedJson,
  write: writeTextAtomic,
  quarantine: quarantineFile,
  reportCorrupt: (report) => reportStoreError("corrupt-file", report),
};

// The records read, plus whether it is safe to write the result back and
// whether what came off disk had to be repaired. The kept articles cannot be
// rebuilt from anywhere — the briefing they came from is a day old and gone — so
// a file that could not be read must never be replaced by "the one article being
// kept", or by "everything except the one being un-kept". Content that does not
// parse is quarantined by readGuardedJson and a fresh list takes over; a file
// that could not be read at all is left alone and writing is refused until a
// later read succeeds.
async function readSavedArticles(io: SavedArticlesIo): Promise<{
  list: SavedArticle[];
  writable: boolean;
  repaired: boolean;
}> {
  let repaired = false;
  const read = await io.read(SAVED_ARTICLES_FILE, (raw) => {
    const parsed = parseSavedArticles(raw);
    if (parsed === null) return null;
    repaired = parsed.repaired;
    return parsed.articles;
  });
  if (read.status === "ok") return { list: read.value, writable: true, repaired };
  if (read.status === "missing") return { list: [], writable: true, repaired: false };
  return { list: [], writable: read.savedAs !== null, repaired: false };
}

export async function loadSavedArticles(
  io: SavedArticlesIo = savedArticlesIo,
): Promise<SavedArticle[]> {
  return (await readSavedArticles(io)).list;
}

// Replace the file with `list`. Returns whether it was written.
//
// When the read had to leave an entry behind, the bytes go aside as
// `.corrupt-<ms>` first, so the records this build could not place survive the
// write that drops them, and the reader is told where they went. A quarantine
// that fails leaves those bytes in place and the write is refused: the entries
// would otherwise exist nowhere.
async function save(io: SavedArticlesIo, list: SavedArticle[], repaired: boolean): Promise<boolean> {
  if (repaired) {
    let savedAs: string | null = null;
    try {
      savedAs = await io.quarantine(SAVED_ARTICLES_FILE);
    } catch (e) {
      console.error(`failed to quarantine ${SAVED_ARTICLES_FILE}`, e);
    }
    io.reportCorrupt({ file: SAVED_ARTICLES_FILE, savedAs });
    if (savedAs === null) return false;
  }
  await io.write(SAVED_ARTICLES_FILE, JSON.stringify(list, null, 2));
  return true;
}

// Save one article under a topic. Returns the record written, or null when the
// article has no identity (no URL and no title) and so cannot be de-duplicated,
// or when the records file could not be read and must not be written over.
export async function saveArticle(
  input: SavedArticleInput,
  io: SavedArticlesIo = savedArticlesIo,
): Promise<SavedArticle | null> {
  const article = buildSavedArticle(input, Date.now());
  if (article.id === "") return null;
  const read = await readSavedArticles(io);
  if (!read.writable) return null;
  const wrote = await save(io, upsertSavedArticle(read.list, article), read.repaired);
  return wrote ? article : null;
}

// Un-save an article: a real removal, not an archive (docs/21). A file that
// could not be read is left alone — every other kept article is in it.
export async function removeSavedArticle(
  id: string,
  io: SavedArticlesIo = savedArticlesIo,
): Promise<void> {
  const read = await readSavedArticles(io);
  if (!read.writable) return;
  await save(io, removeSavedArticleById(read.list, id), read.repaired);
}
