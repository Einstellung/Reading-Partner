// Per-document annotation persistence: one annotations-<pathHash>.json under
// AppData, written in full (the reader hands us the complete object each save).
// Writes are debounced and flushed on pagehide, mirroring the reading-position
// persistence in App.tsx. Save failures are surfaced, never swallowed — a lost
// annotation is invisible until the file is reopened.

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
// The cache always holds image-stripped objects (what gets written to JSON).
const cache = new Map<string, Annotation[]>();
const timers = new Map<string, number>();
const dirty = new Set<string>();
// Image annotations whose PNG is already on disk ("<pathHash>/<id>"), so we
// don't re-decode and rewrite the same snapshot on every save.
const extracted = new Set<string>();

// Image annotations carry the selected region as a base64 PNG data URI. It
// bloats the JSON (~tens of KB each, pitfall 07) and the document render does
// not use it (only position), so it lives in its own file and is re-inlined
// on load for the trace-list thumbnail.
function imagePath(key: string, id: string): string {
  return `images/${key}/${id}.png`;
}

function dataUriToBytes(uri: string): Uint8Array {
  const bin = atob(uri.slice(uri.indexOf(",") + 1));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function bytesToDataUri(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return `data:image/png;base64,${btoa(bin)}`;
}

async function writeImage(key: string, id: string, uri: string): Promise<void> {
  await mkdir(`images/${key}`, { baseDir: BaseDirectory.AppData, recursive: true });
  await writeFile(imagePath(key, id), dataUriToBytes(uri), { baseDir: BaseDirectory.AppData });
}

async function readImage(key: string, id: string): Promise<string | null> {
  if (!(await exists(imagePath(key, id), { baseDir: BaseDirectory.AppData }))) return null;
  return bytesToDataUri(await readFile(imagePath(key, id), { baseDir: BaseDirectory.AppData }));
}

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
// a genuine read/parse error is rethrown so the caller can warn. Image
// annotations get their PNG re-inlined for the trace-list thumbnail; the cache
// keeps the stripped versions (what stays on disk).
export async function loadAnnotations(path: string): Promise<Annotation[]> {
  const key = hashPath(path);
  const name = fileFor(path);
  if (!(await exists(name, { baseDir: BaseDirectory.AppData }))) {
    cache.set(key, []);
    return [];
  }
  const parsed = JSON.parse(
    await readTextFile(name, { baseDir: BaseDirectory.AppData }),
  ) as Annotation[];
  const list = Array.isArray(parsed) ? parsed : [];
  cache.set(key, list.map((a) => ({ ...a })));
  return Promise.all(
    list.map(async (a) => {
      if (a.type !== "image") return a;
      const uri = await readImage(key, a.id).catch(() => null);
      if (!uri) return a; // no PNG yet; leave any inline image so a save extracts it
      extracted.add(`${key}/${a.id}`); // PNG confirmed on disk
      return { ...a, image: uri };
    }),
  );
}

// Replace the full set for a document and schedule a debounced write. Image
// data URIs are peeled off to PNG files (once) and stripped from the JSON.
export function saveAnnotations(path: string, annotations: Annotation[]): void {
  const key = hashPath(path);
  const stripped = annotations.map((a) => {
    if (typeof a.image !== "string" || !a.image.startsWith("data:image/")) return a;
    const tag = `${key}/${a.id}`;
    if (!extracted.has(tag)) {
      extracted.add(tag);
      void writeImage(key, a.id, a.image).catch((e) => onError(e));
    }
    const { image: _image, ...rest } = a;
    void _image;
    return rest as Annotation;
  });
  cache.set(key, stripped);
  schedule(key);
}

// Remove annotations by id and schedule a debounced write.
export function deleteAnnotations(path: string, ids: string[]): void {
  const key = hashPath(path);
  const remaining = (cache.get(key) ?? []).filter((a) => !ids.includes(a.id));
  cache.set(key, remaining);
  schedule(key);
}
