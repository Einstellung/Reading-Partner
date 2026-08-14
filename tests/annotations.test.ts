// The annotation store's in-memory cache and its invalidation
// (src/platform/app/annotations.ts). The cache is written back in full on every
// mark, so after sync pulls another device's annotations-<bookId>.json it has to
// be dropped or the next mark erases what was pulled.
//
// The real store runs here against an in-memory file and a fake clock handed to
// createAnnotationStore. Nothing global is touched: mock.module would swap
// atomic-fs out for every other test file sharing the worker and never put it
// back (pitfall 119), and a fake `window` on globalThis decides for unrelated
// code whether it thinks it is in a browser. Run: bun test.

import { beforeEach, expect, test } from "bun:test";
import {
  createAnnotationStore,
  type AnnotationStore,
} from "../src/platform/app/annotations";
import type { Annotation } from "../src/platform/app/reader-contract";

const files = new Map<string, string>();
let writes: string[] = [];

interface Task {
  id: number;
  at: number;
  fn: () => void;
}
let clock = 0;
let nextTimerId = 1;
let tasks: Task[] = [];
let exitFlush: (() => void) | null = null;
let errors: unknown[] = [];
let writeFails = false;
let reads = 0;

let store: AnnotationStore;

beforeEach(() => {
  files.clear();
  writes = [];
  tasks = [];
  clock = 0;
  errors = [];
  writeFails = false;
  reads = 0;
  exitFlush = null;
  store = createAnnotationStore({
    read: async (file) => {
      reads++;
      return files.get(file) ?? null;
    },
    // A real write is an IPC round-trip, so the file cannot change before the
    // first await; landing it synchronously would let a flush that only starts
    // the write pass for one that waited.
    write: async (file, contents) => {
      await Promise.resolve();
      if (writeFails) throw new Error("EIO");
      writes.push(file);
      files.set(file, contents);
    },
    onError: (e) => errors.push(e),
    timer: {
      schedule: (fn, ms) => {
        const id = nextTimerId++;
        tasks.push({ id, at: clock + ms, fn });
        return id;
      },
      cancel: (id) => {
        tasks = tasks.filter((t) => t.id !== id);
      },
    },
    exit: (onExit) => {
      exitFlush = onExit;
    },
  });
});

// Let the store's own promises settle (the write is async under the timer).
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function advance(ms: number): Promise<void> {
  clock += ms;
  const due = tasks.filter((t) => t.at <= clock);
  tasks = tasks.filter((t) => t.at > clock);
  for (const t of due) t.fn();
  await settle();
}

const mark = (id: string): Annotation =>
  ({ id, type: "highlight", color: "#ffd400", pageIndex: 0 }) as unknown as Annotation;

const idsIn = (file: string): string[] =>
  (JSON.parse(files.get(file)!) as Annotation[]).map((a) => a.id);

test("loadAnnotations reads the per-book file", async () => {
  files.set("annotations-book1.json", JSON.stringify([mark("a")]));
  expect((await store.load("book1")).map((a) => a.id)).toEqual(["a"]);
});

test("a dropped cache re-reads the file a sync pull replaced", async () => {
  files.set("annotations-book2.json", JSON.stringify([mark("mine")]));
  await store.load("book2");

  // The other device's copy arrives.
  files.set("annotations-book2.json", JSON.stringify([mark("mine"), mark("theirs")]));
  store.drop("book2");

  const reloaded = await store.load("book2");
  expect(reloaded.map((a) => a.id)).toEqual(["mine", "theirs"]);
  // And a later delete recomputes from the pulled set, not the stale one.
  store.remove("book2", ["mine"]);
  await advance(500);
  expect(idsIn("annotations-book2.json")).toEqual(["theirs"]);
});

test("a book with unflushed local marks keeps its cache", async () => {
  files.set("annotations-book3.json", JSON.stringify([mark("a")]));
  await store.load("book3");
  store.save("book3", [mark("a"), mark("just-drawn")]);

  // A pull arriving before the debounce fires must not throw away the mark the
  // user just made; it is picked up on reopen instead.
  store.drop("book3");
  await advance(500);
  expect(idsIn("annotations-book3.json")).toEqual(["a", "just-drawn"]);
});

test("the debounced write targets the same file name a load reads", async () => {
  store.save("book4", [mark("a")]);
  await advance(499);
  expect(writes).toEqual([]);
  await advance(1);
  expect(writes).toEqual(["annotations-book4.json"]);
});

// The last mark of a session is made and the app is closed inside the debounce;
// on iOS the webview is suspended without the timer ever firing.
test("a mark still on the debounce is written on the way out", async () => {
  store.save("book5", [mark("late")]);
  await advance(100);
  expect(writes).toEqual([]);

  exitFlush?.();
  await settle();
  expect(idsIn("annotations-book5.json")).toEqual(["late"]);

  // pagehide can fire more than once, and the timer it cancelled must not write
  // a second time either.
  exitFlush?.();
  await advance(500);
  expect(writes).toEqual(["annotations-book5.json"]);
});

test("a failed write is reported rather than swallowed", async () => {
  writeFails = true;
  store.save("book6", [mark("a")]);
  await advance(500);
  expect(writes).toEqual([]);
  expect(errors.length).toBe(1);
});

// peek is the sweep's read path: it must not seed the cache, or a sweep running
// while the open book has a write pending would flush the stale copy over the
// mark just made.
test("peeking at a book does not seed its cache", async () => {
  files.set("annotations-book7.json", JSON.stringify([mark("on-disk")]));
  expect((await store.peek("book7")).map((a) => a.id)).toEqual(["on-disk"]);
  const afterPeek = reads;

  // Nothing was cached, so anything that has to know the book's marks has to go
  // and read them. That emptiness is the point: a sweep that had seeded the
  // cache would let the next save flush a disk copy over marks made since.
  store.remove("book7", ["whatever"]);
  await advance(500);
  expect(reads).toBe(afterPeek + 1);
  expect(idsIn("annotations-book7.json")).toEqual(["on-disk"]);
});

// The same shape that emptied a thread file, on the store that holds the
// highlights: after a pull the cache is not the record of what this book has,
// and a delete that recomputes from nothing writes nothing over everything.
test("a delete on a book whose marks are not in memory reads the file first", async () => {
  files.set("annotations-book9.json", JSON.stringify([mark("a"), mark("b"), mark("c")]));

  store.remove("book9", ["b"]);
  // The file has to come back before the delete can be worked out at all.
  await settle();
  await advance(500);

  expect(idsIn("annotations-book9.json")).toEqual(["a", "c"]);
});

test("a delete right after a sync pull keeps the marks the pull brought", async () => {
  files.set("annotations-book10.json", JSON.stringify([mark("mine")]));
  await store.load("book10");

  // The other device's copy arrives and the pull route hands it to the store.
  files.set("annotations-book10.json", JSON.stringify([mark("mine"), mark("theirs")]));
  store.drop("book10");
  await settle();

  store.remove("book10", ["mine"]);
  await advance(500);

  expect(idsIn("annotations-book10.json")).toEqual(["theirs"]);
});

test("an unreadable file throws out of load and reads as no marks out of peek", async () => {
  files.set("annotations-book8.json", "{not json");
  await expect(store.load("book8")).rejects.toThrow();
  expect(await store.peek("book8")).toEqual([]);
});
