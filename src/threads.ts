// AI-pen conversation threads, one file per document: threads-<pathHash>.json.
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
import { hashPath } from "./storage";

export interface ThreadMessage {
  role: "user" | "ai";
  text: string;
  ts: number;
  // Filenames of attached images under images/threads/<threadId>/, e.g.
  // "1720000000000-0.png". Kept out of the thread JSON body so the file stays
  // small (same reasoning as image annotations, pitfall 07); the base64 is read
  // back on demand for display and for resending to the model.
  images?: string[];
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
export async function loadThreads(path: string): Promise<ThreadMap> {
  const key = hashPath(path);
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

export function getThread(path: string, threadId: string): Thread | undefined {
  return cache.get(hashPath(path))?.[threadId];
}

export function createThread(path: string, annotationId: string, threadId: string): Thread {
  const key = hashPath(path);
  const map = cache.get(key) ?? {};
  const thread: Thread = {
    id: threadId,
    annotationId,
    path,
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
export function createBookThread(path: string, threadId: string): Thread {
  const key = hashPath(path);
  const map = cache.get(key) ?? {};
  const thread: Thread = {
    id: threadId,
    annotationId: "",
    book: true,
    path,
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
export function getBookThread(path: string): Thread | undefined {
  const map = cache.get(hashPath(path));
  if (!map) return undefined;
  for (const t of Object.values(map)) if (t.book) return t;
  return undefined;
}

export function appendMessage(path: string, threadId: string, message: ThreadMessage): Thread | undefined {
  const key = hashPath(path);
  const thread = cache.get(key)?.[threadId];
  if (!thread) return undefined;
  thread.messages.push(message);
  schedule(key);
  return thread;
}
