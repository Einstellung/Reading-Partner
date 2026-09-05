// src/smoke/relay-verdict.ts: judging the speech probe's live leg by the
// relay's timeline instead of by a player event the leg may never produce. The
// case that made it necessary is the first one below — a run where the vendor
// could not be reached, which the old criterion recorded as three minutes of
// waiting and an empty reason. Run: bun test.

import { expect, test } from "bun:test";
import { judgeRelayLeg, type RelayRow } from "../../src/smoke/relay-verdict";

/// The shape `plugin:voice|speech_live` answers with, cut down to what the
/// verdict reads.
function summary(sentences: number, timeline: RelayRow[]) {
  return { sentences, timeline };
}

/// A sentence that went the whole way: request out, audio back, handed over.
function through(id: number): RelayRow[] {
  return [
    { event: "started", id },
    { event: "firstAudio", id },
    { event: "ready", id },
    { event: "queued", id },
  ];
}

const drained: RelayRow = { event: "drained" };

test("every sentence through the whole path, and the relay drained", () => {
  const relay = summary(3, [...through(0), ...through(1), ...through(2), drained]);
  expect(judgeRelayLeg(relay)).toEqual({ ok: true, error: null });
});

test("a leg the vendor could not be reached for says so, with the cause", () => {
  const why =
    "the voice service could not be reached: error sending request for url (…): " +
    "client error (Connect): dns error";
  const relay = summary(2, [
    { event: "started", id: 0 },
    { event: "failed", id: 0, error: why },
    { event: "started", id: 1 },
    { event: "failed", id: 1, error: why },
    drained,
  ]);
  const verdict = judgeRelayLeg(relay);
  expect(verdict.ok).toBe(false);
  // The count and the first failure whole: twelve failures on a device were one
  // failure twelve times, and only that string said what it was.
  expect(verdict.error).toBe(`2 of 2 sentences failed: ${why}`);
});

test("a failure with nothing written on it is still a failure", () => {
  const relay = summary(1, [{ event: "started", id: 0 }, { event: "failed", id: 0 }, drained]);
  expect(judgeRelayLeg(relay).error).toBe("1 of 1 sentences failed: no reason recorded");
});

test("a sentence that never sent audio back is not a sentence that was spoken", () => {
  const relay = summary(2, [
    ...through(0),
    { event: "started", id: 1 },
    { event: "queued", id: 1 },
    drained,
  ]);
  expect(judgeRelayLeg(relay)).toEqual({
    ok: false,
    error: "1 of 2 sentences ever sent audio back",
  });
});

test("audio the player never took does not count as spoken", () => {
  const relay = summary(2, [
    ...through(0),
    { event: "started", id: 1 },
    { event: "firstAudio", id: 1 },
    { event: "ready", id: 1 },
    drained,
  ]);
  expect(judgeRelayLeg(relay)).toEqual({
    ok: false,
    error: "1 of 2 sentences reached the player",
  });
});

test("a turn the player refused fails even with every sentence through it", () => {
  const relay = summary(1, [...through(0), { event: "abandoned", id: 0 }]);
  expect(judgeRelayLeg(relay).ok).toBe(false);
});

test("a relay that stopped without draining did not finish the turn", () => {
  expect(judgeRelayLeg(summary(1, through(0)))).toEqual({
    ok: false,
    error: "the relay stopped without saying it had drained",
  });
});

test("no record at all is a failure rather than a pass", () => {
  // The leg times out, or the command answers with nothing. Neither may read as
  // a leg that worked.
  for (const nothing of [null, undefined, "", 0]) {
    expect(judgeRelayLeg(nothing)).toEqual({
      ok: false,
      error: "the live leg got no record back from the relay",
    });
  }
  expect(judgeRelayLeg({}).ok).toBe(false);
  expect(judgeRelayLeg(summary(0, [drained])).error).toBe("the live leg was given nothing to say");
});
