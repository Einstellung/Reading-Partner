// A conversation's topic (src/platform/app/threads.ts, docs/21): the field the
// info side writes when the reader confirms where something belongs, and what
// has to survive a sync of the file it sits in.
//
// Two halves. The store's own: setting it, clearing it, and a thread that is not
// there. And the merge's: threads-*.json merges record by record, so a topic
// filed on this device has to come back out of a merge with a device that has
// never heard of the field — the same additive rule `focusChapter` and the aside
// fields keep. The real store runs against an in-memory file with a timer that
// fires at once (pitfall 119: nothing global is touched). Run: bun test.

import { expect, test } from "bun:test";
import { mergeFile } from "../../../src/platform/sync/merge";
import { createThreadStore, type Thread, type ThreadStore } from "../../../src/platform/app/threads";

const FILE = "threads-book1.json";

function harness(seed?: Thread[]) {
  const files = new Map<string, string>();
  if (seed) {
    files.set(FILE, JSON.stringify({ threads: Object.fromEntries(seed.map((t) => [t.id, t])) }));
  }
  const store: ThreadStore = createThreadStore({
    read: async (file) => files.get(file) ?? null,
    write: async (file, contents) => {
      files.set(file, contents);
    },
    quarantine: async () => null,
    // The write is the assertion here, so it happens at the call rather than
    // half a second later.
    timer: {
      schedule: (fn) => {
        fn();
        return 0;
      },
      cancel: () => {},
    },
    exit: () => {},
  });
  const onDisk = () => (JSON.parse(files.get(FILE)!) as { threads: Record<string, Thread> }).threads;
  return { store, files, onDisk };
}

function thread(id: string, over: Partial<Thread> = {}): Thread {
  return {
    id,
    annotationId: "",
    path: "book1",
    createdAt: 1,
    messages: [{ role: "user", text: "hello", ts: 1 }],
    ...over,
  };
}

test("a topic is written on the thread, cleared, and absent until it is set", async () => {
  const { store, onDisk } = harness([thread("briefing-2026-09-08")]);
  await store.load("book1");
  expect(store.get("book1", "briefing-2026-09-08")?.topicId).toBeUndefined();

  store.setTopic("book1", "briefing-2026-09-08", "t-9f2");
  await store.flush();
  expect(onDisk()["briefing-2026-09-08"].topicId).toBe("t-9f2");

  store.setTopic("book1", "briefing-2026-09-08", null);
  await store.flush();
  expect("topicId" in onDisk()["briefing-2026-09-08"]).toBe(false);
});

// One day's file holds the briefing's conversation and one per article, and
// filing one of them says nothing about the others (docs/pitfall/209 is the
// same shape from the other side).
test("filing one conversation leaves the day's others where they were", async () => {
  const { store, onDisk } = harness([thread("briefing-2026-09-08"), thread("2026-09-08:a1")]);
  await store.load("book1");

  store.setTopic("book1", "2026-09-08:a1", "t-9f2");
  await store.flush();
  expect(onDisk()["2026-09-08:a1"].topicId).toBe("t-9f2");
  expect(onDisk()["briefing-2026-09-08"].topicId).toBeUndefined();
});

test("a thread that is not there is not a write", async () => {
  const { store, files } = harness([thread("t1")]);
  await store.load("book1");
  const before = files.get(FILE);

  store.setTopic("book1", "missing", "t-9f2");
  await store.flush();
  expect(files.get(FILE)).toBe(before);
});

// --- the merge --------------------------------------------------------------

function bytes(threads: Thread[]): Uint8Array {
  return new TextEncoder().encode(
    JSON.stringify({ threads: Object.fromEntries(threads.map((t) => [t.id, t])) }, null, 2),
  );
}

function mergedThreads(base: Thread[], local: Thread[], remote: Thread[]): Record<string, Thread> {
  const out = mergeFile({
    path: FILE,
    base: bytes(base),
    local: bytes(local),
    remote: bytes(remote),
  });
  return (JSON.parse(new TextDecoder().decode(out.merged)) as { threads: Record<string, Thread> })
    .threads;
}

// The other device is on a build that has never written the field. Per-record
// merge hands back whichever side changed, so the whole record comes across
// with the topic on it rather than the field being dropped as unknown.
test("a topic filed here survives a merge with a device that has never written one", () => {
  const before = thread("briefing-2026-09-08");
  const filed = thread("briefing-2026-09-08", { topicId: "t-9f2" });
  const theirs = thread("2026-09-08:a1");

  const out = mergedThreads([before], [filed], [before, theirs]);
  expect(out["briefing-2026-09-08"].topicId).toBe("t-9f2");
  // And their conversation arrives untouched, without a topic it never had.
  expect("topicId" in out["2026-09-08:a1"]).toBe(false);
});

test("a topic the other device filed arrives here", () => {
  const before = thread("briefing-2026-09-08");
  const filed = thread("briefing-2026-09-08", { topicId: "t-9f2" });

  const out = mergedThreads([before], [before], [filed]);
  expect(out["briefing-2026-09-08"].topicId).toBe("t-9f2");
});
