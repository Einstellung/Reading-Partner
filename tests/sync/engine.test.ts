// The sync engine's pass (src/sync/engine.ts) over a fake backend + fake fs +
// fake book store: push, pull, last-writer-wins, the books channel, the pulled
// callback, and single-flight. No timers (syncNow drives a pass directly), no
// network. Run: bun test.

import { expect, test } from "bun:test";
import { SyncEngine, type EngineDeps } from "../../src/sync/engine";
import type { Manifest, SyncBackend } from "../../src/sync/backend";
import type { BookFs } from "../../src/sync/books";
import type { LocalFile, SyncFs } from "../../src/sync/syncFs";
import type { Snapshot } from "../../src/sync/reconcile";

const enc = (s: string) => new TextEncoder().encode(s);
const dec = (b: Uint8Array) => new TextDecoder().decode(b);

function makeBackend(seedManifest: Manifest = {}, seedData: Record<string, string> = {}) {
  let manifest: Manifest = structuredClone(seedManifest);
  const data = new Map<string, Uint8Array>(
    Object.entries(seedData).map(([k, v]) => [k, enc(v)]),
  );
  const books = new Map<string, Uint8Array>();
  let ensureLayoutCalls = 0;
  const backend: SyncBackend = {
    async ensureLayout() {
      ensureLayoutCalls++;
    },
    async listManifest() {
      return structuredClone(manifest);
    },
    async writeManifest(m) {
      manifest = structuredClone(m);
    },
    async download(name) {
      const b = data.get(name);
      if (!b) throw new Error(`missing ${name}`);
      return b;
    },
    async upload(name, bytes) {
      data.set(name, bytes);
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
    manifest: () => manifest,
    ensureLayoutCalls: () => ensureLayoutCalls,
  };
}

function makeFs(seed: Record<string, { text: string; mtime: number }> = {}) {
  const files = new Map<string, { bytes: Uint8Array; mtime: number }>();
  for (const [k, v] of Object.entries(seed)) files.set(k, { bytes: enc(v.text), mtime: v.mtime });
  let writeClock = 1000;
  const fs: SyncFs = {
    async list(): Promise<LocalFile[]> {
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
      files.set(path, { bytes, mtime: (writeClock += 1) });
    },
    async stat(path) {
      const f = files.get(path);
      return f ? { mtime: f.mtime, size: f.bytes.length } : null;
    },
  };
  return { fs, files };
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

function makeEngine(over: Partial<EngineDeps> & { snapshot: Snapshot }) {
  const pulled: string[][] = [];
  const deps: EngineDeps = {
    backend: over.backend ?? makeBackend().backend,
    fs: over.fs ?? makeFs().fs,
    books: over.books ?? makeBooks().books,
    snapshot: over.snapshot,
    onPulled: (p) => pulled.push(p),
    ...over,
  };
  return { engine: new SyncEngine(deps), pulled };
}

test("push: a new local file is uploaded, manifested, and snapshotted", async () => {
  const be = makeBackend();
  const { fs } = makeFs({ "settings.json": { text: "{}", mtime: 500 } });
  const snapshot: Snapshot = {};
  const { engine } = makeEngine({ backend: be.backend, fs, snapshot });

  await engine.syncNow();

  expect(dec(be.data.get("settings.json")!)).toBe("{}");
  expect(be.manifest()["settings.json"]).toEqual({ rev: 1, mtime: 500, size: 2 });
  expect(snapshot["settings.json"]).toEqual({ rev: 1, mtime: 500, size: 2 });
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

test("conflict: the newer mtime wins (local edit beats older remote)", async () => {
  const be = makeBackend(
    { "reading-state.json": { rev: 2, mtime: 100, size: 3 } },
    { "reading-state.json": "OLD" },
  );
  const { fs } = makeFs({ "reading-state.json": { text: "NEWLOCAL", mtime: 900 } });
  const snapshot: Snapshot = { "reading-state.json": { rev: 1, mtime: 50, size: 3 } };
  const { engine } = makeEngine({ backend: be.backend, fs, snapshot });

  await engine.syncNow();

  expect(dec(be.data.get("reading-state.json")!)).toBe("NEWLOCAL");
  expect(be.manifest()["reading-state.json"].rev).toBe(3);
});

test("conflict: the newer mtime wins (remote beats older local edit)", async () => {
  const be = makeBackend(
    { "reading-state.json": { rev: 9, mtime: 9000, size: 6 } },
    { "reading-state.json": "REMOTE" },
  );
  const { fs, files } = makeFs({ "reading-state.json": { text: "loc", mtime: 800 } });
  const snapshot: Snapshot = { "reading-state.json": { rev: 1, mtime: 50, size: 3 } };
  const { engine } = makeEngine({ backend: be.backend, fs, snapshot });

  await engine.syncNow();

  expect(dec(files.get("reading-state.json")!.bytes)).toBe("REMOTE");
  expect(snapshot["reading-state.json"].rev).toBe(9);
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

test("single-flight: overlapping passes run only once", async () => {
  const be = makeBackend();
  const { fs } = makeFs({ "settings.json": { text: "{}", mtime: 1 } });
  const { engine } = makeEngine({ backend: be.backend, fs, snapshot: {} });

  await Promise.all([engine.syncNow(), engine.syncNow(), engine.syncNow()]);

  expect(be.ensureLayoutCalls()).toBe(1);
});

test("an offline failure is captured as lastError, not thrown", async () => {
  const be = makeBackend();
  be.backend.listManifest = async () => {
    throw new Error("network down");
  };
  const { engine } = makeEngine({ backend: be.backend, snapshot: {} });

  await engine.syncNow(); // must not reject
  expect(engine.status().lastError).toBe("network down");
});
