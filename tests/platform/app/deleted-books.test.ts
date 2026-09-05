// The deleted-book tombstone's file format (src/platform/app/deleted-books.ts):
// what a line has to look like to count, and what appending one does to a file
// that already names the book. The fs half is exercised through the sync engine
// (tests/platform/sync/engine.test.ts), which is where the file matters.
// Run: bun test.

import { expect, test } from "bun:test";
import {
  appendDeletedBookLine,
  parseDeletedBooks,
  DELETED_BOOKS_FILE,
} from "../../../src/platform/app/deleted-books";

test("the file sits at the AppData root, in sync range", () => {
  expect(DELETED_BOOKS_FILE).toBe("deleted-books.jsonl");
});

test("every line's bookId is read back", () => {
  const text = '{"bookId":"a1","at":"2026-09-05"}\n{"bookId":"b2","at":"2026-09-06"}\n';
  expect([...parseDeletedBooks(text)]).toEqual(["a1", "b2"]);
});

// Every caller of this is deciding what to delete. A file half of which will not
// parse must not read as "nothing is deleted" — nor may one bad line stop the
// good ones being read.
test("blank and malformed lines are skipped, not fatal", () => {
  const text = [
    "",
    "   ",
    "not json",
    "[1,2,3]",
    '{"at":"2026-09-05"}',
    '{"bookId":"","at":"2026-09-05"}',
    '{"bookId":42}',
    '{"bookId":"good"}',
    "",
  ].join("\n");
  expect([...parseDeletedBooks(text)]).toEqual(["good"]);
});

test("an empty file names no deleted book", () => {
  expect(parseDeletedBooks("").size).toBe(0);
});

test("appending to an empty file writes the one line", () => {
  expect(appendDeletedBookLine("", "a1", "2026-09-05")).toBe('{"bookId":"a1","at":"2026-09-05"}\n');
});

// Both devices delete the same book on the same day and write the same bytes,
// so the records merge's union holds one line rather than two dated versions of
// one fact (platform/sync/merge/records.ts).
test("the line is bookId then at, so two devices write the same bytes", () => {
  const a = appendDeletedBookLine("", "a1", "2026-09-05");
  const b = appendDeletedBookLine("", "a1", "2026-09-05");
  expect(a).toBe(b);
});

test("appending a book that is already tombstoned changes nothing", () => {
  const first = appendDeletedBookLine("", "a1", "2026-09-05");
  expect(appendDeletedBookLine(first, "a1", "2026-09-30")).toBe(first);
});

test("a file with no trailing newline gets one before the new line", () => {
  const text = '{"bookId":"a1","at":"2026-09-05"}';
  expect(appendDeletedBookLine(text, "b2", "2026-09-06")).toBe(
    '{"bookId":"a1","at":"2026-09-05"}\n{"bookId":"b2","at":"2026-09-06"}\n',
  );
});

test("an existing line is never rewritten", () => {
  const text = '{"bookId":"a1","at":"2026-09-05"}\n';
  const next = appendDeletedBookLine(text, "b2", "2026-09-06");
  expect(next.startsWith(text)).toBe(true);
});
