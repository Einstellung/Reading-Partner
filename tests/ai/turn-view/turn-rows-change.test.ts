// What a running turn does to its row (applyRowChange, src/ai/turn-view/turn-rows.ts),
// on the chat surfaces' own row type. The reading call runs the same reducer
// over its CallRow (tests/reading/call-state.test.ts); these are the cases
// useStreamingTurn leans on — the coach, the retell, the lesson and the info
// companion. Pure. Run: bun test.

import { expect, test } from "bun:test";
import { applyRowChange, type RowChange } from "../../../src/ai/turn-view/turn-rows";
import type { ThreadMessage } from "../../../src/ui/components/chat/types";

const ai = (ts: number, text = "", extra: Partial<ThreadMessage> = {}): ThreadMessage => ({
  role: "ai",
  text,
  ts,
  ...extra,
});

const START: RowChange = { kind: "tool-start", name: "read_talk_outline", label: "Reading the talk outline" };

function run(row: ThreadMessage, changes: RowChange[]): ThreadMessage {
  return changes.reduce(applyRowChange, row);
}

test("a delta appends to the text already streamed", () => {
  expect(applyRowChange(ai(1, "he"), { kind: "delta", chunk: "llo" }).text).toBe("hello");
});

test("the phase follows the turn: thinking, then the tool, then the reply", () => {
  const thinking = applyRowChange(ai(1), { kind: "phase", phase: "thinking" });
  expect(thinking.phase).toBe("thinking");
  const calling = applyRowChange(thinking, START);
  expect(calling.phase).toBe("tool");
  expect(applyRowChange(calling, { kind: "delta", chunk: "so" }).phase).toBe("writing");
});

test("a quiet tool leaves the phase where it was and is kept on the trace", () => {
  const thinking = applyRowChange(ai(1), { kind: "phase", phase: "thinking" });
  const quiet = applyRowChange(thinking, { kind: "tool-start", name: "note", label: "Noting", quiet: true });
  expect(quiet.phase).toBe("thinking");
  expect(quiet.tools).toEqual([{ name: "note", label: "Noting", state: "running", quiet: true }]);
});

test("a tool start keeps what the round wrote and puts the tool on the trace as running", () => {
  const next = applyRowChange(ai(1, "let me look"), START);
  expect(next.text).toBe("let me look\n\n");
  expect(next.tools).toEqual([
    { name: "read_talk_outline", label: "Reading the talk outline", state: "running" },
  ]);
  expect(applyRowChange(ai(1), START).text).toBe("");
});

test("a tool end settles the call in place and marks a failed one", () => {
  const started = applyRowChange(ai(1), START);
  expect(
    applyRowChange(started, { kind: "tool-end", name: "read_talk_outline", isError: false }).tools,
  ).toEqual([{ name: "read_talk_outline", label: "Reading the talk outline", state: "done" }]);
  expect(
    applyRowChange(started, {
      kind: "tool-end",
      name: "read_talk_outline",
      isError: true,
      error: "no outline",
    }).tools,
  ).toEqual([
    { name: "read_talk_outline", label: "Reading the talk outline", state: "error", error: "no outline" },
  ]);
});

test("a change nothing matches hands the row back untouched", () => {
  const row = ai(1, "text");
  expect(applyRowChange(row, { kind: "tool-end", name: "absent", isError: false })).toBe(row);
  expect(applyRowChange(row, { kind: "tool-label", name: "absent", label: "x" })).toBe(row);
});

test("the answer keeps the whole trace, carries the notice and ends the streaming", () => {
  const row = run(ai(1, "", { streaming: true }), [
    { kind: "delta", chunk: "partial" },
    START,
    { kind: "tool-end", name: "read_talk_outline", isError: true, error: "gone" },
  ]);
  const answered = applyRowChange(row, { kind: "answer", text: "the whole answer", notice: "left out chapter 3" });
  expect(answered).toEqual({
    role: "ai",
    text: "the whole answer",
    ts: 1,
    notice: "left out chapter 3",
    tools: [{ name: "read_talk_outline", label: "Reading the talk outline", state: "error", error: "gone" }],
  });
  expect(answered.streaming).toBeUndefined();
  expect(answered.phase).toBeUndefined();
});

test("an error stands in for the reply and drops the trace", () => {
  const row = run(ai(1, "", { streaming: true }), [START, { kind: "delta", chunk: "half" }]);
  expect(applyRowChange(row, { kind: "error", text: "could not be reached" })).toEqual({
    role: "ai",
    text: "could not be reached",
    ts: 1,
    failed: true,
  });
});

test("a refusal goes in the notice, keeps the words and the trace", () => {
  const row = run(ai(1, "", { streaming: true }), [{ kind: "delta", chunk: "so far" }, START]);
  const declined = applyRowChange(row, { kind: "refusal", text: "too big" });
  expect(declined.text).toBe("so far\n\n");
  expect(declined.notice).toBe("too big");
  expect(declined.failed).toBe(false);
  expect(declined.streaming).toBe(false);
  expect(declined.tools?.map((t) => t.name)).toEqual(["read_talk_outline"]);
});

test("a stop keeps the half sentence as a finished row with no trace", () => {
  const row = run(ai(1, "", { streaming: true }), [START, { kind: "delta", chunk: "half a sen" }]);
  expect(applyRowChange(row, { kind: "stopped", text: "half a sen" })).toEqual({
    role: "ai",
    text: "half a sen",
    ts: 1,
  });
});

test("every way a turn ends clears the phase", () => {
  const endings: RowChange[] = [
    { kind: "answer", text: "done" },
    { kind: "error", text: "no reply" },
    { kind: "refusal", text: "too big" },
    { kind: "stopped", text: "half a sen" },
  ];
  const row = applyRowChange(ai(1, "", { streaming: true }), { kind: "phase", phase: "thinking" });
  expect(endings.map((e) => applyRowChange(row, e).phase)).toEqual(endings.map(() => undefined));
});
