// The Topics shelf's arithmetic (src/ui/components/library/topic-shelf.ts): the
// column count at each form factor, the cover stack's geometry and the two
// labels a card carries. All of it decides what the screen looks like and none
// of it is visible to a type checker, so the numbers are pinned here.
// Run: bun test.

import { expect, test } from "bun:test";
import type { FileRef, Topic } from "../../../src/platform/app/topics";
import {
  coverInitial,
  coverSlots,
  fileCountLabel,
  MAX_COVERS,
  shelfOrder,
  TOPIC_GRID_COLUMNS_CLASS,
  TOPIC_GRID_STEPS,
  topicGridColumns,
} from "../../../src/ui/components/library/topic-shelf";

function file(name: string, addedAt: number, lastOpenedAt?: number): FileRef {
  return {
    path: `/books/${name}`,
    name,
    addedAt,
    ...(lastOpenedAt === undefined ? {} : { lastOpenedAt }),
  };
}

function topic(name: string, files: FileRef[], createdAt = 0): Topic {
  return { id: name, name, createdAt, files };
}

test("the grid is two columns on a phone and grows with the viewport", () => {
  expect(topicGridColumns(390)).toBe(2); // phone
  expect(topicGridColumns(639)).toBe(2);
  expect(topicGridColumns(820)).toBe(3); // iPad portrait
  expect(topicGridColumns(1180)).toBe(4); // iPad landscape
  expect(topicGridColumns(1600)).toBe(5); // a wide desktop window
});

test("the grid class string is the same table the numbers come from", () => {
  expect(TOPIC_GRID_COLUMNS_CLASS).toBe("grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5");
  // A class Tailwind can only find by reading it: no interpolation anywhere.
  for (const step of TOPIC_GRID_STEPS) {
    expect(step.className).toContain(`grid-cols-${step.columns}`);
  }
});

test("the shelf lists the newest topic first", () => {
  const order = shelfOrder([topic("old", [], 100), topic("new", [], 300), topic("mid", [], 200)]);
  expect(order.map((t) => t.name)).toEqual(["new", "mid", "old"]);
});

test("shelfOrder copies rather than sorting the caller's array", () => {
  const topics = [topic("a", [], 1), topic("b", [], 2)];
  shelfOrder(topics);
  expect(topics.map((t) => t.name)).toEqual(["a", "b"]);
});

test("the cover stack shows the most recently read books, at most three", () => {
  const t = topic("t", [
    file("added-first.pdf", 1),
    file("read-last.pdf", 2, 500),
    file("read-first.pdf", 3, 100),
    file("read-middle.pdf", 4, 300),
  ]);
  // Oldest of the three on the left, most recent on the right and in front.
  expect(coverSlots(t).map((s) => s.file.name)).toEqual([
    "read-first.pdf",
    "read-middle.pdf",
    "read-last.pdf",
  ]);
  expect(coverSlots(t)).toHaveLength(MAX_COVERS);
});

test("the stack stays centred and inside the box at every count", () => {
  for (const count of [1, 2, 3]) {
    const t = topic("t", Array.from({ length: count }, (_, i) => file(`${i}.pdf`, i)));
    const slots = coverSlots(t);
    expect(slots).toHaveLength(count);
    const centres = slots.map((s) => s.leftPercent);
    // Symmetric about the middle of the shelf.
    expect(centres[0] + centres[centres.length - 1]).toBeCloseTo(100, 6);
    for (const slot of slots) {
      expect(slot.leftPercent - slot.widthPercent / 2).toBeGreaterThanOrEqual(0);
      expect(slot.leftPercent + slot.widthPercent / 2).toBeLessThanOrEqual(100);
    }
    // Each cover in front of the one to its left, so the last one is whole.
    expect(slots.map((s) => s.z)).toEqual(slots.map((_, i) => i + 1));
  }
});

test("two covers overlap less than three do", () => {
  const two = coverSlots(topic("t", [file("a.pdf", 1), file("b.pdf", 2)]));
  const three = coverSlots(topic("t", [file("a.pdf", 1), file("b.pdf", 2), file("c.pdf", 3)]));
  const gap = (s: { leftPercent: number }[]) => s[1].leftPercent - s[0].leftPercent;
  expect(gap(two)).toBeGreaterThan(gap(three));
});

test("a topic with no files has no covers", () => {
  expect(coverSlots(topic("t", []))).toEqual([]);
});

test("the count label carries the empty case and the plural", () => {
  expect(fileCountLabel(0)).toBe("No files");
  expect(fileCountLabel(1)).toBe("1 file");
  expect(fileCountLabel(2)).toBe("2 files");
});

test("the placeholder initial drops the extension and keeps the script", () => {
  expect(coverInitial("attention.pdf")).toBe("A");
  expect(coverInitial("读书分享准备.pdf")).toBe("读");
  expect(coverInitial("v2.final.pdf")).toBe("V");
  // A file whose name is nothing but an extension, and an astral first letter.
  expect(coverInitial(".pdf")).toBe("?");
  expect(coverInitial("𝕏 notes.pdf")).toBe("𝕏");
});
