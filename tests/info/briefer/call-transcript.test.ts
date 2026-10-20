// A voice call's lines, written to the day's info thread and copied into the
// door conversation (src/info/briefer/call-transcript.ts).
// Run: scripts/t.sh tests/info/briefer/call-transcript.test.ts

import { expect, test } from "bun:test";

import { callTranscriptWriter } from "../../../src/info/briefer/call-transcript";

function harness(now: () => number) {
  const ops: string[] = [];
  const write = callTranscriptWriter(
    [
      { key: "info-2026-10-20", threadId: "briefing" },
      { key: "door-2026-10-20", threadId: "d1" },
    ],
    {
      append: (key, threadId, m) => ops.push(`append ${key}/${threadId} ${m.role} ${m.ts} ${m.text}`),
      patch: (key, threadId, ts, p) => ops.push(`patch ${key}/${threadId} ${ts} ${p.text}`),
      now,
    },
  );
  return { ops, write };
}

test("a new line is appended to every thread under one stamp", () => {
  const { ops, write } = harness(() => 100);
  write({ key: "1:user", role: "user", text: "hello" });
  expect(ops).toEqual([
    "append info-2026-10-20/briefing user 100 hello",
    "append door-2026-10-20/d1 user 100 hello",
  ]);
});

test("the same line settling again is patched in place in every thread", () => {
  const { ops, write } = harness(() => 100);
  write({ key: "1:ai", role: "ai", text: "Hi" });
  write({ key: "1:ai", role: "ai", text: "Hi there" });
  expect(ops.slice(2)).toEqual([
    "patch info-2026-10-20/briefing 100 Hi there",
    "patch door-2026-10-20/d1 100 Hi there",
  ]);
});

test("two lines in one millisecond keep distinct, increasing stamps", () => {
  const { ops, write } = harness(() => 100);
  write({ key: "1:user", role: "user", text: "a" });
  write({ key: "1:ai", role: "ai", text: "b" });
  expect(ops[2]).toBe("append info-2026-10-20/briefing ai 101 b");
  expect(ops[3]).toBe("append door-2026-10-20/d1 ai 101 b");
});
