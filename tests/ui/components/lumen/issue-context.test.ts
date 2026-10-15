// The brief open in the reader, as Lumen's conversation sees it
// (src/ui/components/lumen/issue-context.ts, docs/info/88).

import { beforeEach, expect, test } from "bun:test";
import {
  askLumen,
  doorCitationJump,
  getOpenIssue,
  noteOnLastLine,
  opensDoor,
  publishOpenIssue,
  resetIssueContext,
  subscribeAskLumen,
  subscribeOpenIssue,
  type OpenIssue,
} from "../../../../src/ui/components/lumen/issue-context";
import { rackOmits } from "../../../../src/ui/components/reader/reader-tool";

const issue = (bookId: string): OpenIssue => ({
  bookId,
  title: "Oct 15 brief",
  where: () => ({ page: null, pageCount: null }),
  fulltext: async () => null,
  marks: () => [],
  jump: () => {},
});

beforeEach(() => resetIssueContext());

test("a brief published is the one open until its undo, and the door hears both", () => {
  let heard = 0;
  subscribeOpenIssue(() => heard++);
  const a = issue("a");
  const undoA = publishOpenIssue(a);
  expect(getOpenIssue()).toBe(a);
  // A second reader's brief replaces it, and the first one's undo leaves it alone.
  const b = issue("b");
  const undoB = publishOpenIssue(b);
  undoA();
  expect(getOpenIssue()).toBe(b);
  undoB();
  expect(getOpenIssue()).toBeNull();
  expect(heard).toBe(3);
});

test("the door comes up for a brief being opened, not for the same one published again", () => {
  expect(opensDoor(null, issue("a"))).toBe(true);
  expect(opensDoor("a", issue("a"))).toBe(false);
  expect(opensDoor("a", issue("b"))).toBe(true);
  expect(opensDoor("a", null)).toBe(false);
});

test("an Ask hands the passage over squeezed, and an empty one hands nothing", () => {
  const asked: string[] = [];
  const off = subscribeAskLumen((q) => asked.push(q.text));
  askLumen({ text: "  a model\n writes proofs " });
  askLumen({ text: "   " });
  off();
  askLumen({ text: "after" });
  expect(asked).toEqual(["a model writes proofs"]);
});

test("a page citation in the door jumps only while a brief is open", () => {
  expect(doorCitationJump({ kind: "page", page: 4, quote: "writes proofs" }, true)).toEqual({
    pageIndex: 3,
    quote: "writes proofs",
  });
  expect(doorCitationJump({ kind: "page", page: 2 }, true)).toEqual({ pageIndex: 1 });
  expect(doorCitationJump({ kind: "page", page: 2 }, false)).toBeNull();
  expect(doorCitationJump({ kind: "figure", id: "3" }, true)).toBeNull();
});

test("the note goes on the reader's last line and on nothing else", () => {
  const history = [
    { role: "user", text: "a" },
    { role: "ai", text: "b" },
    { role: "user", text: "c" },
  ];
  expect(noteOnLastLine(history, " [n]")).toEqual([...history.slice(0, 2), { role: "user", text: "c [n]" }]);
  expect(history[2].text).toBe("c");
  expect(noteOnLastLine(history, "")).toEqual(history);
  expect(noteOnLastLine(history.slice(0, 2), " [n]")).toEqual(history.slice(0, 2));
});

test("a brief's rack has no AI pen; a book's keeps it", () => {
  expect(rackOmits(true, "issue")).toEqual(["ai"]);
  expect(rackOmits(false, "issue")).toEqual(["navlock", "ai"]);
  expect(rackOmits(true)).toEqual([]);
});
