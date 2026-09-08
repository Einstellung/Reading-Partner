// What used to be hand-written beside each reader now comes off the table, and
// this is where the two are held together (docs/61).
//
// Four questions were answered by four separate lists: whether a file syncs,
// how it merges, what its records look like, and whether a deleted book owns
// it. Each list is now a fold over the palace, so the failure mode is no longer
// that they disagree — it is that a row says one thing and the reader takes
// another. Every sample in the table is put to all four. Run: bun test.

import { expect, test } from "bun:test";
import { PALACE, resolvePalace, rowsWhere } from "../../src/palace";
import { strategyFor } from "../../src/platform/sync/merge/contract";
import { recordShape } from "../../src/platform/sync/merge/records";
import { deadPathsFor, isDeadPath } from "../../src/platform/sync/dead-paths";
import { inSyncRange } from "../../src/platform/sync/syncFs";
import { deadLocalPathsFor } from "../../src/reading/delete/pick";
import {
  coverFailurePath,
  coverImagePath,
  coverMetaPath,
} from "../../src/reading/cover-cache";
import { figuresFile } from "../../src/reading/figures/store";
import { fulltextFile } from "../../src/fulltext/store";
import { libraryPdfPath } from "../../src/platform/app/library";

// A book id is the content hash of the file's bytes, and three kinds only match
// that shape: a made-up id would resolve to the orphan row beside them instead.
const BOOK = "0123456789abcdef0123456789abcdef";

test("a sample is merged the way its row says", () => {
  for (const row of PALACE) {
    if (row.sync !== "data") continue;
    for (const path of row.samples) {
      expect(`${path}: ${strategyFor(path)}`).toBe(`${path}: ${row.merge}`);
    }
  }
});

test("a sample's records are the shape its row says, and nothing else has one", () => {
  for (const row of PALACE) {
    for (const path of row.samples) {
      expect({ path, shape: recordShape(path) }).toEqual({ path, shape: row.shape ?? null });
    }
  }
});

test("a sample is in the sync range exactly when its row is on the data channel", () => {
  for (const row of PALACE) {
    for (const path of row.samples) {
      expect(`${path}: ${inSyncRange(path)}`).toBe(`${path}: ${row.sync === "data"}`);
    }
  }
});

// A retell dies with a book too, but by a rule about its materials rather than
// by its name (reading/delete/pick.ts): its path cannot be derived from a book
// id and a tombstone naming that id must not claim it.
test("a sample is a deleted book's exactly when its row is named for a book", () => {
  for (const row of PALACE) {
    for (const path of row.samples) {
      const id = resolvePalace(path)?.id;
      const claimed = id === null || id === undefined ? false : isDeadPath(path, new Set([id]));
      const owned = row.deleteWith === "book" && row.id === "bookId";
      expect(`${path}: ${claimed}`).toBe(`${path}: ${owned}`);
    }
  }
});

// The engine purges the synced half on every device; the domain half deletes
// what only ever existed here. Between them they must cover every kind the
// table says a book owns, or a deleted book leaves a file behind — a cover on
// the next shelf, or marks that come back with the book.
test("what a deleted book takes covers every kind named for a book", () => {
  const local = deadLocalPathsFor(BOOK);
  const removed = new Set([...local.files, ...local.dirs.map((d) => `${d}/`)]);
  const owed = rowsWhere((r) => r.deleteWith === "book" && r.id === "bookId")
    .map((r) => r.pathFor?.(BOOK))
    .filter((p): p is string => p !== undefined);
  expect(owed.filter((p) => !removed.has(p))).toEqual([]);

  // And the synced half is the part of that the reconcile loop can see, all of
  // it deleted here as well.
  const synced = deadPathsFor(BOOK);
  for (const path of [...synced.files, ...synced.dirs]) {
    expect(`${path}: ${removed.has(path)}`).toBe(`${path}: true`);
  }
  for (const path of [...synced.files, ...synced.dirs.map((d) => `${d}state.json`)]) {
    expect(`${path}: ${inSyncRange(path)}`).toBe(`${path}: true`);
  }
});

// The domain still builds its own paths — the cover cache names a cover, the
// full-text store names its cache — and the row restates that shape so the
// table can answer for a path nobody handed it. Restating it is the risk.
test("the paths the domain builds resolve to the row that restates them", () => {
  const cases: ReadonlyArray<[string, string]> = [
    [libraryPdfPath(BOOK), "book-pdf"],
    [fulltextFile(BOOK), "fulltext"],
    [figuresFile(BOOK), "figures"],
    [coverImagePath(BOOK), "cover-image"],
    [coverMetaPath(BOOK), "cover-meta"],
    [coverFailurePath(BOOK), "cover-failure"],
  ];
  for (const [path, kind] of cases) {
    const hit = resolvePalace(path);
    expect(`${path} -> ${hit?.row.kind ?? "nothing"}`).toBe(`${path} -> ${kind}`);
    expect(`${path} -> ${hit?.id ?? "nothing"}`).toBe(`${path} -> ${BOOK}`);
  }
});
