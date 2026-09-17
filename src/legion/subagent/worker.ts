// A sub-agent as a legion worker (docs/55 step 10).
//
// Every agent worker so far is the same shape: the brief the soul wrote is on
// disk, one sub-agent run answers it under a round cap, the sub-agent's own
// progress is reported in the runner's wording, and what came back goes to an
// output file the run points at. A run that established nothing throws, which is
// what makes it an attempt the runner counts rather than an answer delivered as
// though it were a finding (docs/25).
//
// The kind, the sub-agent and the cap are the domain's; this is only the
// skeleton around them, so it names no kind of its own.

import type { WorkerContext, WorkerHandle } from "../execute/worker";
import { writeRunOutput } from "../execute/outputs";
import { createSubagentQuota } from "./quota";
import { runSubagent } from "./run";
import { runSubagentTurnLive } from "./live";
import type { SubagentDefinition, SubagentTurnFn } from "./types";
import { StoppedError } from "../stop";
import { appData } from "../../platform/app/appdata";

/** What one agent worker is: a sub-agent and how many rounds it gets. */
export interface AgentWorkerSpec {
  /** The sub-agent itself, as this device would build it. */
  agent: () => Promise<SubagentDefinition>;
  /** The round cap for one run. */
  rounds: number;
}

/** The seams a test reaches for. Every one of them has a live default. */
export interface AgentWorkerDeps {
  /** The sub-agent turn. The live one unless a test hands one in. */
  turn?: SubagentTurnFn;
  /** The sub-agent itself, overriding the spec's. */
  agent?: () => Promise<SubagentDefinition>;
  /** Where the brief that comes back is put, answering the path. */
  writeOutput?: (runId: string, text: string) => Promise<string>;
  /** The brief the soul wrote, read back off its path. */
  readBrief?: (path: string) => Promise<string>;
}

/** Build the worker a domain hands `registerWorker` for one agent kind. */
export function agentWorker(spec: AgentWorkerSpec, deps: AgentWorkerDeps = {}) {
  const readBrief = deps.readBrief ?? ((path: string) => appData.readText(path));
  const writeOutput = deps.writeOutput ?? writeRunOutput;
  const buildAgent = deps.agent ?? spec.agent;
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
          // The sub-agent's phases in the runner's own wording. Only a tool name
          // this device injected ever travels this way (subagent/types.ts).
          onProgress: (progress) => {
            if (progress.tool) void ctx.reportTool(progress.tool, progress.round);
          },
        },
        { run: turn, quota: createSubagentQuota(spec.rounds) },
      );
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
