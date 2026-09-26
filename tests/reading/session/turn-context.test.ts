// Where the reader is, as a reading turn is told it
// (src/reading/session/turn-context.ts). Run: bun test.

import { expect, test } from "bun:test";
import { readingTurnContext } from "../../../src/reading/session/turn-context";

test("the topic, the book and the page on screen", () => {
  const topic = {
    id: "t1",
    name: "Machines",
    files: [
      { path: "/books/a.epub", name: "A", addedAt: 1, hash: "h1" },
      { path: "/books/b.pdf", name: "B", addedAt: 2 },
    ],
  };
  expect(readingTurnContext(topic, "A", { pageIndex: 13, pageLabel: "14" })).toEqual({
    topicId: "t1",
    topicName: "Machines",
    fileName: "A",
    pageLabel: "14",
    pageIndex: 13,
    files: [
      { path: "/books/a.epub", name: "A", hash: "h1" },
      { path: "/books/b.pdf", name: "B", hash: undefined },
    ],
  });
});

test("no topic and no page yet", () => {
  expect(readingTurnContext(null, "", null)).toEqual({
    topicId: null,
    topicName: "",
    fileName: "",
    pageLabel: null,
    pageIndex: null,
    files: [],
  });
});
