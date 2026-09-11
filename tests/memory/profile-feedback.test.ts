// The attention log (src/memory/profile/feedback.ts): the pure JSONL parse, and
// appending against an in-memory AppData.
//
// The log is one whole-file read-modify-write per reaction (plugin-fs has no
// append mode), which is the shape that ate a book's conversation elsewhere in
// the app: a read that fails, a fallback that stands in for the file, and the
// next write making the fallback the file. Run: bun test.

import { beforeEach, expect, test } from "bun:test";
import {
  FEEDBACK_FILE,
  appendFeedback,
  loadFeedback,
  parseFeedbackLog,
} from "../../src/memory/profile/feedback";
import { installAppData, type FakeDisk } from "../support/appdata-fake";

let disk: FakeDisk;

beforeEach(() => {
  disk = installAppData();
});

test("parseFeedbackLog reads valid lines and skips corrupt ones", () => {
  const log = [
    JSON.stringify({ ts: 1, itemId: "a", title: "A", action: "opened" }),
    "",
    "{ this is not json",
    JSON.stringify({ ts: 2, itemId: "b", title: "B", action: "dismissed", category: "vendor PR" }),
    JSON.stringify({ nope: true }), // missing itemId/action -> skipped
  ].join("\n");
  const events = parseFeedbackLog(log);
  expect(events.length).toBe(2);
  expect(events[0].itemId).toBe("a");
  expect(events[1].category).toBe("vendor PR");
});

test("parseFeedbackLog on empty input", () => {
  expect(parseFeedbackLog("")).toEqual([]);
  expect(parseFeedbackLog("\n\n")).toEqual([]);
});

function line(itemId: string): string {
  return JSON.stringify({ ts: 1, itemId, title: itemId.toUpperCase(), action: "opened" });
}

const THREE = [line("a"), line("b"), line("c")].join("\n") + "\n";

test("an append adds one line and keeps the ones already there", async () => {
  disk.files.set(FEEDBACK_FILE, THREE);
  await appendFeedback({ itemId: "d", title: "D", action: "dismissed" });
  const events = parseFeedbackLog(disk.files.get(FEEDBACK_FILE) ?? "");
  expect(events.map((e) => e.itemId)).toEqual(["a", "b", "c", "d"]);
});

test("the first reaction of all creates the file", async () => {
  await appendFeedback({ itemId: "a", title: "A", action: "opened" });
  expect(parseFeedbackLog(disk.files.get(FEEDBACK_FILE) ?? "")).toHaveLength(1);
});

// The one that matters. A log that could not be read is not an empty log, and
// this write replaces the whole file: standing in "" for it puts this single
// reaction where the reader's whole attention history was. Sync does not undo
// it either — with a merge base, lines this device dropped count as deletes and
// come off the other device too.
test("a log that could not be read is left exactly as it is", async () => {
  disk.files.set(FEEDBACK_FILE, THREE);
  disk.unreadable.add(FEEDBACK_FILE);

  await appendFeedback({ itemId: "d", title: "D", action: "dismissed" });

  // Byte for byte what was there: not truncated, not appended to blind.
  expect(disk.files.get(FEEDBACK_FILE)).toBe(THREE);

  // And once the file opens again, the log is all still there and the next
  // reaction lands on top of it.
  disk.unreadable.clear();
  await appendFeedback({ itemId: "e", title: "E", action: "appealed" });
  expect((await loadFeedback()).map((e) => e.itemId)).toEqual(["a", "b", "c", "e"]);
});

// The other half of "could not be read": bytes that are there and are partly
// junk. JSONL is line-addressed, so a half-written line is one skipped record
// and not a reason to rewrite anything — the file keeps its bad line and its
// good ones, and the new event goes on the end.
test("a half-written line is kept, not tidied away", async () => {
  const damaged = [line("a"), '{"ts":2,"itemId":"b","act', line("c")].join("\n") + "\n";
  disk.files.set(FEEDBACK_FILE, damaged);

  await appendFeedback({ itemId: "d", title: "D", action: "opened" });

  const body = disk.files.get(FEEDBACK_FILE) ?? "";
  expect(body.startsWith(damaged)).toBe(true);
  expect(body).toContain('{"ts":2,"itemId":"b","act');
  expect(parseFeedbackLog(body).map((e) => e.itemId)).toEqual(["a", "c", "d"]);
});

test("loadFeedback on an unreadable log reads as empty without touching it", async () => {
  disk.files.set(FEEDBACK_FILE, THREE);
  disk.unreadable.add(FEEDBACK_FILE);
  expect(await loadFeedback()).toEqual([]);
  expect(disk.files.get(FEEDBACK_FILE)).toBe(THREE);
});
