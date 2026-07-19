// Unit tests for the talk registry append logic (src/slides/types.ts addTalk).
// The fs wrapper (store.ts) is exercised in the app; the pure append is here.
// Run: bun test.

import { expect, test } from "bun:test";
import { addTalk, type TalkEntry } from "../../src/slides/types";

const entry = (title: string, createdAt: number): TalkEntry => ({
  title,
  file: `slides/${createdAt}-${title}.html`,
  createdAt,
  bookIds: ["b1"],
  instruction: "",
});

test("addTalk appends newest last without mutating the input", () => {
  const a = [entry("first", 1)];
  const b = addTalk(a, entry("second", 2));
  expect(b.map((t) => t.title)).toEqual(["first", "second"]);
  expect(a).toHaveLength(1); // input untouched
});

test("addTalk builds up an ordered history", () => {
  let talks: TalkEntry[] = [];
  talks = addTalk(talks, entry("one", 1));
  talks = addTalk(talks, entry("two", 2));
  talks = addTalk(talks, entry("three", 3));
  expect(talks.map((t) => t.createdAt)).toEqual([1, 2, 3]);
  // Newest-first is the display order (live.ts reverses).
  expect([...talks].reverse().map((t) => t.title)).toEqual(["three", "two", "one"]);
});
