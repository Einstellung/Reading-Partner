// Finishing what the deletion log says (src/reading/delete/settle.ts): a book
// still on the shelf or still on disk after its deletion is taken off, a topic
// the merge brought back is dropped, a deleted book's mark cursor is dropped,
// and a settled device is left alone. Run: bun test.

import { expect, test } from "bun:test";
import { emptyDeletions } from "../../../src/platform/app/deleted-books";
import { settleDeletions, type SettleDeps } from "../../../src/reading/delete/settle";

function world(over: {
  dead?: string[];
  shelved?: string[];
  blobs?: string[];
  pruned?: boolean;
}) {
  const calls: string[] = [];
  const deps: SettleDeps = {
    deletions: async () => ({ ...emptyDeletions(), book: new Set(over.dead ?? []) }),
    libraryBookIds: async () => over.shelved ?? [],
    hasBlob: async (id) => (over.blobs ?? []).includes(id),
    removeLibraryEntry: async (id) => {
      calls.push(`library ${id}`);
    },
    removeViewState: async (id) => {
      calls.push(`position ${id}`);
    },
    removeFile: async (p) => {
      calls.push(`file ${p}`);
    },
    removeDir: async (p) => {
      calls.push(`dir ${p}`);
    },
    pruneTopics: async () => {
      calls.push("prune topics");
      return over.pruned ?? false;
    },
    forgetDistillCursors: async (ids) => {
      calls.push(`forget cursors ${[...ids].sort().join(" ")}`);
    },
  };
  return { calls, deps };
}

test("a deleted book still on the shelf is taken off, records and files", async () => {
  const w = world({ dead: ["h1"], shelved: ["h1", "h2"] });
  expect(await settleDeletions(w.deps)).toBe(true);
  expect(w.calls.slice(0, 3)).toEqual(["library h1", "position h1", "file library/h1.pdf"]);
  expect(w.calls).toContain("file covers/h1.jpg");
  expect(w.calls).toContain("dir prep-h1");
  expect(w.calls.filter((c) => c.includes("h2"))).toEqual([]);
  expect(w.calls.slice(-2)).toEqual(["prune topics", "forget cursors h1"]);
});

test("a deleted book whose blob is still here is finished even with no shelf entry", async () => {
  const w = world({ dead: ["h1"], blobs: ["h1"] });
  expect(await settleDeletions(w.deps)).toBe(true);
  expect(w.calls).toContain("file library/h1.epub");
  expect(w.calls).toContain("file fulltext-h1.json");
});

test("a deletion already settled costs nothing but the probes", async () => {
  const w = world({ dead: ["h1"], shelved: ["h2"] });
  expect(await settleDeletions(w.deps)).toBe(false);
  expect(w.calls).toEqual(["prune topics", "forget cursors h1"]);
});

// A cursor left behind by a delete that never cleared it, or brought back by the
// merge from a device that distilled the book before the tombstone reached it:
// the book is off the shelf and its blob is gone, and the cursor still goes.
test("every book in the log has its cursor dropped, settled or not", async () => {
  const w = world({ dead: ["h1", "h2"], shelved: ["h1"] });
  await settleDeletions(w.deps);
  expect(w.calls).toContain("forget cursors h1 h2");
});

test("an empty log asks nothing of the cursors", async () => {
  const w = world({});
  await settleDeletions(w.deps);
  expect(w.calls).toEqual(["prune topics"]);
});

test("cursors that will not drop leave the answer standing", async () => {
  const w = world({ dead: ["h1"], shelved: ["h1"] });
  w.deps.forgetDistillCursors = async () => {
    throw new Error("disk full");
  };
  expect(await settleDeletions(w.deps)).toBe(true);
});

test("a topic row the merge brought back is a change worth re-reading the shelf for", async () => {
  const w = world({ pruned: true });
  expect(await settleDeletions(w.deps)).toBe(true);
});

test("one file that will not go does not stop the next book", async () => {
  const w = world({ dead: ["h1", "h2"], shelved: ["h1", "h2"] });
  w.deps.removeFile = async (p) => {
    if (p === "library/h1.pdf") throw new Error("busy");
    w.calls.push(`file ${p}`);
  };
  expect(await settleDeletions(w.deps)).toBe(true);
  expect(w.calls).toContain("library h2");
  expect(w.calls).toContain("file library/h2.pdf");
});
