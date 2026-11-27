// A sync pull landing in a book whose conversation file has a write on its way
// (src/platform/app/threads.ts, pitfall 712). The store used to keep its own
// copy of every thread it held and write that copy whole, so whatever another
// device had written into one of those threads was erased by the next write and
// went out as a deletion on the next sync pass. What this file holds down: the
// threads both sides hold merge one message at a time — the pulled ones taken
// in and announced, this process's own changes kept — and the order and the
// identity are the sync merge's (platform/sync/merge/messages.ts).
//
// The real store runs against an in-memory file and a fake clock, through the
// real pull route (pitfall 119). Run: bun test.

import { beforeEach, expect, test } from "bun:test";
import {
  createThreadStore,
  type Thread,
  type ThreadAppend,
  type ThreadMessage,
  type ThreadStore,
} from "../../../src/platform/app/threads";
import { mergeThread } from "../../../src/platform/sync/merge/messages";
import type { Json } from "../../../src/platform/sync/merge/text";
import { bookCachePullRoute, type PullRoute } from "../../../src/platform/sync/pull-routes";

const FILE = "threads-book1.json";

let files: Map<string, string>;
let heard: ThreadAppend[];
let tasks: { id: number; fn: () => void }[];
let held: Promise<void> | null;
let store: ThreadStore;
let route: PullRoute;

beforeEach(() => {
  files = new Map();
  heard = [];
  tasks = [];
  held = null;
  let nextId = 1;
  store = createThreadStore({
    // The bytes are taken when the read is issued and handed back when it is
    // answered, which a held read makes later than everything after it.
    read: async (file) => {
      const text = files.get(file) ?? null;
      const wait = held;
      held = null;
      await (wait ?? Promise.resolve());
      return text;
    },
    write: async (file, contents) => {
      await Promise.resolve();
      files.set(file, contents);
    },
    quarantine: async () => null,
    timer: {
      schedule: (fn) => {
        const id = nextId++;
        tasks.push({ id, fn });
        return id;
      },
      cancel: (id) => {
        tasks = tasks.filter((t) => t.id !== id);
      },
    },
    onAppend: (append) => heard.push(append),
  });
  route = bookCachePullRoute({ threads: store.drop, annotations: () => {}, viewStates: () => {} });
});

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const msg = (id: string, role: "user" | "ai", ts: number, text: string): ThreadMessage => ({
  id,
  role,
  ts,
  text,
});

function thread(id: string, messages: ThreadMessage[]): Thread {
  return { id, annotationId: `ann-${id}`, path: "book1", createdAt: 1, messages };
}

function writeFile(threads: Thread[]): void {
  files.set(FILE, JSON.stringify({ threads: Object.fromEntries(threads.map((t) => [t.id, t])) }));
}

function onDisk(threadId: string): ThreadMessage[] {
  const parsed = JSON.parse(files.get(FILE)!) as { threads: Record<string, Thread> };
  return parsed.threads[threadId].messages;
}

const texts = (messages: readonly ThreadMessage[] | undefined): string[] =>
  (messages ?? []).map((m) => m.text);

async function pull(): Promise<void> {
  route.onPulled([FILE]);
  await settle();
}

// The debounce running out, and the write it starts landing.
async function debounce(): Promise<void> {
  for (const t of tasks.splice(0)) t.fn();
  await store.flush();
}

// The next read is answered only once the returned function is called.
function holdNextRead(): () => void {
  let release = (): void => {};
  held = new Promise<void>((resolve) => {
    release = resolve;
  });
  return release;
}

test("pitfall 712: a pull into another thread of a book with a write pending survives the write", async () => {
  writeFile([thread("t1", [msg("a", "user", 10, "a")]), thread("t2", [msg("c", "user", 20, "c")])]);
  await store.load("book1");
  store.append("book1", "t1", msg("b", "ai", 11, "b"));
  // Another device's line in t2, pulled while t1's append is in the debounce.
  writeFile([
    thread("t1", [msg("a", "user", 10, "a")]),
    thread("t2", [msg("c", "user", 20, "c"), msg("d", "ai", 21, "d")]),
  ]);
  await pull();
  await debounce();

  expect(texts(onDisk("t2"))).toEqual(["c", "d"]);
  expect(texts(onDisk("t1"))).toEqual(["a", "b"]);
});

test("a pull into the thread being written to keeps both sides, in the order the sync merge gives", async () => {
  const base = [msg("u1", "user", 10, "first"), msg("a1", "ai", 11, "answer")];
  writeFile([thread("t1", base)]);
  await store.load("book1");
  store.append("book1", "t1", msg("u2", "user", 20, "here"));
  store.append("book1", "t1", msg("t-zz", "ai", 21, ""));
  store.patch("book1", "t1", 21, { text: "writing" });
  const local = store.get("book1", "t1")!.messages.map((m) => ({ ...m }));
  heard.length = 0;

  // From the other device: a question and its answer, and a line from a build
  // that writes no ids, stamped in the same millisecond as the reply here —
  // where only the thread-qualified key puts the two in one order.
  const pulled = [
    ...base,
    msg("u3", "user", 15, "there"),
    msg("a3", "ai", 15, "over there"),
    { role: "ai", ts: 21, text: "legacy" } as ThreadMessage,
  ];
  writeFile([thread("t1", pulled)]);
  await pull();

  const merged = mergeThread(
    "t1",
    thread("t1", base) as unknown as Json,
    thread("t1", local) as unknown as Json,
    thread("t1", pulled) as unknown as Json,
  );
  const syncOrder = texts((merged?.value as unknown as Thread).messages);
  expect(syncOrder).toEqual(["first", "answer", "there", "over there", "here", "writing", "legacy"]);
  expect(texts(store.get("book1", "t1")?.messages)).toEqual(syncOrder);
  expect(heard.map((a) => a.message.text)).toEqual(["there", "over there", "legacy"]);
  expect(heard.every((a) => a.update === undefined)).toBe(true);

  await debounce();
  expect(texts(onDisk("t1"))).toEqual(syncOrder);
});

test("a message taken out here is not read back in by a pull that lands before it is written", async () => {
  writeFile([
    thread("t1", [msg("u1", "user", 10, "q"), msg("r", "ai", 11, "receipt"), msg("u2", "user", 12, "q2")]),
  ]);
  await store.load("book1");
  store.removeMessage("book1", "t1", 11);
  // The other device still has it, and has said something since.
  writeFile([
    thread("t1", [
      msg("u1", "user", 10, "q"),
      msg("r", "ai", 11, "receipt"),
      msg("u2", "user", 12, "q2"),
      msg("m", "ai", 13, "theirs"),
    ]),
  ]);
  await pull();

  expect(texts(store.get("book1", "t1")?.messages)).toEqual(["q", "q2", "theirs"]);
  expect(heard.map((a) => a.message.text)).toEqual(["theirs"]);

  await debounce();
  expect(texts(onDisk("t1"))).toEqual(["q", "q2", "theirs"]);
});

test("once the deletion is written, the file decides: a pull that puts the message back keeps it", async () => {
  writeFile([thread("t1", [msg("u1", "user", 10, "q"), msg("r", "ai", 11, "receipt")])]);
  await store.load("book1");
  store.removeMessage("book1", "t1", 11);
  await debounce();
  expect(texts(onDisk("t1"))).toEqual(["q"]);

  // Another device edited it meanwhile, and the sync merge lets an edit
  // outrank a delete. Pulled while this book has a write pending again.
  store.append("book1", "t1", msg("u2", "user", 12, "q2"));
  heard.length = 0;
  const edited = msg("r", "ai", 11, "receipt, edited");
  writeFile([thread("t1", [msg("u1", "user", 10, "q"), edited])]);
  await pull();

  expect(texts(store.get("book1", "t1")?.messages)).toEqual(["q", "receipt, edited", "q2"]);
  expect(heard).toEqual([{ key: "book1", threadId: "t1", message: edited }]);
});

test("a re-read that began before the deletion was written does not bring the message back", async () => {
  writeFile([
    thread("t1", [msg("u1", "user", 10, "q"), msg("r", "ai", 11, "receipt"), msg("u2", "user", 12, "q2")]),
  ]);
  await store.load("book1");
  // The pull's re-read takes the file while it still has the message, and is
  // answered only after the deletion has been written and paid.
  const release = holdNextRead();
  route.onPulled([FILE]);
  store.removeMessage("book1", "t1", 11);
  await debounce();
  release();
  await settle();

  expect(texts(store.get("book1", "t1")?.messages)).toEqual(["q", "q2"]);
  expect(heard).toEqual([]);
  store.append("book1", "t1", msg("u3", "user", 13, "q3"));
  await debounce();
  expect(texts(onDisk("t1"))).toEqual(["q", "q2", "q3"]);
});

test("a reply being written here is neither put back nor announced by a pull holding an older copy", async () => {
  writeFile([thread("t1", [msg("u1", "user", 10, "q")])]);
  await store.load("book1");
  store.append("book1", "t1", msg("a1", "ai", 11, ""));
  store.patch("book1", "t1", 11, { text: "hel" });
  await debounce();
  store.patch("book1", "t1", 11, { text: "hello" });
  heard.length = 0;

  // The file still has what the last write said, and another device's line.
  const theirs = msg("m", "user", 12, "theirs");
  writeFile([thread("t1", [msg("u1", "user", 10, "q"), msg("a1", "ai", 11, "hel"), theirs])]);
  await pull();

  expect(texts(store.get("book1", "t1")?.messages)).toEqual(["q", "hello", "theirs"]);
  expect(heard).toEqual([{ key: "book1", threadId: "t1", message: theirs }]);

  await debounce();
  expect(texts(onDisk("t1"))).toEqual(["q", "hello", "theirs"]);
});

test("another device's reply pulled longer while this book is busy is an update to the held one", async () => {
  writeFile([thread("t1", [msg("u1", "user", 10, "q"), msg("r1", "ai", 11, "hel")])]);
  await store.load("book1");
  store.append("book1", "t1", msg("u2", "user", 20, "next"));
  heard.length = 0;
  const grown = msg("r1", "ai", 11, "hello");
  writeFile([thread("t1", [msg("u1", "user", 10, "q"), grown])]);
  await pull();

  expect(heard).toEqual([{ key: "book1", threadId: "t1", message: grown, update: true }]);
  expect(texts(store.get("book1", "t1")?.messages)).toEqual(["q", "hello", "next"]);

  await debounce();
  expect(texts(onDisk("t1"))).toEqual(["q", "hello", "next"]);
});

test("a write that finds a pulled message before the re-read does takes it in and announces it", async () => {
  writeFile([thread("t1", [msg("u1", "user", 10, "q")])]);
  await store.load("book1");
  store.append("book1", "t1", msg("u2", "user", 20, "mine"));
  heard.length = 0;
  // The sync engine has replaced the file; its re-read has not been asked for.
  const theirs = msg("m", "ai", 15, "theirs");
  writeFile([thread("t1", [msg("u1", "user", 10, "q"), theirs])]);
  await debounce();

  expect(texts(onDisk("t1"))).toEqual(["q", "theirs", "mine"]);
  expect(texts(store.get("book1", "t1")?.messages)).toEqual(["q", "theirs", "mine"]);
  expect(heard).toEqual([{ key: "book1", threadId: "t1", message: theirs }]);

  // The re-read that follows finds nothing new to say.
  heard.length = 0;
  await pull();
  expect(heard).toEqual([]);
});
