// The two forms a stored message anchor takes
// (src/memory/observations/anchors.ts), and what each one resolves to.
//
// The numbers: 459 message anchors on the owner's store on 2026-08-28, all of
// them the legacy "<threadId>:<ts>" pair, and 155 of those (34%) name two
// messages — a user turn and the reply to it, appended in the same millisecond.
// Which one the observation was about is unrecoverable for those, which is why
// a message now carries an id of its own.

import { expect, test } from "bun:test";
import {
  anchorNames,
  messageAnchor,
  messageAnchorKeys,
  parseMessageAnchor,
  resolveMessageAnchor,
  type AnchoredMessage,
} from "../../src/memory/observations/anchors";
import {
  buildAnchorIndex,
  observationsForMessage,
} from "../../src/memory/observations/links";
import type { Observation } from "../../src/memory/observations/types";

// A conversation as the thread file holds it after a turn and its reply landed
// in the same millisecond. Only the second pair carries ids.
const LEGACY: AnchoredMessage[] = [
  { role: "user", ts: 1000 },
  { role: "ai", ts: 1000 },
];

const MIXED: AnchoredMessage[] = [
  { role: "user", ts: 1000 },
  { role: "ai", ts: 1000 },
  { id: "t-0123456789abcdef", role: "user", ts: 2000 },
  { id: "t-fedcba9876543210", role: "ai", ts: 2000 },
];

test("a message with an id is anchored by it; one without falls back to the pair", () => {
  expect(messageAnchor({ id: "t-0123456789abcdef", ts: 2000 }, "thread-1")).toBe(
    "t-0123456789abcdef",
  );
  expect(messageAnchor({ ts: 1000 }, "thread-1")).toBe("thread-1:1000");
  // The thread a message is stored in wins over the pass's own, which is what a
  // folded aside needs (transcript.ts).
  expect(messageAnchor({ ts: 1000, threadId: "aside-2" }, "thread-1")).toBe("aside-2:1000");
});

test("both forms parse, and neither is taken for the other", () => {
  expect(parseMessageAnchor("t-0123456789abcdef")).toEqual({
    kind: "id",
    id: "t-0123456789abcdef",
  });
  expect(parseMessageAnchor("thread-1:1000")).toEqual({
    kind: "legacy",
    threadId: "thread-1",
    ts: 1000,
  });
  // A numeric thread id is real — one on the owner's store is "1786097054089".
  expect(parseMessageAnchor("1786097054089:1787487039182")).toEqual({
    kind: "legacy",
    threadId: "1786097054089",
    ts: 1787487039182,
  });
  expect(parseMessageAnchor("")).toBeNull();
  expect(parseMessageAnchor("thread-1:")).toBeNull();
  expect(parseMessageAnchor(":1000")).toBeNull();
});

// The whole reason the id exists.
test("a legacy anchor that names two messages resolves to the user turn", () => {
  expect(resolveMessageAnchor("thread-1:1000", LEGACY, "thread-1")).toBe(LEGACY[0]);
  // Order in the array does not decide it: the reply first still resolves to
  // what the reader said.
  const replyFirst = [LEGACY[1], LEGACY[0]];
  expect(resolveMessageAnchor("thread-1:1000", replyFirst, "thread-1")).toBe(LEGACY[0]);
});

test("a legacy anchor that names only an AI reply still resolves to it", () => {
  const only: AnchoredMessage[] = [{ role: "ai", ts: 3000 }];
  expect(resolveMessageAnchor("thread-1:3000", only, "thread-1")).toBe(only[0]);
});

test("a new-format anchor resolves to exactly the message it names", () => {
  expect(resolveMessageAnchor("t-fedcba9876543210", MIXED, "thread-1")).toBe(MIXED[3]);
  expect(resolveMessageAnchor("t-0123456789abcdef", MIXED, "thread-1")).toBe(MIXED[2]);
  expect(resolveMessageAnchor("t-aaaaaaaaaaaaaaaa", MIXED, "thread-1")).toBeUndefined();
});

// Gaining an id does not take a message out of reach of the anchors already
// written about it: the pair still names where it is stored, and an observation
// from before is not rewritten.
test("a legacy anchor still resolves against a message that has an id", () => {
  expect(resolveMessageAnchor("thread-1:2000", MIXED, "thread-1")).toBe(MIXED[2]);
});

test("an anchor from another thread does not resolve against this one", () => {
  expect(resolveMessageAnchor("other:1000", LEGACY, "thread-1")).toBeUndefined();
  expect(anchorNames("thread-1:1000", LEGACY[0], "thread-1")).toBe(true);
  expect(anchorNames("thread-1:1000", LEGACY[0], "other")).toBe(false);
});

test("a message names itself by its id and by the pair, so both forms find it", () => {
  expect(messageAnchorKeys(MIXED[2], "thread-1")).toEqual([
    "t-0123456789abcdef",
    "thread-1:2000",
  ]);
  expect(messageAnchorKeys(LEGACY[0], "thread-1")).toEqual(["thread-1:1000"]);
});

function obs(id: string, messages: string[]): Observation {
  return {
    id,
    type: "stuck-point",
    summary: `summary of ${id}`,
    body: "",
    created: "2026-08-01",
    updated: "2026-08-01",
    anchors: { annotationIds: [], messageIds: messages },
  };
}

// One turn, cited by an observation written before ids existed and by one
// written after. Asking with only one of the two forms finds half of them.
test("a turn's observations are found through either stored form", () => {
  const old = obs("m-aaaaaaaa", ["thread-1:2000"]);
  const fresh = obs("m-bbbbbbbb", ["t-0123456789abcdef"]);
  const index = buildAnchorIndex([old, fresh]);

  expect(observationsForMessage(index, MIXED[2], "thread-1")).toEqual([fresh, old]);
  expect(observationsForMessage(index, "thread-1:2000")).toEqual([old]);
  expect(observationsForMessage(index, "t-0123456789abcdef")).toEqual([fresh]);
});

test("an observation citing a turn in both forms is listed once", () => {
  const both = obs("m-cccccccc", ["thread-1:2000", "t-0123456789abcdef"]);
  const index = buildAnchorIndex([both]);
  expect(observationsForMessage(index, MIXED[2], "thread-1")).toEqual([both]);
});
