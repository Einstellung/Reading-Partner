// The sync engine's pass (src/platform/sync/engine.ts) over a fake backend + fake fs +
// fake book store: push, pull, last-writer-wins, the books channel, the pulled
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
  type Manifest,
  type SyncBackend,
} from "../../../src/platform/sync/backend";
import type { BookFs } from "../../../src/platform/sync/books";
import type { LocalFile, SyncFs } from "../../../src/platform/sync/syncFs";
import type { Snapshot } from "../../../src/platform/sync/reconcile";

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
  // Defaults first so `over` can override any of them, onPulled included.
  const deps: EngineDeps = {
    backend: makeBackend().backend,
    fs: makeFs().fs,
    books: makeBooks().books,
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

// --- a pass that partly fails ----------------------------------------------
//
// The reported failure: one file's download died on a lossy link, the pass
// aborted there, and the remaining downloads, every upload, the manifest write
// and the books channel never ran. On a link where each request has a real
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
  expect(be.manifest()["library.json"].rev).toBe(1); // the manifest was still written
  expect(dec(be.books.get("h")!)).toBe("PDF"); // the books channel still ran
  expect(store.size).toBe(1);
  expect(pulled).toEqual([["settings.json"]]); // only what landed
  expect(snapshot["topics.json"]).toBeUndefined();
  // Nothing succeeded that would let health call this device synced.
  expect(engine.status().lastSyncAt).toBeNull();
  expect(engine.status().lastError).toStartWith("download topics.json failed: error sending");
});

test("an upload that failed is never claimed in the manifest", async () => {
  const be = makeBackend();
  const upload = be.backend.upload;
  be.backend.upload = async (name, bytes, mtime) => {
    if (name === "topics.json") throw new Error("error sending request");
    return upload(name, bytes, mtime);
  };
  const { fs } = makeFs({
    "topics.json": { text: "T", mtime: 500 },
    "settings.json": { text: "S", mtime: 500 },
  });
  const snapshot: Snapshot = {};
  const { engine } = makeEngine({ backend: be.backend, fs, snapshot });

  await engine.syncNow();

  expect(be.manifest()["settings.json"]).toEqual({ rev: 1, mtime: 500, size: 1 });
  // A rev here would tell every other device that topics.json is current with
  // bytes that were never sent, and stop this device from offering its own copy.
  expect(be.manifest()["topics.json"]).toBeUndefined();
  expect(snapshot["topics.json"]).toBeUndefined();
  expect(snapshot["settings.json"]).toEqual({ rev: 1, mtime: 500, size: 1 });
});

test("publishing one upload leaves every other manifest entry alone", async () => {
  const be = makeBackend({ "other.json": { rev: 7, mtime: 1, size: 2 } }, { "other.json": "xy" });
  const { fs } = makeFs({ "settings.json": { text: "{}", mtime: 500 } });
  const snapshot: Snapshot = { "other.json": { rev: 7, mtime: 1, size: 2 } };
  const { engine } = makeEngine({ backend: be.backend, fs, snapshot });

  await engine.syncNow();

  // Dropping an entry this device has no local copy of takes the file out of
  // the backup for every device.
  expect(be.manifest()["other.json"]).toEqual({ rev: 7, mtime: 1, size: 2 });
  expect(be.manifest()["settings.json"].rev).toBe(1);
});

test("bytes in the remote that the manifest write did not publish are sent again", async () => {
  const be = makeBackend();
  const writeManifest = be.backend.writeManifest;
  let refuse = true;
  be.backend.writeManifest = async (m) => {
    if (refuse) throw new Error("error sending request");
    return writeManifest(m);
  };
  const { fs } = makeFs({ "settings.json": { text: "{}", mtime: 500 } });
  const snapshot: Snapshot = {};
  const { engine } = makeEngine({ backend: be.backend, fs, snapshot });

  await engine.syncNow();

  // Uploaded, but no other device can see it: snapshotting it would leave the
  // file looking synced and never publish it.
  expect(be.data.has("settings.json")).toBe(true);
  expect(snapshot["settings.json"]).toBeUndefined();
  expect(engine.status().lastSyncAt).toBeNull();
  expect(engine.status().lastError).toStartWith("write manifest failed:");

  refuse = false;
  await engine.syncNow();

  expect(be.manifest()["settings.json"]).toEqual({ rev: 1, mtime: 500, size: 2 });
  expect(snapshot["settings.json"]).toEqual({ rev: 1, mtime: 500, size: 2 });
  expect(engine.status().lastSyncAt).not.toBeNull();
  expect(engine.status().lastError).toBeNull();
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
  const remote: Manifest = {};
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
