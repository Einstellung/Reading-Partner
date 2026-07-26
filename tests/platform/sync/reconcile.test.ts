// Pure reconcile decisions (src/platform/sync/reconcile.ts): which files upload vs
// download, the rev they get, and last-writer-wins on a conflict. No IO.
// Run: bun test.

import { expect, test } from "bun:test";
import { cachedHash, reconcile, type Snapshot } from "../../../src/platform/sync/reconcile";
import type { Manifest } from "../../../src/platform/sync/backend";
import type { LocalFile } from "../../../src/platform/sync/syncFs";

const L = (path: string, mtime: number, hash: string, size = 10): LocalFile => ({
  path,
  mtime,
  size,
  hash,
});

test("a brand-new local file uploads at rev 1", () => {
  const plan = reconcile([L("a.json", 100, "h1")], {}, {});
  expect(plan.uploads).toEqual([{ path: "a.json", rev: 1, mtime: 100, size: 10, hash: "h1" }]);
  expect(plan.downloads).toEqual([]);
});

test("a remote-only file downloads", () => {
  const remote: Manifest = { a: { rev: 3, mtime: 50, size: 20 } };
  const plan = reconcile([], remote, {});
  expect(plan.downloads).toEqual([{ path: "a", rev: 3, size: 20 }]);
  expect(plan.uploads).toEqual([]);
});

test("an unchanged file (local hash == snapshot, remote rev == snapshot) does nothing", () => {
  const snap: Snapshot = { a: { rev: 2, mtime: 100, size: 10, hash: "h1" } };
  const remote: Manifest = { a: { rev: 2, mtime: 100, size: 10, hash: "h1" } };
  const plan = reconcile([L("a", 100, "h1")], remote, snap);
  expect(plan.uploads).toEqual([]);
  expect(plan.downloads).toEqual([]);
  expect(plan.converged).toEqual([]);
});

// The whole point of hashing. The app rewrites files with the content already
// there; under mtime that was an edit, and the device that merely re-saved won
// the whole file against the other device's real change.
test("a rewrite with identical content is not a change", () => {
  const snap: Snapshot = { a: { rev: 2, mtime: 100, size: 10, hash: "h1" } };
  const remote: Manifest = { a: { rev: 2, mtime: 100, size: 10, hash: "h1" } };
  const plan = reconcile([L("a", 999_999, "h1")], remote, snap);
  expect(plan.uploads).toEqual([]);
  expect(plan.downloads).toEqual([]);
});

test("a local edit uploads at snapshot rev + 1", () => {
  const snap: Snapshot = { a: { rev: 2, mtime: 100, size: 10, hash: "h1" } };
  const remote: Manifest = { a: { rev: 2, mtime: 100, size: 10, hash: "h1" } };
  const plan = reconcile([L("a", 250, "h2", 12)], remote, snap);
  expect(plan.uploads).toEqual([{ path: "a", rev: 3, mtime: 250, size: 12, hash: "h2" }]);
});

test("a remote-newer file (no local change) downloads", () => {
  const snap: Snapshot = { a: { rev: 2, mtime: 100, size: 10, hash: "h1" } };
  const remote: Manifest = { a: { rev: 5, mtime: 300, size: 14, hash: "h9" } };
  const plan = reconcile([L("a", 100, "h1")], remote, snap);
  expect(plan.downloads).toEqual([{ path: "a", rev: 5, size: 14 }]);
  expect(plan.uploads).toEqual([]);
});

test("conflict: local mtime newer wins (upload)", () => {
  const snap: Snapshot = { a: { rev: 2, mtime: 100, size: 10, hash: "h1" } };
  const remote: Manifest = { a: { rev: 5, mtime: 300, size: 10, hash: "h9" } };
  const plan = reconcile([L("a", 400, "h2")], remote, snap); // both changed, local newer
  expect(plan.uploads).toEqual([{ path: "a", rev: 6, mtime: 400, size: 10, hash: "h2" }]);
  expect(plan.downloads).toEqual([]);
});

test("conflict: remote mtime newer wins (download)", () => {
  const snap: Snapshot = { a: { rev: 2, mtime: 100, size: 10, hash: "h1" } };
  const remote: Manifest = { a: { rev: 5, mtime: 500, size: 10, hash: "h9" } };
  const plan = reconcile([L("a", 400, "h2")], remote, snap); // both changed, remote newer
  expect(plan.downloads).toEqual([{ path: "a", rev: 5, size: 10 }]);
  expect(plan.uploads).toEqual([]);
});

// Two devices that made the same edit, or one that re-saved byte for byte.
// Nothing to exchange, and handing it to a conflict rule would invent one.
test("both sides holding the same bytes moves nothing and converges the snapshot", () => {
  const snap: Snapshot = { a: { rev: 2, mtime: 100, size: 10, hash: "h1" } };
  const remote: Manifest = { a: { rev: 7, mtime: 500, size: 10, hash: "h2" } };
  const plan = reconcile([L("a", 400, "h2")], remote, snap);
  expect(plan.uploads).toEqual([]);
  expect(plan.downloads).toEqual([]);
  expect(plan.converged).toEqual([{ path: "a", rev: 7, mtime: 400, size: 10, hash: "h2" }]);
});

test("agreement the snapshot already records is not re-reported", () => {
  const snap: Snapshot = { a: { rev: 7, mtime: 400, size: 10, hash: "h2" } };
  const remote: Manifest = { a: { rev: 7, mtime: 500, size: 10, hash: "h2" } };
  const plan = reconcile([L("a", 400, "h2")], remote, snap);
  expect(plan.converged).toEqual([]);
});

// The state file is rebuildable precisely because of this: losing it (loadState
// falls back to an empty state on any read failure) degrades to comparing
// mtimes, not to re-pushing every local file over the remote.
test("no snapshot at all falls back to last-writer-wins, not a blanket re-push", () => {
  const remote: Manifest = {
    old: { rev: 5, mtime: 100, size: 10, hash: "hx" },
    fresh: { rev: 5, mtime: 900, size: 10, hash: "hy" },
  };
  const plan = reconcile([L("old", 400, "h1"), L("fresh", 400, "h2")], remote, {});
  expect(plan.uploads).toEqual([{ path: "old", rev: 6, mtime: 400, size: 10, hash: "h1" }]);
  expect(plan.downloads).toEqual([{ path: "fresh", rev: 5, size: 10 }]);
});

// The first pass after the upgrade reads a snapshot with no hashes in it.
// Calling every file changed there would push the whole data set over the
// remote, so those entries keep the old mtime/size rule until the engine fills
// the hash in.
test("a snapshot entry from before hashing falls back to mtime and size", () => {
  const snap: Snapshot = { a: { rev: 2, mtime: 100, size: 10 } };
  const remote: Manifest = { a: { rev: 2, mtime: 100, size: 10 } };
  expect(reconcile([L("a", 100, "h1")], remote, snap).uploads).toEqual([]);
  expect(reconcile([L("a", 700, "h2")], remote, snap).uploads).toEqual([
    { path: "a", rev: 3, mtime: 700, size: 10, hash: "h2" },
  ]);
});

test("a locally-deleted file (present in snapshot/remote, unchanged remote) is left alone", () => {
  const snap: Snapshot = { a: { rev: 2, mtime: 100, size: 10, hash: "h1" } };
  const remote: Manifest = { a: { rev: 2, mtime: 100, size: 10, hash: "h1" } };
  const plan = reconcile([], remote, snap);
  expect(plan.uploads).toEqual([]);
  expect(plan.downloads).toEqual([]);
  // Still on the remote, so its merge base is still worth something.
  expect(plan.dropBases).toEqual([]);
});

test("a file gone from both sides has its merge base dropped", () => {
  const snap: Snapshot = { a: { rev: 2, mtime: 100, size: 10, hash: "h1" } };
  expect(reconcile([], {}, snap).dropBases).toEqual(["a"]);
});

test("the snapshot's hash is only reusable while mtime and size still match", () => {
  const snap = { rev: 1, mtime: 100, size: 10, hash: "h1" };
  expect(cachedHash(snap, { mtime: 100, size: 10 })).toBe("h1");
  expect(cachedHash(snap, { mtime: 101, size: 10 })).toBeNull();
  expect(cachedHash(snap, { mtime: 100, size: 11 })).toBeNull();
  expect(cachedHash({ rev: 1, mtime: 100, size: 10 }, { mtime: 100, size: 10 })).toBeNull();
  expect(cachedHash(undefined, { mtime: 100, size: 10 })).toBeNull();
});
