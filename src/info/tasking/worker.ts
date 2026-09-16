// The tasking kind, as a legion worker (docs/63, docs/55 step 10b).
//
// The secretary hands over a question the briefing does not answer and the turn
// ends there; this is what takes it. An agent worker, `local` tier — the run is
// in this process, on the device the reader asked on, and never reaches the
// synced folder. It has no `requires`: every record it reads is already on this
// device, and a device that can talk to the model at all can do this.
//
// Shaped after reading/papers/research-worker.ts, down to the failure: a run
// that established nothing throws, so the runner counts the attempt instead of
// delivering an empty answer into the reader's briefing.

import { registerWorker, type WorkerContext, type WorkerHandle } from "../../legion/execute/worker";
import { writeRunOutput } from "../../legion/execute/outputs";
import {
  createSubagentQuota,
  runSubagent,
  runSubagentTurnLive,
  type SubagentDefinition,
  type SubagentTurnFn,
} from "../../legion/subagent";
import { StoppedError } from "../../legion/stop";
import { appData } from "../../platform/app/appdata";
import { buildTaskingAgent, TASKING_KIND, TASKING_TURN_ROUNDS } from "./tasking-agent";

export { TASKING_KIND };

export interface TaskingWorkerDeps {
  /** The sub-agent turn. The live one unless a test hands one in. */
  turn?: SubagentTurnFn;
  /** The sub-agent itself. Built over this device's own records unless injected. */
  agent?: () => Promise<SubagentDefinition>;
  /** Where the brief that comes back is put, answering the path. */
  writeOutput?: (runId: string, text: string) => Promise<string>;
  /** The brief the soul wrote, read back off its path. */
  readBrief?: (path: string) => Promise<string>;
}

/**
 * Run one tasking run. The brief the soul wrote is on disk; the sub-agent's own
 * progress is reported in the runner's wording, so a person looking at the run
 * sees which record it is in and which round.
 */
export function taskingWorker(deps: TaskingWorkerDeps = {}) {
  const readBrief = deps.readBrief ?? ((path: string) => appData.readText(path));
  const writeOutput = deps.writeOutput ?? writeRunOutput;
  const buildAgent = deps.agent ?? (async () => buildTaskingAgent());
  const turn = deps.turn ?? runSubagentTurnLive;
  return (brief: string, ctx: WorkerContext): WorkerHandle => {
    const stop = new AbortController();
    const done = (async () => {
      const task = (await readBrief(brief)).trim();
      if (!task) throw new Error(`the brief at ${brief} is empty`);
      const definition = await buildAgent();
      const result = await runSubagent(
        {
          definition,
          task,
          signal: stop.signal,
          onProgress: (progress) => {
            if (progress.tool) void ctx.reportTool(progress.tool, progress.round);
          },
        },
        { run: turn, quota: createSubagentQuota(TASKING_TURN_ROUNDS) },
      );
      // Nothing was read, so nothing was established: what the model wrote is
      // its own knowledge of the subject, which is the one thing this kind
      // exists to keep out of the briefing (docs/25, docs/63 质量规则).
      if (!result.usable) throw new Error(result.brief);
      const output = await writeOutput(ctx.run.id, result.brief);
      return {
        output,
        progress: `${result.rounds} rounds, ${result.toolSuccesses} of ${result.toolCalls} lookups`,
      };
    })();
    return {
      cancel: () => stop.abort(new StoppedError()),
      done,
    };
  };
}

/** Hand legion the tasking kind. Called once at startup; the undo is for tests. */
export function registerTaskingWorker(deps: TaskingWorkerDeps = {}): void {
  registerWorker({
    kind: TASKING_KIND,
    tier: "local",
    agent: true,
    run: taskingWorker(deps),
  });
}
