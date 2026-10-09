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
import type { SteerPort } from "../../../../src/legion/execute/contract";
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


const READ = { name: "read_chapter", label: "Reading chapter 2", state: "done" as const };

// Stop keeps what was on screen, round break included, and the calls that
// settled; a word the stream lands after the abort does not reopen the row.
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
    ["Let me look.\n\nIt says", undefined, undefined, [READ]],
  ]);
  expect(kept()).toEqual([
    { role: "ai", text: "Let me look.\n\nIt says", ts: runs[0].ts, parts: [{ type: "trace", tools: [READ] }] },
  ]);
  expect(hook.result.current.streaming).toBe(false);
});

// A write that landed before the stop is part of what the turn did, whether or
// not a word followed it. The call still running when the reader stopped never
// reports back, so it goes, on screen and on disk alike.
test("Stop keeps a row that holds only a receipt, and stores its trace", async () => {
  const receipt = { label: "Updated your profile", summary: "Prefers short answers" };
  const { hook, runs, begin, aiRows, kept } = mount();
  await begin();
  const h = runs[0].handlers();
  await act(() => {
    h.onToolStart?.({ name: "profile_update", args: {}, label: "Updating your profile" });
    h.onToolEnd?.({ name: "profile_update", isError: false, receipt });
    h.onToolStart?.({ name: "read_chapter", args: {}, label: "Reading chapter 2" });
  });
  await act(() => hook.result.current.stop());

  const settled = { name: "profile_update", label: "Updating your profile", state: "done" as const, receipt };
  expect(aiRows().map((m) => [m.text, m.streaming, m.tools])).toEqual([["", undefined, [settled]]]);
  expect(kept()).toEqual([{ role: "ai", text: "", ts: runs[0].ts, parts: [{ type: "trace", tools: [settled] }] }]);
});

test("Stop on a row that produced nothing still drops it", async () => {
  const { hook, runs, begin, aiRows, kept } = mount();
  await begin();
  await act(() => runs[0].handlers().onToolStart?.({ name: "read_chapter", args: {}, label: "Reading chapter 2" }));
  await act(() => hook.result.current.stop());

  expect(aiRows()).toEqual([]);
  expect(kept()).toEqual([]);
});

// --- the reader talking into the turn (docs/72) ----------------------------

const tick = () => act(async () => void (await new Promise((resolve) => setTimeout(resolve, 0))));

// The port the harness hands a turn once it has a run to queue into. It records
// what it was asked to queue; the test says when the model was handed it.
function steerable(run: StreamingTurnRun) {
  const queued: string[] = [];
  const port: SteerPort = async (message) => {
    queued.push(typeof message === "string" ? message : message.text);
    return { ok: true, id: `e${queued.length}` };
  };
  return {
    queued,
    open: () => act(() => run.handlers().onSteerable?.(port)),
    inject: (index: number) => act(() => run.handlers().onSteered?.([`e${index + 1}`])),
  };
}

// Everything the hook put in the thread file, in order.
const stored = () =>
  (append.mock.calls as [string, string, threads.ThreadMessage][]).map((c) => [c[2].role, c[2].text]);

const shown = (hook: ReturnType<typeof mount>["hook"]) =>
  hook.result.current.messages.map((m) => [m.role, m.text, m.streaming ?? m.queued]);

async function steered(line: string) {
  const rig = mount();
  await rig.begin();
  const port = steerable(rig.runs[0]);
  await port.open();
  await act(() => rig.runs[0].handlers().onDelta?.("Because"));
  let took = false;
  await act(() => {
    took = rig.hook.result.current.steer(line);
  });
  await tick();
  expect(took).toBe(true);
  return { ...rig, port };
}

test("a line said mid-turn is queued into it, drawn under the reply, and not stored yet", async () => {
  const { hook, runs, port } = await steered("and the other one?");

  expect(runs).toHaveLength(1);
  expect(runs[0].signal.aborted).toBe(false);
  expect(port.queued).toEqual(["and the other one?"]);
  expect(shown(hook)).toEqual([
    ["ai", "Because", true],
    ["user", "and the other one?", true],
  ]);
  expect(stored()).toEqual([]);
});

test("no turn running: steer declines and the caller sends it as a turn", () => {
  const { hook } = mount();
  expect(hook.result.current.steer("hello")).toBe(false);
  expect(hook.result.current.messages).toEqual([]);
});

test("handed the line, the file reads ai / user / ai and the reply gets a row of its own", async () => {
  const { hook, runs, port } = await steered("and the other one?");
  await port.inject(0);

  expect(stored()).toEqual([
    ["ai", "Because"],
    ["user", "and the other one?"],
  ]);
  expect(shown(hook)[1]).toEqual(["user", "and the other one?", undefined]);

  await act(() => {
    const h = runs[0].handlers();
    h.onDelta?.("The other one is older.");
    h.onDone?.("x", undefined as never, "Because\n\nThe other one is older.");
  });
  expect(shown(hook)).toEqual([
    ["ai", "Because", undefined],
    ["user", "and the other one?", undefined],
    ["ai", "The other one is older.", undefined],
  ]);
  expect(stored()).toEqual([
    ["ai", "Because"],
    ["user", "and the other one?"],
    ["ai", "The other one is older."],
  ]);
  expect(runs).toHaveLength(1);
});

test("Stop with a line the model never took keeps the line and opens the next turn on it", async () => {
  const { hook, runs } = await steered("wait, also this");
  await act(() => hook.result.current.stop());

  expect(stored()).toEqual([
    ["ai", "Because"],
    ["user", "wait, also this"],
  ]);
  expect(runs).toHaveLength(2);
  expect(shown(hook)).toEqual([
    ["ai", "Because", undefined],
    ["user", "wait, also this", undefined],
    ["ai", "", true],
  ]);
  // The next turn is asked with the conversation as it now stands.
  expect(hook.result.current.rows().map((m) => m.text)).toEqual(["Because", "wait, also this", ""]);
  expect(hook.result.current.streaming).toBe(true);
});

test("Stop after the line was handed over, before a word followed, stores nothing twice", async () => {
  const { hook, runs, port } = await steered("and the other one?");
  await port.inject(0);
  await act(() => hook.result.current.stop());

  expect(stored()).toEqual([
    ["ai", "Because"],
    ["user", "and the other one?"],
  ]);
  expect(shown(hook)).toEqual([
    ["ai", "Because", undefined],
    ["user", "and the other one?", undefined],
  ]);
  expect(runs).toHaveLength(1);
});

test("a turn that answers before the queue drains opens the next turn on the line", async () => {
  const { hook, runs } = await steered("one more thing");
  await act(() => runs[0].handlers().onDone?.("Because.", undefined as never, "Because."));

  expect(stored()).toEqual([
    ["ai", "Because."],
    ["user", "one more thing"],
  ]);
  expect(runs).toHaveLength(2);
  expect(hook.result.current.streaming).toBe(true);
});

test("a turn that fails puts the line back and opens nothing on it", async () => {
  const { hook, runs, begin } = mount();
  await begin();
  // Said before the turn had a run to queue into: it waits, and never goes.
  await act(() => void hook.result.current.steer("are you there?"));
  await act(() => runs[0].handlers().onError?.("401 unauthorized", undefined, new Error("401")));

  expect(stored()).toEqual([["user", "are you there?"]]);
  expect(runs).toHaveLength(1);
  expect(shown(hook)[1]).toEqual(["user", "are you there?", undefined]);
});

test("a stalled turn is asked again with the line said into it already in the conversation", async () => {
  const { hook, runs } = await steered("and the other one?");
  await stall(runs[0]);

  expect(runs).toHaveLength(2);
  expect(stored()).toEqual([["user", "and the other one?"]]);
  expect(shown(hook)).toEqual([
    ["user", "and the other one?", undefined],
    ["ai", "", true],
  ]);
});

test("leaving the view still stores what the reader said into the turn", async () => {
  const { hook, runs } = await steered("never mind");
  await act(() => hook.result.current.abort());

  expect(stored()).toEqual([["user", "never mind"]]);
  expect(runs).toHaveLength(1);
});
