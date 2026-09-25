// Retiring a translated original (src/reading/delete/retire-book.ts): the work
// moves to the translation, only the original's bytes and caches go.

import { expect, test } from "bun:test";
import { retireReplacedBook, type RetireBookDeps } from "../../../src/reading/delete/retire-book";
import { retellWithMaterialReplaced } from "../../../src/reading/delete/pick";
import type { ViewState } from "../../../src/platform/app/reader-contract";
import type { SupplementRef } from "../../../src/platform/app/supplements";
import type { Topic } from "../../../src/platform/app/topics";
import type { Retell } from "../../../src/reading/retell/types";

const OLD = "old0000";
const NEW = "new1111";
const HOST = "host2222";
const SUP = "sup3333";
const NEW_PATH = `library/${NEW}/a-zh.epub`;

function world() {
  const calls: string[] = [];
  const positions = new Map<string, ViewState>([[OLD, { pageIndex: 7, scale: 1, scrollMode: 0 }]]);
  const topics: Topic[] = [
    { id: "home", name: "home", files: [{ path: "a.epub", hash: OLD, addedAt: 1 }, { path: NEW_PATH, hash: NEW, addedAt: 2 }] },
    { id: "other", name: "other", files: [{ path: "a2.epub", hash: OLD, addedAt: 1 }] },
  ] as Topic[];
  const lists: Record<string, SupplementRef[]> = {
    [OLD]: [{ hash: SUP, title: "sup", addedAt: 1 }],
    [HOST]: [{ hash: OLD, title: "the article", sourceUrl: "https://x", addedAt: 3 }],
  };
  let retells: Retell[] = [
    {
      id: "r1",
      materials: [{ bookId: OLD, title: "A" }],
      decisions: [{ bookId: OLD, chapter: 1, title: "c1", include: true, points: [], updatedAt: 1 }],
    } as unknown as Retell,
    { id: "r2", materials: [{ bookId: HOST, title: "H" }], decisions: [] } as unknown as Retell,
  ];
  const deps: RetireBookDeps = {
    tombstone: async (id) => void calls.push(`tombstone ${id}`),
    removeLibraryEntry: async (id) => void calls.push(`library ${id}`),
    getViewState: async (id) => positions.get(id) ?? null,
    saveViewState: async (id, s) => void positions.set(id, s),
    removeViewState: async (id) => void positions.delete(id),
    listTopics: async () => topics.map((t) => ({ ...t, files: [...t.files] })),
    attachFile: async (topicId, path, hash) => {
      topics.find((t) => t.id === topicId)!.files.push({ path, hash, addedAt: 9 } as never);
    },
    unlinkFile: async (topicId, path) => {
      const t = topics.find((x) => x.id === topicId)!;
      t.files = t.files.filter((f) => f.path !== path);
    },
    listSupplements: async (id) => lists[id] ?? [],
    listSupplementLists: async () => Object.entries(lists).map(([bookId, items]) => ({ bookId, items })),
    addSupplement: async (id, ref) => void (lists[id] = [...(lists[id] ?? []), ref]),
    removeSupplement: async (id, hash) => void (lists[id] = (lists[id] ?? []).filter((s) => s.hash !== hash)),
    listRetells: async () => retells,
    replaceRetellMaterial: async (id, from, to) => {
      retells = retells.map((r) => (r.id === id ? retellWithMaterialReplaced(r, from, to) ?? r : r));
    },
    moveObservations: async (from, to) => void calls.push(`observations ${from} ${to}`),
    movePrep: async (from, to) => {
      calls.push(`prep ${from} ${to}`);
      return true;
    },
    prepCacheFiles: async () => ["fulltext-k.json"],
    removeFile: async (p) => void calls.push(`file ${p}`),
    removeDir: async (p) => void calls.push(`dir ${p}`),
  };
  return { deps, calls, positions, topics, lists, retells: () => retells };
}

test("the work moves to the translation and only the original's bytes go", async () => {
  const w = world();
  await retireReplacedBook(OLD, { hash: NEW, path: NEW_PATH }, w.deps);

  expect(w.positions.get(NEW)?.pageIndex).toBe(7);
  expect(w.positions.has(OLD)).toBe(false);
  // Its supplements are the translation's, and nothing deletes them.
  expect(w.lists[NEW].map((s) => s.hash)).toEqual([SUP]);
  expect(w.calls).not.toContain(`tombstone ${SUP}`);
  // Every shelf and every book that listed it lists the translation instead.
  expect(w.topics.find((t) => t.id === "home")!.files.map((f) => f.hash)).toEqual([NEW]);
  expect(w.topics.find((t) => t.id === "other")!.files.map((f) => [f.path, f.hash])).toEqual([[NEW_PATH, NEW]]);
  expect(w.lists[HOST]).toEqual([{ hash: NEW, title: "the article", sourceUrl: "https://x", addedAt: 3 }]);
  // The retell and its decisions name the translation; the other retell is untouched.
  const r1 = w.retells().find((r) => r.id === "r1")!;
  expect(r1.materials.map((m) => m.bookId)).toEqual([NEW]);
  expect(r1.decisions.map((d) => d.bookId)).toEqual([NEW]);
  expect(w.retells().find((r) => r.id === "r2")!.materials[0].bookId).toBe(HOST);
  expect(w.calls).toContain(`observations ${OLD} ${NEW}`);
  expect(w.calls).toContain(`prep ${OLD} ${NEW}`);

  // Everything moved before the tombstone.
  const tomb = w.calls.indexOf(`tombstone ${OLD}`);
  expect(w.calls.indexOf(`prep ${OLD} ${NEW}`)).toBeLessThan(tomb);
  expect(w.calls.indexOf(`observations ${OLD} ${NEW}`)).toBeLessThan(tomb);
  expect(w.calls).toContain(`library ${OLD}`);
  expect(w.calls).toContain(`file library/${OLD}.epub`);
  expect(w.calls).toContain(`file threads-${OLD}.json`);
  expect(w.calls).toContain(`dir prep-${OLD}`);
  // Moved with the prep, so not deleted; and no thread images at all.
  expect(w.calls).not.toContain("file fulltext-k.json");
  expect(w.calls.some((c) => c.includes("images/"))).toBe(false);
});

test("a failure while moving takes nothing away", async () => {
  const w = world();
  w.deps.moveObservations = async () => {
    throw new Error("observations could not be written");
  };
  await expect(retireReplacedBook(OLD, { hash: NEW, path: NEW_PATH }, w.deps)).rejects.toThrow();
  expect(w.calls.filter((c) => /^(tombstone|library|file|dir) /.test(c))).toEqual([]);
});

test("a retell that already has the translation keeps its own entry", () => {
  const r = {
    id: "r",
    materials: [{ bookId: OLD, title: "A" }, { bookId: NEW, title: "A zh" }],
    decisions: [
      { bookId: OLD, chapter: 1, title: "old" },
      { bookId: OLD, chapter: 2, title: "old2" },
      { bookId: NEW, chapter: 1, title: "new" },
    ],
  } as unknown as Retell;
  const next = retellWithMaterialReplaced(r, OLD, NEW)!;
  expect(next.materials).toEqual([{ bookId: NEW, title: "A zh" }]);
  expect(next.decisions.map((d) => `${d.bookId}#${d.chapter}:${d.title}`)).toEqual([
    `${NEW}#2:old2`,
    `${NEW}#1:new`,
  ]);
  expect(retellWithMaterialReplaced(r, HOST, NEW)).toBeNull();
});
