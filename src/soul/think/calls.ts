// The back half of a voice call (docs/companion/136): every call's numbered
// list of handed-off tasks, and the CallBackend the front talks to
// (contract.ts says what each method promises).
//
// A task is a run the call delegated. Its state here follows the run: a
// verbatim kind (think) is `done` once its output is in the conversation and
// the box (soul/bell.ts announces the landing), any other kind once its run
// finishes. Cancelling is the runner's; a cancelled run rings no bell, so it
// never reaches the conversation or the box.

import type { BoxStore } from "../../box";
import type { Run } from "../../legion/run";
import type { DelegateInput, Delegated } from "../../legion/runner/worker";
import { withoutBriefNote } from "../../legion/subagent";
import { firstSentence } from "../../platform/std/text";
import { coverOf } from "../bell";
import { isVerbatim, type VerbatimLanding } from "../delivery";
import {
  MAX_IN_FLIGHT,
  THINK_KIND,
  type CallBackend,
  type CallNote,
  type CallTask,
  type Cancelled,
  type DispatchInput,
  type Dispatched,
} from "./contract";

export interface CallBackendDeps {
  /** Start a run. The device's runner. */
  delegate(input: DelegateInput): Promise<Delegated>;
  /** Ask a run to stop. */
  cancelRun(runId: string): Promise<unknown>;
  /** The runs this device knows of, for their progress lines. */
  listRuns(): Promise<Run[]>;
  /** Hear every write the runner makes. Returns the undo. */
  watchRuns(fn: () => void): () => void;
  /** Write a brief where the run can point at it; answers the path. */
  writeBrief(text: string): Promise<string>;
  /** Read a file a run pointed at. */
  readFile(path: string): Promise<string>;
  box: Pick<BoxStore, "setState">;
  /** Hear verbatim runs land. Returns the undo. */
  onLanding(fn: (landing: VerbatimLanding) => void): () => void;
  /** A run of this process just finished: answer its bell now rather than at the next tick. */
  answerSoon(): void;
  /** The kinds a call may hand work to. */
  kinds(): readonly string[];
}

interface Task extends CallTask {
  callId: string;
  /** The brief as the front wrote it, for a later `follows`. */
  brief: string;
  /** What came back, once it did. */
  text?: string;
}

/** Build a call ledger over the given runner, box and bell. */
export function createCallBackend(deps: CallBackendDeps): CallBackend {
  const calls = new Map<string, Task[]>();
  const byRun = new Map<string, Task>();
  const listeners = new Map<string, Set<(note: CallNote) => void>>();
  let watching: (() => void) | null = null;
  // A task whose replacement is being started: a landing in that window waits
  // for the outcome, so a task the reader changed their mind about is not told.
  const pending = new Map<Task, (() => void) | null>();

  function tell(note: CallNote): void {
    for (const fn of [...(listeners.get(note.callId) ?? [])]) {
      try {
        fn(note);
      } catch (e) {
        console.warn("a call note listener threw", e);
      }
    }
  }

  function settleDone(task: Task, text: string, boxItemId?: string): void {
    if (task.state !== "running") return;
    if (pending.has(task)) return void pending.set(task, () => settleDone(task, text, boxItemId));
    task.state = "done";
    task.text = text;
    task.cover = coverOf(text);
    if (boxItemId) task.boxItemId = boxItemId;
    tell({ callId: task.callId, n: task.n, task: task.task, status: "done", cover: task.cover });
  }

  function settleFailed(task: Task, reason: string, boxItemId?: string): void {
    if (task.state !== "running") return;
    if (pending.has(task)) return void pending.set(task, () => settleFailed(task, reason, boxItemId));
    task.state = "failed";
    task.reason = reason;
    if (boxItemId) task.boxItemId = boxItemId;
    tell({ callId: task.callId, n: task.n, task: task.task, status: "failed", reason });
  }

  deps.onLanding((landing) => {
    const task = byRun.get(landing.runId);
    if (!task) return;
    if (landing.status === "done") settleDone(task, landing.text, landing.boxItemId);
    else settleFailed(task, landing.reason, landing.boxItemId);
  });

  // A kind answered with a turn has no landing to wait for: the run's own end is the news.
  async function finished(task: Task, run: Run): Promise<void> {
    if (run.state === "done") {
      const text = run.output ? await deps.readFile(run.output).catch(() => null) : null;
      settleDone(task, withoutBriefNote((text ?? "").trim()));
    } else if (run.state === "failed") {
      settleFailed(task, run.progress ?? "the run failed");
    }
  }

  async function refreshProgress(): Promise<void> {
    const running = [...byRun.values()].filter((t) => t.state === "running");
    if (running.length === 0) return;
    const runs = await deps.listRuns().catch(() => [] as Run[]);
    for (const run of runs) {
      const task = byRun.get(run.id);
      if (task && run.progress !== undefined) task.progress = run.progress;
    }
  }

  function find(callId: string, n: number): Task | undefined {
    return calls.get(callId)?.find((t) => t.n === n);
  }

  // The replacement did not start: whatever landed meanwhile is settled now.
  function release(task: Task | undefined): void {
    if (!task) return;
    const late = pending.get(task);
    pending.delete(task);
    late?.();
  }

  async function cancelTask(task: Task): Promise<void> {
    task.state = "cancelled";
    await deps.cancelRun(task.runId);
  }

  return {
    async dispatch(input: DispatchInput): Promise<Dispatched> {
      const kind = input.kind ?? THINK_KIND;
      const task = input.task.trim();
      if (!task) return { ok: false, reason: "The task is empty." };
      const kinds = deps.kinds();
      if (!kinds.includes(kind)) {
        return { ok: false, reason: `Nothing here runs the kind "${kind}". The kinds there are: ${kinds.join(", ") || "none"}.` };
      }
      const list = calls.get(input.callId) ?? [];
      const earlier = input.follows === undefined ? undefined : list.find((t) => t.n === input.follows);
      if (input.follows !== undefined && !earlier) {
        return { ok: false, reason: `There is no task ${input.follows} on this call.` };
      }
      const revised = input.replaces === undefined ? undefined : list.find((t) => t.n === input.replaces);
      if (input.replaces !== undefined && !revised) {
        return { ok: false, reason: `There is no task ${input.replaces} on this call.` };
      }
      // A change of mind replaces a task still running: it does not count against the limit.
      const replacing = revised?.state === "running" ? revised : undefined;
      const running = list.filter((t) => t.state === "running" && t !== replacing).length;
      if (running >= MAX_IN_FLIGHT) {
        return {
          ok: false,
          reason: `${MAX_IN_FLIGHT} tasks are already running on this call. Wait for one to come back.`,
        };
      }

      let brief = task;
      if (earlier && earlier !== revised) {
        brief += `\n\n---\nThis follows on from an earlier task on the same call:\n\n${earlier.brief}`;
        if (earlier.text) brief += `\n\nWhat came back then:\n\n${earlier.text}`;
      }
      if (replacing) pending.set(replacing, null);
      let result: Delegated;
      try {
        const path = await deps.writeBrief(brief);
        result = await deps.delegate({
          kind,
          delegator: { kind: "soul" },
          brief: path,
          deliverTo: JSON.stringify(input.deliverTo),
        });
      } catch (e) {
        release(replacing);
        throw e;
      }
      if (!result.ok) {
        release(replacing);
        return { ok: false, reason: result.reason };
      }
      if (replacing) {
        pending.delete(replacing);
        await cancelTask(replacing);
      }

      const entry: Task = {
        callId: input.callId,
        n: list.length + 1,
        runId: result.run.id,
        kind,
        task: firstSentence(task),
        brief: task,
        ...(input.follows === undefined ? {} : { follows: input.follows }),
        ...(input.replaces === undefined ? {} : { replaces: input.replaces }),
        state: "running",
        told: false,
      };
      list.push(entry);
      calls.set(input.callId, list);
      byRun.set(entry.runId, entry);
      watching ??= deps.watchRuns(() => void refreshProgress());
      void result.done
        ?.then(async (run) => {
          if (isVerbatim(kind)) deps.answerSoon();
          else await finished(entry, run);
        })
        .catch((e) => console.warn(`call task ${entry.n} came apart`, e));
      return { ok: true, n: entry.n, runId: entry.runId, ...(replacing ? { replaced: replacing.n } : {}) };
    },

    async cancel(callId, n): Promise<Cancelled> {
      const task = find(callId, n);
      if (!task) return { ok: false, reason: `There is no task ${n} on this call.` };
      if (task.state !== "running") return { ok: false, reason: `Task ${n} is already ${task.state}.` };
      await cancelTask(task);
      return { ok: true };
    },

    tasks(callId) {
      return (calls.get(callId) ?? []).map(({ callId: _c, brief: _b, text: _t, ...line }) => ({ ...line }));
    },

    subscribe(callId, fn) {
      const set = listeners.get(callId) ?? new Set();
      set.add(fn);
      listeners.set(callId, set);
      return () => {
        set.delete(fn);
        if (set.size === 0) listeners.delete(callId);
      };
    },

    async text(callId, n) {
      return find(callId, n)?.text ?? null;
    },

    async told(callId, n) {
      const task = find(callId, n);
      if (!task?.boxItemId) return false;
      const item = await deps.box.setState(task.boxItemId, "told");
      if (!item) return false;
      task.told = true;
      return true;
    },
  };
}
