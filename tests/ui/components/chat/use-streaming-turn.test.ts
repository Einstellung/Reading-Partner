// The streaming-turn hook every chat surface but the reading call runs its turns
// through (src/ui/components/chat/useStreamingTurn.ts): the coach, the retell,
// the phone lesson and the info companion. What is pinned here is what they now
// share — a turn whose stream went silent is asked again once, the settled tool
// trace goes to disk with the reply, and Stop is final.
//
// The turn is driven by hand through the callbacks the hook gives runAgentTurn.
// The stall arrives the way runHarnessTurn reports one (legion/execute/turn.ts):
// onError with a StallError as the thrown value. Run: bun test.

import { afterEach, expect, spyOn, test } from "bun:test";
import { useDom } from "../../../support/dom";

const { act, cleanup, renderHook } = await useDom();

import * as threads from "../../../../src/platform/app/threads";
import { STALL_MESSAGE, StallError } from "../../../../src/legion/execute/stall";
import {
  useStreamingTurn,
  type StreamingTurnRun,
} from "../../../../src/ui/components/chat/useStreamingTurn";

let append: ReturnType<typeof spyOn>;
afterEach(() => {
  cleanup();
  append?.mockRestore();
});

function mount(onSettled?: () => void) {
  append = spyOn(threads, "appendMessage").mockReturnValue(undefined);
  const hook = renderHook(() => useStreamingTurn("book", "thread", onSettled));
  const runs: StreamingTurnRun[] = [];
  const begin = () =>
    act(() => {
      hook.result.current.begin((run) => {
        runs.push(run);
      });
    });
  const aiRows = () => hook.result.current.messages.filter((m) => m.role === "ai");
  const kept = () =>
    (append.mock.calls as [string, string, threads.ThreadMessage][])
      .map((c) => c[2])
      .filter((m) => m.role === "ai");
  return { hook, runs, begin, aiRows, kept };
}

const stall = (run: StreamingTurnRun) =>
  act(() => run.handlers().onError?.(STALL_MESSAGE, undefined, new StallError()));

test("a stalled turn is asked again once, in a fresh row, and the reply lands", async () => {
  let settled = 0;
  const { hook, runs, begin, aiRows, kept } = mount(() => settled++);
  await begin();
  await act(() => runs[0].handlers().onDelta?.("Half an ans"));
  await stall(runs[0]);

  // Asked again: the half-written row went and a fresh one is streaming.
  expect(runs).toHaveLength(2);
  expect(aiRows()).toEqual([expect.objectContaining({ text: "", streaming: true })]);
  expect(hook.result.current.streaming).toBe(true);
  expect(hook.result.current.running()).toBe(true);
  // The turn is not over, so nothing waiting on it has run.
  expect(settled).toBe(0);

  await act(() => {
    const h = runs[1].handlers();
    h.onDelta?.("The whole answer.");
    h.onDone?.("The whole answer.", undefined as never, "The whole answer.");
  });
  expect(aiRows().map((m) => [m.text, m.failed, m.streaming])).toEqual([
    ["The whole answer.", undefined, undefined],
  ]);
  expect(kept().map((m) => m.text)).toEqual(["The whole answer."]);
  expect(hook.result.current.streaming).toBe(false);
  expect(settled).toBe(1);
});

test("a second stall is shown as a failure, not asked a third time", async () => {
  let settled = 0;
  const { hook, runs, begin, aiRows, kept } = mount(() => settled++);
  await begin();
  await stall(runs[0]);
  await stall(runs[1]);

  expect(runs).toHaveLength(2);
  const [row] = aiRows();
  expect(row.failed).toBe(true);
  expect(row.text).toContain(STALL_MESSAGE);
  expect(hook.result.current.streaming).toBe(false);
  expect(kept()).toEqual([]);
  expect(settled).toBe(1);
});

test("an error that is not a stall is not asked again", async () => {
  const { runs, begin, aiRows } = mount();
  await begin();
  await act(() => runs[0].handlers().onError?.("401 unauthorized", undefined, new Error("401")));

  expect(runs).toHaveLength(1);
  expect(aiRows()[0].failed).toBe(true);
});

test("a turn the reader stopped is not asked again when its stream is cut", async () => {
  const { hook, runs, begin, aiRows, kept } = mount();
  await begin();
  await act(() => runs[0].handlers().onDelta?.("Half"));
  await act(() => hook.result.current.stop());
  await stall(runs[0]);

  expect(runs).toHaveLength(1);
  expect(aiRows().map((m) => [m.text, m.failed])).toEqual([["Half", undefined]]);
  expect(kept().map((m) => m.text)).toEqual(["Half"]);
});

test("the settled trace is stored with the reply", async () => {
  const { runs, begin, kept } = mount();
  await begin();
  await act(() => {
    const h = runs[0].handlers();
    h.onToolStart?.({ name: "read_chapter", args: {}, label: "Reading chapter 2" });
    h.onToolEnd?.({ name: "read_chapter", isError: false });
    h.onDone?.("Chapter 2 says so.", undefined as never, "Chapter 2 says so.");
  });

  expect(kept()).toEqual([
    {
      role: "ai",
      text: "Chapter 2 says so.",
      ts: runs[0].ts,
      parts: [{ type: "trace", tools: [{ name: "read_chapter", label: "Reading chapter 2", state: "done" }] }],
    },
  ]);
});

test("a reply that called no tool is stored with no trace", async () => {
  const { runs, begin, kept } = mount();
  await begin();
  await act(() => runs[0].handlers().onDone?.("Plain.", undefined as never, "Plain."));
  expect(kept()).toEqual([{ role: "ai", text: "Plain.", ts: runs[0].ts }]);
});

// Stop keeps what was on screen, round break included, and a word the stream
// lands after the abort does not reopen the row.
test("Stop keeps the row as the reader saw it and ignores what arrives after", async () => {
  const { hook, runs, begin, aiRows, kept } = mount();
  await begin();
  const h = runs[0].handlers();
  await act(() => {
    h.onDelta?.("Let me look.");
    h.onToolStart?.({ name: "read_chapter", args: {}, label: "Reading chapter 2" });
    h.onToolEnd?.({ name: "read_chapter", isError: false });
    h.onDelta?.("It says");
  });
  await act(() => hook.result.current.stop());
  await act(() => h.onDelta?.(" a late word"));

  expect(aiRows().map((m) => [m.text, m.streaming, m.phase, m.tools])).toEqual([
    ["Let me look.\n\nIt says", undefined, undefined, undefined],
  ]);
  expect(kept().map((m) => m.text)).toEqual(["Let me look.\n\nIt says"]);
  expect(hook.result.current.streaming).toBe(false);
});
