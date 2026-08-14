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
// When set, the next read answers with the file as it is now but only hands the
// answer back when the test releases it — used to park one read mid-flight and,
// because the answer is taken before the park, to model a read slower than a
// whole write cycle.
let gate: Promise<void> | null = null;
// The same, one layer down: the write's own IPC, parked between the bytes being
// handed over and the file changing.
let writeGate: Promise<void> | null = null;
let quarantined: string[] = [];
let quarantineFails = false;
let corrupt: { file: string; savedAs: string | null }[] = [];
let exitFlush: (() => void) | null = null;

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
  writeGate = null;
  quarantined = [];
  quarantineFails = false;
  corrupt = [];
  exitFlush = null;
  errors = [];
  store = createThreadStore({
    read: async (file) => {
      await Promise.resolve();
      reads++;
      if (readFails) throw new Error("EIO");
      const answer = files.get(file) ?? null;
      // One-shot, and the answer is already taken: a parked read comes back with
      // the file as it was when it was issued, which is what a slow read is.
      if (gate) {
        const held = gate;
        gate = null;
        await held;
      }
      return answer;
    },
    // A real write is an IPC round-trip, so the file cannot change before the
    // first await.
    write: async (file, contents) => {
      await Promise.resolve();
      if (writeGate) {
        const held = writeGate;
        writeGate = null;
        await held;
      }
      files.set(file, contents);
    },
    quarantine: async (file) => {
      await Promise.resolve();
      if (quarantineFails) throw new Error("EPERM");
      quarantined.push(file);
      const saved = `${file}.corrupt`;
      files.set(saved, files.get(file)!);
      files.delete(file);
      return saved;
    },
    onError: (e) => errors.push(e),
    onCorrupt: (report) => corrupt.push(report),
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

function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

// Run the timers that come due, and nothing else: what a test needs when it
// wants to be inside a write rather than after it.
function fireTimers(ms: number): void {
  clock += ms;
  const due = tasks.filter((t) => t.at <= clock);
  tasks = tasks.filter((t) => t.at > clock);
  for (const t of due) t.fn();
}

async function advance(ms: number): Promise<void> {
  fireTimers(ms);
  await settle();
  await settle();
}

// Park the next read; returns the release.
function parkNextRead(): () => void {
  let release = (): void => {};
  gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  return release;
}

// Park the next write, between the bytes being handed over and the file
// changing. This is the window a user goes on typing and pressing through.
function parkNextWrite(): () => void {
  let release = (): void => {};
  writeGate = new Promise<void>((resolve) => {
    release = resolve;
  });
  return release;
}

function messagesOf(id: string, file = FILE): string[] {
  const parsed = JSON.parse(files.get(file)!) as { threads: Record<string, Thread> };
  return parsed.threads[id].messages.map((m) => m.text);
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

// Refusing to write over bytes that will not parse is permanent: the file never
// gets better on its own, so every message of the session after it went bad is
// dropped. Moving it aside costs a history nobody could have read anyway.
test("a file that will not parse is moved aside instead of blocking every write", async () => {
  files.set(FILE, "{ this is not json");

  store.createBook("book1", "bt-new");
  await advance(500);

  expect(quarantined).toEqual([FILE]);
  expect(files.get(`${FILE}.corrupt`)).toBe("{ this is not json");
  expect(onDisk()).toEqual(["bt-new"]);
  // What the user is told is that a file was set aside, not that this message
  // could not be saved — it was.
  expect(corrupt).toEqual([{ file: FILE, savedAs: `${FILE}.corrupt` }]);
  expect(errors).toEqual([]);

  // And the next message lands too, which is the half that used to be lost for
  // the rest of the session.
  store.append("book1", "bt-new", { role: "user", text: "still working", ts: 5 });
  await advance(500);
  expect(messagesOf("bt-new")).toEqual(["still working"]);
});

// Moving it aside is what makes writing over it honest. If the move fails the
// bytes are still there, so nothing is written and the failure is reported —
// the same rule readGuardedJson keeps.
test("a file that will not parse and cannot be moved aside is left where it is", async () => {
  files.set(FILE, "{ this is not json");
  quarantineFails = true;

  store.createBook("book1", "bt-new");
  await advance(500);

  expect(files.get(FILE)).toBe("{ this is not json");
  expect(corrupt).toEqual([]);
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
  const release = parkNextRead();
  fireTimers(500);
  await settle();

  const reloaded = await store.load("book1");
  expect(reloaded.t1.messages.map((m) => m.text)).toEqual(["said in t1", "mid-flight"]);

  release();
  await settle();
  await settle();
  const parsed = JSON.parse(files.get(FILE)!) as { threads: Record<string, Thread> };
  expect(parsed.threads.t1.messages.map((m) => m.text)).toEqual(["said in t1", "mid-flight"]);
});

// BLOCKER: a write is two IPC round-trips long, and the user is not stopped for
// them. The store used to compute the merged map before the awaits and assign it
// over the cache after, so anything that added or removed a key in between was
// gone. append and patch survived it (they mutate a thread object the snapshot
// shares); create did not, and create is what the top-bar AI button does.
test("a thread created while a write is in flight is not erased by it", async () => {
  writeFile([thread("t1")]);
  await store.load("book1");
  store.append("book1", "t1", { role: "user", text: "typed", ts: 2 });

  // The debounce fires and the write parks with its bytes handed over; the user
  // presses the top-bar AI button while it is there.
  const release = parkNextWrite();
  fireTimers(500);
  await settle();
  const opened = store.createBook("book1", "bt-new");

  release();
  await settle();
  await settle();

  // The button's thread is still the store's, so what is typed into it has
  // somewhere to go. Before: getBook answered undefined, append answered
  // undefined, and the conversation lived in App's list until the app closed.
  expect(store.getBook("book1")?.id).toBe("bt-new");
  expect(store.append("book1", "bt-new", { role: "user", text: "hello", ts: 3 })).toBe(opened);

  await advance(500);
  expect(onDisk()).toEqual(["bt-new", "t1"]);
  expect(messagesOf("bt-new")).toEqual(["hello"]);
});

// The same shape on the delete side: a thread removed during the write must not
// come back when the write's own merge is applied.
test("a thread deleted while a write is in flight does not come back", async () => {
  writeFile([thread("t1"), thread("t2")]);
  await store.load("book1");
  store.append("book1", "t1", { role: "user", text: "typed", ts: 2 });

  const release = parkNextWrite();
  fireTimers(500);
  await settle();
  store.remove("book1", "t2");

  release();
  await settle();
  await settle();
  expect(store.get("book1", "t2")).toBeUndefined();

  await advance(500);
  expect(onDisk()).toEqual(["t1"]);
});

// Not a regression against main — main has a version of the same — but reachable
// and it deletes messages that had already reached disk. isPending and writing
// both answer "no" here: the write started and finished inside the read.
test("a load whose read is overtaken by a whole write cycle keeps what reached disk", async () => {
  writeFile([thread("t1")]);
  await store.load("book1");
  store.append("book1", "t1", { role: "user", text: "typed", ts: 2 });

  // The load's read is issued and parked; what it will answer with is the file
  // as it is now, without the message.
  const release = parkNextRead();
  const reload = store.load("book1");
  await settle();

  // The debounce fires and the whole write lands while that read is parked.
  await advance(500);
  expect(messagesOf("t1")).toEqual(["said in t1", "typed"]);

  release();
  await reload;

  // A file one write old is not what this book's threads are.
  expect(store.get("book1", "t1")?.messages.map((m) => m.text)).toEqual([
    "said in t1",
    "typed",
  ]);
  store.append("book1", "t1", { role: "ai", text: "answered", ts: 3 });
  await advance(500);
  expect(messagesOf("t1")).toEqual(["said in t1", "typed", "answered"]);
});

// The same staleness on the other side: the read predates a delete and answers
// after it. The store's record of what it has deleted is what refuses it.
test("a stale read cannot bring back a thread this session deleted", async () => {
  writeFile([thread("t1"), thread("t2")]);
  await store.load("book1");
  store.remove("book1", "t1");

  const release = parkNextRead();
  const reload = store.load("book1");
  await settle();

  await advance(500);
  expect(onDisk()).toEqual(["t2"]);

  release();
  await reload;
  expect(store.get("book1", "t1")).toBeUndefined();

  store.append("book1", "t2", { role: "user", text: "more", ts: 5 });
  await advance(500);
  expect(onDisk()).toEqual(["t2"]);
});

// The exit path is the whole reason the debounced writer exists: on iOS the
// webview is suspended at pagehide and the pending timer never fires. It gets
// one IPC, and it does not get to write nothing because a read failed.
test("the way out of the app writes the last message without reading first", async () => {
  writeFile([thread("t1")]);
  await store.load("book1");
  store.append("book1", "t1", { role: "user", text: "last thing said", ts: 2 });
  const before = reads;
  // Whatever a read would do on the way out, it must not decide this.
  readFails = true;

  exitFlush?.();
  await settle();
  await settle();

  expect(reads).toBe(before);
  expect(messagesOf("t1")).toEqual(["said in t1", "last thing said"]);
  expect(errors).toEqual([]);
});

// The exception, and the reason the exit path cannot simply always write the
// cache: a book whose file this process never read holds one new thread and
// nothing else, and that is the incident itself.
test("the way out of the app still reads first for a book it never read", async () => {
  writeFile([thread("t1"), thread("t2")]);

  store.createBook("book1", "bt-new");
  exitFlush?.();
  await settle();
  await settle();

  expect(onDisk()).toEqual(["bt-new", "t1", "t2"]);
});

test("the way out of the app writes nothing for a book it never read and cannot read", async () => {
  writeFile([thread("t1"), thread("t2")]);
  store.createBook("book1", "bt-new");
  readFails = true;

  exitFlush?.();
  await settle();
  await settle();

  expect(onDisk()).toEqual(["t1", "t2"]);
  expect(errors).toHaveLength(1);
});

// pagehide can fire more than once and observeAppExit does not deduplicate.
test("a second pagehide on the way out writes nothing more", async () => {
  writeFile([thread("t1")]);
  await store.load("book1");
  store.append("book1", "t1", { role: "user", text: "late", ts: 2 });

  exitFlush?.();
  await settle();
  await settle();
  const after = files.get(FILE);

  exitFlush?.();
  await advance(500);
  expect(files.get(FILE)).toBe(after!);
});
