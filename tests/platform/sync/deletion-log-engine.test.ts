// Two devices and the deletion log (src/platform/app/deleted-books.ts,
// src/platform/sync/dead-paths.ts, docs/50): a deletion made on one device
// reaches the other's local copies, a book imported again after its deletion
// comes back on both, and a topic deleted under a concurrent edit stays deleted.
// The harness is holdings-engine.test.ts's: one shared remote, two engines with
// their own files, bases and trash. Run: bun test.

import { expect, test } from "bun:test";
import { SyncEngine, type EngineDeps } from "../../../src/platform/sync/engine";
import type { RemoteEntry, RemoteState, SyncBackend } from "../../../src/platform/sync/backend";
import type { BookFs } from "../../../src/platform/sync/books";
import {
  TRASH_TTL_MS,
  type BaseStore,
  type TrashEntry,
  type TrashJournal,
} from "../../../src/platform/sync/localStore";
import type { HoldingsStore } from "../../../src/platform/sync/holdings";
import type { ScannedFile, SyncFs } from "../../../src/platform/sync/syncFs";
import type { Snapshot } from "../../../src/platform/sync/reconcile";
import {
  appendTombstoneLine,
  DELETED_BOOKS_FILE,
  effectiveDeletions,
  tombstoneAt,
  type Tombstone,
} from "../../../src/platform/app/deleted-books";
import { pruneDeletedTopics, type Topic } from "../../../src/platform/app/topics";

const enc = (s: string) => new TextEncoder().encode(s);
const dec = (b: Uint8Array) => new TextDecoder().decode(b);

function makeRemote() {
  const meta = new Map<string, RemoteEntry>();
  const data = new Map<string, Uint8Array>();
  function backend(): SyncBackend {
    let listedHoldings: Record<string, RemoteEntry> = {};
    return {
      async ensureLayout() {},
      async listRemote() {
        const out: RemoteState = {};
        const seen: Record<string, RemoteEntry> = {};
        for (const [name, entry] of meta) {
          if (name.startsWith("holdings-")) {
            seen[name.slice("holdings-".length, -".json".length)] = entry;
            continue;
          }
          out[name] = entry;
        }
        listedHoldings = seen;
        return out;
      },
      listedHoldings: () => listedHoldings,
      async download(name) {
        const b = data.get(name);
        if (!b) throw new Error(`missing ${name}`);
        return b;
      },
      async upload(name, bytes, m) {
        data.set(name, bytes);
        meta.set(name, { rev: m.rev, mtime: m.mtime, size: bytes.length, hash: m.hash });
      },
      async remove(name) {
        data.delete(name);
        meta.delete(name);
      },
      async hasBook() {
        return false;
      },
      async uploadBook() {},
      async downloadBook() {
        throw new Error("no books");
      },
      async removeBook() {},
    };
  }
  return {
    backend,
    has: (name: string) => meta.has(name),
    text: (name: string) => (data.has(name) ? dec(data.get(name)!) : null),
  };
}

function makeDevice(id: string, seed: Record<string, string> = {}) {
  const files = new Map<string, { bytes: Uint8Array; mtime: number }>();
  let clock = 1000;
  for (const [k, v] of Object.entries(seed)) files.set(k, { bytes: enc(v), mtime: (clock += 1) });
  const unreadable = new Set<string>();
  const fs: SyncFs = {
    async list(): Promise<ScannedFile[]> {
      return [...files.entries()].map(([path, f]) => ({
        path,
        mtime: f.mtime,
        size: f.bytes.length,
      }));
    },
    async read(path) {
      if (unreadable.has(path)) throw new Error(`EIO ${path}`);
      const f = files.get(path);
      if (!f) throw new Error(`enoent ${path}`);
      return f.bytes;
    },
    async write(path, bytes) {
      files.set(path, { bytes, mtime: (clock += 1) });
    },
    async stat(path) {
      const f = files.get(path);
      return f ? { mtime: f.mtime, size: f.bytes.length } : null;
    },
    async remove(path) {
      files.delete(path);
    },
  };
  const baseStore = new Map<string, Uint8Array>();
  const base: BaseStore = {
    async read(path) {
      return baseStore.get(path) ?? null;
    },
    async has(path) {
      return baseStore.has(path);
    },
    async write(path, bytes) {
      baseStore.set(path, bytes);
    },
    async remove(path) {
      baseStore.delete(path);
    },
  };
  let trashed: TrashEntry[] = [];
  const trash: TrashJournal = {
    async append(entries) {
      trashed = [...trashed, ...entries];
    },
    async prune(now) {
      trashed = trashed.filter((e) => now - e.at < TRASH_TTL_MS);
    },
  };
  const held = new Map<string, Uint8Array>();
  const holdings: HoldingsStore = {
    async read(key) {
      return held.get(key) ?? null;
    },
    async write(key, bytes) {
      held.set(key, bytes);
    },
  };
  const books: BookFs = {
    async listHashes() {
      return [];
    },
    async has() {
      return false;
    },
    async read() {
      return new Uint8Array();
    },
    async write() {},
  };
  return {
    id,
    fs,
    files,
    base,
    trash,
    holdings,
    books,
    unreadable,
    trashed: () => trashed,
    paths: () => [...files.keys()].filter((p) => !p.startsWith("holdings-")).sort(),
    text: (p: string) => (files.has(p) ? dec(files.get(p)!.bytes) : null),
    put: (p: string, text: string) => files.set(p, { bytes: enc(text), mtime: (clock += 1) }),
    remove: (p: string) => files.delete(p),
    // What the domain side does: append one event to the log.
    log(t: Tombstone) {
      this.put(DELETED_BOOKS_FILE, appendTombstoneLine(this.text(DELETED_BOOKS_FILE) ?? "", t));
    },
    dead() {
      return effectiveDeletions(this.text(DELETED_BOOKS_FILE) ?? "");
    },
  };
}

function engineFor(remote: ReturnType<typeof makeRemote>, dev: ReturnType<typeof makeDevice>) {
  const snapshot: Snapshot = {};
  const deps: EngineDeps = {
    backend: remote.backend(),
    fs: dev.fs,
    books: dev.books,
    booksPolicy: "off",
    base: dev.base,
    trash: dev.trash,
    snapshot,
    deviceId: () => dev.id,
    holdings: dev.holdings,
  };
  return new SyncEngine(deps);
}

async function settle(a: SyncEngine, b: SyncEngine): Promise<void> {
  for (let i = 0; i < 3; i += 1) {
    await a.syncNow();
    await b.syncNow();
  }
}

const T1 = tombstoneAt(Date.UTC(2026, 8, 20, 10));
const T2 = tombstoneAt(Date.UTC(2026, 8, 21, 10));
const T3 = tombstoneAt(Date.UTC(2026, 8, 22, 10));

// --- a book deleted, imported again, and deleted again ---------------------

test("a book imported again after its deletion comes back on both devices, and can go again", async () => {
  const remote = makeRemote();
  const A = makeDevice("d-a", { "annotations-h1.json": "MARKS", "settings.json": "{}" });
  const B = makeDevice("d-b");
  const a = engineFor(remote, A);
  const b = engineFor(remote, B);
  await settle(a, b);
  expect(B.text("annotations-h1.json")).toBe("MARKS");

  // A deletes the book: the log first, then its own copies (delete-book.ts).
  A.log({ kind: "book", id: "h1", op: "delete", at: T1 });
  A.remove("annotations-h1.json");
  await settle(a, b);
  expect(B.paths()).not.toContain("annotations-h1.json");
  expect(remote.has("annotations-h1.json")).toBe(false);
  expect(B.trashed().map((t) => t.path)).toEqual(["annotations-h1.json"]);
  expect(B.dead().book.has("h1")).toBe(true);

  // B imports the same file again: a revive in the log (library.ts), then new
  // marks.
  B.log({ kind: "book", id: "h1", op: "revive", at: T2 });
  B.put("annotations-h1.json", "NEW MARKS");
  await settle(a, b);
  expect(A.text(DELETED_BOOKS_FILE)).toBe(B.text(DELETED_BOOKS_FILE));
  expect(A.dead().book.has("h1")).toBe(false);
  expect(A.text("annotations-h1.json")).toBe("NEW MARKS");
  expect(remote.text("annotations-h1.json")).toBe("NEW MARKS");
  // Both events are in the log, in the union, and nothing was rewritten.
  expect(A.text(DELETED_BOOKS_FILE)).toBe(
    `{"bookId":"h1","at":"${T1}"}\n{"kind":"book","id":"h1","op":"revive","at":"${T2}"}\n`,
  );

  // And the book can be deleted a second time.
  A.log({ kind: "book", id: "h1", op: "delete", at: T3 });
  A.remove("annotations-h1.json");
  await settle(a, b);
  expect(B.paths()).not.toContain("annotations-h1.json");
  expect(remote.has("annotations-h1.json")).toBe(false);
  expect(B.dead().book.has("h1")).toBe(true);
});

test("a revive and a delete made apart converge on the later one under the union", async () => {
  const remote = makeRemote();
  const seed = { [DELETED_BOOKS_FILE]: `{"bookId":"h1","at":"${T1}"}\n`, "settings.json": "{}" };
  const A = makeDevice("d-a", seed);
  const B = makeDevice("d-b", seed);
  const a = engineFor(remote, A);
  const b = engineFor(remote, B);
  await settle(a, b);

  // Offline from each other: A imports the book again, B deletes it once more
  // an hour later (a no-op to the log, it is already deleted) and then, later
  // still, imports it too.
  A.log({ kind: "book", id: "h1", op: "revive", at: T2 });
  A.put("annotations-h1.json", "A MARKS");
  B.log({ kind: "book", id: "h1", op: "revive", at: T3 });
  await settle(a, b);
  expect(A.text(DELETED_BOOKS_FILE)).toBe(B.text(DELETED_BOOKS_FILE));
  expect(A.dead().book.has("h1")).toBe(false);
  expect(B.text("annotations-h1.json")).toBe("A MARKS");
});

// --- a retell deleted on one device -----------------------------------------

test("a retell deleted on one device leaves the other's local copies, its talk and its rehearsal", async () => {
  const remote = makeRemote();
  const A = makeDevice("d-a", {
    "retell-r1.json": "RETELL",
    "threads-retell-r1.json": "RETELL CHAT",
    "outline-o1.json": "OUTLINE",
    "threads-talk-o1.json": "TALK CHAT",
    "rehearsal-x1.json": "REHEARSAL",
    "runs-rehearsal-x1.json": "RUNS",
    "runs/x1/8f1c0a52-3b7d-4c1e-9a2f-0d5e6b7c8a90.json": "PASS",
    "retell-r2.json": "OTHER",
  });
  const B = makeDevice("d-b");
  const a = engineFor(remote, A);
  const b = engineFor(remote, B);
  await settle(a, b);
  expect(B.paths()).toContain("runs/x1/8f1c0a52-3b7d-4c1e-9a2f-0d5e6b7c8a90.json");

  // What delete-retell.ts does on A: each store logs its own deletion and
  // removes its own files.
  A.log({ kind: "rehearsal", id: "x1", op: "delete", at: T1 });
  A.log({ kind: "outline", id: "o1", op: "delete", at: T1 });
  A.log({ kind: "retell", id: "r1", op: "delete", at: T1 });
  for (const p of A.paths()) if (p !== "retell-r2.json" && p !== DELETED_BOOKS_FILE) A.remove(p);
  await settle(a, b);

  expect(B.paths()).toEqual([DELETED_BOOKS_FILE, "retell-r2.json"]);
  expect(A.paths()).toEqual([DELETED_BOOKS_FILE, "retell-r2.json"]);
  for (const p of [
    "retell-r1.json",
    "threads-retell-r1.json",
    "outline-o1.json",
    "threads-talk-o1.json",
    "rehearsal-x1.json",
    "runs-rehearsal-x1.json",
    "runs/x1/8f1c0a52-3b7d-4c1e-9a2f-0d5e6b7c8a90.json",
  ]) {
    expect(`${p}: ${remote.has(p)}`).toBe(`${p}: false`);
  }
  // B's copies are journalled on the way out.
  expect(B.trashed().map((t) => t.path).sort()).toEqual([
    "outline-o1.json",
    "rehearsal-x1.json",
    "retell-r1.json",
    "runs-rehearsal-x1.json",
    "runs/x1/8f1c0a52-3b7d-4c1e-9a2f-0d5e6b7c8a90.json",
    "threads-retell-r1.json",
    "threads-talk-o1.json",
  ]);
});

// --- a topic deleted under a concurrent edit --------------------------------

function topicsJson(topics: Topic[]): string {
  return JSON.stringify({ topics }, null, 2);
}

test("a topic deleted on one device stays deleted when the other opened one of its books meanwhile", async () => {
  const remote = makeRemote();
  const topics: Topic[] = [
    { id: "t1", name: "gone", createdAt: 1, files: [{ path: "/a.pdf", name: "a.pdf", addedAt: 1, hash: "h1" }] },
    { id: "t2", name: "kept", createdAt: 2, files: [] },
  ];
  const A = makeDevice("d-a", { "topics.json": topicsJson(topics) });
  const B = makeDevice("d-b");
  const a = engineFor(remote, A);
  const b = engineFor(remote, B);
  await settle(a, b);

  // A deletes the topic (delete-topic.ts): the log, then the row. B, not yet
  // synced, opens the topic's book, which edits the same row.
  A.log({ kind: "topic", id: "t1", op: "delete", at: T1 });
  A.put("topics.json", topicsJson(topics.filter((t) => t.id !== "t1")));
  const edited = structuredClone(topics);
  edited[0]!.files[0]!.lastOpenedAt = 5;
  B.put("topics.json", topicsJson(edited));
  await settle(a, b);

  // The record merge lets the edit outrank the delete: the row is back in the
  // file on both devices. The log is what the shelf answers from, and on it the
  // topic is gone — on both.
  expect(A.text("topics.json")).toBe(B.text("topics.json"));
  for (const dev of [A, B]) {
    const onDisk = (JSON.parse(dev.text("topics.json")!) as { topics: Topic[] }).topics;
    expect(onDisk.map((t) => t.id)).toEqual(["t1", "t2"]);
    expect(pruneDeletedTopics(onDisk, dev.dead()).map((t) => t.id)).toEqual(["t2"]);
  }
});

// --- a log that will not read -----------------------------------------------

test("a log this device cannot read deletes nothing and is not rewritten", async () => {
  const remote = makeRemote();
  const A = makeDevice("d-a", {
    [DELETED_BOOKS_FILE]: `{"bookId":"h1","at":"${T1}"}\n`,
    "annotations-h1.json": "MARKS",
  });
  A.unreadable.add(DELETED_BOOKS_FILE);
  const a = engineFor(remote, A);
  await a.syncNow();
  expect(A.text("annotations-h1.json")).toBe("MARKS");
  expect(A.text(DELETED_BOOKS_FILE)).toBe(`{"bookId":"h1","at":"${T1}"}\n`);
  expect(A.trashed()).toEqual([]);
});
