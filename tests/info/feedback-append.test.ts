// Appending to the attention log (src/observation/feedback.ts) against an
// in-memory AppData. Its own file rather than feedback.test.ts's, because the
// mocked filesystem has to be installed before the module under test is
// imported.
//
// The log is one whole-file read-modify-write per reaction (plugin-fs has no
// append mode), which is the shape that ate a book's conversation elsewhere in
// the app: a read that fails, a fallback that stands in for the file, and the
// next write making the fallback the file. Run: bun test.

import { beforeEach, expect, mock, test } from "bun:test";
import { makeAppData } from "../support/appdata";

const app = makeAppData();
const { files, unreadable } = app;
mock.module("@tauri-apps/plugin-fs", () => app.pluginFs);
mock.module("@tauri-apps/api/core", () => app.core);
mock.module("../../src/platform/app/atomic-fs", () => app.atomicFs);

const { appendFeedback, FEEDBACK_FILE, loadFeedback, parseFeedbackLog } = await import(
  "../../src/observation/feedback"
);

function line(itemId: string): string {
  return JSON.stringify({ ts: 1, itemId, title: itemId.toUpperCase(), action: "opened" });
}

const THREE = [line("a"), line("b"), line("c")].join("\n") + "\n";

beforeEach(() => app.reset());

test("an append adds one line and keeps the ones already there", async () => {
  files.set(FEEDBACK_FILE, THREE);
  await appendFeedback({ itemId: "d", title: "D", action: "dismissed" });
  const events = parseFeedbackLog(files.get(FEEDBACK_FILE) ?? "");
  expect(events.map((e) => e.itemId)).toEqual(["a", "b", "c", "d"]);
});

test("the first reaction of all creates the file", async () => {
  await appendFeedback({ itemId: "a", title: "A", action: "opened" });
  expect(parseFeedbackLog(files.get(FEEDBACK_FILE) ?? "")).toHaveLength(1);
});

// The one that matters. A log that could not be read is not an empty log, and
// this write replaces the whole file: standing in "" for it puts this single
// reaction where the reader's whole attention history was. Sync does not undo
// it either — with a merge base, lines this device dropped count as deletes and
// come off the other device too.
test("a log that could not be read is left exactly as it is", async () => {
  files.set(FEEDBACK_FILE, THREE);
  unreadable.add(FEEDBACK_FILE);

  await appendFeedback({ itemId: "d", title: "D", action: "dismissed" });

  // Byte for byte what was there: not truncated, not appended to blind.
  expect(files.get(FEEDBACK_FILE)).toBe(THREE);

  // And once the file opens again, the log is all still there and the next
  // reaction lands on top of it.
  unreadable.clear();
  await appendFeedback({ itemId: "e", title: "E", action: "appealed" });
  expect((await loadFeedback()).map((e) => e.itemId)).toEqual(["a", "b", "c", "e"]);
});

// The other half of "could not be read": bytes that are there and are partly
// junk. JSONL is line-addressed, so a half-written line is one skipped record
// and not a reason to rewrite anything — the file keeps its bad line and its
// good ones, and the new event goes on the end.
test("a half-written line is kept, not tidied away", async () => {
  const damaged = [line("a"), '{"ts":2,"itemId":"b","act', line("c")].join("\n") + "\n";
  files.set(FEEDBACK_FILE, damaged);

  await appendFeedback({ itemId: "d", title: "D", action: "opened" });

  const body = files.get(FEEDBACK_FILE) ?? "";
  expect(body.startsWith(damaged)).toBe(true);
  expect(body).toContain('{"ts":2,"itemId":"b","act');
  expect(parseFeedbackLog(body).map((e) => e.itemId)).toEqual(["a", "c", "d"]);
});

test("loadFeedback on an unreadable log reads as empty without touching it", async () => {
  files.set(FEEDBACK_FILE, THREE);
  unreadable.add(FEEDBACK_FILE);
  expect(await loadFeedback()).toEqual([]);
  expect(files.get(FEEDBACK_FILE)).toBe(THREE);
});
