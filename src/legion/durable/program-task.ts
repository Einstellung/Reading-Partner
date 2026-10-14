// Program tasks (docs/soul/87, docs/info/88 「两种 run」): a durable task a
// domain defines with `defineTask` and runs without a model, such as a topic
// search's open/read/build/deliver/wrap. legion/durable never imports the
// domain: the definition is handed in through registerProgramTask, and every
// generation installs the registered ones on its registry before it resumes,
// so a task the last process left mid-phase finds its definition and goes on
// from its checkpoint.
//
// Each run of a task has an ownerless conversation of its own, keyed by the
// caller in `rp.conversations`. Asked again under the same key (the legion run
// retried, or started again after a restart), the live task there is waited on
// rather than a second one created, and a completed one is handed back.

import type { Context } from "@earendil-works/chord";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { defineExtension, type AnyTask, type Extension, type Task, type TaskId, type TaskOutcome } from "@earendil-works/pi-durable";
import type { DurableRuntime } from "./harness";

export const PROGRAM_PLACE = "program";
export const PROGRAM_EXTENSION = "rp-program";

const registered = new Map<string, AnyTask>();
const listeners = new Set<() => void>();

/** Hand the Harness a task definition. The same name again replaces it. Returns the undo. */
export function registerProgramTask(task: AnyTask): () => void {
  registered.set(task.definition.name, task);
  for (const listener of listeners) listener();
  return () => {
    if (registered.get(task.definition.name) !== task) return;
    registered.delete(task.definition.name);
    for (const listener of listeners) listener();
  };
}

export function programTasks(): AnyTask[] {
  return [...registered.values()];
}

/** Hear about registrations made after a Harness opened. Returns the undo. */
export function onProgramTasks(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The extension that carries the registered tasks. */
export function programExtension(tasks: readonly AnyTask[] = programTasks()): Extension {
  return defineExtension({ name: PROGRAM_EXTENSION, tasks: [...tasks] });
}

export interface ProgramTaskRun {
  task: AnyTask;
  /** Names the run: the same key finds the same task. */
  key: string;
  /** What the conversation's `rp.thread` says it is for. */
  name: string;
  input: unknown;
  /** Aborting it aborts the task (its definition's abort runs). */
  signal?: AbortSignal;
}

/** Run a program task, or wait for the one already under this key. Settles with its outcome. */
export async function runProgramTask<R>(
  runtime: DurableRuntime,
  run: ProgramTaskRun,
  context: Context = BACKGROUND_CONTEXT,
): Promise<TaskOutcome<R>> {
  const conversation = await runtime.conversationFor(
    `${PROGRAM_PLACE}:${run.key}`,
    { place: PROGRAM_PLACE, name: run.name, key: run.key },
    context,
  );
  const page = await runtime.storage.scanTasks(
    { conversationId: conversation.id, kind: run.task.definition.name, order: "descending" },
    1,
    undefined,
    context,
  );
  const last = page.items[0];
  if (last && last.state.status === "terminal" && last.state.outcome.status === "completed") {
    return last.state.outcome as TaskOutcome<R>;
  }
  const id = (
    last && last.state.status !== "terminal"
      ? last.id
      : await conversation.commit(
          (tx) =>
            tx.createTask(run.task as unknown as Task<unknown, { phase: string }, R, object>, run.input, {
              ownership: { kind: "conversation" },
              background: true,
            }),
          context,
        )
  ) as TaskId<R>;
  const abort = () => void runtime.harness.abortTask(id, BACKGROUND_CONTEXT).catch(() => {});
  if (run.signal?.aborted) abort();
  else run.signal?.addEventListener("abort", abort, { once: true });
  try {
    const settled = await runtime.harness.waitForTask(id, context);
    return settled.state.outcome as TaskOutcome<R>;
  } finally {
    run.signal?.removeEventListener("abort", abort);
  }
}
