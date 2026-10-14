// A voice call's numbered list of handed-off tasks (src/soul/think/calls.ts,
// docs/companion/136 并行、取消、改口; 回来; 落盒). The runner, the box and the
// bell are scripted: what the ledger asked of them is what this file reads.
// Run: scripts/t.sh tests/soul/think-calls.test.ts

import { afterAll, beforeAll, expect, test } from "bun:test";
import type { BoxItem } from "../../src/box";
import type { Run } from "../../src/legion/run";
import type { DelegateInput, Delegated } from "../../src/legion/runner/worker";
import { declareVerbatim, type VerbatimLanding } from "../../src/soul";
import {
  MAX_IN_FLIGHT,
  THINK_KIND,
  buildCallDelegateTool,
  createCallBackend,
  type CallNote,
} from "../../src/soul/think";

const PLACE = { place: "briefing" as const, date: "2026-10-14" };

// think is declared verbatim when it is registered (kind.ts); here, by hand.
let undeclare: () => void = () => {};
beforeAll(() => {
  undeclare = declareVerbatim(THINK_KIND);
});
afterAll(() => undeclare());

function harness(kinds: readonly string[] = [THINK_KIND, "research-literature"]) {
  const delegated: DelegateInput[] = [];
  const cancelled: string[] = [];
  const briefs = new Map<string, string>();
  const told: string[] = [];
  const settles = new Map<string, (run: Run) => void>();
  const runs: Run[] = [];
  let landing: (l: VerbatimLanding) => void = () => {};
  let watcher: () => void = () => {};
  let soon = 0;
  let next = 0;
  const backend = createCallBackend({
    delegate: async (input): Promise<Delegated> => {
      delegated.push(input);
      const run = { id: `r-${++next}`, kind: input.kind, state: "running" } as unknown as Run;
      runs.push(run);
      const done = new Promise<Run>((resolve) => settles.set(run.id, resolve));
      return { ok: true, run, existing: false, done };
    },
    cancelRun: async (id) => {
      cancelled.push(id);
    },
    listRuns: async () => runs,
    watchRuns: (fn) => {
      watcher = fn;
      return () => {};
    },
    writeBrief: async (text) => {
      const path = `legion/briefs/b-${briefs.size + 1}.md`;
      briefs.set(path, text);
      return path;
    },
    readFile: async (path) => {
      if (path === "legion/outputs/r-1.md") {
        return "Three papers. The 1971 one settles it.\n\nSub-agent note: the brief was longer than 1200 tokens and was cut off.";
      }
      throw new Error(`no file ${path}`);
    },
    box: {
      setState: async (id, state) => {
        told.push(`${id}:${state}`);
        return { id, state } as unknown as BoxItem;
      },
    },
    onLanding: (fn) => {
      landing = fn;
      return () => {};
    },
    answerSoon: () => {
      soon += 1;
    },
    kinds: () => kinds,
  });
  return {
    backend,
    delegated,
    cancelled,
    briefs,
    told,
    runs,
    land: (l: VerbatimLanding) => landing(l),
    finish: async (id: string, run: Partial<Run>) => {
      settles.get(id)!({ id, ...run } as Run);
      await new Promise((r) => setTimeout(r, 0));
    },
    progress: () => watcher(),
    soon: () => soon,
  };
}

const dispatch = (h: ReturnType<typeof harness>, task: string, follows?: number) =>
  h.backend.dispatch({ callId: "c1", task, deliverTo: PLACE, ...(follows === undefined ? {} : { follows }) });

test("a task is a think run numbered within its call, delivered to the call's place", async () => {
  const h = harness();
  const first = await dispatch(h, "Why did the yen fall today? Answer in two minutes.");
  const second = await dispatch(h, "What did the Fed say?");
  expect(first).toEqual({ ok: true, n: 1, runId: "r-1" });
  expect(second).toEqual({ ok: true, n: 2, runId: "r-2" });
  expect(h.delegated[0]).toMatchObject({ kind: THINK_KIND, delegator: { kind: "soul" }, deliverTo: JSON.stringify(PLACE) });
  // The brief goes by path, its text as the front wrote it.
  expect(h.briefs.get(h.delegated[0]!.brief)).toBe("Why did the yen fall today? Answer in two minutes.");
  // Another call has a list of its own.
  expect((await h.backend.dispatch({ callId: "c2", task: "x", deliverTo: PLACE }))).toMatchObject({ n: 1 });
  expect(h.backend.tasks("c1").map((t) => [t.n, t.task, t.state])).toEqual([
    [1, "Why did the yen fall today?", "running"],
    [2, "What did the Fed say?", "running"],
  ]);
});

test(`at most ${MAX_IN_FLIGHT} are running on one call; the next is refused until one comes back`, async () => {
  const h = harness();
  for (let i = 0; i < MAX_IN_FLIGHT; i++) expect((await dispatch(h, `q${i}`)).ok).toBe(true);
  const refused = await dispatch(h, "one more");
  expect(refused.ok).toBe(false);
  expect(h.delegated).toHaveLength(MAX_IN_FLIGHT);
  h.land({ status: "done", runId: "r-1", kind: THINK_KIND, text: "Done.", cover: "Done.", boxItemId: "b-1" });
  expect((await dispatch(h, "one more")).ok).toBe(true);
});

test("a kind nothing runs and an empty task are refused before anything starts", async () => {
  const h = harness([THINK_KIND]);
  expect((await h.backend.dispatch({ callId: "c1", task: "x", kind: "nope", deliverTo: PLACE })).ok).toBe(false);
  expect((await dispatch(h, "   ")).ok).toBe(false);
  expect(h.delegated).toHaveLength(0);
});

test("cancel stops the run; the task is cancelled and frees its place", async () => {
  const h = harness();
  await dispatch(h, "q1");
  expect(await h.backend.cancel("c1", 1)).toEqual({ ok: true });
  expect(h.cancelled).toEqual(["r-1"]);
  expect(h.backend.tasks("c1")[0]!.state).toBe("cancelled");
  expect((await h.backend.cancel("c1", 1)).ok).toBe(false);
  expect((await h.backend.cancel("c1", 9)).ok).toBe(false);
});

test("a change of mind replaces a running task: the old one is cancelled, the new one follows it", async () => {
  const h = harness();
  for (let i = 0; i < MAX_IN_FLIGHT; i++) await dispatch(h, `q${i}`);
  // Full, and still the replacement is taken: it does not add to what is running.
  const again = await dispatch(h, "Not the yen, the euro.", 2);
  expect(again).toEqual({ ok: true, n: 4, runId: "r-4", replaced: 2 });
  expect(h.cancelled).toEqual(["r-2"]);
  expect(h.backend.tasks("c1").map((t) => t.state)).toEqual(["running", "cancelled", "running", "running"]);
  expect(h.backend.tasks("c1")[3]!.follows).toBe(2);
  // The new brief is written in full, not "as above".
  expect(h.briefs.get(h.delegated[3]!.brief)).toBe("Not the yen, the euro.");
});

test("following a task that came back attaches its brief and what came back", async () => {
  const h = harness();
  await dispatch(h, "Why did the yen fall?");
  h.land({ status: "done", runId: "r-1", kind: THINK_KIND, text: "Rates. The gap widened.", cover: "Rates.", boxItemId: "b-1" });
  await dispatch(h, "And what does that mean for exporters?", 1);
  const brief = h.briefs.get(h.delegated[1]!.brief)!;
  expect(brief.startsWith("And what does that mean for exporters?")).toBe(true);
  expect(brief).toContain("Why did the yen fall?");
  expect(brief).toContain("Rates. The gap widened.");
  expect(h.cancelled).toEqual([]);
  expect((await dispatch(h, "x", 7)).ok).toBe(false);
});

test("a landing settles the task, tells the call once, and hands back the same text", async () => {
  const h = harness();
  const notes: CallNote[] = [];
  h.backend.subscribe("c1", (note) => notes.push(note));
  await dispatch(h, "Why did the yen fall?");
  await dispatch(h, "Who said it?");
  // A think run finishing asks for its bell now rather than at the next tick.
  await h.finish("r-1", { state: "done", output: "legion/outputs/r-1.md" });
  expect(h.soon()).toBe(1);
  expect(h.backend.tasks("c1")[0]!.state).toBe("running");
  const text = "Rates. The gap between the two widened.";
  h.land({ status: "done", runId: "r-1", kind: THINK_KIND, text, cover: "Rates.", boxItemId: "b-1" });
  h.land({ status: "failed", runId: "r-2", kind: THINK_KIND, reason: "no model is configured", boxItemId: "b-2" });
  // A run no call of this ledger sent is not its business.
  h.land({ status: "done", runId: "r-elsewhere", kind: THINK_KIND, text: "x", cover: "x", boxItemId: "b-9" });
  expect(notes).toEqual([
    { callId: "c1", n: 1, task: "Why did the yen fall?", status: "done", cover: "Rates." },
    { callId: "c1", n: 2, task: "Who said it?", status: "failed", reason: "no model is configured" },
  ]);
  expect(await h.backend.text("c1", 1)).toBe(text);
  expect(await h.backend.text("c1", 2)).toBeNull();
  expect(h.backend.tasks("c1")[0]).toMatchObject({ state: "done", cover: "Rates.", boxItemId: "b-1", told: false });
  // Landing twice is told once.
  h.land({ status: "done", runId: "r-1", kind: THINK_KIND, text, cover: "Rates.", boxItemId: "b-1" });
  expect(notes).toHaveLength(2);
});

test("told marks the box item told; nothing to mark until it came back", async () => {
  const h = harness();
  await dispatch(h, "q");
  expect(await h.backend.told("c1", 1)).toBe(false);
  h.land({ status: "done", runId: "r-1", kind: THINK_KIND, text: "A.", cover: "A.", boxItemId: "b-1" });
  expect(await h.backend.told("c1", 1)).toBe(true);
  expect(h.told).toEqual(["b-1:told"]);
  expect(h.backend.tasks("c1")[0]!.told).toBe(true);
});

test("a cancelled task is never told, even if a landing arrives", async () => {
  const h = harness();
  const notes: CallNote[] = [];
  h.backend.subscribe("c1", (note) => notes.push(note));
  await dispatch(h, "q");
  await h.backend.cancel("c1", 1);
  h.land({ status: "done", runId: "r-1", kind: THINK_KIND, text: "A.", cover: "A.", boxItemId: "b-1" });
  expect(notes).toEqual([]);
});

test("a kind answered with a turn settles when its run ends, its output read off the run without the runner's note", async () => {
  const h = harness();
  const notes: CallNote[] = [];
  h.backend.subscribe("c1", (note) => notes.push(note));
  await h.backend.dispatch({ callId: "c1", task: "Find the 1971 paper.", kind: "research-literature", deliverTo: PLACE });
  await h.finish("r-1", { state: "done", output: "legion/outputs/r-1.md" });
  expect(h.soon()).toBe(0);
  expect(notes).toEqual([{ callId: "c1", n: 1, task: "Find the 1971 paper.", status: "done", cover: "Three papers." }]);
  expect(await h.backend.text("c1", 1)).toBe("Three papers. The 1971 one settles it.");
});

test("the progress line follows the runner", async () => {
  const h = harness();
  await dispatch(h, "q");
  (h.runs[0] as { progress?: string }).progress = "web_search (round 2)";
  h.progress();
  await new Promise((r) => setTimeout(r, 0));
  expect(h.backend.tasks("c1")[0]!.progress).toBe("web_search (round 2)");
});

test("the call's delegate tool numbers through the ledger and throws a refusal", async () => {
  const h = harness();
  const tool = buildCallDelegateTool({ callId: "c1", deliverTo: PLACE, backend: h.backend, kinds: () => [THINK_KIND] });
  expect(tool.name).toBe("delegate");
  const result = await tool.execute({ kind: "think", task: "Why did the yen fall?" });
  expect(typeof result === "string" ? result : result.text).toContain("task 1");
  await tool.execute({ kind: "", task: "Why the euro?", follows: 1 });
  expect(h.delegated[1]!.kind).toBe(THINK_KIND);
  expect(h.cancelled).toEqual(["r-1"]);
  await expect(tool.execute({ kind: "think", task: "x", follows: 9 })).rejects.toThrow("no task 9");
});
