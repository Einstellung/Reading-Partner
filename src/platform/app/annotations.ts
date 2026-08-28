// Per-document annotation persistence: one annotations-<bookId>.json under
// AppData, keyed by the book's content hash (library.ts), written in full (the
// reader hands us the complete object each save).
// Writes go through the shared debounced writer (debounced-writer.ts), so they
// coalesce and are flushed on the way out of the app. Save failures are
// surfaced, never swallowed — a lost annotation is invisible until the file is
// reopened.
//
// This store's writer cannot merge — the reader hands over the whole set, and
// merging would resurrect deleted highlights — so everything here follows from
// that: a key the cache does not hold is not written, a pull invalidates the
// cache synchronously rather than re-reading it, and the one path that has to
// derive a set from an absent cache reads the file. The incident that made
// those rules explicit, and why threads.ts answers the same question the other
// way round, is in docs/13.
//
// Everything the store reaches outside itself is passed in, so a test can run
// the real store against an in-memory file on a fake clock instead of rewriting
// the module registry for every other test sharing the worker (pitfall 119).

import { appData } from "./appdata";
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
  //
  // A key this map does not hold means "nobody here knows what this book's marks
  // are", which is not the same as "this book has no marks" — telling the two
  // apart is the whole of what went wrong below. It is told apart by the absence
  // itself: nothing derives a set from a missing key, and the one path that has
  // to (a delete) reads the file. What it must not do is fill the gap with an
  // asynchronous re-read, because the writer here cannot merge — the reader's
  // API is whole-set replacement and merging would resurrect deleted highlights
  // — so a read landing after a save would put the disk copy back over it.
  const cache = new Map<string, Annotation[]>();

  // Bumped by every change to a key's cached set and twice by every write —
  // once when it starts and once when it is over. Same rule as threads.ts:
  // `load` takes this number before its first await and compares it after,
  // because what came back is an account of this book's marks only if nothing
  // happened to them in between, and a read can outlive a whole write.
  // `remove`'s cache-less read is not guarded by it; what that path does
  // instead is at the call site.
  const gens = new Map<string, number>();
  const genOf = (key: string): number => gens.get(key) ?? 0;
  const bump = (key: string): void => {
    gens.set(key, genOf(key) + 1);
  };
  // Keys whose write has begun and not finished. A key stops counting as pending
  // the moment its write starts, and a read issued before it must not be
  // installed over the set that write is putting on disk.
  const writing = new Set<string>();

  // A key the cache holds nothing for is not written. `?? []` here would replace
  // a book's marks with an empty list whenever the cache went away between the
  // change and the write — the same hole threads.ts lost a conversation to.
  // Nothing to say about a file is not the same as "this book has no marks".
  const writer: DebouncedWriter<string> = createDebouncedWriter<string>({
    write: async (key) => {
      const held = cache.get(key);
      if (!held) return;
      writing.add(key);
      bump(key);
      try {
        await io.write(fileFor(key), JSON.stringify(held, null, 2));
      } finally {
        // `writing` stops being true here, so this is the last moment anything
        // can tell a read issued during this write that the file moved on.
        // Bumped however the write ended — one that threw leaves the cache
        // holding marks that never reached disk, and installing the file over
        // them loses them just the same.
        bump(key);
        writing.delete(key);
      }
    },
    debounceMs: SAVE_DEBOUNCE,
    onError: io.onError,
    timer: io.timer,
    exit: io.exit,
  });

  // The file's marks, with no opinion about the cache. A missing file is no
  // marks; anything else throws, because a delete that read [] out of a failed
  // read would write the book empty.
  async function readSet(bookId: string): Promise<Annotation[]> {
    const text = await io.read(fileFor(bookId));
    if (text === null) return [];
    const parsed = JSON.parse(text) as Annotation[];
    return Array.isArray(parsed) ? parsed : [];
  }

  // A missing file is normal (returns []); a genuine read/parse error is
  // rethrown so the caller can warn. Legacy image annotations load as-is
  // (region-select is retired) — the engine still renders them; they just can't
  // be created anymore.
  //
  // What came back is installed only if it is still an account of this book: a
  // save that landed while the file was being read is the reader's whole set and
  // outranks anything on disk, and a write already in the air holds content this
  // read could not have seen.
  async function load(bookId: string): Promise<Annotation[]> {
    const before = genOf(bookId);
    const list = await readSet(bookId);
    if (genOf(bookId) === before && !writer.isPending(bookId) && !writing.has(bookId)) {
      cache.set(bookId, list.map((a) => ({ ...a })));
    }
    return list;
  }

  // The on-disk marks of a book that is not being read, without touching the
  // cache. The observation sweep (src/memory/observations/arrears.ts) walks every book
  // of every topic every half hour and must not go through load: that seeds the
  // cache from disk, and doing it while the open book has a debounced write
  // pending would flush the stale copy over the mark just made. Missing or
  // unreadable file reads as no marks — a sweep has nothing to warn anyone about.
  async function peek(bookId: string): Promise<Annotation[]> {
    try {
      return await readSet(bookId);
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
    // Forgotten, synchronously, and nothing is read here. A re-read is an await
    // long, and a highlight drawn inside that await would be overwritten by the
    // disk copy arriving behind it — this store's writer cannot merge the two
    // back together. What made a re-read look necessary (a delete recomputing
    // from an absent cache and writing nothing over everything) is closed in
    // `remove` instead.
    //
    // A book with edits still waiting on the debounce is left alone — dropping
    // would throw away the mark the user just made, and the pull is picked up on
    // reopen instead. Same rule as dropThreadCache. Note this only settles the
    // on-disk copy: a book that is open keeps the reader's own annotation set,
    // which still overwrites the pull on the next save, so pulled marks appear on
    // reopen.
    drop: (bookId) => {
      if (writer.isPending(bookId)) return;
      cache.delete(bookId);
      bump(bookId);
    },
    save: (bookId, annotations) => {
      cache.set(bookId, annotations.map((a) => ({ ...a })));
      bump(bookId);
      writer.schedule(bookId);
    },
    remove: (bookId, ids) => {
      const held = cache.get(bookId);
      if (held) {
        cache.set(bookId, held.filter((a) => !ids.includes(a.id)));
        bump(bookId);
        writer.schedule(bookId);
        return;
      }
      // Nothing held: the file is the only record of what the other marks are,
      // so it is read before one of them is taken out. Filtering an empty list
      // and saving the result is how a delete erases a book.
      //
      // What comes back is applied to whatever the cache holds by then, not
      // installed over it: a highlight drawn while the read was in flight is the
      // reader's whole set, and the deletion of an older mark has to be taken
      // out of that rather than out of the file as it was before it existed.
      //
      // No gen is taken here, unlike `load`. There is nothing to fall back to
      // when the number has moved: a cache that exists by then is already the
      // newer copy and already wins, and when there is none the file as this
      // read found it is the only record there is. So a pull that lands inside
      // this read is not noticed, and the delete is worked out against the copy
      // from before it — one mark short of the file, not the empty file that
      // filtering nothing used to write.
      void readSet(bookId)
        .then((fromDisk) => {
          const current = cache.get(bookId) ?? fromDisk;
          cache.set(bookId, current.filter((a) => !ids.includes(a.id)));
          bump(bookId);
          writer.schedule(bookId);
        })
        .catch((e: unknown) => io.onError?.(e));
    },
    flush: writer.flush,
  };
}

function liveStore(): AnnotationStore {
  return createAnnotationStore({
    read: async (file) => ((await appData.exists(file)) ? appData.readText(file) : null),
    write: writeTextAtomic,
    onError: (e) => reportStoreError("annotations", e),
  });
}

let store = liveStore();

// The store as this module was first imported with: an empty cache and nothing
// waiting to be written. `drop` takes one book out; this takes the whole store
// back, which is what a test process shared by several files needs.
export function rebuildAnnotationStoreForTests(): void {
  store = liveStore();
}

export const loadAnnotations = (bookId: string): Promise<Annotation[]> => store.load(bookId);
export const peekAnnotations = (bookId: string): Promise<Annotation[]> => store.peek(bookId);
export const dropAnnotationCache = (bookId: string): void => store.drop(bookId);
export const saveAnnotations = (bookId: string, annotations: Annotation[]): void =>
  store.save(bookId, annotations);
export const deleteAnnotations = (bookId: string, ids: string[]): void =>
  store.remove(bookId, ids);
