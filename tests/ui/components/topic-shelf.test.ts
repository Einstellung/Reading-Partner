// The library shelf's arithmetic (src/ui/components/library/topic-shelf.ts):
// the column count at each form factor, which covers a card shows and how wide
// they are, and the two labels a card carries. All of it decides what the
// screen looks like and none of it is visible to a type checker, so the numbers
// are pinned here. Run: bun test.

import { expect, test } from "bun:test";
import type { FileRef, Topic } from "../../../src/platform/app/topics";
import {
  COVER_ASPECT,
  coverAspect,
  coverInitial,
  coverStack,
  fileCountLabel,
  frontWidthPercent,
  MAX_COVERS,
  shelfOrder,
  singleCover,
  SPINE_WIDTH_PERCENT,
  stackFiles,
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

test("the grid is dense enough to be a shelf at every form factor", () => {
  expect(topicGridColumns(390)).toBe(2); // phone
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

test("the front cover is the most recently read book, the edges follow it", () => {
  const t = topic("t", [
    file("added-first.pdf", 1),
    file("read-last.pdf", 2, 500),
    file("read-first.pdf", 3, 100),
    file("read-middle.pdf", 4, 300),
  ]);
  const stack = coverStack(t)!;
  expect(stack.front.name).toBe("read-last.pdf");
  expect(stack.spines.map((f) => f.name)).toEqual(["read-middle.pdf", "read-first.pdf"]);
  // The card asks for one image per cover it draws, and no more.
  expect(stackFiles(stack)).toHaveLength(MAX_COVERS);
});

test("the covers take the whole width of the card, never less", () => {
  for (const count of [1, 2, 3]) {
    const t = topic("t", Array.from({ length: count }, (_, i) => file(`${i}.pdf`, i)));
    const stack = coverStack(t)!;
    const total = frontWidthPercent(stack) + stack.spines.length * stack.spineWidthPercent;
    expect(total).toBe(100);
  }
});

test("one book means one cover across the whole card", () => {
  const stack = coverStack(topic("t", [file("only.pdf", 1)]))!;
  expect(stack.spines).toEqual([]);
  expect(frontWidthPercent(stack)).toBe(100);
});

test("an edge is a slice, not a share of the card", () => {
  const three = coverStack(topic("t", [file("a.pdf", 1), file("b.pdf", 2), file("c.pdf", 3)]))!;
  expect(three.spineWidthPercent).toBe(SPINE_WIDTH_PERCENT);
  // Whatever else changes, the front cover stays the card.
  expect(frontWidthPercent(three)).toBeGreaterThanOrEqual(80);
});

test("a topic with no files has no stack at all", () => {
  expect(coverStack(topic("t", []))).toBeNull();
  expect(stackFiles(null)).toEqual([]);
});

test("a book on its own screen is the same front cover", () => {
  const one = file("only.pdf", 1);
  expect(singleCover(one)).toEqual(coverStack(topic("t", [one]))!);
});

test("the cover box takes the image's shape, and a book's until it has one", () => {
  expect(coverAspect(0.66)).toBe(0.66);
  expect(coverAspect(16 / 9)).toBe(16 / 9);
  // Everything an image that failed to decode can report.
  expect(coverAspect(undefined)).toBe(COVER_ASPECT);
  expect(coverAspect(0)).toBe(COVER_ASPECT);
  expect(coverAspect(Number.NaN)).toBe(COVER_ASPECT);
  expect(coverAspect(Number.POSITIVE_INFINITY)).toBe(COVER_ASPECT);
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
