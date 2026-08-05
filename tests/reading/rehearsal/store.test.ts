// The decision file on disk (src/reading/rehearsal/store.ts) against an in-memory
// AppData: the round trip, the read-modify-write that merges one chapter in, and
// what a file this build cannot read does. Run: bun test.

import { beforeEach, expect, mock, test } from "bun:test";

const files = new Map<string, string>();

mock.module("@tauri-apps/plugin-fs", () => ({
  BaseDirectory: { AppData: 1 },
  exists: async (p: string) => files.has(p),
  mkdir: async () => {},
  readTextFile: async (p: string) => {
    const v = files.get(p);
    if (v === undefined) throw new Error("no file");
    return v;
  },
  writeTextFile: async (p: string, body: string) => {
    files.set(p, body);
  },
}));

// The stores write through the Rust atomic writer, not the fs plugin.
mock.module("../../../src/platform/app/atomic-fs", () => ({
  writeTextAtomic: async (path: string, contents: string) => {
    files.set(path, contents);
  },
}));

const { loadRehearsalPlan, recordDecision, rehearsalFile } = await import(
  "../../../src/reading/rehearsal/store"
);

const BOOK = "book-hash";

function decision(chapter: number, points: string[], updatedAt: number) {
  return { chapter, title: `Chapter ${chapter}`, include: true, points, updatedAt };
}

beforeEach(() => files.clear());

test("a book with no rehearsal reads as absent, not as an error", async () => {
  expect(await loadRehearsalPlan(BOOK)).toBeNull();
});

test("the first decision creates the file and it reads back", async () => {
  await recordDecision(BOOK, decision(1, ["the 1962 data"], 10));
  expect(files.has(rehearsalFile(BOOK))).toBe(true);
  const plan = await loadRehearsalPlan(BOOK);
  expect(plan?.bookId).toBe(BOOK);
  expect(plan?.decisions).toHaveLength(1);
  expect(plan?.decisions[0].points).toEqual(["the 1962 data"]);
});

test("a second chapter merges in rather than replacing the file", async () => {
  await recordDecision(BOOK, decision(2, ["b"], 10));
  await recordDecision(BOOK, decision(1, ["a"], 20));
  const plan = await loadRehearsalPlan(BOOK);
  expect(plan?.decisions.map((d) => d.chapter)).toEqual([1, 2]);
  expect(plan?.updatedAt).toBe(20);
});

test("recording a chapter again overwrites that chapter only", async () => {
  await recordDecision(BOOK, decision(1, ["first take"], 10));
  await recordDecision(BOOK, decision(2, ["other chapter"], 11));
  await recordDecision(BOOK, decision(1, ["second take"], 12));
  const plan = await loadRehearsalPlan(BOOK);
  expect(plan?.decisions).toHaveLength(2);
  expect(plan?.decisions[0].points).toEqual(["second take"]);
  expect(plan?.decisions[1].points).toEqual(["other chapter"]);
});

test("two books keep separate files", async () => {
  await recordDecision(BOOK, decision(1, ["a"], 10));
  await recordDecision("other", decision(1, ["b"], 10));
  expect((await loadRehearsalPlan(BOOK))?.decisions[0].points).toEqual(["a"]);
  expect((await loadRehearsalPlan("other"))?.decisions[0].points).toEqual(["b"]);
});

// A version this build cannot read, and a file that is not JSON at all, both read
// as absent: the next decision starts a fresh one instead of crashing the turn.
test("an unreadable file reads as absent", async () => {
  files.set(rehearsalFile(BOOK), JSON.stringify({ version: 99, decisions: [] }));
  expect(await loadRehearsalPlan(BOOK)).toBeNull();
  files.set(rehearsalFile(BOOK), "{not json");
  expect(await loadRehearsalPlan(BOOK)).toBeNull();
});
