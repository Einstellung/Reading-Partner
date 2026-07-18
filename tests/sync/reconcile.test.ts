// Pure reconcile decisions (src/sync/reconcile.ts): which files upload vs
// download, the rev they get, and last-writer-wins on a conflict. No IO.
// Run: bun test.

import { expect, test } from "bun:test";
import { reconcile, type Snapshot } from "../../src/sync/reconcile";
import type { Manifest } from "../../src/sync/backend";
import type { LocalFile } from "../../src/sync/syncFs";

const L = (path: string, mtime: number, size = 10): LocalFile => ({ path, mtime, size });

test("a brand-new local file uploads at rev 1", () => {
  const plan = reconcile([L("a.json", 100)], {}, {});
  expect(plan.uploads).toEqual([{ path: "a.json", rev: 1, mtime: 100, size: 10 }]);
  expect(plan.downloads).toEqual([]);
  expect(plan.nextManifest["a.json"]).toEqual({ rev: 1, mtime: 100, size: 10 });
});

test("a remote-only file downloads", () => {
  const remote: Manifest = { a: { rev: 3, mtime: 50, size: 20 } };
  const plan = reconcile([], remote, {});
  expect(plan.downloads).toEqual([{ path: "a", rev: 3, size: 20 }]);
  expect(plan.uploads).toEqual([]);
});

test("an unchanged file (local == snapshot, remote rev == snapshot) does nothing", () => {
  const snap: Snapshot = { a: { rev: 2, mtime: 100, size: 10 } };
  const remote: Manifest = { a: { rev: 2, mtime: 100, size: 10 } };
  const plan = reconcile([L("a", 100)], remote, snap);
  expect(plan.uploads).toEqual([]);
  expect(plan.downloads).toEqual([]);
});

test("a local edit uploads at snapshot rev + 1", () => {
  const snap: Snapshot = { a: { rev: 2, mtime: 100, size: 10 } };
  const remote: Manifest = { a: { rev: 2, mtime: 100, size: 10 } };
  const plan = reconcile([L("a", 250, 12)], remote, snap);
  expect(plan.uploads).toEqual([{ path: "a", rev: 3, mtime: 250, size: 12 }]);
});

test("a remote-newer file (no local change) downloads", () => {
  const snap: Snapshot = { a: { rev: 2, mtime: 100, size: 10 } };
  const remote: Manifest = { a: { rev: 5, mtime: 300, size: 14 } };
  const plan = reconcile([L("a", 100)], remote, snap);
  expect(plan.downloads).toEqual([{ path: "a", rev: 5, size: 14 }]);
  expect(plan.uploads).toEqual([]);
});

test("conflict: local mtime newer wins (upload)", () => {
  const snap: Snapshot = { a: { rev: 2, mtime: 100, size: 10 } };
  const remote: Manifest = { a: { rev: 5, mtime: 300, size: 10 } };
  const plan = reconcile([L("a", 400)], remote, snap); // both changed, local newer
  expect(plan.uploads).toEqual([{ path: "a", rev: 6, mtime: 400, size: 10 }]);
  expect(plan.downloads).toEqual([]);
});

test("conflict: remote mtime newer wins (download)", () => {
  const snap: Snapshot = { a: { rev: 2, mtime: 100, size: 10 } };
  const remote: Manifest = { a: { rev: 5, mtime: 500, size: 10 } };
  const plan = reconcile([L("a", 400)], remote, snap); // both changed, remote newer
  expect(plan.downloads).toEqual([{ path: "a", rev: 5, size: 10 }]);
  expect(plan.uploads).toEqual([]);
});

test("a locally-deleted file (present in snapshot/remote, unchanged remote) is left alone", () => {
  const snap: Snapshot = { a: { rev: 2, mtime: 100, size: 10 } };
  const remote: Manifest = { a: { rev: 2, mtime: 100, size: 10 } };
  const plan = reconcile([], remote, snap);
  expect(plan.uploads).toEqual([]);
  expect(plan.downloads).toEqual([]);
  expect(plan.nextManifest.a).toEqual({ rev: 2, mtime: 100, size: 10 });
});
