// A voice call held at the door (src/soul/voice/live/door-call.ts, docs/68).
// Run: scripts/t.sh tests/soul/voice/live/door-call.test.ts

import { expect, test } from "bun:test";

import { callTranscriptWriter } from "../../../../src/soul/voice/live/call-transcript";
import { doorCallPlace, doorCallSpec, doorCallThreads } from "../../../../src/soul/voice/live/door-call";

test("the front is told the call is at the door, and that a book is open where one is", () => {
  const plain = doorCallPlace({});
  expect(plain).toContain("At the door");
  expect(plain).not.toContain("book open");
  expect(doorCallPlace({ inReader: false })).toBe(plain);
  expect(doorCallPlace({ inReader: true })).toBe(`${plain}\nThey have a book open in the reader.`);
});

test("a door call writes to the day's door conversation and nowhere else", () => {
  expect(doorCallThreads("2026-10-20", "d1")).toEqual([{ key: "door-2026-10-20", threadId: "d1" }]);
});

test("the spec delivers to the door on the start day and opens that day's thread", async () => {
  const opened: string[] = [];
  const spec = doorCallSpec({ date: "2026-10-20", inReader: true }, async (date) => {
    opened.push(date);
    return { id: "d1" };
  });
  expect(spec.deliverTo).toEqual({ place: "door", date: "2026-10-20" });
  expect(spec.place).toBe(doorCallPlace({ inReader: true }));
  expect(spec.contextualStrings).toEqual([]);
  // Nothing is distilled on hang-up at the door.
  expect(spec.afterStop).toBeUndefined();
  // The thread is opened only when the builder asks, once there is a bridge.
  expect(opened).toEqual([]);
  const threads = await spec.threads();
  expect(opened).toEqual(["2026-10-20"]);

  const ops: string[] = [];
  const write = callTranscriptWriter(threads, {
    append: (key, threadId, m) => ops.push(`append ${key}/${threadId} ${m.role} ${m.text}`),
    patch: (key, threadId, _ts, p) => ops.push(`patch ${key}/${threadId} ${p.text}`),
    now: () => 1,
  });
  write({ key: "1:user", role: "user", text: "hello" });
  write({ key: "1:user", role: "user", text: "hello there" });
  expect(ops).toEqual(["append door-2026-10-20/d1 user hello", "patch door-2026-10-20/d1 hello there"]);
});

test("the screen's hooks ride along only when given", () => {
  const open = async () => ({ id: "d1" });
  const bare = doorCallSpec({ date: "2026-10-20" }, open);
  expect("onShow" in bare).toBe(false);
  expect("onRunning" in bare).toBe(false);
  const onRunning = () => {};
  expect(doorCallSpec({ date: "2026-10-20", onRunning }, open).onRunning).toBe(onRunning);
});
