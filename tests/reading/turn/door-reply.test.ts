// A think run handed off from a call at the door lands its answer in the day's
// door conversation (src/reading/turn/door-bell.ts, docs/companion/136).
// Run: scripts/t.sh tests/reading/turn/door-reply.test.ts

import { afterEach, expect, test } from "bun:test";

import type { ThreadMessage } from "../../../src/platform/app/threads";
import { doorKey, replyAppender } from "../../../src/soul";
import { appendDoorReply, registerDoorDelivery, type DoorReplyDeps } from "../../../src/reading/turn/door-bell";

const DATE = "2026-10-20";

const undo: (() => void)[] = [];
afterEach(() => {
  for (const u of undo.splice(0)) u();
});

function rig() {
  const opened: string[] = [];
  const written: { key: string; threadId: string; message: ThreadMessage }[] = [];
  let flushed = 0;
  const deps: DoorReplyDeps = {
    openThread: async (date) => {
      opened.push(date);
      return { id: "d1" };
    },
    append: (key, threadId, message) => void written.push({ key, threadId, message }),
    flush: async () => void (flushed += 1),
  };
  return { deps, opened, written, flushed: () => flushed };
}

test("the door appender writes the soul's reply into the day's door thread, stamped with the run", async () => {
  const r = rig();
  const ok = await appendDoorReply({ origin: { place: "door", date: DATE }, text: "Rates did it.", runId: "r-1", at: 1000 }, r.deps);
  expect(ok).toBe(true);
  expect(r.opened).toEqual([DATE]);
  expect(r.written).toHaveLength(1);
  expect(r.written[0]).toMatchObject({
    key: doorKey(DATE),
    threadId: "d1",
    message: { role: "ai", text: "Rates did it.", ts: 1000, origin: { runId: "r-1" } },
  });
  expect(r.flushed()).toBe(1);
});

test("an origin that is not the door is left alone", async () => {
  const r = rig();
  const ok = await appendDoorReply({ origin: { place: "briefing", date: DATE }, text: "x", runId: "r", at: 1 }, r.deps);
  expect(ok).toBe(false);
  expect(r.opened).toEqual([]);
  expect(r.written).toEqual([]);
  expect(r.flushed()).toBe(0);
});

test("registerDoorDelivery registers the door's appender and its undo takes it away", () => {
  const off = registerDoorDelivery();
  undo.push(off);
  expect(replyAppender("door")).not.toBeNull();
  off();
  expect(replyAppender("door")).toBeNull();
});
