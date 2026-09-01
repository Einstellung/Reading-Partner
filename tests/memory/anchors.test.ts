// The forms a stored message anchor takes (src/memory/observations/anchors.ts),
// and what each one resolves to.
//
// The numbers: 292 message anchors on the owner's store on 2026-08-28, all of
// them the "<threadId>:<ts>" pair, and 143 of those (49%) name two messages — a
// user turn and the reply to it, appended in the same millisecond. Which one
// the observation was about is unrecoverable for those, which is why a message
// now carries an id of its own, and the pair is kept beside it because a sync
// merge can hand back a message without its id.

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

const ID_A = "t-0123456789abcdef";
const ID_B = "t-fedcba9876543210";

// A conversation as the thread file holds it after a turn and its reply landed
// in the same millisecond. Only the second pair carries ids.
const LEGACY: AnchoredMessage[] = [
  { role: "user", ts: 1000 },
  { role: "ai", ts: 1000 },
];

const MIXED: AnchoredMessage[] = [
  { role: "user", ts: 1000 },
  { role: "ai", ts: 1000 },
  { id: ID_A, role: "user", ts: 2000 },
  { id: ID_B, role: "ai", ts: 2000 },
];

test("an anchor carries both halves whenever both are known", () => {
  expect(messageAnchor({ id: ID_A, ts: 2000 }, "thread-1")).toBe(`${ID_A}@thread-1:2000`);
  // The thread a message is stored in wins over the pass's own, which is what a
  // folded aside needs (transcript.ts).
  expect(messageAnchor({ id: ID_A, ts: 2000, threadId: "aside-2" }, "thread-1")).toBe(
    `${ID_A}@aside-2:2000`,
  );
  expect(messageAnchor({ ts: 1000 }, "thread-1")).toBe("thread-1:1000");
  expect(messageAnchor({ id: ID_A, ts: 2000 })).toBe(ID_A);
});

test("every form parses, and no half is taken for the other", () => {
  expect(parseMessageAnchor(`${ID_A}@thread-1:2000`)).toEqual({
    id: ID_A,
    threadId: "thread-1",
    ts: 2000,
  });
  expect(parseMessageAnchor(ID_A)).toEqual({ id: ID_A });
  expect(parseMessageAnchor("thread-1:1000")).toEqual({ threadId: "thread-1", ts: 1000 });
  // A numeric thread id is real — one on the owner's store is "1786097054089".
  expect(parseMessageAnchor("1786097054089:1787487039182")).toEqual({
    threadId: "1786097054089",
    ts: 1787487039182,
  });
  // A composite whose pair half is unusable still carries the id.
  expect(parseMessageAnchor(`${ID_A}@thread-1:`)).toEqual({ id: ID_A });
  expect(parseMessageAnchor("")).toBeNull();
  expect(parseMessageAnchor("thread-1:")).toBeNull();
  expect(parseMessageAnchor(":1000")).toBeNull();
  expect(parseMessageAnchor("@thread-1:")).toBeNull();
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

test("a composite anchor resolves on its id, not on the pair it also carries", () => {
  // The pair half of this anchor names both messages at ts 2000, and the user
  // turn would win it. The id says plainly it is the reply.
  expect(resolveMessageAnchor(`${ID_B}@thread-1:2000`, MIXED, "thread-1")).toBe(MIXED[3]);
  expect(resolveMessageAnchor(`${ID_A}@thread-1:2000`, MIXED, "thread-1")).toBe(MIXED[2]);
  expect(resolveMessageAnchor(ID_B, MIXED, "thread-1")).toBe(MIXED[3]);
});

// The reason the pair rides along: a thread record is atomic under the records
// merge, so a device that has not run the backfill can win the merge and hand
// the message back without its id.
test("a composite anchor falls back to the pair when the message lost its id", () => {
  const stripped: AnchoredMessage[] = [
    { role: "user", ts: 2000 },
    { role: "ai", ts: 2000 },
  ];
  expect(resolveMessageAnchor(`${ID_B}@thread-1:2000`, stripped, "thread-1")).toBe(stripped[0]);
  // The id alone has nothing to fall back to. This is the case the composite
  // exists to prevent.
  expect(resolveMessageAnchor(ID_B, stripped, "thread-1")).toBeUndefined();
});

// Two devices migrating the same message independently could mint two ids for
// it. The pair was written from the same message at the same moment, so it
// still names the right turn.
test("a composite anchor falls back to the pair when the two ids differ", () => {
  const remigrated: AnchoredMessage[] = [{ id: "t-aaaaaaaaaaaaaaaa", role: "user", ts: 2000 }];
  expect(resolveMessageAnchor(`${ID_A}@thread-1:2000`, remigrated, "thread-1")).toBe(
    remigrated[0],
  );
  expect(anchorNames(`${ID_A}@thread-1:2000`, remigrated[0], "thread-1")).toBe(true);
});

test("an anchor from another thread does not resolve against this one", () => {
  expect(resolveMessageAnchor("other:1000", LEGACY, "thread-1")).toBeUndefined();
  expect(resolveMessageAnchor(`${ID_A}@other:2000`, MIXED, "thread-1")).toBe(MIXED[2]);
  expect(anchorNames("thread-1:1000", LEGACY[0], "thread-1")).toBe(true);
  expect(anchorNames("thread-1:1000", LEGACY[0], "other")).toBe(false);
  expect(anchorNames("t-aaaaaaaaaaaaaaaa", MIXED[2], "thread-1")).toBe(false);
});

// Gaining an id does not take a message out of reach of the anchors already
// written about it: the pair still names where it is stored, and an observation
// from before is not rewritten.
test("a legacy anchor still resolves against a message that has an id", () => {
  expect(resolveMessageAnchor("thread-1:2000", MIXED, "thread-1")).toBe(MIXED[2]);
});

test("a message names itself by the composite and by each half", () => {
  expect(messageAnchorKeys(MIXED[2], "thread-1")).toEqual([
    `${ID_A}@thread-1:2000`,
    ID_A,
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
// written after. Asking with only one form finds only half of them.
test("a turn's observations are found through every stored form", () => {
  const old = obs("m-aaaaaaaa", ["thread-1:2000"]);
  const fresh = obs("m-bbbbbbbb", [`${ID_A}@thread-1:2000`]);
  const index = buildAnchorIndex([old, fresh]);

  expect(observationsForMessage(index, MIXED[2], "thread-1")).toEqual([fresh, old]);
  expect(observationsForMessage(index, "thread-1:2000")).toEqual([old]);
  expect(observationsForMessage(index, `${ID_A}@thread-1:2000`)).toEqual([fresh]);
});

test("an observation citing a turn in two forms is listed once", () => {
  const both = obs("m-cccccccc", ["thread-1:2000", `${ID_A}@thread-1:2000`]);
  const index = buildAnchorIndex([both]);
  expect(observationsForMessage(index, MIXED[2], "thread-1")).toEqual([both]);
});
