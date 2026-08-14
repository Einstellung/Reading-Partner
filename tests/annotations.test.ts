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
// One-shot parks, the same pair threads-store.test.ts uses: `readGate` holds a
// read between the answer being taken and it being handed back (which is what a
// slow read is), `writeGate` holds the write's IPC between the bytes being
// handed over and the file changing.
let readGate: Promise<void> | null = null;
let writeGate: Promise<void> | null = null;

let store: AnnotationStore;

beforeEach(() => {
  files.clear();
  writes = [];
  tasks = [];
  clock = 0;
  errors = [];
  writeFails = false;
  reads = 0;
  readGate = null;
  writeGate = null;
  exitFlush = null;
  store = createAnnotationStore({
    read: async (file) => {
      reads++;
      // Taken before the park: a parked read comes back with the file as it was
      // when it was issued.
      const answer = files.get(file) ?? null;
      if (readGate) {
        const held = readGate;
        readGate = null;
        await held;
      }
      return answer;
    },
    // A real write is an IPC round-trip, so the file cannot change before the
    // first await; landing it synchronously would let a flush that only starts
    // the write pass for one that waited.
    write: async (file, contents) => {
      await Promise.resolve();
      if (writeGate) {
        const held = writeGate;
        writeGate = null;
        await held;
      }
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

// Park the next read; returns the release.
function parkNextRead(): () => void {
  let release = (): void => {};
  readGate = new Promise<void>((resolve) => {
    release = resolve;
  });
  return release;
}

// Park the next write, between the bytes being handed over and the file
// changing.
function parkNextWrite(): () => void {
  let release = (): void => {};
  writeGate = new Promise<void>((resolve) => {
    release = resolve;
  });
  return release;
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

  store.remove("book10", ["mine"]);
  // The drop leaves nothing in memory, so the file has to come back before the
  // delete can be worked out at all.
  await settle();
  await advance(500);

  expect(idsIn("annotations-book10.json")).toEqual(["theirs"]);
});

test("an unreadable file throws out of load and reads as no marks out of peek", async () => {
  files.set("annotations-book8.json", "{not json");
  await expect(store.load("book8")).rejects.toThrow();
  expect(await store.peek("book8")).toEqual([]);
});

// BLOCKER: what a pull leaves behind cannot be filled in asynchronously. A
// re-read is an await long, and this store's writer cannot merge — the reader's
// API is whole-set replacement, and merging would resurrect deleted highlights —
// so a disk copy arriving behind a save simply replaces it.
test("a highlight drawn while a pull is being taken up is not thrown away", async () => {
  files.set("annotations-book11.json", JSON.stringify([mark("a"), mark("b")]));
  await store.load("book11");

  // Sync pulls the file and the route invalidates the cache.
  store.drop("book11");
  // The user drags a new highlight before anything the drop started could
  // finish. The reader hands its whole set, which is what it had plus the new
  // one — this is the only record of the drag there will ever be.
  store.save("book11", [mark("a"), mark("b"), mark("just-made")]);
  await advance(500);

  expect(idsIn("annotations-book11.json")).toEqual(["a", "b", "just-made"]);
});

// The same window on the cache-less delete path: it reads the file, and the read
// must not be allowed to decide what the book's marks were.
test("a highlight drawn while a delete is reading the file is not thrown away", async () => {
  files.set("annotations-book12.json", JSON.stringify([mark("a"), mark("b")]));

  // Nothing in memory — a pull just dropped it. The user deletes one mark and
  // draws another before the file comes back.
  store.remove("book12", ["a"]);
  store.save("book12", [mark("a"), mark("b"), mark("just-made")]);
  await settle();
  await advance(500);

  expect(idsIn("annotations-book12.json")).toEqual(["b", "just-made"]);
});

// A load is an await long too, and a save that lands inside it is the reader's
// whole set, which is newer than any file.
test("a mark made while the file is being loaded is not replaced by it", async () => {
  files.set("annotations-book13.json", JSON.stringify([mark("a")]));

  const loading = store.load("book13");
  store.save("book13", [mark("a"), mark("just-made")]);
  await loading;
  await advance(500);

  expect(idsIn("annotations-book13.json")).toEqual(["a", "just-made"]);
});


// The window a single gen bump does not cover, the same one threads.ts has: the
// write bumps on its way in and takes `writing`, and a load issued after that
// whose read answers after the write is over finds all three guards quiet. The
// set from before the save goes back over the cache, and because this store
// writes the cache out whole, one delete then puts it over the file.
test("a load issued inside a write does not put the pre-write set back", async () => {
  files.set("annotations-book14.json", JSON.stringify([mark("a")]));
  await store.load("book14");
  store.save("book14", [mark("a"), mark("b")]);

  // The debounce fires and the write parks with its bytes handed over.
  const releaseWrite = parkNextWrite();
  await advance(500);

  // The load is issued here; what its read will answer with is the file without
  // the mark just made.
  const releaseRead = parkNextRead();
  const reload = store.load("book14");
  await settle();

  releaseWrite();
  await settle();
  expect(idsIn("annotations-book14.json")).toEqual(["a", "b"]);

  releaseRead();
  await reload;

  // Before: the cache was ["a"] again, and this delete wrote the book empty.
  store.remove("book14", ["a"]);
  await advance(500);
  expect(idsIn("annotations-book14.json")).toEqual(["b"]);
});


// And a write that fails leaves the cache holding the only copy of the mark,
// with the guards quiet the same way — so what the bump on the way out records
// is that this write is over, not that the file changed.
test("a write that fails does not let a load in flight put the file back", async () => {
  files.set("annotations-book15.json", JSON.stringify([mark("a")]));
  await store.load("book15");
  store.save("book15", [mark("a"), mark("b")]);

  const releaseWrite = parkNextWrite();
  writeFails = true;
  await advance(500);

  const releaseRead = parkNextRead();
  const reload = store.load("book15");
  await settle();

  releaseWrite();
  await settle();
  expect(errors).toHaveLength(1);
  expect(idsIn("annotations-book15.json")).toEqual(["a"]);

  releaseRead();
  await reload;

  writeFails = false;
  store.remove("book15", ["a"]);
  await advance(500);
  expect(idsIn("annotations-book15.json")).toEqual(["b"]);
});
