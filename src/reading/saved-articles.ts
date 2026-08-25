// Saved articles (docs/21): an info article the reader kept, filed under a topic. The
// store — reading it, writing it, keeping it mergeable. What reaches the AI is one
// step further out: from the open book's chat the model can list these records and
// put one of them on the open book's prep list (saved-article-tools.ts). No
// TopicMaterial is involved either way; a kept article is not a book.
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
// The body does not live in the records. A record is a few hundred bytes of
// metadata and a pointer; the body is its own file under article-bodies/, named
// for the hash of its own bytes and never written twice. The shape is the one
// library.json already has for books (metadata in the index, content in
// library/<hash>.pdf), and the reason is sync: the index is rewritten and
// re-uploaded on every keep, so everything inside it is paid for again each
// time. With the bodies inlined that was 883 KB a keep, of which 857 KB was
// body — and the other device had to download all of it to learn that one
// article had been added. A body file is uploaded once and is then cold
// forever.
//
// The body is kept twice inside that file: `text` for the AI path, `html` for
// reading it today. The html keeps its external image URLs — they render
// through the img: proxy (docs/pitfall/30) — but any data: image is stripped,
// since a base64 body would dominate the file. Same rule and same function as
// the bodies the collector publishes (info/briefing/publish.ts), so an article
// read from the briefing and the copy kept from it hold the same markup.
//
// Nothing deletes a body file. File-level deletes do not propagate (docs/13),
// so a device that dropped one locally would pull it straight back from the
// remote on the next pass, every pass. An un-kept article leaves its body
// behind: dead weight that costs nothing to sync, since it never changes again.

import {
  quarantineFile,
  readGuardedJson,
  writeTextAtomic,
  type CorruptFileReport,
  type GuardedRead,
} from "../platform/app/atomic-fs";
import { readJson } from "../platform/app/atomic-fs";
import { appData } from "../platform/app/appdata";
import { contentHash } from "../platform/app/content-hash";
import { reportStoreError } from "../platform/app/store-errors";
import { sanitizeArticleHtml, stripDataImages } from "../info/extract/sanitize";

export const SAVED_ARTICLES_FILE = "saved-articles.json";

// Where the bodies live. Its own directory rather than the AppData root, which
// already holds a flat file per book for four other things: these are one
// immutable blob per kept article and belong together, the way library/ holds
// the book blobs.
export const ARTICLE_BODY_DIR = "article-bodies";

// A body file's name is the hash of its own bytes, which is what makes it
// immutable: different bytes are a different file, so nothing is ever rewritten
// and two devices that split the same record land on the same name.
const BODY_HASH = /^[0-9a-f]{32}$/;

export function articleBodyPath(hash: string): string {
  return `${ARTICLE_BODY_DIR}/${hash}.json`;
}

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
  // Which body file holds this article's text and html; "" when nothing was
  // captured, which is a real case (a headline-only source) and not worth a file
  // holding two empty strings.
  bodyHash: string;
  // How long the plain text in that file is. Denormalized because the one thing
  // a list of kept articles says about a body is its length — the classroom tool
  // prints it on every row (saved-article-tools.ts) — and reading thirty body
  // files to draw a list would put the bodies back in the hot path.
  textChars: number;
  // Where the body used to sit, before it moved into a file of its own. Still
  // read: a record can arrive over sync from a device on the older build, and
  // the split below is what finally lifts it out. Nothing here writes them.
  text?: string;
  html?: string;
}

// The two forms of one article's body, as they are stored together.
export interface SavedArticleBody {
  // Plain text, and what the AI path feeds to the prep list
  // (saved-article-tools.ts). "" when there is none.
  text: string;
  // Sanitized HTML, for reading it now. "" when there is none.
  html: string;
}

export const NO_ARTICLE_BODY: SavedArticleBody = { text: "", html: "" };

// Everything a caller supplies; id/savedAt, the split and the image stripping
// are ours.
export type SavedArticleInput = Omit<
  SavedArticle,
  "id" | "savedAt" | "bodyHash" | "textChars" | "text" | "html"
> &
  SavedArticleBody;

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

// The body as it is stored: text trimmed, html sanitized and stripped of inlined
// images. The same function on the way in and on the way out, so the bytes a
// keep writes are the bytes a re-read produces — which is what lets the file be
// named after its own hash (see articleBodyBytes).
export function buildArticleBody(body: SavedArticleBody): SavedArticleBody {
  return { text: body.text.trim(), html: sanitizeStoredHtml(body.html) };
}

// The bytes one body is stored as. Fixed key order, no indentation: the file is
// named after the hash of exactly these bytes, so two devices splitting the same
// record have to produce them character for character.
export function articleBodyBytes(body: SavedArticleBody): string {
  return JSON.stringify({ text: body.text, html: body.html });
}

export function articleBodyHash(body: SavedArticleBody): Promise<string> {
  return contentHash(new TextEncoder().encode(articleBodyBytes(body)));
}

// A record from what the caller collected, pointing at a body already written.
// The pointer comes in rather than being derived here because hashing is async
// and this stays pure; savedAt comes from the caller's clock so a test can pin
// it.
export function buildSavedArticle(
  input: SavedArticleInput,
  savedAt: number,
  stored: { hash: string; chars: number },
): SavedArticle {
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
    bodyHash: stored.hash,
    textChars: stored.chars,
  };
}

// How long this article's text is, for a caller drawing a list. Reads the
// denormalized count, and falls back to a body still inlined in the record.
export function savedArticleTextChars(article: SavedArticle): number {
  if (typeof article.textChars === "number") return article.textChars;
  return asText(article.text).length;
}

// The body file this record points at, or "" for none. The records file is
// synced and merges record by record, so this value can arrive from anywhere:
// anything that is not a hash this build would have written never becomes a
// path.
export function articleBodyHashOf(article: SavedArticle): string {
  const hash = asText(article.bodyHash);
  return BODY_HASH.test(hash) ? hash : "";
}

// The body a record still carries inline, made safe to render. What a device on
// the older build wrote, and what the split lifts out.
function inlinedBody(article: SavedArticle): SavedArticleBody {
  return { text: asText(article.text), html: sanitizeStoredHtml(article.html) };
}

// Whether the body is still sitting in the record. Judged by shape rather than
// by a version flag: the split is idempotent because a record it has already
// been through has no such key left.
export function hasInlinedBody(article: SavedArticle): boolean {
  return "text" in article || "html" in article;
}

// One body file's contents, made safe to render.
//
// Read the way the records are: a body file lives in the synced folder, so it
// can reach this device without ever having passed through this device's write
// path, and SavedArticleView hands `html` to dangerouslySetInnerHTML. Sanitizing
// on write as well keeps the stored file clean, but write-side alone guards
// nothing — the attacker writes the file.
export function parseArticleBody(raw: unknown): SavedArticleBody {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return NO_ARTICLE_BODY;
  const body = raw as Partial<SavedArticleBody>;
  return { text: asText(body.text), html: sanitizeStoredHtml(body.html) };
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
// A body still inlined in a record is sanitized here, on the way out of the
// file, for the reason parseArticleBody gives: a record can arrive without ever
// having passed through this device's write path. Only when the key is really
// there, though — a record whose body has been split out must come back without
// one, or the split would find something to do on every pass and rewrite the
// whole file each time.
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
    const carried: SavedArticle = { ...(entry as SavedArticle), id };
    if ("html" in carried) carried.html = sanitizeStoredHtml(record.html);
    articles.push(carried);
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
  // A body file, parsed; null when it is not there or could not be read. Not the
  // guarded read the records get, and deliberately: a missing body is ordinary
  // (the record reached this device ahead of its file), and bad bytes are not
  // worth quarantining when the file is immutable and the other device still
  // holds a copy of it.
  readBody(file: string): Promise<unknown>;
  exists(file: string): Promise<boolean>;
}

export const savedArticlesIo: SavedArticlesIo = {
  read: readGuardedJson,
  write: writeTextAtomic,
  quarantine: quarantineFile,
  reportCorrupt: (report) => reportStoreError("corrupt-file", report),
  readBody: (file) => readJson<unknown>(file),
  exists: (file) => appData.exists(file).catch(() => false),
};

// The body of one kept article. Reads the file the record points at, and falls
// back to a body still inlined in the record — which is what a device on the
// older build wrote, and what a record synced from one still carries.
//
// A pointer with no file behind it answers with an empty body rather than
// raising: the records and the bodies are separate files and arrive over sync
// separately, so "the record is here and its body is not yet" is a state the
// reader can be in, and it is the same screen as an article kept without one.
export async function loadSavedArticleBody(
  article: SavedArticle,
  io: SavedArticlesIo = savedArticlesIo,
): Promise<SavedArticleBody> {
  const hash = articleBodyHashOf(article);
  if (hash === "") return inlinedBody(article);
  const raw = await io.readBody(articleBodyPath(hash));
  return raw === null ? inlinedBody(article) : parseArticleBody(raw);
}

// Write one body and answer with the hash the record will point at. "" when
// there is no body at all: an article kept from a headline-only source has
// nothing to store, and a file per nothing is still a file to sync.
//
// A file already there holds these exact bytes, so the write is skipped. That is
// not only an optimisation: a body file is never rewritten, which is the whole
// of what lets sync treat it as cold.
async function writeArticleBody(io: SavedArticlesIo, body: SavedArticleBody): Promise<string> {
  if (body.text === "" && body.html === "") return "";
  const bytes = articleBodyBytes(body);
  const hash = await contentHash(new TextEncoder().encode(bytes));
  const path = articleBodyPath(hash);
  if (!(await io.exists(path))) await io.write(path, bytes);
  return hash;
}

// The records read, and whether what came off disk had to be repaired. An empty
// list is the answer for a file that is not there yet, and for one whose bad
// content has just been moved aside. It is not the answer for a file that is
// sitting there unread: the kept articles cannot be rebuilt from anywhere — the
// briefing they came from is a day old and gone — so the reader would be shown
// an empty shelf, and the next keep would write "the one article being kept"
// over it. Raising is also what keeps the file from being overwritten: both
// writers below read before they save.
//
// Content that does not parse is quarantined by readGuardedJson and a fresh list
// takes over.
async function readSavedArticles(io: SavedArticlesIo): Promise<{
  list: SavedArticle[];
  repaired: boolean;
}> {
  let repaired = false;
  const read = await io.read(SAVED_ARTICLES_FILE, (raw) => {
    const parsed = parseSavedArticles(raw);
    if (parsed === null) return null;
    repaired = parsed.repaired;
    return parsed.articles;
  });
  if (read.status === "ok") return { list: read.value, repaired };
  if (read.status === "missing") return { list: [], repaired: false };
  if (read.savedAs === null) throw new Error(`${SAVED_ARTICLES_FILE} could not be read`);
  return { list: [], repaired: false };
}

export async function loadSavedArticles(
  io: SavedArticlesIo = savedArticlesIo,
): Promise<SavedArticle[]> {
  return (await readSavedArticles(io)).list;
}

// Whether anything is kept — without building the records.
//
// For callers that only need to decide whether to offer something: a full read
// runs the html sanitizer over every stored body (a DOMParser parse plus a walk
// of the whole tree, twice for a body carrying a data: image), and a classroom
// turn that asks "is there anything kept" on the way past must not pay that for
// bodies nobody is going to look at.
//
// An entry counts when it is shaped like a record, so an empty array answers
// false and so does a file holding nothing but junk. Whatever those entries turn
// out to be, this never returns null to readGuardedJson: the verdict "this is not
// the shape I write" belongs to the real read, which is also the one that can
// rebuild what it sets aside. Bytes that are not JSON at all are still moved
// aside by the guarded read itself, the same as on any other read of the file.
export async function hasSavedArticles(io: SavedArticlesIo = savedArticlesIo): Promise<boolean> {
  let any = false;
  await io.read(SAVED_ARTICLES_FILE, (raw) => {
    if (Array.isArray(raw)) {
      any = raw.some((e) => !!e && typeof e === "object" && !Array.isArray(e));
    }
    return [];
  });
  return any;
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
// article has no identity (no URL and no title) and so cannot be de-duplicated.
// Raises when the records file is there and could not be read: every other kept
// article is in it.
export async function saveArticle(
  input: SavedArticleInput,
  io: SavedArticlesIo = savedArticlesIo,
): Promise<SavedArticle | null> {
  if (savedArticleId(input.url, input.title) === "") return null;
  // The body first, the record second. The other order leaves a record pointing
  // at a file that was never written, which reads as "kept without a body" for
  // good; this order leaves at worst a body file nobody points at, which costs
  // one cold upload and nothing else.
  const body = buildArticleBody(input);
  const hash = await writeArticleBody(io, body);
  const article = buildSavedArticle(input, Date.now(), { hash, chars: body.text.length });
  const read = await readSavedArticles(io);
  const wrote = await save(io, upsertSavedArticle(read.list, article), read.repaired);
  return wrote ? article : null;
}

// Lift every body still sitting in the records into a file of its own. Answers
// with how many records moved.
//
// Idempotent by shape, not by a flag on disk: a record this has already been
// through carries no text/html key, so a second pass finds nothing to move and
// writes nothing at all — not the same bytes again, nothing, so it costs no sync
// revision and no merge.
//
// Two devices converge without coordinating. Both start from the same records
// (the file merges record by record, so both hold the same ones), the body bytes
// are a fixed serialisation of the same two strings, and the file name is the
// hash of those bytes — so both write the same body file and the same pointer,
// and the merge is handed two identical records rather than a conflict.
//
// A record whose inlined body was empty keeps whatever pointer it already had:
// the empty keys are dropped and nothing else about it changes, so a record that
// went through an older device's write path (which re-added `html: ""`) settles
// rather than losing its body.
export async function splitSavedArticleBodies(
  io: SavedArticlesIo = savedArticlesIo,
): Promise<number> {
  const read = await readSavedArticles(io);
  let moved = 0;
  const next: SavedArticle[] = [];
  for (const article of read.list) {
    if (!hasInlinedBody(article)) {
      next.push(article);
      continue;
    }
    const body = buildArticleBody(inlinedBody(article));
    const hash = await writeArticleBody(io, body);
    const { text: _text, html: _html, ...rest } = article;
    next.push({
      ...rest,
      bodyHash: hash === "" ? articleBodyHashOf(article) : hash,
      textChars: hash === "" ? savedArticleTextChars(article) : body.text.length,
    });
    moved += 1;
  }
  if (moved === 0) return 0;
  await save(io, next, read.repaired);
  return moved;
}

// The split, run at most once per process. Both shells call it on the way up and
// React runs their effects twice under StrictMode; two passes over the same file
// would produce the same bytes, but they would race each other's write.
let splitRun: Promise<number> | null = null;
export function splitSavedArticleBodiesOnce(
  io: SavedArticlesIo = savedArticlesIo,
): Promise<number> {
  return (splitRun ??= splitSavedArticleBodies(io));
}

// Un-save an article: a real removal, not an archive (docs/21).
export async function removeSavedArticle(
  id: string,
  io: SavedArticlesIo = savedArticlesIo,
): Promise<void> {
  const read = await readSavedArticles(io);
  await save(io, removeSavedArticleById(read.list, id), read.repaired);
}
