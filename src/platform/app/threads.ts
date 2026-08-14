// AI-pen conversation threads, one file per document: threads-<bookId>.json,
// keyed by the book's content hash (library.ts).
// This is the seed of the "conversation stream" tier (docs/01 §3, first layer);
// the format is intentionally small but the field names are the durable ones.
// Writes go through the shared debounced writer (debounced-writer.ts): they
// coalesce, they are flushed on the way out of the app, and failures are
// surfaced (pitfall 09).
//
// The one rule this store exists to keep: a write never replaces a file this
// process has not read. Every write re-reads the file it is about to replace
// and merges what it holds onto what is there, so no path — not one that starts
// from an empty map, not one that runs while the cache is being refreshed — can
// turn a conversation history into a one-thread file. What that looked like
// when it was possible is in tests/threads-store.test.ts.
//
// Everything the store reaches outside itself is passed in (same shape as
// annotations.ts and settings.ts), so a test can run the real store against an
// in-memory file on a fake clock instead of rewriting the module registry for
// every other test sharing the worker (pitfall 119).

import {
  BaseDirectory,
  exists,
  mkdir,
  readFile,
  readTextFile,
  writeFile,
} from "@tauri-apps/plugin-fs";
import { writeTextAtomic } from "./atomic-fs";
import {
  createDebouncedWriter,
  type DebouncedWriter,
  type WriterTimer,
} from "./debounced-writer";
import { reportStoreError } from "./store-errors";

// A durable message part (the persisted projection of the UI's ChatPart, in
// src/ui/components/chatParts.ts). Only durable parts reach disk: text, and a card
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

function fileFor(bookId: string): string {
  return `threads-${bookId}.json`;
}

export interface ThreadIo {
  // The file's text, or null when there is none. A read that fails for any
  // other reason throws, so the caller — and the writer — can tell the
  // difference between "no file yet" and "could not be read".
  read: (file: string) => Promise<string | null>;
  write: (file: string, contents: string) => Promise<void>;
  onError?: (e: unknown) => void;
  timer?: WriterTimer;
  exit?: (onExit: () => void) => void;
}

// What the store holds for one file. `removed` is the deletions it owes the
// file: the merge adds back anything on disk that is not in `threads`, so a
// thread deleted here has to be named or it comes straight back.
interface Entry {
  threads: ThreadMap;
  removed: Set<string>;
}

export interface ThreadStore {
  load: (bookId: string) => Promise<ThreadMap>;
  peek: (bookId: string) => Promise<Thread[]>;
  drop: (bookId: string) => void;
  get: (bookId: string, threadId: string) => Thread | undefined;
  getBook: (bookId: string) => Thread | undefined;
  create: (bookId: string, annotationId: string, threadId: string) => Thread;
  createBook: (bookId: string, threadId: string) => Thread;
  remove: (bookId: string, threadId: string) => boolean;
  append: (bookId: string, threadId: string, message: ThreadMessage) => Thread | undefined;
  patch: (bookId: string, threadId: string, ts: number, patch: Partial<ThreadMessage>) => void;
  flush: () => Promise<void>;
}

function parseThreads(text: string): ThreadMap {
  const parsed = JSON.parse(text) as { threads?: ThreadMap };
  return parsed.threads ?? {};
}

export function createThreadStore(io: ThreadIo): ThreadStore {
  const cache = new Map<string, Entry>();

  function entryFor(key: string): Entry {
    const held = cache.get(key);
    if (held) return held;
    const fresh: Entry = { threads: {}, removed: new Set() };
    cache.set(key, fresh);
    return fresh;
  }

  // Read-modify-write, always. The alternative is to write the cache straight
  // out whenever the store believes it read the file first, and that belief is
  // one more thing that can be wrong: a cache that was dropped, or that was
  // never loaded because the caller reached a create path before its load
  // resolved, then writes an empty map over the file. Re-reading costs one IPC
  // round-trip per debounce window and removes the whole class.
  //
  // Cache wins per thread: the copy this process is editing is the newer one for
  // the threads it holds. A thread only this file has (another device's, pulled
  // under us) is kept as it is rather than erased, which is what v1 per-file LWW
  // used to do to it.
  // Keys whose write has begun and not finished. The debounced writer stops
  // calling a key pending the moment its write starts, and a load landing in
  // that window would take the file — which does not have the edit being
  // written yet — for the whole truth.
  const writing = new Set<string>();

  const writer: DebouncedWriter<string> = createDebouncedWriter<string>({
    write: async (key) => {
      const entry = cache.get(key);
      // Nothing held for this key: there is nothing to say about the file, and
      // saying "{}" is exactly the bug this store is written against.
      if (!entry) return;
      writing.add(key);
      try {
        const text = await io.read(fileFor(key));
        // A parse failure throws out of here: it is reported (pitfall 09) and
        // nothing is written. A file whose contents could not be read is never
        // replaced — the bytes stay for the next attempt, or for a human.
        const onDisk = text === null ? {} : parseThreads(text);
        const merged: ThreadMap = { ...onDisk, ...entry.threads };
        const removed = [...entry.removed];
        for (const id of removed) delete merged[id];
        await io.write(fileFor(key), JSON.stringify({ threads: merged }, null, 2));
        // The file and the cache now agree, so the deletions are paid off and
        // the threads that came in with the merge are what later reads answer.
        entry.threads = merged;
        for (const id of removed) entry.removed.delete(id);
      } finally {
        writing.delete(key);
      }
    },
    debounceMs: SAVE_DEBOUNCE,
    onError: io.onError,
    timer: io.timer,
    exit: io.exit,
  });

  const schedule = (key: string): void => writer.schedule(key);

  // Load a document's threads. Missing file is normal ({}); read/parse errors
  // rethrow so the caller can warn.
  //
  // Edits that have not reached disk yet outrank the file for the threads they
  // touch: a load that ran between an append and its write would otherwise hand
  // back — and cache — a conversation missing its last message.
  async function load(bookId: string): Promise<ThreadMap> {
    const text = await io.read(fileFor(bookId));
    const onDisk = text === null ? {} : parseThreads(text);
    const held = cache.get(bookId);
    if (!held || (!writer.isPending(bookId) && !writing.has(bookId))) {
      cache.set(bookId, { threads: onDisk, removed: new Set() });
      return onDisk;
    }
    const merged: ThreadMap = { ...onDisk, ...held.threads };
    for (const id of held.removed) delete merged[id];
    held.threads = merged;
    return merged;
  }

  // The on-disk threads of a book, without touching the cache — the sweep's read
  // path, for the same reason as peekAnnotations. A book that is open answers from
  // disk here, at most one debounce behind, rather than from the live cache.
  async function peek(bookId: string): Promise<Thread[]> {
    try {
      const text = await io.read(fileFor(bookId));
      return text === null ? [] : Object.values(parseThreads(text));
    } catch {
      return [];
    }
  }

  function create(bookId: string, annotationId: string, threadId: string, book?: true): Thread {
    const entry = entryFor(bookId);
    const thread: Thread = {
      id: threadId,
      annotationId,
      ...(book ? { book } : {}),
      path: bookId,
      createdAt: Date.now(),
      messages: [],
    };
    entry.threads[threadId] = thread;
    entry.removed.delete(threadId);
    schedule(bookId);
    return thread;
  }

  return {
    load,
    peek,
    // A sync pull replaced the file under us. Re-read it rather than throw the
    // cached copy away: an absent entry reads as "this book has no threads",
    // and that is what sent the top-bar AI button off to start a second
    // conversation over a history it could not see. The re-read is allowed to
    // be asynchronous and is allowed to fail, because it is no longer what
    // keeps the file safe — the writer's merge is.
    drop: (bookId) => {
      void load(bookId).catch((e: unknown) => io.onError?.(e));
    },
    get: (bookId, threadId) => cache.get(bookId)?.threads[threadId],
    // The book-level thread for a document, if one has ever been created. There
    // is at most one per book (the top-bar button reopens it rather than making
    // more), so this answers with the oldest if a past bug left two.
    getBook: (bookId) => {
      const held = cache.get(bookId);
      if (!held) return undefined;
      let found: Thread | undefined;
      for (const t of Object.values(held.threads)) {
        if (t.book && (!found || t.createdAt < found.createdAt)) found = t;
      }
      return found;
    },
    create: (bookId, annotationId, threadId) => create(bookId, annotationId, threadId),
    // Create the book-level thread (docs/03: the top-bar AI button's
    // selection-free entry). No annotation anchor; the `book` marker is how it's
    // found again.
    createBook: (bookId, threadId) => create(bookId, "", threadId, true),
    // Remove a thread from its file by id. The file stays and is rewritten
    // without this thread — an in-file edit, so per-file LWW sync carries the
    // removal to other devices (unlike a whole-file deletion, which v1 sync does
    // not propagate). The thread's images under images/threads/<threadId>/ are
    // left on disk; they are not synced and a stale directory is harmless. No-op
    // when the thread is already gone.
    remove: (bookId, threadId) => {
      const held = cache.get(bookId);
      if (!held || !(threadId in held.threads)) return false;
      delete held.threads[threadId];
      // Named, so the write's merge takes it out of the file instead of reading
      // it back in as a thread only the file has.
      held.removed.add(threadId);
      schedule(bookId);
      return true;
    },
    append: (bookId, threadId, message) => {
      const thread = cache.get(bookId)?.threads[threadId];
      if (!thread) return undefined;
      thread.messages.push(message);
      schedule(bookId);
      return thread;
    },
    // Merge a patch into the stored message identified by `ts` (used to record a
    // card's later state, e.g. a confirm card flipping to "added"). No-op when
    // the thread or message is gone.
    patch: (bookId, threadId, ts, patch) => {
      const thread = cache.get(bookId)?.threads[threadId];
      if (!thread) return;
      const i = thread.messages.findIndex((m) => m.ts === ts);
      if (i < 0) return;
      thread.messages[i] = { ...thread.messages[i], ...patch };
      schedule(bookId);
    },
    flush: writer.flush,
  };
}

const store = createThreadStore({
  read: async (file) =>
    (await exists(file, { baseDir: BaseDirectory.AppData }))
      ? readTextFile(file, { baseDir: BaseDirectory.AppData })
      : null,
  write: writeTextAtomic,
  onError: (e) => reportStoreError("threads", e),
});

export const loadThreads = (bookId: string): Promise<ThreadMap> => store.load(bookId);
export const peekThreads = (bookId: string): Promise<Thread[]> => store.peek(bookId);
export const dropThreadCache = (bookId: string): void => store.drop(bookId);
export const getThread = (bookId: string, threadId: string): Thread | undefined =>
  store.get(bookId, threadId);
export const getBookThread = (bookId: string): Thread | undefined => store.getBook(bookId);
export const createThread = (bookId: string, annotationId: string, threadId: string): Thread =>
  store.create(bookId, annotationId, threadId);
export const createBookThread = (bookId: string, threadId: string): Thread =>
  store.createBook(bookId, threadId);
export const deleteThread = (bookId: string, threadId: string): boolean =>
  store.remove(bookId, threadId);
export const appendMessage = (
  bookId: string,
  threadId: string,
  message: ThreadMessage,
): Thread | undefined => store.append(bookId, threadId, message);
export const patchThreadMessage = (
  bookId: string,
  threadId: string,
  ts: number,
  patch: Partial<ThreadMessage>,
): void => store.patch(bookId, threadId, ts, patch);
export const flushThreads = (): Promise<void> => store.flush();

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

// Narrow, so a loaded image is the same shape the compressor produces
// (ai/image-utils's CompressedImage) and can be handed straight to a bubble.
function mediaTypeFor(name: string): "image/png" | "image/jpeg" {
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
): Promise<{ data: string; mediaType: "image/png" | "image/jpeg" }[]> {
  const out: { data: string; mediaType: "image/png" | "image/jpeg" }[] = [];
  for (const name of names) {
    const path = `${threadImageDir(threadId)}/${name}`;
    if (!(await exists(path, { baseDir: BaseDirectory.AppData }))) continue;
    const bytes = await readFile(path, { baseDir: BaseDirectory.AppData });
    out.push({ data: bytesToBase64(bytes), mediaType: mediaTypeFor(name) });
  }
  return out;
}
