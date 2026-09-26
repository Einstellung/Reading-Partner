// Two devices talking in the same conversation while apart (docs/59 §5): after
// they sync, both hold every message either wrote, on the same bytes, and
// nothing went to the journal. The harness is deletion-log-engine.test.ts's,
// trimmed: one shared remote, two engines with their own files, bases and
// trash. Run: bun test.

import { expect, test } from "bun:test";
import { SyncEngine } from "../../../src/platform/sync/engine";
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
  return { backend, text: (name: string) => (data.has(name) ? dec(data.get(name)!) : null) };
}

function makeDevice(id: string, seed: Record<string, string>) {
  const files = new Map<string, { bytes: Uint8Array; mtime: number }>();
  let clock = 1000;
  for (const [k, v] of Object.entries(seed)) files.set(k, { bytes: enc(v), mtime: (clock += 1) });
  const fs: SyncFs = {
    async list(): Promise<ScannedFile[]> {
      return [...files.entries()].map(([path, f]) => ({ path, mtime: f.mtime, size: f.bytes.length }));
    },
    async read(path) {
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
    base,
    trash,
    holdings,
    books,
    trashed: () => trashed,
    text: (p: string) => (files.has(p) ? dec(files.get(p)!.bytes) : null),
    put: (p: string, text: string) => files.set(p, { bytes: enc(text), mtime: (clock += 1) }),
  };
}

function engineFor(remote: ReturnType<typeof makeRemote>, dev: ReturnType<typeof makeDevice>) {
  const snapshot: Snapshot = {};
  return new SyncEngine({
    backend: remote.backend(),
    fs: dev.fs,
    books: dev.books,
    booksPolicy: "off",
    base: dev.base,
    trash: dev.trash,
    snapshot,
    deviceId: () => dev.id,
    holdings: dev.holdings,
  });
}

async function settle(a: SyncEngine, b: SyncEngine): Promise<void> {
  for (let i = 0; i < 3; i += 1) {
    await a.syncNow();
    await b.syncNow();
  }
}

const FILE = "threads-info-2026-09-26.json";
const T = "11111111-2222-3333-4444-555555555555";

type Msg = { id: string; role: "user" | "ai"; text: string; ts: number };

function conversation(messages: Msg[]): string {
  const thread = { id: T, annotationId: "", path: "info", createdAt: 1, messages };
  return JSON.stringify({ threads: { [T]: thread } }, null, 2);
}

function idsIn(text: string | null): string[] {
  const file = JSON.parse(text ?? "{}") as { threads: Record<string, { messages: Msg[] }> };
  return file.threads[T].messages.map((m) => m.id);
}

test("two devices appending to one conversation apart both keep every message", async () => {
  const remote = makeRemote();
  const start: Msg[] = [
    { id: "t-1", role: "user", text: "morning", ts: 1 },
    { id: "t-2", role: "ai", text: "here is today", ts: 1 },
  ];
  const A = makeDevice("d-a", { [FILE]: conversation(start) });
  const B = makeDevice("d-b", {});
  const a = engineFor(remote, A);
  const b = engineFor(remote, B);
  await settle(a, b);
  expect(B.text(FILE)).toBe(A.text(FILE));

  // Apart: the desktop asks one thing, the phone another, each gets its answer.
  A.put(
    FILE,
    conversation([
      ...start,
      { id: "t-5", role: "user", text: "and rates?", ts: 50 },
      { id: "t-6", role: "ai", text: "held", ts: 50 },
    ]),
  );
  B.put(
    FILE,
    conversation([
      ...start,
      { id: "t-3", role: "user", text: "and oil?", ts: 30 },
      { id: "t-4", role: "ai", text: "down", ts: 30 },
    ]),
  );
  await settle(a, b);

  expect(idsIn(A.text(FILE))).toEqual(["t-1", "t-2", "t-3", "t-4", "t-5", "t-6"]);
  expect(B.text(FILE)).toBe(A.text(FILE));
  expect(remote.text(FILE)).toBe(A.text(FILE));
  // Nothing was chosen away, so nothing is in either journal.
  expect(A.trashed()).toEqual([]);
  expect(B.trashed()).toEqual([]);
});

test("a reply one device synced half written ends up whole on both", async () => {
  const remote = makeRemote();
  const question: Msg = { id: "t-1", role: "user", text: "why?", ts: 1 };
  const A = makeDevice("d-a", { [FILE]: conversation([question]) });
  const B = makeDevice("d-b", {});
  const a = engineFor(remote, A);
  const b = engineFor(remote, B);
  await settle(a, b);

  // A pass lands while the answer is still being written.
  A.put(FILE, conversation([question, { id: "t-2", role: "ai", text: "Because the", ts: 2 }]));
  await a.syncNow();
  // The phone appends meanwhile; the desktop finishes its answer.
  await b.syncNow();
  B.put(
    FILE,
    conversation([
      question,
      { id: "t-2", role: "ai", text: "Because the", ts: 2 },
      { id: "t-3", role: "user", text: "go on", ts: 3 },
    ]),
  );
  A.put(
    FILE,
    conversation([question, { id: "t-2", role: "ai", text: "Because the rates moved.", ts: 2 }]),
  );
  await settle(a, b);

  const file = JSON.parse(A.text(FILE) ?? "{}") as { threads: Record<string, { messages: Msg[] }> };
  expect(file.threads[T].messages.map((m) => m.text)).toEqual([
    "why?",
    "Because the rates moved.",
    "go on",
  ]);
  expect(B.text(FILE)).toBe(A.text(FILE));
  expect(A.trashed()).toEqual([]);
  expect(B.trashed()).toEqual([]);
});
