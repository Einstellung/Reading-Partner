// AI-pen conversation threads, one file per document: threads-<pathHash>.json.
// This is the seed of the "conversation stream" tier (docs/01 §3, first layer);
// the format is intentionally small but the field names are the durable ones.
// Writes are debounced and flushed on pagehide; failures are surfaced (pitfall 09).

import {
  BaseDirectory,
  exists,
  mkdir,
  readTextFile,
  writeTextFile,
} from "@tauri-apps/plugin-fs";
import { hashPath } from "./storage";

export interface ThreadMessage {
  role: "user" | "ai";
  text: string;
  ts: number;
}

export interface Thread {
  id: string;
  annotationId: string;
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

export function appendMessage(path: string, threadId: string, message: ThreadMessage): Thread | undefined {
  const key = hashPath(path);
  const thread = cache.get(key)?.[threadId];
  if (!thread) return undefined;
  thread.messages.push(message);
  schedule(key);
  return thread;
}
