// AI-pen conversation threads, one file per document: threads-<bookId>.json,
// keyed by the book's content hash (library.ts).
// This is the seed of the "conversation stream" tier (docs/01 §3, first layer);
// the format is intentionally small but the field names are the durable ones.
// Writes are debounced and flushed on pagehide; failures are surfaced (pitfall 09).

import {
  BaseDirectory,
  exists,
  mkdir,
  readFile,
  readTextFile,
  writeFile,
  writeTextFile,
} from "@tauri-apps/plugin-fs";

// A durable message part (the persisted projection of the UI's ChatPart, in
// src/components/chatParts.ts). Only durable parts reach disk: text, and a card
// whose kind is worth keeping (the confirm card, the briefing-ready card). The
// tool trace and the transient briefing progress/failure cards are never stored.
// The card payload is kept opaque here so persistence does not depend on the info
// domain; the UI casts it back to its payload type on rehydrate.
export type PersistedCardPayload = { kind: string } & Record<string, unknown>;
export type PersistedPart =
  | { type: "text"; text: string }
  | { type: "card"; id: string; card: PersistedCardPayload };

export interface ThreadMessage {
  role: "user" | "ai";
  text: string;
  ts: number;
  // Filenames of attached images under images/threads/<threadId>/, e.g.
  // "1720000000000-0.png". Kept out of the thread JSON body so the file stays
  // small (same reasoning as image annotations, pitfall 07); the base64 is read
  // back on demand for display and for resending to the model.
  images?: string[];
  // The durable message-parts structure. Absent on plain text turns and on files
  // written before parts existed — a reader then falls back to `text` alone, so
  // old { role, text, ts } messages keep loading unchanged.
  parts?: PersistedPart[];
}

export interface Thread {
  id: string;
  // The AI-pen mark this thread is anchored on. Empty string for the one
  // book-level thread (docs/03: the top-bar AI button, no selection), which is
  // marked by `book` instead.
  annotationId: string;
  // The single persistent per-book thread reached from the top-bar AI button.
  // Absent (undefined) on ordinary mark-anchored threads.
  book?: boolean;
  // The book id (content hash) this thread belongs to. Kept for readability of
  // the on-disk file; the store keys off the filename, not this field.
  path: string;
  createdAt: number;
  messages: ThreadMessage[];
}

type ThreadMap = Record<string, Thread>;

const SAVE_DEBOUNCE = 500;

const cache = new Map<string, ThreadMap>();
const timers = new Map<string, number>();
const dirty = new Set<string>();

let onError: (e: unknown) => void = () => {};
export function onThreadSaveError(handler: (e: unknown) => void): void {
  onError = handler;
}

async function ensureDir(): Promise<void> {
  try {
    if (!(await exists("", { baseDir: BaseDirectory.AppData }))) {
      await mkdir("", { baseDir: BaseDirectory.AppData, recursive: true });
    }
  } catch {
    // A real problem resurfaces on the write below.
  }
}

// Thread images live one directory per thread. Mirrors annotations.ts's base64
// <-> bytes helpers; here `data` is bare base64 (no data: prefix), matching the
// ChatMessage.images contract.
function threadImageDir(threadId: string): string {
  return `images/threads/${threadId}`;
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function extFor(mediaType: string): string {
  return mediaType === "image/png" ? "png" : "jpg";
}

function mediaTypeFor(name: string): string {
  return name.endsWith(".png") ? "image/png" : "image/jpeg";
}

// Write a message's images to disk, returning the filenames to store on the
// ThreadMessage. The extension records the media type so it round-trips on read.
// Throws on write failure so the caller can warn instead of silently dropping.
export async function saveThreadImages(
  threadId: string,
  images: { data: string; mediaType: string }[],
): Promise<string[]> {
  if (images.length === 0) return [];
  await mkdir(threadImageDir(threadId), { baseDir: BaseDirectory.AppData, recursive: true });
  const stamp = Date.now();
  const names: string[] = [];
  for (let i = 0; i < images.length; i++) {
    const name = `${stamp}-${i}.${extFor(images[i].mediaType)}`;
    await writeFile(`${threadImageDir(threadId)}/${name}`, base64ToBytes(images[i].data), {
      baseDir: BaseDirectory.AppData,
    });
    names.push(name);
  }
  return names;
}

// Read a message's stored images back as base64 for display / resending. Missing
// files are skipped (a half-written thread should not block the rest).
export async function readThreadImages(
  threadId: string,
  names: string[],
): Promise<{ data: string; mediaType: string }[]> {
  const out: { data: string; mediaType: string }[] = [];
  for (const name of names) {
    const path = `${threadImageDir(threadId)}/${name}`;
    if (!(await exists(path, { baseDir: BaseDirectory.AppData }))) continue;
    const bytes = await readFile(path, { baseDir: BaseDirectory.AppData });
    out.push({ data: bytesToBase64(bytes), mediaType: mediaTypeFor(name) });
  }
  return out;
}

async function writeNow(key: string): Promise<void> {
  dirty.delete(key);
  const threads = cache.get(key) ?? {};
  await ensureDir();
  await writeTextFile(`threads-${key}.json`, JSON.stringify({ threads }, null, 2), {
    baseDir: BaseDirectory.AppData,
  });
}

let pagehideBound = false;
function bindPagehide(): void {
  if (pagehideBound || typeof window === "undefined") return;
  pagehideBound = true;
  window.addEventListener("pagehide", () => {
    for (const key of [...dirty]) {
      const t = timers.get(key);
      if (t) clearTimeout(t);
      timers.delete(key);
      void writeNow(key).catch((e) => onError(e));
    }
  });
}

function schedule(key: string): void {
  dirty.add(key);
  bindPagehide();
  // Headless (tests): no window timer to debounce on; the cache is the source of
  // truth and a real run always has a window.
  if (typeof window === "undefined") return;
  const existing = timers.get(key);
  if (existing) clearTimeout(existing);
  timers.set(
    key,
    window.setTimeout(() => {
      timers.delete(key);
      void writeNow(key).catch((e) => onError(e));
    }, SAVE_DEBOUNCE),
  );
}

// Load a document's threads. Missing file is normal ({}); read/parse errors
// rethrow so the caller can warn.
export async function loadThreads(bookId: string): Promise<ThreadMap> {
  const key = bookId;
  const name = `threads-${key}.json`;
  if (!(await exists(name, { baseDir: BaseDirectory.AppData }))) {
    cache.set(key, {});
    return {};
  }
  const parsed = JSON.parse(
    await readTextFile(name, { baseDir: BaseDirectory.AppData }),
  ) as { threads?: ThreadMap };
  const threads = parsed.threads ?? {};
  cache.set(key, threads);
  return threads;
}

export function getThread(bookId: string, threadId: string): Thread | undefined {
  return cache.get(bookId)?.[threadId];
}

// Drop a book's cached threads so the next loadThreads re-reads from disk. Used
// after sync pulls a newer threads-<bookId>.json (src/sync): the in-memory cache
// would otherwise mask the pulled file. A book that is currently open and has
// unflushed edits is left alone — flushing them would clobber the pull, and the
// open view keeps its own copy anyway (v1: pulled threads take effect on reopen).
export function dropThreadCache(bookId: string): void {
  if (dirty.has(bookId)) return;
  cache.delete(bookId);
}

export function createThread(bookId: string, annotationId: string, threadId: string): Thread {
  const key = bookId;
  const map = cache.get(key) ?? {};
  const thread: Thread = {
    id: threadId,
    annotationId,
    path: bookId,
    createdAt: Date.now(),
    messages: [],
  };
  map[threadId] = thread;
  cache.set(key, map);
  schedule(key);
  return thread;
}

// Create the book-level thread (docs/03: the top-bar AI button's selection-free
// entry). No annotation anchor; the `book` marker is how it's found again.
export function createBookThread(bookId: string, threadId: string): Thread {
  const key = bookId;
  const map = cache.get(key) ?? {};
  const thread: Thread = {
    id: threadId,
    annotationId: "",
    book: true,
    path: bookId,
    createdAt: Date.now(),
    messages: [],
  };
  map[threadId] = thread;
  cache.set(key, map);
  schedule(key);
  return thread;
}

// The book-level thread for a document, if one has ever been created. There is
// at most one per book (the top-bar button reopens it rather than making more).
export function getBookThread(bookId: string): Thread | undefined {
  const map = cache.get(bookId);
  if (!map) return undefined;
  for (const t of Object.values(map)) if (t.book) return t;
  return undefined;
}

// Remove a thread from its file by id. Generic over the file key (bookId), so it
// serves the reading side (threads-<contentHash>.json) and the info side
// (threads-info-<date>.json) alike. The file stays and is rewritten without this
// thread — an in-file edit, so per-file LWW sync carries the removal to other
// devices (unlike a whole-file deletion, which v1 sync does not propagate). The
// thread's images under images/threads/<threadId>/ are left on disk; they are not
// synced and a stale directory is harmless. No-op when the thread is already gone.
export function deleteThread(bookId: string, threadId: string): boolean {
  const key = bookId;
  const map = cache.get(key);
  if (!map || !(threadId in map)) return false;
  delete map[threadId];
  schedule(key);
  return true;
}

export function appendMessage(bookId: string, threadId: string, message: ThreadMessage): Thread | undefined {
  const key = bookId;
  const thread = cache.get(key)?.[threadId];
  if (!thread) return undefined;
  thread.messages.push(message);
  schedule(key);
  return thread;
}

// Merge a patch into the stored message identified by `ts` (used to record a
// card's later state, e.g. a confirm card flipping to "added"). No-op when the
// thread or message is gone.
export function patchThreadMessage(
  bookId: string,
  threadId: string,
  ts: number,
  patch: Partial<ThreadMessage>,
): void {
  const thread = cache.get(bookId)?.[threadId];
  if (!thread) return;
  const i = thread.messages.findIndex((m) => m.ts === ts);
  if (i < 0) return;
  thread.messages[i] = { ...thread.messages[i], ...patch };
  schedule(bookId);
}
