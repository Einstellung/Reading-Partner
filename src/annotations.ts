// Per-document annotation persistence: one annotations-<pathHash>.json under
// AppData, written in full (the reader hands us the complete object each save).
// Writes are debounced and flushed on pagehide, mirroring the reading-position
// persistence in App.tsx. Save failures are surfaced, never swallowed — a lost
// annotation is invisible until the file is reopened.

import {
  BaseDirectory,
  exists,
  mkdir,
  readTextFile,
  writeTextFile,
} from "@tauri-apps/plugin-fs";
import { hashPath } from "./storage";
import type { Annotation } from "./reader";

// From vendor/reader/src/common/defines.js (ANNOTATION_COLORS). B's UI uses the
// same list; this export is the single source.
export const ANNOTATION_COLORS: { name: string; color: string }[] = [
  { name: "Yellow", color: "#ffd400" },
  { name: "Red", color: "#ff6666" },
  { name: "Green", color: "#5fb236" },
  { name: "Blue", color: "#2ea8e5" },
  { name: "Purple", color: "#a28ae5" },
  { name: "Magenta", color: "#e56eee" },
  { name: "Orange", color: "#f19837" },
  { name: "Gray", color: "#aaaaaa" },
];

const SAVE_DEBOUNCE = 500;

function fileFor(path: string): string {
  return `annotations-${hashPath(path)}.json`;
}

// Last known full set per file hash, so a delete can recompute without the
// caller re-supplying everything and both paths share one debounced writer.
const cache = new Map<string, Annotation[]>();
const timers = new Map<string, number>();
const dirty = new Set<string>();

let onError: (e: unknown) => void = () => {};
export function onSaveError(handler: (e: unknown) => void): void {
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
  const anns = cache.get(key) ?? [];
  await ensureDir();
  await writeTextFile(`annotations-${key}.json`, JSON.stringify(anns, null, 2), {
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

// Load a document's saved annotations. A missing file is normal (returns []);
// a genuine read/parse error is rethrown so the caller can warn.
export async function loadAnnotations(path: string): Promise<Annotation[]> {
  const key = hashPath(path);
  const name = fileFor(path);
  if (!(await exists(name, { baseDir: BaseDirectory.AppData }))) {
    cache.set(key, []);
    return [];
  }
  const text = await readTextFile(name, { baseDir: BaseDirectory.AppData });
  const anns = JSON.parse(text) as Annotation[];
  const list = Array.isArray(anns) ? anns : [];
  cache.set(key, list);
  return list;
}

// Replace the full set for a document and schedule a debounced write.
export function saveAnnotations(path: string, annotations: Annotation[]): void {
  cache.set(hashPath(path), annotations);
  schedule(hashPath(path));
}

// Remove annotations by id and schedule a debounced write.
export function deleteAnnotations(path: string, ids: string[]): void {
  const key = hashPath(path);
  const remaining = (cache.get(key) ?? []).filter((a) => !ids.includes(a.id));
  cache.set(key, remaining);
  schedule(key);
}
