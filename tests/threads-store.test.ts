// The thread store's file discipline (src/platform/app/threads.ts): what it is
// allowed to write over.
//
// One book's conversations are one file, and the store used to serialise
// whatever its cache held — `cache.get(key) ?? {}`. A sync pull dropped that
// cache while the book was open; the next press of the top-bar AI button found
// no book thread, made one, and half a second later the file held that one
// thread and nothing else. Eight conversations, gone in one debounce.
//
// So the rule under test is: a write never replaces a file this process has not
// read. The real store runs here against an in-memory file and a fake clock
// handed to createThreadStore — nothing global is touched (pitfall 119).
// Run: bun test.

import { beforeEach, expect, test } from "bun:test";
import {
  createThreadStore,
  type Thread,
  type ThreadStore,
} from "../src/platform/app/threads";

const files = new Map<string, string>();
let reads = 0;
let readFails = false;
// When set, the next read waits on it and clears it — used to park a write
// mid-flight while something else reads.
let gate: Promise<void> | null = null;

interface Task {
  id: number;
  at: number;
  fn: () => void;
}
let clock = 0;
let nextTimerId = 1;
let tasks: Task[] = [];
let errors: unknown[] = [];

let store: ThreadStore;

const FILE = "threads-book1.json";

beforeEach(() => {
  files.clear();
  tasks = [];
  clock = 0;
  reads = 0;
  readFails = false;
  gate = null;
  errors = [];
  store = createThreadStore({
    read: async (file) => {
      await Promise.resolve();
      // One-shot: the write's read is the one parked, not the load's.
      if (gate) {
        const held = gate;
        gate = null;
        await held;
      }
      reads++;
      if (readFails) throw new Error("EIO");
      return files.get(file) ?? null;
    },
    // A real write is an IPC round-trip, so the file cannot change before the
    // first await.
    write: async (file, contents) => {
      await Promise.resolve();
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
    exit: () => {},
  });
});

function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function advance(ms: number): Promise<void> {
  clock += ms;
  const due = tasks.filter((t) => t.at <= clock);
  tasks = tasks.filter((t) => t.at > clock);
  for (const t of due) t.fn();
  await settle();
  await settle();
}

function thread(id: string, over: Partial<Thread> = {}): Thread {
  return {
    id,
    annotationId: `ann-${id}`,
    path: "book1",
    createdAt: 1,
    messages: [{ role: "user", text: `said in ${id}`, ts: 1 }],
    ...over,
  };
}

function onDisk(file = FILE): string[] {
  const parsed = JSON.parse(files.get(file)!) as { threads: Record<string, Thread> };
  return Object.keys(parsed.threads).sort();
}

function writeFile(threads: Thread[], file = FILE): void {
  files.set(
    file,
    JSON.stringify({ threads: Object.fromEntries(threads.map((t) => [t.id, t])) }),
  );
}

// The incident, driven end to end.
test("a pull that lands between the load and the next new thread costs nothing", async () => {
  writeFile([thread("t1"), thread("t2"), thread("bt", { book: true, annotationId: "" })]);
  await store.load("book1");

  // Sync pulls the file; the route tells the store its cache is behind.
  store.drop("book1");
  await settle();

  // The user presses the top-bar AI button. Before: the lookup missed, so a
  // second book thread was made and written over all three.
  expect(store.getBook("book1")?.id).toBe("bt");

  store.create("book1", "ann-new", "t3");
  await advance(500);

  expect(onDisk()).toEqual(["bt", "t1", "t2", "t3"]);
});

// The same hole reached without any sync at all: the press beats open-book's
// load, so nothing was ever read for this file.
test("a book whose file was never read is added to, not replaced", async () => {
  writeFile([thread("t1"), thread("t2")]);

  store.createBook("book1", "bt-new");
  await advance(500);

  expect(onDisk()).toEqual(["bt-new", "t1", "t2"]);
});

test("a message appended to a thread the file does not know is merged in", async () => {
  writeFile([thread("t1")]);
  await store.load("book1");
  store.create("book1", "ann-2", "t2");
  await advance(500);

  // Another device's conversation arrives in the file behind the store's back.
  writeFile([thread("t1"), thread("t2"), thread("theirs")]);

  store.append("book1", "t2", { role: "ai", text: "answered", ts: 9 });
  await advance(500);

  // Their conversation is kept as it is; the one this process is editing is
  // written from the cache (per-thread LWW, where the whole file used to lose).
  expect(onDisk()).toEqual(["t1", "t2", "theirs"]);
  const parsed = JSON.parse(files.get(FILE)!) as { threads: Record<string, Thread> };
  expect(parsed.threads.t2.messages.map((m) => m.text)).toEqual(["answered"]);
  expect(parsed.threads.theirs.messages.map((m) => m.text)).toEqual(["said in theirs"]);
});

test("a deleted thread does not come back through the merge", async () => {
  writeFile([thread("t1"), thread("t2")]);
  await store.load("book1");

  expect(store.remove("book1", "t1")).toBe(true);
  await advance(500);

  expect(onDisk()).toEqual(["t2"]);
});

test("a delete still lands when a pull re-reads the file before it is written", async () => {
  writeFile([thread("t1"), thread("t2")]);
  await store.load("book1");
  store.remove("book1", "t1");

  // The pull arrives inside the debounce window, with t1 still in the file.
  store.drop("book1");
  await settle();

  // The re-read must not hand the deleted thread back, or the trace list shows
  // a conversation the user removed until the write catches up.
  expect(store.get("book1", "t1")).toBeUndefined();

  await advance(500);
  expect(onDisk()).toEqual(["t2"]);
});

test("a load that runs before the write does not lose the unwritten message", async () => {
  writeFile([thread("t1")]);
  await store.load("book1");
  store.append("book1", "t1", { role: "user", text: "not written yet", ts: 2 });

  const reloaded = await store.load("book1");

  expect(reloaded.t1.messages.map((m) => m.text)).toEqual(["said in t1", "not written yet"]);
  await advance(500);
  const parsed = JSON.parse(files.get(FILE)!) as { threads: Record<string, Thread> };
  expect(parsed.threads.t1.messages).toHaveLength(2);
});

test("a file that will not parse is reported and left alone", async () => {
  files.set(FILE, "{ this is not json");

  store.createBook("book1", "bt-new");
  await advance(500);

  expect(files.get(FILE)).toBe("{ this is not json");
  expect(errors).toHaveLength(1);
});

test("a file that cannot be read is not replaced either", async () => {
  writeFile([thread("t1")]);
  await store.load("book1");
  readFails = true;

  store.create("book1", "ann-2", "t2");
  await advance(500);

  expect(onDisk()).toEqual(["t1"]);
  expect(errors).toHaveLength(1);
});

// The file is read once per debounce window, not once per message.
test("a burst of appends costs one read and one write", async () => {
  writeFile([thread("t1")]);
  await store.load("book1");
  const before = reads;

  for (let i = 0; i < 5; i++) {
    store.append("book1", "t1", { role: "user", text: `m${i}`, ts: 10 + i });
  }
  await advance(500);

  expect(reads - before).toBe(1);
  const parsed = JSON.parse(files.get(FILE)!) as { threads: Record<string, Thread> };
  expect(parsed.threads.t1.messages).toHaveLength(6);
});

// peek is the observation sweep's read path: it must not seed or disturb the
// cache of a book that is open.
test("peek reads the file without giving the store an opinion about it", async () => {
  writeFile([thread("t1")]);

  expect((await store.peek("book1")).map((t) => t.id)).toEqual(["t1"]);
  expect(store.get("book1", "t1")).toBeUndefined();
});

// Only one book thread is ever created now, but a file written before that was
// true has two, and the one worth reopening is the one with the history in it.
test("a file with two book threads reopens the older one", async () => {
  writeFile([
    thread("bt-new", { book: true, annotationId: "", createdAt: 200 }),
    thread("bt-old", { book: true, annotationId: "", createdAt: 100 }),
  ]);
  await store.load("book1");

  expect(store.getBook("book1")?.id).toBe("bt-old");
});

// The gap the debounced writer leaves: a key stops counting as pending the
// moment its write starts, and the write is two IPC round-trips long.
test("a load that lands while a write is in flight keeps the message being written", async () => {
  writeFile([thread("t1")]);
  await store.load("book1");
  store.append("book1", "t1", { role: "user", text: "mid-flight", ts: 2 });

  // Hold the write open at its read, and load the book while it is there.
  let release = (): void => {};
  gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  clock += 500;
  const due = tasks.filter((t) => t.at <= clock);
  tasks = tasks.filter((t) => t.at > clock);
  for (const t of due) t.fn();
  await settle();

  const reloaded = await store.load("book1");
  expect(reloaded.t1.messages.map((m) => m.text)).toEqual(["said in t1", "mid-flight"]);

  release();
  await settle();
  await settle();
  const parsed = JSON.parse(files.get(FILE)!) as { threads: Record<string, Thread> };
  expect(parsed.threads.t1.messages.map((m) => m.text)).toEqual(["said in t1", "mid-flight"]);
});
