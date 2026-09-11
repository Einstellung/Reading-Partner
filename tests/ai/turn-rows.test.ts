// What the `failed` mark decides once a turn has stopped (src/ai/turn-rows.ts).
// Two readers hang off it — what goes back to the model next turn, and which row
// a fresh attempt replaces — and a refusal is not a failure, so refusalRow clears
// the mark rather than leaving whatever was there. These tests are about that
// consequence, not the drawing; the rendering is in budget-notice.test.tsx.
// Run: bun test.

import { expect, test } from "bun:test";
import { REFUSE_MIDTURN, REFUSE_ROUNDS } from "../../src/ai/agent";
import {
  appendRoundBreak,
  holdsNoAnswer,
  joinRoundTexts,
  refusalRow,
  replayableHistory,
} from "../../src/ai/turn-rows";
import type { ThreadMessage } from "../../src/ui/components/chat/types";

const WORDS = "The passage argues that the retina is not a camera";

// The refusal exits fire mid-turn, so the row they land on is the one being
// streamed into: whatever the model had written by then is on it.
function streamedThisFar(text: string): ThreadMessage {
  return { role: "ai", text, ts: 2, streaming: true };
}

test("what the model wrote before the stop goes back to it next turn", () => {
  const row = streamedThisFar(WORDS);
  const stopped: ThreadMessage = { ...row, ...refusalRow(row, REFUSE_MIDTURN) };

  const history = replayableHistory([
    { role: "user", text: "what does chapter two claim", ts: 1 },
    stopped,
    { role: "user", text: "go on", ts: 3 },
  ]);

  expect(history).toEqual([
    { role: "user", text: "what does chapter two claim" },
    { role: "ai", text: WORDS },
    { role: "user", text: "go on" },
  ]);
});

// The other half of the same rule: the app's sentence about the turn is in
// `notice`, and nothing carries it into `text`, so the model never meets it.
test("the sentence the app wrote about the stop does not go back", () => {
  const row = streamedThisFar(WORDS);
  const stopped: ThreadMessage = { ...row, ...refusalRow(row, REFUSE_MIDTURN) };

  expect(stopped.notice).toBe(REFUSE_MIDTURN);
  const history = replayableHistory([stopped]);
  expect(history.some((m) => m.text.includes(REFUSE_MIDTURN))).toBe(false);
});

// The state refusalRow now refuses to produce, built by hand to prove it is
// gone: a row that arrives already marked leaves unmarked, so the words on it
// are replayed instead of being dropped by a mark that was never about them.
test("a refusal over a row already marked failed still replays the model's words", () => {
  const marked: ThreadMessage = { role: "ai", text: WORDS, ts: 2, failed: true };
  const stopped: ThreadMessage = { ...marked, ...refusalRow(marked, REFUSE_ROUNDS) };

  expect(stopped.failed).toBe(false);
  expect(replayableHistory([stopped])).toEqual([{ role: "ai", text: WORDS }]);
});

// A turn that could not reach the model is the other ending, and it is untouched
// by any of this: its words are the app's, parked in `text` because no reply
// came, and `failed` is the only thing that keeps them out of the next request.
test("a turn that could not reach the model is still kept out of the replay", () => {
  const history = replayableHistory([
    { role: "user", text: "what does chapter two claim", ts: 1 },
    { role: "ai", text: "Couldn't reach the model. fetch failed", ts: 2, failed: true },
  ]);

  expect(history).toEqual([{ role: "user", text: "what does chapter two claim" }]);
});

// A fresh attempt replaces the rows that hold no answer and sits under the rest.
// A refusal with the model's words on it is an answer, however short.
test("a fresh attempt sits under a refusal that got words out", () => {
  const row = streamedThisFar(WORDS);
  const stopped: ThreadMessage = { ...row, ...refusalRow(row, REFUSE_MIDTURN) };

  expect(holdsNoAnswer(stopped)).toBe(false);
});

test("a fresh attempt replaces a refusal that got nothing out", () => {
  const row = streamedThisFar("");
  const stopped: ThreadMessage = { ...row, ...refusalRow(row, REFUSE_ROUNDS) };

  expect(stopped.text).toBe("");
  expect(stopped.notice).toBe(REFUSE_ROUNDS);
  expect(holdsNoAnswer(stopped)).toBe(true);
});

// Same two rows, arriving already marked. Which one a fresh attempt replaces is
// decided by whether the model got words out, not by a mark the refusal path no
// longer leaves behind.
test("an inherited failed mark does not decide what a fresh attempt replaces", () => {
  const withWords: ThreadMessage = { role: "ai", text: WORDS, ts: 2, failed: true };
  const empty: ThreadMessage = { role: "ai", text: "", ts: 2, failed: true };

  expect(holdsNoAnswer({ ...withWords, ...refusalRow(withWords, REFUSE_ROUNDS) })).toBe(false);
  expect(holdsNoAnswer({ ...empty, ...refusalRow(empty, REFUSE_ROUNDS) })).toBe(true);
});

// And the failure ending still is replaced, mark and all: nothing came back.
test("a turn that could not reach the model is still replaced", () => {
  expect(holdsNoAnswer({ role: "ai", text: "Couldn't reach the model.", failed: true })).toBe(
    true,
  );
});

// --- the gap between a turn's rounds (docs/pitfall/291) ---------------------

test("the break is opened once, and never on a row with nothing written", () => {
  expect(appendRoundBreak("")).toBe("");
  expect(appendRoundBreak("   \n")).toBe("");
  expect(appendRoundBreak("first")).toBe("first\n\n");
  expect(appendRoundBreak("first\n\n")).toBe("first\n\n");
  expect(appendRoundBreak("first\n")).toBe("first\n\n");
});

test("a turn's text is every round that wrote something, a blank line apart", () => {
  expect(joinRoundTexts(["let me look", "the answer"])).toBe("let me look\n\nthe answer");
  expect(joinRoundTexts(["", "the answer"])).toBe("the answer");
  expect(joinRoundTexts(["let me look", "", "the answer"])).toBe("let me look\n\nthe answer");
  expect(joinRoundTexts([])).toBe("");
});

// The streamed row and the saved text are built by different code (the reducer
// appends the break as the tool starts, the loop joins the rounds at the end),
// so they are checked against each other: a mismatch would redraw the reply the
// moment the turn landed.
test("joining the rounds gives what the streamed row already holds", () => {
  const rounds = ["Let me check p. 4.", "", "The page argues otherwise."];
  let row = "";
  for (const text of rounds) {
    row += text;
    row = appendRoundBreak(row);
  }
  expect(joinRoundTexts(rounds)).toBe(row.replace(/\n+$/, ""));
});
