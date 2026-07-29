// The sync engine's pass (src/platform/sync/engine.ts) over a fake backend + fake fs +
// fake book store: push, pull, three-way merge, the books channel, the pulled
// callback, single-flight, and what a pass does when part of it fails. No timers
// (syncNow drives a pass directly), no network. Run: bun test.

import { expect, test } from "bun:test";
import {
  MAX_CONSECUTIVE_FAILURES,
  SyncEngine,
  type EngineDeps,
} from "../../../src/platform/sync/engine";
import {
  RemoteGoneError,
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
import type {
  MergeFile,
  MergeInput,
  MergeOutput,
} from "../../../src/platform/sync/merge/contract";
import type { ScannedFile, SyncFs } from "../../../src/platform/sync/syncFs";
import type { Snapshot } from "../../../src/platform/sync/reconcile";

import { hashBytes } from "../../../src/platform/sync/content";

const enc = (s: string) => new TextEncoder().encode(s);
const dec = (b: Uint8Array) => new TextDecoder().decode(b);
const h = (s: string) => hashBytes(enc(s));

// An in-memory remote. Each file carries its own rev/mtime/hash, written with
// its bytes in one call — there is no index over the top for a test to write
// separately, because there is none in Drive either.
function makeBackend(seedRemote: RemoteState = {}, seedData: Record<string, string> = {}) {
  const meta = new Map<string, RemoteEntry>(Object.entries(structuredClone(seedRemote)));
  const data = new Map<string, Uint8Array>(
    Object.entries(seedData).map(([k, v]) => [k, enc(v)]),
  );
  const books = new Map<string, Uint8Array>();
  let ensureLayoutCalls = 0;
  const backend: SyncBackend = {
    async ensureLayout() {
      ensureLayoutCalls++;
    },
    async listRemote() {
      return Object.fromEntries(meta);
    },
    async download(name) {
      const b = data.get(name);
      if (!b) throw new Error(`missing ${name}`);
      return b;
    },
    async upload(name, bytes, m) {
      data.set(name, bytes);
      meta.set(name, { rev: m.rev, mtime: m.mtime, size: bytes.length, hash: m.hash });
    },
    async hasBook(hash) {
      return books.has(hash);
    },
    async uploadBook(hash, bytes) {
      if (!books.has(hash)) books.set(hash, bytes);
    },
    async downloadBook(hash) {
      const b = books.get(hash);
      if (!b) throw new Error(`missing book ${hash}`);
      return b;
    },
  };
  return {
    backend,
    data,
    books,
    remote: () => Object.fromEntries(meta),
    ensureLayoutCalls: () => ensureLayoutCalls,
  };
}

function makeFs(seed: Record<string, { text: string; mtime: number }> = {}) {
  const files = new Map<string, { bytes: Uint8Array; mtime: number }>();
  for (const [k, v] of Object.entries(seed)) files.set(k, { bytes: enc(v.text), mtime: v.mtime });
  let writeClock = 1000;
  let reads = 0;
  const fs: SyncFs = {
    async list(): Promise<ScannedFile[]> {
      return [...files.entries()].map(([path, f]) => ({
        path,
        mtime: f.mtime,
        size: f.bytes.length,
      }));
    },
    async read(path) {
      reads += 1;
      const f = files.get(path);
      if (!f) throw new Error(`enoent ${path}`);
      return f.bytes;
    },
    async write(path, bytes) {
      files.set(path, { bytes, mtime: (writeClock += 1) });
    },
    async stat(path) {
      const f = files.get(path);
      return f ? { mtime: f.mtime, size: f.bytes.length } : null;
    },
  };
  return { fs, files, reads: () => reads };
}

function makeBooks(localHashes: Record<string, string> = {}, listed?: string[]) {
  const store = new Map<string, Uint8Array>(
    Object.entries(localHashes).map(([k, v]) => [k, enc(v)]),
  );
  const books: BookFs = {
    async listHashes() {
      return listed ?? [...store.keys()];
    },
    async has(hash) {
      return store.has(hash);
    },
    async read(hash) {
      return store.get(hash)!;
    },
    async write(hash, bytes) {
      store.set(hash, bytes);
    },
  };
  return { books, store };
}

// The merge base: the bytes both sides last agreed on, one entry per path.
function makeBase(seed: Record<string, string> = {}) {
  const store = new Map<string, Uint8Array>(
    Object.entries(seed).map(([k, v]) => [k, enc(v)]),
  );
  const base: BaseStore = {
    async read(path) {
      return store.get(path) ?? null;
    },
    async has(path) {
      return store.has(path);
    },
    async write(path, bytes) {
      store.set(path, bytes);
    },
    async remove(path) {
      store.delete(path);
    },
  };
  return { base, store, text: (p: string) => (store.has(p) ? dec(store.get(p)!) : null) };
}

// The delete journal: what a merge removed because the other side had.
function makeTrash() {
  let entries: TrashEntry[] = [];
  let prunedAt: number | null = null;
  const trash: TrashJournal = {
    async append(added) {
      entries = [...entries, ...added];
    },
    async prune(now) {
      prunedAt = now;
      entries = entries.filter((e) => now - e.at < TRASH_TTL_MS);
    },
  };
  return { trash, entries: () => entries, prunedAt: () => prunedAt };
}

function makeEngine(over: Partial<EngineDeps> & { snapshot: Snapshot }) {
  const pulled: string[][] = [];
  // Defaults first so `over` can override any of them, onPulled included.
  const deps: EngineDeps = {
    backend: makeBackend().backend,
    fs: makeFs().fs,
    books: makeBooks().books,
    base: makeBase().base,
    trash: makeTrash().trash,
    onPulled: (p) => pulled.push(p),
    ...over,
  };
  return { engine: new SyncEngine(deps), pulled };
}

test("push: a new local file is uploaded, published, and snapshotted", async () => {
  const be = makeBackend();
  const { fs } = makeFs({ "settings.json": { text: "{}", mtime: 500 } });
  const snapshot: Snapshot = {};
  const { engine } = makeEngine({ backend: be.backend, fs, snapshot });

  await engine.syncNow();

  expect(dec(be.data.get("settings.json")!)).toBe("{}");
  const hash = await h("{}");
  expect(be.remote()["settings.json"]).toEqual({ rev: 1, mtime: 500, size: 2, hash });
  expect(snapshot["settings.json"]).toEqual({ rev: 1, mtime: 500, size: 2, hash });
  // Nothing failed, so this device is mirrored — the one thing health reads
  // lastSyncAt for.
  expect(engine.status().lastSyncAt).not.toBeNull();
});

test("pull: a remote-only file is written locally and reported to onPulled", async () => {
  const be = makeBackend(
    { "topics.json": { rev: 4, mtime: 200, size: 7 } },
    { "topics.json": "topics!" },
  );
  const { fs, files } = makeFs();
  const snapshot: Snapshot = {};
  const { engine, pulled } = makeEngine({ backend: be.backend, fs, snapshot });

  await engine.syncNow();

  expect(dec(files.get("topics.json")!.bytes)).toBe("topics!");
  expect(snapshot["topics.json"].rev).toBe(4);
  expect(pulled).toEqual([["topics.json"]]);
});

// --- both sides changed: merge, do not pick -----------------------------------
//
// A whole file is the wrong unit to declare a winner at when the file is a
// collection of records. The merge module decides what the merged content is;
// what is pinned here is what the engine does with its three outputs.

// A stand-in for ../merge. What it returns is deliberately not what any real
// strategy would return — the point is that the engine honours the contract's
// three outputs whatever produces them.
function fakeMerge(out: {
  merged: string;
  copies?: MergeOutput["copies"];
  dropped?: MergeOutput["dropped"];
}): MergeFile {
  return () => ({
    merged: enc(out.merged),
    copies: out.copies ?? [],
    dropped: out.dropped ?? [],
    contested: false,
  });
}

function bothChanged(localText: string, remoteText: string) {
  const be = makeBackend(
    { "reading-state.json": { rev: 4, mtime: 900, size: remoteText.length, hash: "remote" } },
    { "reading-state.json": remoteText },
  );
  const { fs, files } = makeFs({ "reading-state.json": { text: localText, mtime: 800 } });
  const snapshot: Snapshot = {
    "reading-state.json": { rev: 2, mtime: 50, size: 3, hash: "base" },
  };
  return { be, fs, files, snapshot };
}

test("a file both sides changed is merged and the merge is published above the remote", async () => {
  const { be, fs, files, snapshot } = bothChanged("LOCAL", "REMOTE");
  const bs = makeBase({ "reading-state.json": "BASE" });
  const { engine, pulled } = makeEngine({
    backend: be.backend,
    fs,
    base: bs.base,
    snapshot,
    merge: fakeMerge({ merged: "MERGED" }),
  });

  await engine.syncNow();

  expect(dec(files.get("reading-state.json")!.bytes)).toBe("MERGED");
  expect(dec(be.data.get("reading-state.json")!)).toBe("MERGED");
  // Above the remote's rev, so the other device pulls the merge rather than
  // treating its own copy as still current.
  expect(be.remote()["reading-state.json"].rev).toBe(5);
  expect(snapshot["reading-state.json"].hash).toBe(await h("MERGED"));
  expect(bs.text("reading-state.json")).toBe("MERGED");
  // The shell has to reload a file the pass rewrote under it.
  expect(pulled).toEqual([["reading-state.json"]]);
});

test("the merge sees the base, this side and the other side", async () => {
  const { be, fs, snapshot } = bothChanged("LOCAL", "REMOTE");
  const bs = makeBase({ "reading-state.json": "BASE" });
  let seen: MergeInput | null = null;
  const { engine } = makeEngine({
    backend: be.backend,
    fs,
    base: bs.base,
    snapshot,
    merge: (input) => {
      seen = input;
      return { merged: input.local, copies: [], dropped: [], contested: false };
    },
  });

  await engine.syncNow();

  const input = seen as unknown as MergeInput;
  expect(input.path).toBe("reading-state.json");
  expect(dec(input.base!)).toBe("BASE");
  expect(dec(input.local)).toBe("LOCAL");
  expect(dec(input.remote)).toBe("REMOTE");
});

test("a merge with no base is handed null, not skipped", async () => {
  const { be, fs, files, snapshot } = bothChanged("LOCAL", "REMOTE");
  let base: Uint8Array | null | undefined;
  const { engine } = makeEngine({
    backend: be.backend,
    fs,
    snapshot,
    merge: (input) => {
      base = input.base;
      return { merged: enc("KEPT-BOTH"), copies: [], dropped: [], contested: true };
    },
  });

  await engine.syncNow();

  // The first pass after this landed has no base, and neither does a file this
  // device never pulled. The merge is still run; the contract covers the case.
  expect(base).toBeNull();
  expect(dec(files.get("reading-state.json")!.bytes)).toBe("KEPT-BOTH");
});

test("every conflict copy is written, and an existing path is never overwritten", async () => {
  const { be, fs, files, snapshot } = bothChanged("LOCAL", "REMOTE");
  files.set("reading-state.conflict-taken.json", { bytes: enc("ALREADY-THERE"), mtime: 1 });
  const { engine } = makeEngine({
    backend: be.backend,
    fs,
    snapshot,
    merge: fakeMerge({
      merged: "MERGED",
      copies: [
        { path: "reading-state.conflict-new.json", bytes: enc("THEIRS") },
        { path: "reading-state.conflict-taken.json", bytes: enc("WOULD-CLOBBER") },
      ],
    }),
  });

  await engine.syncNow();

  expect(dec(files.get("reading-state.conflict-new.json")!.bytes)).toBe("THEIRS");
  expect(dec(files.get("reading-state.conflict-taken.json")!.bytes)).toBe("ALREADY-THERE");
});

test("every dropped record is journalled so a propagated delete stays recoverable", async () => {
  const { be, fs, snapshot } = bothChanged("LOCAL", "REMOTE");
  const tr = makeTrash();
  const { engine } = makeEngine({
    backend: be.backend,
    fs,
    trash: tr.trash,
    snapshot,
    now: () => 7000,
    merge: fakeMerge({
      merged: "MERGED",
      dropped: [
        { id: "a1", record: { text: "a highlight the other device deleted" } },
        { id: "a2", record: { text: "and another" } },
      ],
    }),
  });

  await engine.syncNow();

  expect(tr.entries()).toEqual([
    {
      at: 7000,
      path: "reading-state.json",
      id: "a1",
      record: { text: "a highlight the other device deleted" },
    },
    { at: 7000, path: "reading-state.json", id: "a2", record: { text: "and another" } },
  ]);
});

test("the journal is pruned once per pass", async () => {
  const tr = makeTrash();
  await tr.trash.append([
    { at: 1000, path: "a.json", id: "old", record: 1 },
    { at: 1000 + TRASH_TTL_MS, path: "a.json", id: "fresh", record: 2 },
  ]);
  const { engine } = makeEngine({ trash: tr.trash, snapshot: {}, now: () => 1000 + TRASH_TTL_MS });

  await engine.syncNow();

  expect(tr.prunedAt()).toBe(1000 + TRASH_TTL_MS);
  expect(tr.entries().map((e) => e.id)).toEqual(["fresh"]);
});

test("a merge that throws costs only its own file", async () => {
  const { be, fs, files, snapshot } = bothChanged("LOCAL", "REMOTE");
  files.set("settings.json", { bytes: enc("S"), mtime: 500 });
  const { engine } = makeEngine({
    backend: be.backend,
    fs,
    snapshot,
    merge: () => {
      throw new Error("unmergeable");
    },
  });

  await engine.syncNow();

  // Untouched: neither side's content was thrown away.
  expect(dec(files.get("reading-state.json")!.bytes)).toBe("LOCAL");
  expect(dec(be.data.get("reading-state.json")!)).toBe("REMOTE");
  // And the rest of the pass still ran.
  expect(dec(be.data.get("settings.json")!)).toBe("S");
  expect(engine.status().lastError).toStartWith("merge reading-state.json failed: unmergeable");
});

test("a merge whose upload fails keeps the merged bytes on disk and retries next pass", async () => {
  const { be, fs, files, snapshot } = bothChanged("LOCAL", "REMOTE");
  let refuse = true;
  const upload = be.backend.upload;
  be.backend.upload = async (name, bytes, mtime) => {
    if (refuse) throw new Error("error sending request");
    return upload(name, bytes, mtime);
  };
  const bs = makeBase({ "reading-state.json": "BASE" });
  const { engine } = makeEngine({
    backend: be.backend,
    fs,
    base: bs.base,
    snapshot,
    merge: fakeMerge({ merged: "MERGED" }),
  });

  await engine.syncNow();

  // The merged bytes are the only copy holding both sides' work; losing them to
  // a failed upload would be the one unrecoverable outcome.
  expect(dec(files.get("reading-state.json")!.bytes)).toBe("MERGED");
  expect(be.remote()["reading-state.json"].rev).toBe(4);
  expect(bs.text("reading-state.json")).toBe("BASE");
  expect(engine.status().lastError).toStartWith("merge reading-state.json failed:");

  refuse = false;
  await engine.syncNow();

  expect(dec(be.data.get("reading-state.json")!)).toBe("MERGED");
  expect(be.remote()["reading-state.json"].rev).toBe(5);
});

// --- change detection is by content, not by clock ---------------------------
//
// The app rewrites files with the content already in them. Under mtime that was
// a local edit, and whichever device re-saved last won the whole file — so a
// device that only re-saved could wipe the other's annotations.

test("a rewrite with identical content produces no upload, no download, no conflict", async () => {
  const hash = await h("SAME");
  const be = makeBackend(
    { "topics.json": { rev: 4, mtime: 100, size: 4, hash } },
    { "topics.json": "SAME" },
  );
  const { fs, files } = makeFs({ "topics.json": { text: "SAME", mtime: 100 } });
  const snapshot: Snapshot = { "topics.json": { rev: 4, mtime: 100, size: 4, hash } };
  const { engine, pulled } = makeEngine({ backend: be.backend, fs, snapshot });

  // Re-saved byte for byte: only the clock moved.
  files.set("topics.json", { bytes: enc("SAME"), mtime: 999_999 });
  await engine.syncNow();

  expect(be.remote()["topics.json"].rev).toBe(4); // no upload
  expect(pulled).toEqual([]); // no download
  // And the snapshot took the new mtime, so the cheap pre-filter stops flagging
  // the file on every 15s tick from here on.
  expect(snapshot["topics.json"]).toEqual({ rev: 4, mtime: 999_999, size: 4, hash });
});

test("a real local edit still uploads", async () => {
  const be = makeBackend(
    { "topics.json": { rev: 4, mtime: 100, size: 4, hash: await h("SAME") } },
    { "topics.json": "SAME" },
  );
  const { fs, files } = makeFs({ "topics.json": { text: "SAME", mtime: 100 } });
  const snapshot: Snapshot = {
    "topics.json": { rev: 4, mtime: 100, size: 4, hash: await h("SAME") },
  };
  const { engine } = makeEngine({ backend: be.backend, fs, snapshot });

  files.set("topics.json", { bytes: enc("EDITED"), mtime: 200 });
  await engine.syncNow();

  expect(dec(be.data.get("topics.json")!)).toBe("EDITED");
  expect(be.remote()["topics.json"]).toEqual({
    rev: 5,
    mtime: 200,
    size: 6,
    hash: await h("EDITED"),
  });
});

test("both devices holding the same bytes at different revs exchange nothing", async () => {
  const hash = await h("SAME");
  const be = makeBackend(
    { "topics.json": { rev: 9, mtime: 900, size: 4, hash } },
    { "topics.json": "SAME" },
  );
  const { fs } = makeFs({ "topics.json": { text: "SAME", mtime: 100 } });
  // Both sides edited to the same content since the last sync.
  const snapshot: Snapshot = { "topics.json": { rev: 4, mtime: 50, size: 3, hash: "old" } };
  const { engine, pulled } = makeEngine({ backend: be.backend, fs, snapshot });

  await engine.syncNow();

  expect(be.remote()["topics.json"].rev).toBe(9);
  expect(pulled).toEqual([]);
  expect(snapshot["topics.json"]).toEqual({ rev: 9, mtime: 100, size: 4, hash });
});

// The first pass after this upgrade reads a sync-state.json with no hashes in
// it. Treating a missing hash as "changed" would push the whole data set over
// the remote; the entries keep the old mtime/size rule for exactly one pass.
test("a snapshot from before hashing is filled in, not re-pushed", async () => {
  const be = makeBackend(
    { "topics.json": { rev: 4, mtime: 100, size: 4 } },
    { "topics.json": "SAME" },
  );
  const { fs } = makeFs({ "topics.json": { text: "SAME", mtime: 100 } });
  const snapshot: Snapshot = { "topics.json": { rev: 4, mtime: 100, size: 4 } };
  const { engine, pulled } = makeEngine({ backend: be.backend, fs, snapshot });

  await engine.syncNow();

  expect(be.remote()["topics.json"].rev).toBe(4);
  expect(pulled).toEqual([]);
  expect(snapshot["topics.json"]).toEqual({ rev: 4, mtime: 100, size: 4, hash: await h("SAME") });
});

test("a steady pass reads only the files whose mtime or size moved", async () => {
  const be = makeBackend();
  const { fs, files, reads } = makeFs({
    "topics.json": { text: "T", mtime: 100 },
    "settings.json": { text: "S", mtime: 100 },
  });
  const snapshot: Snapshot = {};
  const { engine } = makeEngine({ backend: be.backend, fs, snapshot });

  await engine.syncNow();
  const afterFirst = reads();
  files.set("topics.json", { bytes: enc("T2"), mtime: 300 });
  await engine.syncNow();

  // One hash read plus one upload read for the changed file; the untouched one
  // is answered from the snapshot.
  expect(reads() - afterFirst).toBe(2);
});

// --- the merge base ---------------------------------------------------------
//
// The bytes both sides last agreed on, kept locally so a later conflict has
// three inputs instead of two.

test("a successful upload and a successful download each become the base", async () => {
  const be = makeBackend(
    { "topics.json": { rev: 4, mtime: 200, size: 6 } },
    { "topics.json": "REMOTE" },
  );
  const { fs } = makeFs({ "settings.json": { text: "LOCAL", mtime: 500 } });
  const bs = makeBase();
  const { engine } = makeEngine({ backend: be.backend, fs, base: bs.base, snapshot: {} });

  await engine.syncNow();

  expect(bs.text("topics.json")).toBe("REMOTE");
  expect(bs.text("settings.json")).toBe("LOCAL");
});

test("bytes that never reached the remote are not recorded as agreed", async () => {
  const be = makeBackend();
  be.backend.upload = async () => {
    throw new Error("error sending request");
  };
  const { fs } = makeFs({ "settings.json": { text: "LOCAL", mtime: 500 } });
  const bs = makeBase();
  const { engine } = makeEngine({ backend: be.backend, fs, base: bs.base, snapshot: {} });

  await engine.syncNow();

  // No other device holds those bytes, so calling them the common ancestor
  // would let the next merge assume the other side had them.
  expect(bs.text("settings.json")).toBeNull();
});

test("a file already in sync when this landed gets its base seeded from disk", async () => {
  const hash = await h("SAME");
  const be = makeBackend(
    { "topics.json": { rev: 4, mtime: 100, size: 4, hash } },
    { "topics.json": "SAME" },
  );
  const { fs } = makeFs({ "topics.json": { text: "SAME", mtime: 100 } });
  const snapshot: Snapshot = { "topics.json": { rev: 4, mtime: 100, size: 4, hash } };
  const bs = makeBase();
  const { engine } = makeEngine({ backend: be.backend, fs, base: bs.base, snapshot });

  await engine.syncNow();

  // Nothing moved it, so nothing else would ever write its base.
  expect(bs.text("topics.json")).toBe("SAME");
});

test("a base is not seeded from a local file the snapshot does not vouch for", async () => {
  const be = makeBackend();
  const { fs } = makeFs({ "topics.json": { text: "LOCAL", mtime: 100 } });
  be.backend.upload = async () => {
    throw new Error("error sending request");
  };
  const bs = makeBase();
  const { engine } = makeEngine({ backend: be.backend, fs, base: bs.base, snapshot: {} });

  await engine.syncNow();

  expect(bs.text("topics.json")).toBeNull();
});

test("a base is dropped when the file is gone from both sides", async () => {
  const be = makeBackend();
  const bs = makeBase({ "topics.json": "OLD", "settings.json": "KEPT" });
  const { fs } = makeFs({ "settings.json": { text: "KEPT", mtime: 100 } });
  const snapshot: Snapshot = {
    "topics.json": { rev: 4, mtime: 100, size: 3, hash: "gone" },
    "settings.json": { rev: 1, mtime: 100, size: 4, hash: await h("KEPT") },
  };
  const { engine } = makeEngine({ backend: be.backend, fs, base: bs.base, snapshot });

  await engine.syncNow();

  expect(bs.text("topics.json")).toBeNull();
  expect(bs.text("settings.json")).toBe("KEPT");
});

test("a base store that will not write does not fail the file that moved", async () => {
  const be = makeBackend();
  const { fs } = makeFs({ "settings.json": { text: "LOCAL", mtime: 500 } });
  const bs = makeBase();
  bs.base.write = async () => {
    throw new Error("disk full");
  };
  const { engine } = makeEngine({ backend: be.backend, fs, base: bs.base, snapshot: {} });

  await engine.syncNow();

  expect(dec(be.data.get("settings.json")!)).toBe("LOCAL");
  expect(engine.status().lastError).toBeNull();
  expect(engine.status().lastSyncAt).not.toBeNull();
});

test("books channel: local-only book uploads, remote-only book downloads", async () => {
  const be = makeBackend();
  be.books.set("remotehash", enc("REMOTE-PDF"));
  const { books, store } = makeBooks({ localhash: "LOCAL-PDF" }, ["localhash", "remotehash"]);
  const snapshot: Snapshot = {};
  const { engine } = makeEngine({ backend: be.backend, books, snapshot });

  await engine.syncNow();

  expect(dec(be.books.get("localhash")!)).toBe("LOCAL-PDF");
  expect(dec(store.get("remotehash")!)).toBe("REMOTE-PDF");
});

test("an immutable book blob is never re-uploaded", async () => {
  const be = makeBackend();
  be.books.set("h", enc("ORIGINAL"));
  const { books } = makeBooks({ h: "DIFFERENT-BYTES-SAME-HASH" }, ["h"]);
  const { engine } = makeEngine({ backend: be.backend, books, snapshot: {} });

  await engine.syncNow();

  expect(dec(be.books.get("h")!)).toBe("ORIGINAL");
});

// --- the books channel is a policy, not a given -----------------------------
//
// The phone shell never opens a PDF (docs/22), and library.json is synced, so
// without a policy a phone that signs in downloads the whole library in the
// background — a data plan and a phone's storage spent on files nothing there
// can read.

test("under the phone policy the books channel does not run in either direction", async () => {
  const be = makeBackend();
  be.books.set("remotehash", enc("REMOTE-PDF"));
  const { books, store } = makeBooks({ localhash: "LOCAL-PDF" }, ["localhash", "remotehash"]);
  let listed = 0;
  const counting: BookFs = {
    ...books,
    async listHashes() {
      listed += 1;
      return books.listHashes();
    },
  };
  const { engine } = makeEngine({
    backend: be.backend,
    books: counting,
    booksPolicy: "off",
    snapshot: {},
  });

  await engine.syncNow();

  // Nothing came down, nothing went up, and library.json was never even read
  // to find out what could have.
  expect(store.has("remotehash")).toBe(false);
  expect(be.books.has("localhash")).toBe(false);
  expect(listed).toBe(0);
});

test("the phone policy leaves the data channel alone", async () => {
  const be = makeBackend(
    { "library.json": { rev: 3, mtime: 200, size: 3 } },
    { "library.json": "LIB" },
  );
  const { fs, files } = makeFs();
  const { engine } = makeEngine({ backend: be.backend, fs, booksPolicy: "off", snapshot: {} });

  await engine.syncNow();

  // The phone knows what books exist; it just does not hold them.
  expect(dec(files.get("library.json")!.bytes)).toBe("LIB");
  expect(engine.status().lastError).toBeNull();
});

test("single-flight: overlapping passes run only once", async () => {
  const be = makeBackend();
  const { fs } = makeFs({ "settings.json": { text: "{}", mtime: 1 } });
  const { engine } = makeEngine({ backend: be.backend, fs, snapshot: {} });

  await Promise.all([engine.syncNow(), engine.syncNow(), engine.syncNow()]);

  expect(be.ensureLayoutCalls()).toBe(1);
});

test("an offline failure is captured as lastError, not thrown", async () => {
  const be = makeBackend();
  be.backend.listRemote = async () => {
    throw new Error("network down");
  };
  const { engine } = makeEngine({ backend: be.backend, snapshot: {} });

  await engine.syncNow(); // must not reject
  expect(engine.status().lastError).toBe("network down");
});

// --- a pass that partly fails ----------------------------------------------
//
// The reported failure: one file's download died on a lossy link, the pass
// aborted there, and the remaining downloads, every upload and the books
// channel never ran. On a link where each request has a real
// chance of failing, a pass needing fifty of them never completed once — the
// device sat at "Last sync: Never" for weeks.

test("one file that will not download costs only itself", async () => {
  const be = makeBackend(
    {
      "topics.json": { rev: 2, mtime: 100, size: 3 },
      "settings.json": { rev: 2, mtime: 100, size: 3 },
    },
    { "topics.json": "TOP", "settings.json": "SET" },
  );
  const download = be.backend.download;
  be.backend.download = async (name) => {
    if (name === "topics.json") throw new Error("error sending request for url (https://…)");
    return download(name);
  };
  const { fs, files } = makeFs({ "library.json": { text: "LIB", mtime: 500 } });
  const { books, store } = makeBooks({ h: "PDF" }, ["h"]);
  const snapshot: Snapshot = {};
  const { engine, pulled } = makeEngine({ backend: be.backend, fs, books, snapshot });

  await engine.syncNow();

  expect(dec(files.get("settings.json")!.bytes)).toBe("SET"); // the other pull landed
  expect(dec(be.data.get("library.json")!)).toBe("LIB"); // the push still ran
  expect(be.remote()["library.json"].rev).toBe(1); // and was published
  expect(dec(be.books.get("h")!)).toBe("PDF"); // the books channel still ran
  expect(store.size).toBe(1);
  expect(pulled).toEqual([["settings.json"]]); // only what landed
  expect(snapshot["topics.json"]).toBeUndefined();
  // Nothing succeeded that would let health call this device synced.
  expect(engine.status().lastSyncAt).toBeNull();
  expect(engine.status().lastError).toStartWith("download topics.json failed: error sending");
});

test("an upload that failed is never claimed", async () => {
  const be = makeBackend();
  const upload = be.backend.upload;
  be.backend.upload = async (name, bytes, meta) => {
    if (name === "topics.json") throw new Error("error sending request");
    return upload(name, bytes, meta);
  };
  const { fs } = makeFs({
    "topics.json": { text: "T", mtime: 500 },
    "settings.json": { text: "S", mtime: 500 },
  });
  const snapshot: Snapshot = {};
  const { engine } = makeEngine({ backend: be.backend, fs, snapshot });

  await engine.syncNow();

  const entry = { rev: 1, mtime: 500, size: 1, hash: await h("S") };
  expect(be.remote()["settings.json"]).toEqual(entry);
  // A rev here would tell every other device that topics.json is current with
  // bytes that were never sent, and stop this device from offering its own copy.
  expect(be.remote()["topics.json"]).toBeUndefined();
  expect(snapshot["topics.json"]).toBeUndefined();
  expect(snapshot["settings.json"]).toEqual(entry);
});

// There used to be a manifest.json listing every file, rewritten whole on every
// pass. Two devices publishing in the same window lost one of the two writes,
// and a device that failed to read it had no remote state at all. Each file now
// carries its own rev, so an upload cannot touch what it did not write.
test("an upload cannot disturb another file's entry", async () => {
  const be = makeBackend({ "other.json": { rev: 7, mtime: 1, size: 2 } }, { "other.json": "xy" });
  const { fs } = makeFs({ "settings.json": { text: "{}", mtime: 500 } });
  const snapshot: Snapshot = { "other.json": { rev: 7, mtime: 1, size: 2 } };
  const { engine } = makeEngine({ backend: be.backend, fs, snapshot });

  await engine.syncNow();

  expect(be.remote()["other.json"]).toEqual({ rev: 7, mtime: 1, size: 2 });
  expect(be.remote()["settings.json"].rev).toBe(1);
});

test("a file gone from the remote is skipped, not counted as a fault", async () => {
  const be = makeBackend({ "gone.json": { rev: 3, mtime: 1, size: 4 } });
  be.backend.download = async (name) => {
    throw new RemoteGoneError(`Drive file not found: ${name}`);
  };
  const { engine } = makeEngine({ backend: be.backend, snapshot: {}, now: () => 5000 });

  await engine.syncNow();

  // Nothing a retry can fix, so blocking lastSyncAt on it would raise a
  // permanent alarm about a permanent condition.
  expect(engine.status().lastError).toBeNull();
  expect(engine.status().lastSyncAt).toBe(5000);
});

test("a run of failures ends the pass instead of grinding through the rest", async () => {
  const remote: RemoteState = {};
  for (let i = 0; i < 6; i++) remote[`f${i}.json`] = { rev: 1, mtime: 1, size: 1 };
  const be = makeBackend(remote);
  let attempts = 0;
  be.backend.download = async () => {
    attempts += 1;
    throw new Error("error sending request");
  };
  const { engine } = makeEngine({ backend: be.backend, snapshot: {} });

  await engine.syncNow();

  expect(attempts).toBe(MAX_CONSECUTIVE_FAILURES);
  expect(engine.status().lastError).toStartWith("3 items failed; first: download f0.json failed:");
});

test("a dead token stops the pass at once instead of counting as one bad file", async () => {
  const be = makeBackend({ "a.json": { rev: 1, mtime: 1, size: 1 } }, { "a.json": "A" });
  be.backend.download = async () => {
    const e = new Error("Google sign-in expired");
    e.name = "GoogleAuthError";
    throw e;
  };
  const { fs } = makeFs({ "settings.json": { text: "{}", mtime: 500 } });
  let signedOut = 0;
  const { engine } = makeEngine({
    backend: be.backend,
    fs,
    snapshot: {},
    onSignedOut: () => {
      signedOut += 1;
    },
  });

  await engine.syncNow();

  expect(signedOut).toBe(1);
  // Everything after it is pointless: the token is dead for the uploads too.
  expect(be.data.has("settings.json")).toBe(false);
  expect(engine.status().lastError).toBe("Google sign-in expired");
});

test("a book that will not upload does not stop the next one", async () => {
  const be = makeBackend();
  const uploadBook = be.backend.uploadBook;
  be.backend.uploadBook = async (hash, bytes) => {
    if (hash === "bad") throw new Error("error sending request");
    return uploadBook(hash, bytes);
  };
  const { books } = makeBooks({ bad: "A", good: "B" }, ["bad", "good"]);
  const { engine } = makeEngine({ backend: be.backend, books, snapshot: {} });

  await engine.syncNow();

  expect(dec(be.books.get("good")!)).toBe("B");
  expect(be.books.has("bad")).toBe(false);
  expect(engine.status().lastSyncAt).toBeNull();
  expect(engine.status().lastError).toStartWith("book bad failed:");
});
