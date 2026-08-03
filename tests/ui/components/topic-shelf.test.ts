// The library shelf's arithmetic (src/ui/components/library/topic-shelf.ts):
// the column count at each form factor, the cover stack's geometry and the two
// labels a card carries. All of it decides what the screen looks like and none
// of it is visible to a type checker, so the numbers are pinned here.
// Run: bun test.

import { expect, test } from "bun:test";
import type { FileRef, Topic } from "../../../src/platform/app/topics";
import {
  coverBox,
  COVER_ASPECT,
  coverInitial,
  coverSlots,
  fileCountLabel,
  MAX_COVERS,
  MAX_SPAN_PERCENT,
  shelfOrder,
  singleCoverSlot,
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

test("the grid is two columns up to a tablet and grows from there", () => {
  expect(topicGridColumns(390)).toBe(2); // phone
  expect(topicGridColumns(820)).toBe(2); // iPad portrait
  expect(topicGridColumns(1180)).toBe(3); // iPad landscape
  expect(topicGridColumns(1600)).toBe(4); // a wide desktop window
});

test("the grid class string is the same table the numbers come from", () => {
  expect(TOPIC_GRID_COLUMNS_CLASS).toBe("grid-cols-2 lg:grid-cols-3 xl:grid-cols-4");
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

function stack(count: number) {
  return coverSlots(topic("t", Array.from({ length: count }, (_, i) => file(`${i}.pdf`, i))));
}

// A percentage string back to a number, for reading coverBox's output.
function pct(value: string): number {
  return Number(value.replace("%", ""));
}

test("a lone cover is centred; a stack is anchored by left edges", () => {
  expect(stack(1).map((s) => s.anchor)).toEqual(["centre"]);
  expect(stack(1)[0].leftPercent).toBe(50);
  for (const count of [2, 3]) {
    const slots = stack(count);
    expect(slots.map((s) => s.anchor)).toEqual(slots.map(() => "left"));
    // Strictly increasing left edges: every cover behind shows a strip of
    // itself, whatever shape it turns out to be.
    for (let i = 1; i < slots.length; i++) {
      expect(slots[i].leftPercent - slots[i - 1].leftPercent).toBeGreaterThanOrEqual(8);
    }
    // Each cover in front of the one to its left, so the last one is whole.
    expect(slots.map((s) => s.z)).toEqual(slots.map((_, i) => i + 1));
  }
});

test("books in a stack stand as tall as each other, and near a lone one", () => {
  for (const count of [1, 2, 3]) {
    const heights = new Set(stack(count).map((s) => s.heightPercent));
    expect(heights.size).toBe(1);
  }
  // A card with three books must not read as a different screen from a card
  // with one.
  expect(stack(3)[0].heightPercent).toBeGreaterThan(0.85 * stack(1)[0].heightPercent);
  expect(stack(1)[0].heightPercent).toBeLessThanOrEqual(92);
});

test("a book-shaped cover keeps its height and clears the band", () => {
  for (const count of [1, 2, 3]) {
    for (const slot of stack(count)) {
      const box = coverBox(slot, 0.66); // a trade paperback
      expect(pct(box.height)).toBe(slot.heightPercent);
      expect(pct(box.height)).toBeLessThanOrEqual(100);
      const right =
        slot.anchor === "centre" ? 50 + pct(box.width) / 2 : slot.leftPercent + pct(box.width);
      expect(right).toBeLessThanOrEqual(100);
      expect(pct(box.width)).toBeGreaterThan(0);
    }
  }
});

test("a landscape first page is capped by width and gets shorter", () => {
  for (const count of [1, 2, 3]) {
    for (const slot of stack(count)) {
      const deck = coverBox(slot, 16 / 9);
      const book = coverBox(slot, COVER_ASPECT);
      // Never wider than a book of the same height, so a deck behind one stays
      // behind it rather than sticking out past its edge.
      expect(pct(deck.width)).toBeLessThanOrEqual(pct(book.width) + 0.001);
      expect(pct(deck.height)).toBeLessThan(slot.heightPercent);
      // And it is still a 16:9 box, not a squashed one.
      expect(pct(deck.width) / (pct(deck.height) * 1.33)).toBeCloseTo(16 / 9, 1);
    }
  }
});

test("the whole stack keeps a margin either side of the band", () => {
  for (const count of [1, 2, 3]) {
    const slots = stack(count);
    const first = slots[0];
    const last = slots[slots.length - 1];
    const width = (s: (typeof slots)[number]) => pct(coverBox(s, COVER_ASPECT).width);
    const left = first.anchor === "centre" ? 50 - width(first) / 2 : first.leftPercent;
    const right = last.anchor === "centre" ? 50 + width(last) / 2 : last.leftPercent + width(last);
    expect(right - left).toBeLessThanOrEqual(MAX_SPAN_PERCENT);
    // Centred as a group: the two margins are the same.
    expect(left).toBeCloseTo(100 - right, 1);
  }
});

test("the box before the image has loaded is a book-shaped guess", () => {
  const [slot] = stack(1);
  expect(coverBox(slot, undefined)).toEqual(coverBox(slot, COVER_ASPECT));
  expect(coverBox(slot, 0)).toEqual(coverBox(slot, COVER_ASPECT));
});

test("a single cover is the same box on both library screens", () => {
  const one = file("only.pdf", 1);
  const alone = singleCoverSlot(one);
  expect(alone).toEqual(coverSlots(topic("t", [one])));
  // Nearly the whole card wide: this is the screen's subject, not a thumbnail.
  expect(pct(coverBox(alone[0], COVER_ASPECT).width)).toBeGreaterThanOrEqual(80);
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
