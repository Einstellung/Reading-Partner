// Two SyncEngines on one in-memory remote — two devices, the way docs/59 §7
// says the tree model has to be verified. Every dependency of a pass is
// injected (engine.ts), so this is the real convergence test and the iPad only
// confirms it.
//
// What is pinned here: both devices publish a holdings and cache the other's,
// an idle pass adds no request, a holdings never reaches either device's
// AppData, and — with the inference armed — a deletion on one device travels,
// an edit beats a delete, a device with no cached base concludes nothing, and a
// purge that failed keeps the base it was taken against until it lands.
// Run: bun test.

import { expect, test } from "bun:test";
import { SyncEngine, type EngineDeps } from "../../../src/platform/sync/engine";
import {
  type RemoteEntry,
  type RemoteState,
  type SyncBackend,
} from "../../../src/platform/sync/backend";
import type { BookFs } from "../../../src/platform/sync/books";
import {
  TRASH_TTL_MS,
  type BaseStore,
  type TrashEntry,
  type TrashJournal,
} from "../../../src/platform/sync/localStore";
import {
  holdingsRemoteName,
  parseHoldings,
  serializeHoldings,
  buildHoldings,
  SELF_KEY,
  type HoldingsStore,
} from "../../../src/platform/sync/holdings";
import type { ScannedFile, SyncFs } from "../../../src/platform/sync/syncFs";
import type { Snapshot } from "../../../src/platform/sync/reconcile";
import { hashBytes } from "../../../src/platform/sync/content";

const enc = (s: string) => new TextEncoder().encode(s);
const dec = (b: Uint8Array) => new TextDecoder().decode(b);

// The shared remote: one data folder both devices list, upload into and delete
// from. Each device gets its own backend object, because listedHoldings answers
// from that device's own last listing.
function makeRemote() {
  const meta = new Map<string, RemoteEntry>();
  const data = new Map<string, Uint8Array>();
  let uploads = 0;
  let downloads = 0;

  function backend(): SyncBackend {
    let listedHoldings: Record<string, RemoteEntry> = {};
    return {
      async ensureLayout() {},
      async listRemote() {
        const out: RemoteState = {};
        const seen: Record<string, RemoteEntry> = {};
        for (const [name, entry] of meta) {
          // The split the real backend does by name (driveBackend.ts): a
          // holdings never reaches RemoteState.
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
        downloads += 1;
        const b = data.get(name);
        if (!b) throw new Error(`missing ${name}`);
        return b;
      },
      async upload(name, bytes, m) {
        uploads += 1;
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
    data,
    meta,
    names: () => [...meta.keys()].sort(),
    text: (name: string) => (data.has(name) ? dec(data.get(name)!) : null),
    uploads: () => uploads,
    downloads: () => downloads,
    seed(name: string, text: string, entry: Omit<RemoteEntry, "size">) {
      data.set(name, enc(text));
      meta.set(name, { ...entry, size: enc(text).length });
    },
  };
}

// One device: its files, its merge base, its trash journal, its cached
// holdings.
function makeDevice(id: string, seed: Record<string, string> = {}) {
  const files = new Map<string, { bytes: Uint8Array; mtime: number }>();
  let clock = 1000;
  for (const [k, v] of Object.entries(seed)) files.set(k, { bytes: enc(v), mtime: (clock += 1) });
  const fs: SyncFs = {
    async list(): Promise<ScannedFile[]> {
      return [...files.entries()].map(([path, f]) => ({
        path,
        mtime: f.mtime,
        size: f.bytes.length,
      }));
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
    files,
    base,
    trash,
    holdings,
    held,
    books,
    trashed: () => trashed,
    paths: () => [...files.keys()].sort(),
    text: (p: string) => (files.has(p) ? dec(files.get(p)!.bytes) : null),
    put: (p: string, text: string) => files.set(p, { bytes: enc(text), mtime: (clock += 1) }),
    cached: (device: string) => parseHoldings(held.get(device) ?? null),
    self: () => parseHoldings(held.get(SELF_KEY) ?? null),
  };
}

function engineFor(
  remote: ReturnType<typeof makeRemote>,
  dev: ReturnType<typeof makeDevice>,
  over: Partial<EngineDeps> = {},
) {
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
    ...over,
  };
  return { engine: new SyncEngine(deps), snapshot };
}

// Both devices in step, with each holding a current copy of the other's tree.
// Three rounds, because a tree is published from the scan the pass started
// with: a device that pulled a file this pass says so on its next one, and the
// other device caches that on the one after.
async function settle(a: SyncEngine, b: SyncEngine): Promise<void> {
  for (let i = 0; i < 3; i += 1) {
    await a.syncNow();
    await b.syncNow();
  }
}

// --- tier 1: publish and cache ----------------------------------------------

test("both devices publish a holdings and cache the other's", async () => {
  const remote = makeRemote();
  const A = makeDevice("d-a", { "topics.json": "topics" });
  const B = makeDevice("d-b", { "settings.json": "{}" });
  const a = engineFor(remote, A);
  const b = engineFor(remote, B);

  await settle(a.engine, b.engine);

  expect(remote.names()).toContain("holdings-d-a.json");
  expect(remote.names()).toContain("holdings-d-b.json");

  const mine = A.self()!;
  expect(Object.keys(mine.files).sort()).toEqual(["settings.json", "topics.json"]);
  expect(mine.device).toBe("d-a");
  expect(mine.complete).toBe(true);

  const peer = A.cached("d-b")!;
  expect(peer.device).toBe("d-b");
  expect(Object.keys(peer.files).sort()).toEqual(["settings.json", "topics.json"]);
  expect(B.cached("d-a")!.device).toBe("d-a");

  // No device caches itself: differencing a device's own past against its
  // present is not a peer's opinion about anything.
  expect(A.cached("d-a")).toBeNull();
});

test("a holdings never reaches AppData and is never reconciled", async () => {
  const remote = makeRemote();
  const A = makeDevice("d-a", { "topics.json": "topics" });
  const B = makeDevice("d-b");
  const a = engineFor(remote, A);
  const b = engineFor(remote, B);

  await settle(a.engine, b.engine);

  for (const dev of [A, B]) {
    expect(dev.paths().filter((p) => p.includes("holdings"))).toEqual([]);
  }
  expect(Object.keys(a.snapshot).filter((p) => p.includes("holdings"))).toEqual([]);
  expect(Object.keys(b.snapshot).filter((p) => p.includes("holdings"))).toEqual([]);
});

test("an idle pass publishes nothing and fetches no peer tree", async () => {
  const remote = makeRemote();
  const A = makeDevice("d-a", { "topics.json": "topics" });
  const B = makeDevice("d-b");
  const a = engineFor(remote, A);
  const b = engineFor(remote, B);
  await settle(a.engine, b.engine);

  const uploads = remote.uploads();
  const downloads = remote.downloads();
  await a.engine.syncNow();
  await b.engine.syncNow();

  expect(remote.uploads()).toBe(uploads);
  expect(remote.downloads()).toBe(downloads);
});

test("the same tree scanned twice publishes the same bytes", async () => {
  const remote = makeRemote();
  const A = makeDevice("d-a", { "topics.json": "topics" });
  const a = engineFor(remote, A, { now: () => 4242 });
  await a.engine.syncNow();
  const first = remote.text("holdings-d-a.json");

  // A second device publishing the same tree writes byte-for-byte the same
  // file, apart from the name it is its own: nothing in it depends on the order
  // a scan produced.
  const remote2 = makeRemote();
  const B = makeDevice("d-a", { "topics.json": "topics" });
  const b = engineFor(remote2, B, { now: () => 4242 });
  await b.engine.syncNow();

  expect(remote2.text("holdings-d-a.json")).toBe(first);
});

test("a peer's incomplete holdings is cached but never inferred from", async () => {
  const remote = makeRemote();
  const A = makeDevice("d-a", { "topics.json": "topics" });
  const a = engineFor(remote, A, { inferDeletions: true });
  await a.engine.syncNow();

  // A base for the peer that this device did reason from, and a current one
  // that dropped the file while saying its scan was partial.
  const had = serializeHoldings(
    buildHoldings({ device: "d-b", at: 1, files: { "topics.json": [await hashBytes(enc("topics")), 6] } }),
  );
  await A.holdings.write("d-b", had);
  const partial = serializeHoldings(
    buildHoldings({ device: "d-b", at: 2, files: {}, complete: false }),
  );
  remote.seed(holdingsRemoteName("d-b"), dec(partial), { rev: 7, mtime: 2, hash: "x" });

  await a.engine.syncNow();

  expect(A.text("topics.json")).toBe("topics");
  expect(A.cached("d-b")!.complete).toBe(false);
});

test("the report names this device's tree and the peer's", async () => {
  const remote = makeRemote();
  const A = makeDevice("d-a", { "topics.json": "topics" });
  const B = makeDevice("d-b");
  const a = engineFor(remote, A);
  const b = engineFor(remote, B);
  await settle(a.engine, b.engine);

  const text = a.engine.holdingsReport();
  expect(text).toContain("self d-a");
  expect(text).toContain("peer d-b");
  expect(text).toContain("inferred deletions (off): none");
});

// --- tier 2: the inference, armed by injection ------------------------------

test("a file one device deleted goes on the other, through the trash", async () => {
  const remote = makeRemote();
  const A = makeDevice("d-a", { "topics.json": "topics" });
  const B = makeDevice("d-b");
  const a = engineFor(remote, A, { inferDeletions: true });
  const b = engineFor(remote, B, { inferDeletions: true });
  await settle(a.engine, b.engine);
  expect(B.text("topics.json")).toBe("topics");

  A.files.delete("topics.json");
  // One pass to publish the tree without it, one on the other device to see the
  // difference and act on it.
  await a.engine.syncNow();
  await b.engine.syncNow();

  expect(B.text("topics.json")).toBeNull();
  expect(remote.names()).not.toContain("topics.json");
  expect(B.trashed().map((e) => e.path)).toEqual(["topics.json"]);
  expect(B.trashed()[0].record).toBe("topics");
  expect(b.snapshot["topics.json"]).toBeUndefined();

  // And it does not come back on the device that deleted it.
  await a.engine.syncNow();
  expect(A.text("topics.json")).toBeNull();
});

test("a delete that meets an edit loses, and both devices end on the edit", async () => {
  const remote = makeRemote();
  const A = makeDevice("d-a", { "topics.json": "topics" });
  const B = makeDevice("d-b");
  const a = engineFor(remote, A, { inferDeletions: true });
  const b = engineFor(remote, B, { inferDeletions: true });
  await settle(a.engine, b.engine);

  A.files.delete("topics.json");
  B.put("topics.json", "topics, edited");

  await a.engine.syncNow();
  await b.engine.syncNow();
  await a.engine.syncNow();

  expect(B.text("topics.json")).toBe("topics, edited");
  expect(A.text("topics.json")).toBe("topics, edited");
  expect(remote.text("topics.json")).toBe("topics, edited");
  expect(B.trashed()).toEqual([]);
});

test("a device with no cached tree of the peer infers nothing", async () => {
  const remote = makeRemote();
  const A = makeDevice("d-a", { "topics.json": "topics" });
  const B = makeDevice("d-b");
  const a = engineFor(remote, A, { inferDeletions: true });
  const b = engineFor(remote, B, { inferDeletions: true });

  // A publishes a tree with the file, then one without it, before B has ever
  // listed: B's first sight of A is a tree that never had it.
  await a.engine.syncNow();
  A.files.delete("topics.json");
  await a.engine.syncNow();

  await b.engine.syncNow();
  await b.engine.syncNow();

  // B pulled the file (it is in the remote) and keeps it: an absence it never
  // saw arrive is not a deletion.
  expect(B.text("topics.json")).toBe("topics");
  expect(B.trashed()).toEqual([]);
});

test("a path on the never-infer list survives the same difference", async () => {
  const remote = makeRemote();
  const A = makeDevice("d-a", { "statements.json": "[]", "topics.json": "topics" });
  const B = makeDevice("d-b");
  const a = engineFor(remote, A, { inferDeletions: true });
  const b = engineFor(remote, B, { inferDeletions: true });
  await settle(a.engine, b.engine);

  A.files.delete("statements.json");
  A.files.delete("topics.json");
  await a.engine.syncNow();
  await b.engine.syncNow();

  expect(B.text("statements.json")).toBe("[]");
  expect(B.text("topics.json")).toBeNull();
});

test("a listing that disagrees with the cached tree suppresses that path", async () => {
  const remote = makeRemote();
  const A = makeDevice("d-a", { "topics.json": "topics" });
  const B = makeDevice("d-b");
  const a = engineFor(remote, A, { inferDeletions: true });
  const b = engineFor(remote, B, { inferDeletions: true });
  await settle(a.engine, b.engine);

  A.files.delete("topics.json");
  await a.engine.syncNow();
  // Drive listed the trees before it listed the files (docs/59 §8.2): the
  // remote copy has moved past what A's cached tree described.
  const entry = remote.meta.get("topics.json")!;
  remote.meta.set("topics.json", { ...entry, rev: entry.rev, hash: "0".repeat(32) });

  await b.engine.syncNow();

  expect(B.text("topics.json")).toBe("topics");
  expect(B.trashed()).toEqual([]);
});

test("the inference is off unless it is asked for", async () => {
  const remote = makeRemote();
  const A = makeDevice("d-a", { "topics.json": "topics" });
  const B = makeDevice("d-b");
  const a = engineFor(remote, A);
  const b = engineFor(remote, B);
  await settle(a.engine, b.engine);

  A.files.delete("topics.json");
  await a.engine.syncNow();
  await b.engine.syncNow();

  expect(B.text("topics.json")).toBe("topics");
  expect(b.engine.holdingsReport()).toContain("inferred deletions (off): none");
});

// --- tier 2: a purge that did not land --------------------------------------
//
// The cached tree is what the next difference is taken against, so it may only
// move once the deletions this one produced have actually gone. Advancing it
// over a failed purge differences the peer's tree against itself next pass: the
// path is in neither side, nothing ever names it again, and the file stays on
// this device for good (docs/59 §8.4 allows one pass late, not forever).

// One device whose local delete fails the first `fails` times it is asked.
function refusingRemove(dev: ReturnType<typeof makeDevice>, path: string, fails: number): SyncFs {
  let left = fails;
  return {
    ...dev.fs,
    async remove(p) {
      if (p === path && left > 0) {
        left -= 1;
        throw new Error(`EBUSY ${p}`);
      }
      await dev.fs.remove(p);
    },
  };
}

test("a purge that failed keeps the peer's tree from becoming the next base", async () => {
  const remote = makeRemote();
  const A = makeDevice("d-a", { "topics.json": "topics" });
  const B = makeDevice("d-b");
  const a = engineFor(remote, A, { inferDeletions: true });
  const b = engineFor(remote, B, {
    inferDeletions: true,
    fs: refusingRemove(B, "topics.json", 1),
  });
  await settle(a.engine, b.engine);
  expect(B.text("topics.json")).toBe("topics");

  A.files.delete("topics.json");
  await a.engine.syncNow();

  // B takes the difference and hands the path to purgeDead, whose local delete
  // will not go through. Nothing else of the purge is attempted: deleting the
  // remote copy of a file this device still holds would make it the only device
  // with it.
  await b.engine.syncNow();
  expect(B.text("topics.json")).toBe("topics");
  expect(remote.names()).toContain("topics.json");
  expect(b.engine.holdingsReport()).toContain("inferred deletions (on): topics.json");
  // The base is still the tree that had the file — which is the whole of the
  // retry: without it the next pass has nothing to difference.
  expect(Object.keys(B.cached("d-a")!.files)).toContain("topics.json");

  await b.engine.syncNow();

  expect(B.text("topics.json")).toBeNull();
  expect(remote.names()).not.toContain("topics.json");
  expect(B.trashed().map((e) => e.path)).toContain("topics.json");
  expect(B.trashed().every((e) => e.record === "topics")).toBe(true);
  expect(b.snapshot["topics.json"]).toBeUndefined();
  // Only now, with the path gone, is the peer's tree allowed to be the base.
  expect(Object.keys(B.cached("d-a")!.files)).not.toContain("topics.json");
});

test("a purge that never lands names the same path every pass", async () => {
  const remote = makeRemote();
  const A = makeDevice("d-a", { "topics.json": "topics" });
  const B = makeDevice("d-b");
  const a = engineFor(remote, A, { inferDeletions: true });
  const b = engineFor(remote, B, {
    inferDeletions: true,
    fs: refusingRemove(B, "topics.json", Number.MAX_SAFE_INTEGER),
  });
  await settle(a.engine, b.engine);

  A.files.delete("topics.json");
  await a.engine.syncNow();

  for (let pass = 0; pass < 2; pass += 1) {
    await b.engine.syncNow();
    // The file is still here and the pass says so, both in the report and in
    // the error the status carries. A deletion that cannot be executed is not
    // allowed to become a deletion nobody remembers.
    expect(B.text("topics.json")).toBe("topics");
    expect(b.engine.holdingsReport()).toContain("inferred deletions (on): topics.json");
    expect(b.engine.status().lastError ?? "").toContain("remove topics.json");
    expect(Object.keys(B.cached("d-a")!.files)).toContain("topics.json");
  }

  // And the remote copy is untouched, so a third device is not looking at a
  // path this one half deleted.
  expect(remote.names()).toContain("topics.json");
});
