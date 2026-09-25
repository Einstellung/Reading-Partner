// The holdings half of a sync pass (src/platform/sync/holdings-exchange.ts)
// without an engine: a fake remote that answers listedHoldings and download,
// a fake cache, and a local tree handed in directly. What is pinned here is
// the order the inference depends on (docs/59 §8.4) — the cached copy is the
// base, the fetched copy only replaces it once every deletion it produced has
// left this device, and the rev is remembered only for a copy that landed —
// plus when a publish is due. holdings-engine.test.ts covers the same wiring
// through two whole engines. Run: bun test.

import { expect, test } from "bun:test";
import {
  RemoteGoneError,
  type RemoteEntry,
  type RemoteState,
  type SyncBackend,
} from "../../../src/platform/sync/backend";
import {
  buildHoldings,
  emptyHoldingsPass,
  holdingsRemoteName,
  parseHoldings,
  serializeHoldings,
  SELF_KEY,
  type HoldingsFiles,
  type HoldingsPass,
  type HoldingsStore,
} from "../../../src/platform/sync/holdings";
import { HoldingsExchange } from "../../../src/platform/sync/holdings-exchange";
import { PassFailures } from "../../../src/platform/sync/pass-failures";
import type { LocalFile } from "../../../src/platform/sync/syncFs";

const ME = "dev-me";
const PEER = "dev-peer";

function tree(device: string, files: HoldingsFiles, at = 1): Uint8Array {
  return serializeHoldings(buildHoldings({ device, at, files }));
}

function makeRemote() {
  const listed: Record<string, RemoteEntry> = {};
  const data = new Map<string, Uint8Array>();
  const downloads: string[] = [];
  const uploads: { name: string; rev: number }[] = [];
  let failDownload: unknown = null;
  let failUpload: unknown = null;
  const backend = {
    listedHoldings: () => listed,
    async download(name: string) {
      downloads.push(name);
      if (failDownload) throw failDownload;
      const b = data.get(name);
      if (!b) throw new RemoteGoneError(name);
      return b;
    },
    async upload(name: string, bytes: Uint8Array, meta: { rev: number }) {
      if (failUpload) throw failUpload;
      uploads.push({ name, rev: meta.rev });
      data.set(name, bytes);
    },
  } as unknown as SyncBackend;
  return {
    backend,
    downloads,
    uploads,
    // What the peer published, at the rev the next listing will show.
    publish(device: string, bytes: Uint8Array, rev: number) {
      data.set(holdingsRemoteName(device), bytes);
      listed[device] = { rev, mtime: 0, size: bytes.length, hash: `h${rev}` };
    },
    failDownload(e: unknown) {
      failDownload = e;
    },
    failUpload(e: unknown) {
      failUpload = e;
    },
  };
}

function makeStore() {
  const cache = new Map<string, Uint8Array>();
  let failWrite = false;
  const store: HoldingsStore = {
    async read(key) {
      return cache.get(key) ?? null;
    },
    async write(key, bytes) {
      if (failWrite) throw new Error("disk full");
      cache.set(key, bytes);
    },
  };
  return {
    store,
    cache,
    failWrites(on: boolean) {
      failWrite = on;
    },
  };
}

function local(files: Record<string, string>): LocalFile[] {
  return Object.entries(files).map(([path, hash]) => ({ path, hash, mtime: 1, size: 1 }));
}

function setup(opts: { deviceId?: string; appVersion?: () => string } = {}) {
  const remote = makeRemote();
  const cache = makeStore();
  const ex = new HoldingsExchange({
    backend: remote.backend,
    store: cache.store,
    deviceId: () => opts.deviceId ?? ME,
    appVersion: opts.appVersion,
    now: () => 5000,
  });
  return { remote, cache, ex };
}

function armed(): HoldingsPass {
  const pass = emptyHoldingsPass();
  pass.enabled = true;
  return pass;
}

const NO_REMOTE: RemoteState = {};

test("a path the peer's cached tree held and its current tree does not is inferred deleted", async () => {
  const { remote, cache, ex } = setup();
  cache.cache.set(PEER, tree(PEER, { "topics.json": ["t1", 1], "library.json": ["l1", 1] }));
  remote.publish(PEER, tree(PEER, { "library.json": ["l1", 1] }, 2), 2);

  const pass = armed();
  const out = await ex.pullPeerHoldings(
    pass,
    local({ "topics.json": "t1", "library.json": "l1" }),
    NO_REMOTE,
    new PassFailures(),
  );

  expect([...out.inferred]).toEqual(["topics.json"]);
  expect(pass.inferred).toEqual(["topics.json"]);
  expect(pass.fetched).toBe(1);
  expect(out.advances).toHaveLength(1);
  expect(out.advances[0]).toMatchObject({ device: PEER, rev: 2, deletions: ["topics.json"] });
  // Not advanced during the pull: the cached copy is still the base.
  expect(Object.keys(parseHoldings(cache.cache.get(PEER)!)!.files)).toContain("topics.json");
});

test("the cache advances once every deletion has left, and the same rev is not fetched again", async () => {
  const { remote, cache, ex } = setup();
  cache.cache.set(PEER, tree(PEER, { "topics.json": ["t1", 1] }));
  const current = tree(PEER, {}, 2);
  remote.publish(PEER, current, 2);

  const first = await ex.pullPeerHoldings(
    armed(),
    local({ "topics.json": "t1" }),
    NO_REMOTE,
    new PassFailures(),
  );
  await ex.advancePeerHoldings(first.advances, new Set(["topics.json"]));
  expect(cache.cache.get(PEER)).toEqual(current);

  const pass = armed();
  const second = await ex.pullPeerHoldings(pass, local({}), NO_REMOTE, new PassFailures());
  expect(remote.downloads).toEqual([holdingsRemoteName(PEER)]);
  expect(pass.fetched).toBe(0);
  expect(second.advances).toEqual([]);
  expect(second.inferred.size).toBe(0);
});

test("a deletion that did not leave holds the cache back, so the next pass names the path again", async () => {
  const { remote, cache, ex } = setup();
  const base = tree(PEER, { "topics.json": ["t1", 1] });
  cache.cache.set(PEER, base);
  remote.publish(PEER, tree(PEER, {}, 2), 2);
  const mine = local({ "topics.json": "t1" });

  const first = await ex.pullPeerHoldings(armed(), mine, NO_REMOTE, new PassFailures());
  await ex.advancePeerHoldings(first.advances, new Set());
  expect(cache.cache.get(PEER)).toEqual(base);

  const second = await ex.pullPeerHoldings(armed(), mine, NO_REMOTE, new PassFailures());
  expect([...second.inferred]).toEqual(["topics.json"]);
  // The rev was never claimed, so the current copy is fetched again.
  expect(remote.downloads).toHaveLength(2);
});

test("a cache write that fails claims no rev, so the next pass fetches again", async () => {
  const { remote, cache, ex } = setup();
  cache.cache.set(PEER, tree(PEER, { "topics.json": ["t1", 1] }));
  remote.publish(PEER, tree(PEER, {}, 2), 2);
  const first = await ex.pullPeerHoldings(
    armed(),
    local({ "topics.json": "t1" }),
    NO_REMOTE,
    new PassFailures(),
  );
  cache.failWrites(true);
  await ex.advancePeerHoldings(first.advances, new Set(["topics.json"]));
  cache.failWrites(false);

  await ex.pullPeerHoldings(armed(), local({}), NO_REMOTE, new PassFailures());
  expect(remote.downloads).toHaveLength(2);
});

test("a local edit since the peer's base is contested, not deleted, and does not hold the cache back", async () => {
  const { remote, cache, ex } = setup();
  cache.cache.set(PEER, tree(PEER, { "topics.json": ["t1", 1] }));
  const current = tree(PEER, {}, 2);
  remote.publish(PEER, current, 2);

  const pass = armed();
  const out = await ex.pullPeerHoldings(
    pass,
    local({ "topics.json": "t2-edited" }),
    NO_REMOTE,
    new PassFailures(),
  );
  expect(out.inferred.size).toBe(0);
  expect(pass.contested).toEqual(["topics.json"]);
  expect(out.advances[0].deletions).toEqual([]);

  await ex.advancePeerHoldings(out.advances, new Set());
  expect(cache.cache.get(PEER)).toEqual(current);
});

test("a remote listing at content the peer's base never described leaves the path alone", async () => {
  const { remote, cache, ex } = setup();
  cache.cache.set(PEER, tree(PEER, { "topics.json": ["t1", 1] }));
  remote.publish(PEER, tree(PEER, {}, 2), 2);
  const listing: RemoteState = { "topics.json": { rev: 3, mtime: 0, size: 1, hash: "t9" } };

  const out = await ex.pullPeerHoldings(
    armed(),
    local({ "topics.json": "t1" }),
    listing,
    new PassFailures(),
  );
  expect(out.inferred.size).toBe(0);
});

test("with no cached base nothing is inferred, and the fetched copy becomes the base", async () => {
  const { remote, cache, ex } = setup();
  const current = tree(PEER, { "library.json": ["l1", 1] }, 2);
  remote.publish(PEER, current, 2);

  const out = await ex.pullPeerHoldings(
    armed(),
    local({ "topics.json": "t1" }),
    NO_REMOTE,
    new PassFailures(),
  );
  expect(out.inferred.size).toBe(0);
  await ex.advancePeerHoldings(out.advances, new Set());
  expect(cache.cache.get(PEER)).toEqual(current);
});

test("with the inference off the peer is fetched and cached but nothing is inferred", async () => {
  const { remote, cache, ex } = setup();
  cache.cache.set(PEER, tree(PEER, { "topics.json": ["t1", 1] }));
  const current = tree(PEER, {}, 2);
  remote.publish(PEER, current, 2);

  const pass = emptyHoldingsPass();
  const out = await ex.pullPeerHoldings(
    pass,
    local({ "topics.json": "t1" }),
    NO_REMOTE,
    new PassFailures(),
  );
  expect(out.inferred.size).toBe(0);
  expect(pass.inferred).toEqual([]);
  expect(pass.fetched).toBe(1);
  await ex.advancePeerHoldings(out.advances, new Set());
  expect(cache.cache.get(PEER)).toEqual(current);
});

test("this device's own holdings in the listing is never differenced", async () => {
  const { remote, cache, ex } = setup();
  cache.cache.set(ME, tree(ME, { "topics.json": ["t1", 1] }));
  remote.publish(ME, tree(ME, {}, 2), 2);

  const pass = armed();
  const out = await ex.pullPeerHoldings(
    pass,
    local({ "topics.json": "t1" }),
    NO_REMOTE,
    new PassFailures(),
  );
  expect(remote.downloads).toEqual([]);
  expect(pass.peers).toEqual([]);
  expect(out.inferred.size).toBe(0);
});

test("a peer that will not fetch is reported, counted as a failure unless it is gone, and not advanced", async () => {
  const { remote, cache, ex } = setup();
  const base = tree(PEER, { "topics.json": ["t1", 1] });
  cache.cache.set(PEER, base);
  remote.publish(PEER, tree(PEER, {}, 2), 2);
  remote.failDownload(new Error("offline"));

  const failures = new PassFailures();
  const pass = armed();
  const out = await ex.pullPeerHoldings(pass, local({ "topics.json": "t1" }), NO_REMOTE, failures);
  expect(out.inferred.size).toBe(0);
  expect(out.advances).toEqual([]);
  expect(pass.peers).toEqual([{ device: PEER, cached: parseHoldings(base), current: null }]);
  expect(failures.message()).toBe(`holdings ${PEER} failed: offline`);

  remote.failDownload(new RemoteGoneError("gone"));
  const quiet = new PassFailures();
  await ex.pullPeerHoldings(armed(), local({ "topics.json": "t1" }), NO_REMOTE, quiet);
  expect(quiet.count).toBe(0);
});

test("an auth failure fetching a peer ends the pull", async () => {
  const { remote, ex } = setup();
  remote.publish(PEER, tree(PEER, {}, 2), 2);
  const auth = Object.assign(new Error("token dead"), { name: "GoogleAuthError" });
  remote.failDownload(auth);
  await expect(
    ex.pullPeerHoldings(armed(), local({}), NO_REMOTE, new PassFailures()),
  ).rejects.toBe(auth);
});

test("without a device id there is nothing to pull, advance or publish", async () => {
  const { remote, cache, ex } = setup({ deviceId: "" });
  cache.cache.set(PEER, tree(PEER, { "topics.json": ["t1", 1] }));
  remote.publish(PEER, tree(PEER, {}, 2), 2);

  const pass = armed();
  const out = await ex.pullPeerHoldings(
    pass,
    local({ "topics.json": "t1" }),
    NO_REMOTE,
    new PassFailures(),
  );
  expect(out.inferred.size).toBe(0);
  expect(remote.downloads).toEqual([]);
  await ex.publishHoldings(pass, local({ "topics.json": "t1" }), new PassFailures());
  expect(remote.uploads).toEqual([]);
  expect(pass.self).toBeNull();
});

test("publish uploads a new tree once, skips the same tree, and republishes for a new build", async () => {
  let version = "0.21.6 (macos)";
  const { remote, cache, ex } = setup({ appVersion: () => version });
  const files = local({ "topics.json": "t1" });

  const first = emptyHoldingsPass();
  await ex.publishHoldings(first, files, new PassFailures());
  expect(first.published).toBe(true);
  expect(remote.uploads).toEqual([{ name: holdingsRemoteName(ME), rev: 1 }]);
  expect(parseHoldings(cache.cache.get(SELF_KEY)!)).toMatchObject({
    device: ME,
    app: version,
    files: { "topics.json": ["t1", 1] },
  });

  const idle = emptyHoldingsPass();
  await ex.publishHoldings(idle, files, new PassFailures());
  expect(idle.published).toBe(false);
  expect(idle.self).not.toBeNull();
  expect(remote.uploads).toHaveLength(1);

  version = "0.21.7 (macos)";
  const upgraded = emptyHoldingsPass();
  await ex.publishHoldings(upgraded, files, new PassFailures());
  expect(upgraded.published).toBe(true);
  expect(remote.uploads).toHaveLength(2);
});

test("publish takes the next rev above the listing, and only paths in the sync range", async () => {
  const { remote, ex } = setup();
  remote.publish(ME, tree(ME, {}), 4);
  const pass = emptyHoldingsPass();
  await ex.publishHoldings(
    pass,
    local({ "topics.json": "t1", "sync-state.json": "s1" }),
    new PassFailures(),
  );
  expect(remote.uploads).toEqual([{ name: holdingsRemoteName(ME), rev: 5 }]);
  expect(Object.keys(pass.self!.files)).toEqual(["topics.json"]);
});

test("a publish that fails leaves the local copy alone, so the next pass owes it again", async () => {
  const { remote, cache, ex } = setup();
  remote.failUpload(new Error("HTTP 503"));
  const failures = new PassFailures();
  const pass = emptyHoldingsPass();
  await ex.publishHoldings(pass, local({ "topics.json": "t1" }), failures);
  expect(pass.published).toBe(false);
  expect(cache.cache.has(SELF_KEY)).toBe(false);
  expect(failures.message()).toBe(`publish ${holdingsRemoteName(ME)} failed: HTTP 503`);
});

test("the report shows what the last finished pass did", async () => {
  const { remote, cache, ex } = setup();
  expect(ex.holdingsReport()).toContain("inferred deletions (off): none");

  cache.cache.set(PEER, tree(PEER, { "topics.json": ["t1", 1] }));
  remote.publish(PEER, tree(PEER, {}, 2), 2);
  const pass = armed();
  await ex.pullPeerHoldings(pass, local({ "topics.json": "t1" }), NO_REMOTE, new PassFailures());
  expect(ex.holdingsReport()).toContain("inferred deletions (off): none");
  ex.finishPass(pass);
  expect(ex.holdingsReport()).toContain("inferred deletions (on): topics.json");
});
