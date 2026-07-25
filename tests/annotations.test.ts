// The annotation store's in-memory cache and its invalidation (src/app/
// annotations.ts). The cache is written back in full on every mark, so after
// sync pulls another device's annotations-<bookId>.json it has to be dropped or
// the next mark erases what was pulled. Run: bun test.

import { beforeEach, expect, mock, test } from "bun:test";
import type { Annotation } from "../src/app/reader-contract";

const files = new Map<string, string>();

mock.module("@tauri-apps/plugin-fs", () => ({
  BaseDirectory: { AppData: 1 },
  exists: async (path: string) => files.has(path),
  mkdir: async () => {},
  readTextFile: async (path: string) => {
    const v = files.get(path);
    if (v === undefined) throw new Error(`no file: ${path}`);
    return v;
  },
}));

const writes: string[] = [];
mock.module("../src/app/atomic-fs", () => ({
  writeTextAtomic: async (path: string, contents: string) => {
    writes.push(path);
    files.set(path, contents);
  },
}));

// The debounced writer schedules through `window`; the store is otherwise
// headless.
(globalThis as { window?: unknown }).window = globalThis;

const { deleteAnnotations, dropAnnotationCache, loadAnnotations, saveAnnotations } = await import(
  "../src/app/annotations"
);

const mark = (id: string): Annotation =>
  ({ id, type: "highlight", color: "#ffd400", pageIndex: 0 }) as unknown as Annotation;

beforeEach(() => {
  files.clear();
  writes.length = 0;
});

test("loadAnnotations reads the per-book file", async () => {
  files.set("annotations-book1.json", JSON.stringify([mark("a")]));
  expect((await loadAnnotations("book1")).map((a) => a.id)).toEqual(["a"]);
});

test("a dropped cache re-reads the file a sync pull replaced", async () => {
  files.set("annotations-book2.json", JSON.stringify([mark("mine")]));
  await loadAnnotations("book2");

  // The other device's copy arrives.
  files.set("annotations-book2.json", JSON.stringify([mark("mine"), mark("theirs")]));
  dropAnnotationCache("book2");

  const reloaded = await loadAnnotations("book2");
  expect(reloaded.map((a) => a.id)).toEqual(["mine", "theirs"]);
  // And a later delete recomputes from the pulled set, not the stale one.
  deleteAnnotations("book2", ["mine"]);
  await new Promise((r) => setTimeout(r, 600));
  expect(JSON.parse(files.get("annotations-book2.json")!).map((a: Annotation) => a.id)).toEqual([
    "theirs",
  ]);
});

test("a book with unflushed local marks keeps its cache", async () => {
  files.set("annotations-book3.json", JSON.stringify([mark("a")]));
  await loadAnnotations("book3");
  saveAnnotations("book3", [mark("a"), mark("just-drawn")]);

  // A pull arriving before the debounce fires must not throw away the mark the
  // user just made; it is picked up on reopen instead.
  dropAnnotationCache("book3");
  await new Promise((r) => setTimeout(r, 600));
  expect(JSON.parse(files.get("annotations-book3.json")!).map((a: Annotation) => a.id)).toEqual([
    "a",
    "just-drawn",
  ]);
});

test("the debounced write targets the same file name loadAnnotations reads", async () => {
  saveAnnotations("book4", [mark("a")]);
  await new Promise((r) => setTimeout(r, 600));
  expect(writes).toEqual(["annotations-book4.json"]);
});
