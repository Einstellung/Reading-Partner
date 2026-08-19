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
let writeFails = false;
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
  writeFails = false;
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
      if (writeFails) throw new Error("EIO");
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

// docs/09: the one storage change. A thread that has never been parked on a
// chapter carries no field at all, which is what a device running an older
// version writes and what its file has to keep meaning.
test("a chapter focus is written on the thread, cleared, and absent until set", async () => {
  writeFile([thread("t1")]);
  await store.load("book1");
  expect(store.get("book1", "t1")?.focusChapter).toBeUndefined();

  store.setFocusChapter("book1", "t1", 3);
  await advance(500);
  const parked = JSON.parse(files.get(FILE)!) as { threads: Record<string, Thread> };
  expect(parked.threads.t1.focusChapter).toBe(3);

  store.setFocusChapter("book1", "t1", null);
  await advance(500);
  const cleared = JSON.parse(files.get(FILE)!) as { threads: Record<string, Thread> };
  expect("focusChapter" in cleared.threads.t1).toBe(false);

  // A thread that is gone is not a write.
  store.setFocusChapter("book1", "missing", 2);
  expect(store.get("book1", "missing")).toBeUndefined();
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

// The window a single gen bump does not cover. The write bumps on its way in and
// takes `writing`; a load issued after that, whose read answers after the whole
// write is over, finds all three guards quiet — isPending false, writing false,
// gen unchanged — and wipes the entry down to a file that is one write old.
// Reached by the ordinary sync-pull path: dropThreadCache's re-read, issued while
// a write is in the air.
test("a load issued inside a write does not delete what that write put on disk", async () => {
  writeFile([thread("t1")]);
  await store.load("book1");
  store.append("book1", "t1", { role: "user", text: "typed", ts: 2 });

  // The debounce fires; the write's own read is already done and its bytes are
  // in the air.
  const releaseWrite = parkNextWrite();
  fireTimers(500);
  await settle();

  // The load is issued here, and what its read will answer with is the file
  // without the message.
  const releaseRead = parkNextRead();
  const reload = store.load("book1");
  await settle();

  releaseWrite();
  await settle();
  await settle();
  expect(messagesOf("t1")).toEqual(["said in t1", "typed"]);

  releaseRead();
  await reload;

  // Before: the entry's t1 was replaced by the copy from before the write, and
  // the next write put that copy back over the file — deleting a message that
  // had already reached disk.
  store.append("book1", "t1", { role: "ai", text: "answered", ts: 3 });
  await advance(500);
  expect(messagesOf("t1")).toEqual(["said in t1", "typed", "answered"]);
});

// The same interleaving, on the thread the incident was about. Worse than a lost
// message: the entry is wiped down to a file that predates the thread, so the
// store stops holding a conversation the button is showing.
test("a book thread created this session survives a pull re-read inside its write", async () => {
  writeFile([thread("t1")]);
  await store.load("book1");
  const opened = store.createBook("book1", "bt-new");

  const releaseWrite = parkNextWrite();
  fireTimers(500);
  await settle();

  // Sync pulls the file and the route tells the store to re-read it, right here.
  const releaseRead = parkNextRead();
  store.drop("book1");
  await settle();

  releaseWrite();
  await settle();
  await settle();
  expect(onDisk()).toEqual(["bt-new", "t1"]);

  releaseRead();
  await settle();

  // Before: getBook answered undefined and append answered undefined, and every
  // message typed into the open chat went nowhere — the incident's own failure
  // mode, reached through the pull's re-read instead of through create.
  expect(store.getBook("book1")?.id).toBe("bt-new");
  expect(store.append("book1", "bt-new", { role: "user", text: "hello", ts: 3 })).toBe(opened);

  await advance(500);
  expect(messagesOf("bt-new")).toEqual(["hello"]);
});

// A write that fails leaves the entry holding the only copy of what it was
// carrying, and the guards go quiet exactly the same way — so the file moving on
// is not what the bump on the way out records. It is that this write is over.
test("a write that fails does not let a load in flight erase what it was carrying", async () => {
  writeFile([thread("t1")]);
  await store.load("book1");
  store.append("book1", "t1", { role: "user", text: "typed", ts: 2 });

  const releaseWrite = parkNextWrite();
  writeFails = true;
  fireTimers(500);
  await settle();

  const releaseRead = parkNextRead();
  const reload = store.load("book1");
  await settle();

  releaseWrite();
  await settle();
  await settle();
  expect(errors).toHaveLength(1);
  expect(messagesOf("t1")).toEqual(["said in t1"]);

  releaseRead();
  await reload;

  writeFails = false;
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

// --- asides (docs/03) ---
//
// A side conversation off a live one, one level deep. Two things about it are
// storage rules rather than UI: it is never the thread the top-bar button
// reopens, and deleting the conversation it hangs off takes it too.

test("an aside is written with its parent link and never with the book marker", async () => {
  writeFile([thread("bt", { book: true, annotationId: "" })]);
  await store.load("book1");

  store.createAside("book1", "as-1", {
    parentThreadId: "bt",
    asideAnchor: { messageTs: 7, text: "the sentence they pulled out" },
  });
  await advance(500);

  const parsed = JSON.parse(files.get(FILE)!) as { threads: Record<string, Thread> };
  expect(parsed.threads["as-1"].parentThreadId).toBe("bt");
  expect(parsed.threads["as-1"].asideAnchor).toEqual({
    messageTs: 7,
    text: "the sentence they pulled out",
  });
  expect(parsed.threads["as-1"].annotationId).toBe("");
  expect("book" in parsed.threads["as-1"]).toBe(false);
});

// The mark-anchored flavour: drawn on the page while the lesson ran, so it has
// an annotation like any mark thread and no span of its own.
test("a mark-anchored aside carries its mark and no anchor text", async () => {
  writeFile([thread("bt", { book: true, annotationId: "" })]);
  await store.load("book1");

  const made = store.createAside("book1", "as-2", {
    parentThreadId: "bt",
    annotationId: "ann-drawn",
  });

  expect(made.annotationId).toBe("ann-drawn");
  expect(made.asideAnchor).toBeUndefined();
  expect(made.parentThreadId).toBe("bt");
});

// What the top-bar AI button opens. An aside answering here is the reader's side
// conversation put where the lesson goes.
test("the book thread lookup skips asides, whatever they carry", async () => {
  writeFile([
    thread("bt", { book: true, annotationId: "", createdAt: 5 }),
    // Older, and wrongly carrying the marker a past version could have written.
    thread("as-old", { annotationId: "", createdAt: 1, parentThreadId: "bt", book: true }),
  ]);
  await store.load("book1");

  expect(store.getBook("book1")?.id).toBe("bt");
});

test("a book whose only thread is an aside has no book thread at all", async () => {
  writeFile([thread("as", { annotationId: "", parentThreadId: "gone" })]);
  await store.load("book1");

  expect(store.getBook("book1")).toBeUndefined();
});

// Deleting the lesson deletes what hangs off it, and every id has to be named:
// an aside dropped from the cache and not named comes straight back on the next
// read-modify-write as a thread only the file has.
test("deleting a parent takes its asides, and none of them come back", async () => {
  const shape = (): Thread[] => [
    thread("bt", { book: true, annotationId: "" }),
    thread("as-1", { annotationId: "", parentThreadId: "bt" }),
    thread("as-2", { annotationId: "ann-drawn", parentThreadId: "bt" }),
    thread("t1"),
  ];
  writeFile(shape());
  await store.load("book1");

  expect(store.removeTree("book1", "bt").sort()).toEqual(["as-1", "as-2", "bt"]);
  await advance(500);
  expect(onDisk()).toEqual(["t1"]);

  // The file comes back with all three, the way a sync pull would deliver it.
  writeFile(shape());
  store.append("book1", "t1", { role: "user", text: "still here", ts: 9 });
  await advance(500);
  expect(onDisk()).toEqual(["t1"]);
});

test("deleting an aside leaves the conversation it hangs off alone", async () => {
  writeFile([
    thread("bt", { book: true, annotationId: "" }),
    thread("as-1", { annotationId: "", parentThreadId: "bt" }),
  ]);
  await store.load("book1");

  expect(store.removeTree("book1", "as-1")).toEqual(["as-1"]);
  await advance(500);
  expect(onDisk()).toEqual(["bt"]);
});

test("deleting a thread that is not there removes nothing and names nothing", async () => {
  writeFile([thread("t1")]);
  await store.load("book1");
  expect(store.removeTree("book1", "missing")).toEqual([]);
  expect(store.removeTree("never-loaded", "t1")).toEqual([]);
});

// The cascade's other half. Per-record sync merge has no referential integrity:
// an aside edited on another device outranks this device's delete and arrives
// back with its parent gone. On the device whose user asked for the deletion,
// finishing it is what the delete meant.
test("an aside whose parent this session deleted does not survive the merge", async () => {
  writeFile([
    thread("bt", { book: true, annotationId: "" }),
    thread("as-1", { annotationId: "", parentThreadId: "bt" }),
  ]);
  await store.load("book1");
  store.removeTree("book1", "bt");
  await advance(500);
  expect(onDisk()).toEqual([]);

  // The other device's edited copy lands in the file, and beside it an aside off
  // the same parent that this device has never seen — an id `removed` cannot
  // name, caught by the link instead.
  writeFile([
    thread("as-1", {
      annotationId: "",
      parentThreadId: "bt",
      messages: [{ role: "user", text: "edited elsewhere", ts: 3 }],
    }),
    thread("as-theirs", { annotationId: "", parentThreadId: "bt" }),
    thread("t9"),
  ]);
  store.create("book1", "ann-9", "t-new");
  await advance(500);

  expect(onDisk()).toEqual(["t-new", "t9"]);
  expect(store.get("book1", "as-1")).toBeUndefined();
  expect(store.get("book1", "as-theirs")).toBeUndefined();
});

// The device on the other side of that: its user deleted nothing, so its side
// conversation stays. It is not silently unreachable — the store enumerates it.
test("an orphaned aside is kept and enumerated rather than reaped", async () => {
  writeFile([
    thread("as-1", { annotationId: "", parentThreadId: "gone" }),
    thread("as-2", { annotationId: "ann-drawn", parentThreadId: "bt" }),
    thread("bt", { book: true, annotationId: "" }),
    thread("t1"),
  ]);
  await store.load("book1");

  expect(store.orphanAsides("book1").map((t) => t.id)).toEqual(["as-1"]);
  expect(store.get("book1", "as-1")).toBeDefined();

  store.append("book1", "t1", { role: "user", text: "unrelated", ts: 4 });
  await advance(500);
  expect(onDisk()).toEqual(["as-1", "as-2", "bt", "t1"]);
});

test("the asides of a thread are enumerable for the delete paths", async () => {
  writeFile([
    thread("bt", { book: true, annotationId: "" }),
    thread("as-1", { annotationId: "", parentThreadId: "bt" }),
    thread("as-2", { annotationId: "ann-drawn", parentThreadId: "bt" }),
    thread("t1"),
  ]);
  await store.load("book1");

  expect(store.asides("book1", "bt").map((t) => t.id).sort()).toEqual(["as-1", "as-2"]);
  expect(store.asides("book1", "t1")).toEqual([]);
  expect(store.list("book1").map((t) => t.id).sort()).toEqual(["as-1", "as-2", "bt", "t1"]);
});

// The additive rule the file has kept since `book` and `focusChapter`: a record
// written by a device that has never heard of asides carries neither field, and
// nothing here may mind.
test("a file written before asides existed merges unchanged", async () => {
  writeFile([thread("t1"), thread("bt", { book: true, annotationId: "" })]);
  await store.load("book1");

  expect(store.get("book1", "t1")?.parentThreadId).toBeUndefined();
  expect(store.get("book1", "t1")?.asideAnchor).toBeUndefined();
  expect(store.getBook("book1")?.id).toBe("bt");

  store.append("book1", "t1", { role: "ai", text: "answered", ts: 6 });
  await advance(500);
  const parsed = JSON.parse(files.get(FILE)!) as { threads: Record<string, Thread> };
  expect("parentThreadId" in parsed.threads.t1).toBe(false);
  expect("asideAnchor" in parsed.threads.t1).toBe(false);
  expect(onDisk()).toEqual(["bt", "t1"]);
});
