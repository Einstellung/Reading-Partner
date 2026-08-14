// Per-document annotation persistence: one annotations-<bookId>.json under
// AppData, keyed by the book's content hash (library.ts), written in full (the
// reader hands us the complete object each save).
// Writes go through the shared debounced writer (debounced-writer.ts), so they
// coalesce and are flushed on the way out of the app. Save failures are
// surfaced, never swallowed — a lost annotation is invisible until the file is
// reopened.
//
// Everything the store reaches outside itself is passed in, so a test can run
// the real store against an in-memory file on a fake clock instead of rewriting
// the module registry for every other test sharing the worker (pitfall 119).

import {
  BaseDirectory,
  exists,
  readTextFile,
} from "@tauri-apps/plugin-fs";
import { writeTextAtomic } from "./atomic-fs";
import {
  createDebouncedWriter,
  type DebouncedWriter,
  type WriterTimer,
} from "./debounced-writer";
import type { Annotation } from "./reader-contract";
import { reportStoreError } from "./store-errors";

// The annotation color palette. The UI components use the same list; this
// export is the single source.
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

function fileFor(bookId: string): string {
  return `annotations-${bookId}.json`;
}

export interface AnnotationIo {
  // The file's text, or null when there is none. A read that fails for any
  // other reason throws, so loadAnnotations can tell the caller.
  read: (file: string) => Promise<string | null>;
  write: (file: string, contents: string) => Promise<void>;
  onError?: (e: unknown) => void;
  timer?: WriterTimer;
  exit?: (onExit: () => void) => void;
}

export interface AnnotationStore {
  load: (bookId: string) => Promise<Annotation[]>;
  peek: (bookId: string) => Promise<Annotation[]>;
  drop: (bookId: string) => void;
  save: (bookId: string, annotations: Annotation[]) => void;
  remove: (bookId: string, ids: string[]) => void;
  flush: () => Promise<void>;
}

export function createAnnotationStore(io: AnnotationIo): AnnotationStore {
  // Last known full set per file hash, so a delete can recompute without the
  // caller re-supplying everything and both paths share one debounced writer.
  const cache = new Map<string, Annotation[]>();

  // A key the cache holds nothing for is not written. `?? []` here would replace
  // a book's marks with an empty list whenever the cache went away between the
  // change and the write — the same hole threads.ts lost a conversation to.
  // Nothing to say about a file is not the same as "this book has no marks".
  const writer: DebouncedWriter<string> = createDebouncedWriter<string>({
    write: async (key) => {
      const held = cache.get(key);
      if (!held) return;
      await io.write(fileFor(key), JSON.stringify(held, null, 2));
    },
    debounceMs: SAVE_DEBOUNCE,
    onError: io.onError,
    timer: io.timer,
    exit: io.exit,
  });

  // A missing file is normal (returns []); a genuine read/parse error is
  // rethrown so the caller can warn. Legacy image annotations load as-is
  // (region-select is retired) — the engine still renders them; they just can't
  // be created anymore.
  async function load(bookId: string): Promise<Annotation[]> {
    const text = await io.read(fileFor(bookId));
    if (text === null) {
      cache.set(bookId, []);
      return [];
    }
    const parsed = JSON.parse(text) as Annotation[];
    const list = Array.isArray(parsed) ? parsed : [];
    cache.set(bookId, list.map((a) => ({ ...a })));
    return list;
  }

  // The on-disk marks of a book that is not being read, without touching the
  // cache. The observation sweep (src/observation/arrears.ts) walks every book
  // of every topic every half hour and must not go through load: that seeds the
  // cache from disk, and doing it while the open book has a debounced write
  // pending would flush the stale copy over the mark just made. Missing or
  // unreadable file reads as no marks — a sweep has nothing to warn anyone about.
  async function peek(bookId: string): Promise<Annotation[]> {
    try {
      const text = await io.read(fileFor(bookId));
      if (text === null) return [];
      const parsed = JSON.parse(text) as Annotation[];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  return {
    load,
    peek,
    // Sync pulled a newer annotations-<bookId>.json (src/sync). The cache is
    // written back in full on the next mark, so it has to stop being the copy
    // from before the pull.
    //
    // A book with edits still waiting on the debounce is left alone — re-reading
    // would throw away the mark the user just made, and the pull is picked up on
    // reopen instead. Same rule as dropThreadCache. Note this only settles the
    // on-disk copy: a book that is open keeps the reader's own annotation set,
    // which still overwrites the pull on the next save, so pulled marks appear on
    // reopen.
    drop: (bookId) => {
      if (writer.isPending(bookId)) return;
      // Re-read rather than forget. An absent entry is indistinguishable from a
      // book with no marks, and every path that recomputes from the cache — a
      // delete above all — then computes from nothing and writes that.
      void load(bookId).catch((e: unknown) => io.onError?.(e));
    },
    save: (bookId, annotations) => {
      cache.set(bookId, annotations.map((a) => ({ ...a })));
      writer.schedule(bookId);
    },
    remove: (bookId, ids) => {
      const held = cache.get(bookId);
      if (held) {
        cache.set(bookId, held.filter((a) => !ids.includes(a.id)));
        writer.schedule(bookId);
        return;
      }
      // Nothing held: the file is the only record of what the other marks are,
      // so it is read before one of them is taken out. Filtering an empty list
      // and saving the result is how a delete erases a book.
      void load(bookId)
        .then((current) => {
          cache.set(bookId, current.filter((a) => !ids.includes(a.id)));
          writer.schedule(bookId);
        })
        .catch((e: unknown) => io.onError?.(e));
    },
    flush: writer.flush,
  };
}

const store = createAnnotationStore({
  read: async (file) =>
    (await exists(file, { baseDir: BaseDirectory.AppData }))
      ? readTextFile(file, { baseDir: BaseDirectory.AppData })
      : null,
  write: writeTextAtomic,
  onError: (e) => reportStoreError("annotations", e),
});

export const loadAnnotations = (bookId: string): Promise<Annotation[]> => store.load(bookId);
export const peekAnnotations = (bookId: string): Promise<Annotation[]> => store.peek(bookId);
export const dropAnnotationCache = (bookId: string): void => store.drop(bookId);
export const saveAnnotations = (bookId: string, annotations: Annotation[]): void =>
  store.save(bookId, annotations);
export const deleteAnnotations = (bookId: string, ids: string[]): void =>
  store.remove(bookId, ids);
