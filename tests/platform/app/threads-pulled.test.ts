// A pulled conversation file reaching the view that shows it
// (src/platform/app/threads.ts, load's `pulled`). The pull route makes the store
// re-read the file; what this file holds down is that the re-read announces the
// messages it adopted into a thread the store already held, through the same
// channel and in the same shape as a local append — so a conversation open on
// this device shows what the other one wrote without being closed and reopened.
//
// The real store runs against an in-memory file and a fake clock, and the route
// is the real one built over this store's drop (pitfall 119). Run: bun test.

import { beforeEach, expect, test } from "bun:test";
import {
  createThreadStore,
  type Thread,
  type ThreadAppend,
  type ThreadMessage,
  type ThreadStore,
} from "../../../src/platform/app/threads";
import { bookCachePullRoute, type PullRoute } from "../../../src/platform/sync/pull-routes";

const FILE = "threads-book1.json";

let files: Map<string, string>;
let heard: ThreadAppend[];
let tasks: { id: number; fn: () => void }[];
let store: ThreadStore;
let route: PullRoute;

function build(into: ThreadAppend[]): ThreadStore {
  let nextId = 1;
  return createThreadStore({
    read: async (file) => {
      await Promise.resolve();
      return files.get(file) ?? null;
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
    onAppend: (append) => into.push(append),
  });
}

beforeEach(() => {
  files = new Map();
  heard = [];
  tasks = [];
  store = build(heard);
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
  return { id, annotationId: "", book: true, path: "book1", createdAt: 1, messages };
}

function writeFile(threads: Thread[]): void {
  files.set(FILE, JSON.stringify({ threads: Object.fromEntries(threads.map((t) => [t.id, t])) }));
}

async function pull(): Promise<void> {
  route.onPulled([FILE]);
  await settle();
}

test("a pull announces what the other device added to a thread this process holds", async () => {
  writeFile([thread("t1", [msg("m1", "user", 10, "hi"), msg("m2", "ai", 11, "hello")])]);
  await store.load("book1");

  const question = msg("m3", "user", 20, "and then?");
  const answer = msg("m4", "ai", 21, "then this");
  writeFile([
    thread("t1", [msg("m1", "user", 10, "hi"), msg("m2", "ai", 11, "hello"), question, answer]),
  ]);
  await pull();

  expect(heard).toEqual([
    { key: "book1", threadId: "t1", message: question },
    { key: "book1", threadId: "t1", message: answer },
  ]);
  expect(store.get("book1", "t1")?.messages.map((m) => m.id)).toEqual(["m1", "m2", "m3", "m4"]);
});

test("the announcement is the one a local append of the same message makes", async () => {
  const pulled = msg("m2", "ai", 11, "from the other device");
  writeFile([thread("t1", [msg("m1", "user", 10, "hi")])]);
  await store.load("book1");
  writeFile([thread("t1", [msg("m1", "user", 10, "hi"), pulled])]);
  await pull();

  const local: ThreadAppend[] = [];
  const here = build(local);
  writeFile([thread("t1", [msg("m1", "user", 10, "hi")])]);
  await here.load("book1");
  here.append("book1", "t1", pulled);

  expect(heard).toEqual(local);
});

test("a message the thread already holds is not announced again", async () => {
  writeFile([thread("t1", [msg("m1", "user", 10, "hi"), msg("m2", "ai", 11, "hel")])]);
  await store.load("book1");
  // The same bytes again, keys in another order.
  files.set(
    FILE,
    JSON.stringify({
      threads: {
        t1: {
          ...thread("t1", []),
          messages: [
            { text: "hi", ts: 10, role: "user", id: "m1" },
            { ts: 11, text: "hel", id: "m2", role: "ai" },
          ],
        },
      },
    }),
  );
  await pull();

  expect(heard).toEqual([]);
});

test("a held message pulled longer is announced as an update to it", async () => {
  // The other device's reply, pulled while it was still being written.
  writeFile([thread("t1", [msg("m1", "user", 10, "hi"), msg("m2", "ai", 11, "hel")])]);
  await store.load("book1");
  const grown = msg("m2", "ai", 11, "hello");
  writeFile([thread("t1", [msg("m1", "user", 10, "hi"), grown])]);
  await pull();

  expect(heard).toEqual([{ key: "book1", threadId: "t1", message: grown, update: true }]);
  expect(store.get("book1", "t1")?.messages.map((m) => m.text)).toEqual(["hi", "hello"]);
});

test("a message with no id is told apart by its stamp and role", async () => {
  const old: ThreadMessage = { role: "user", ts: 10, text: "hi" };
  const reply: ThreadMessage = { role: "ai", ts: 10, text: "hello" };
  writeFile([thread("t1", [old])]);
  await store.load("book1");
  writeFile([thread("t1", [old, reply])]);
  await pull();

  expect(heard).toEqual([{ key: "book1", threadId: "t1", message: reply }]);
});

test("a file this process never loaded announces nothing", async () => {
  writeFile([thread("t1", [msg("m1", "user", 10, "hi"), msg("m2", "ai", 11, "hello")])]);
  await pull();

  expect(heard).toEqual([]);
  // The re-read still happened: the store holds the file now.
  expect(store.get("book1", "t1")?.messages).toHaveLength(2);
});

test("a thread new to this process announces nothing", async () => {
  writeFile([thread("t1", [msg("m1", "user", 10, "hi")])]);
  await store.load("book1");
  writeFile([thread("t1", [msg("m1", "user", 10, "hi")]), thread("t2", [msg("m9", "user", 30, "new")])]);
  await pull();

  expect(heard).toEqual([]);
  expect(store.get("book1", "t2")).toBeDefined();
});

test("a thread with a write on its way takes the pulled message, and its own reply is not drawn twice", async () => {
  writeFile([thread("t1", [msg("m1", "user", 10, "hi")])]);
  await store.load("book1");
  // The reply being written here, still in the debounce when the pull lands.
  store.append("book1", "t1", msg("m2", "ai", 11, "hel"));
  heard.length = 0;
  const theirs = msg("m3", "user", 12, "x");
  writeFile([thread("t1", [msg("m1", "user", 10, "hi"), msg("m2", "ai", 11, "hel"), theirs])]);
  await pull();

  expect(heard).toEqual([{ key: "book1", threadId: "t1", message: theirs }]);
  expect(store.get("book1", "t1")?.messages.map((m) => m.id)).toEqual(["m1", "m2", "m3"]);
});

test("a local append is still announced once", async () => {
  writeFile([thread("t1", [msg("m1", "user", 10, "hi")])]);
  await store.load("book1");
  store.append("book1", "t1", msg("m2", "ai", 11, "hello"));
  for (const t of tasks.splice(0)) t.fn();
  await store.flush();
  await pull();

  expect(heard.map((a) => a.message.id)).toEqual(["m2"]);
});
