// "Move to…" (shelf/move-to.ts): when a file can move, and the topics it is
// offered. Run: scripts/t.sh tests/ui/components/shelf/move-to.test.ts

import { expect, test } from "bun:test";
import type { FileRef, Topic } from "../../../../src/platform/app/topics";
import { canMoveFile, movedLine, moveTargets } from "../../../../src/ui/components/shelf/move-to";

const file = (path: string, hash?: string): FileRef => ({ path, name: path, addedAt: 0, ...(hash ? { hash } : {}) });
const topic = (id: string, name: string, createdAt: number, files: FileRef[] = []): Topic => ({
  id,
  name,
  createdAt,
  files,
});

test("a file moves when it has a book id and there is another topic", () => {
  const one = [topic("t1", "Minds", 1)];
  const two = [...one, topic("t2", "Cities", 2)];
  expect(canMoveFile(file("a.epub", "h1"), two)).toBe(true);
  expect(canMoveFile(file("a.epub", "h1"), one)).toBe(false);
  expect(canMoveFile(file("a.epub"), two)).toBe(false);
});

test("every topic is offered in shelf order, the current one marked here", () => {
  const topics = [
    topic("t1", "Minds", 1, [file("a.epub", "h1"), file("b.epub", "h2")]),
    topic("t2", "Cities", 2),
    topic("t3", "A long topic name that wraps onto a second line on a phone", 3, [file("c.epub", "h3")]),
  ];
  expect(moveTargets(topics, "t1")).toEqual([
    { id: "t3", name: "A long topic name that wraps onto a second line on a phone", count: "1 file", here: false },
    { id: "t2", name: "Cities", count: "No files", here: false },
    { id: "t1", name: "Minds", count: "2 files", here: true },
  ]);
});

test("the line after a move names where it went", () => {
  expect(movedLine("Cities")).toBe("Moved to “Cities”");
});
