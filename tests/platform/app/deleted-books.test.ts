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

// --- the log as events (docs/50 「载体」) --------------------------------------

import {
  appendTombstoneLine,
  effectiveDeletions,
  parseTombstones,
  tombstoneAt,
} from "../../../src/platform/app/deleted-books";

const T1 = "2026-09-20T10:00:00.000Z";
const T2 = "2026-09-21T10:00:00.000Z";

test("a revive after a delete brings the book back; a delete after that takes it again", () => {
  let text = appendTombstoneLine("", { kind: "book", id: "h1", op: "delete", at: T1 });
  expect(effectiveDeletions(text).book.has("h1")).toBe(true);
  text = appendTombstoneLine(text, { kind: "book", id: "h1", op: "revive", at: T2 });
  expect(effectiveDeletions(text).book.has("h1")).toBe(false);
  expect(parseDeletedBooks(text).has("h1")).toBe(false);
  text = appendTombstoneLine(text, { kind: "book", id: "h1", op: "delete", at: "2026-09-22T10:00:00.000Z" });
  expect(effectiveDeletions(text).book.has("h1")).toBe(true);
  expect(text.split("\n").filter(Boolean)).toHaveLength(3);
});

test("the order in the file does not matter, only the moments do", () => {
  const text = `{"kind":"book","id":"h1","op":"revive","at":"${T2}"}\n{"bookId":"h1","at":"${T1}"}\n`;
  expect(effectiveDeletions(text).book.has("h1")).toBe(false);
});

test("a tie goes to the delete", () => {
  const text = `{"bookId":"h1","at":"${T1}"}\n{"kind":"book","id":"h1","op":"revive","at":"${T1}"}\n`;
  expect(effectiveDeletions(text).book.has("h1")).toBe(true);
});

test("a day written by the first build sorts before any moment inside it", () => {
  const text = `{"bookId":"h1","at":"2026-09-21"}\n{"kind":"book","id":"h1","op":"revive","at":"2026-09-21T00:00:00.000Z"}\n`;
  expect(effectiveDeletions(text).book.has("h1")).toBe(false);
});

test("a revive of a book that is not deleted writes nothing", () => {
  expect(appendTombstoneLine("", { kind: "book", id: "h1", op: "revive", at: T1 })).toBe("");
});

test("a book's delete keeps the shape an older client reads; the other kinds have their own", () => {
  const text = [
    appendTombstoneLine("", { kind: "book", id: "h1", op: "delete", at: T1 }),
    appendTombstoneLine("", { kind: "retell", id: "r1", op: "delete", at: T1 }),
    appendTombstoneLine("", { kind: "topic", id: "t1", op: "delete", at: T1 }),
  ].join("");
  expect(text).toBe(
    `{"bookId":"h1","at":"${T1}"}\n{"kind":"retell","id":"r1","op":"delete","at":"${T1}"}\n{"kind":"topic","id":"t1","op":"delete","at":"${T1}"}\n`,
  );
  const d = effectiveDeletions(text);
  expect([...d.book]).toEqual(["h1"]);
  expect([...d.retell]).toEqual(["r1"]);
  expect([...d.topic]).toEqual(["t1"]);
  expect(d.outline.size + d.rehearsal.size).toBe(0);
});

test("a line with an unknown kind or op is not an event", () => {
  const text = '{"kind":"desk","id":"x","op":"delete","at":"1"}\n{"kind":"retell","id":"r1","op":"drop","at":"1"}\n{"kind":"retell","id":"","op":"delete"}\n';
  expect(parseTombstones(text)).toEqual([]);
});

test("the moment is an ISO time", () => {
  expect(tombstoneAt(Date.UTC(2026, 8, 20, 10))).toBe("2026-09-20T10:00:00.000Z");
});
