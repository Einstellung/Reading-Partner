// The literature research kind, as a legion worker (docs/68, docs/55 step 10).
//
// The same sub-agent the reading turn used to mount as a tool, moved behind a
// run: the reader's turn ends the moment the work is handed over, and what comes
// back arrives later in the thread the question was asked in. Nothing about the
// sub-agent changes — the prompt, the tool set and the round cap are
// research-agent.ts's, as they were.
//
// An agent worker, `local` tier: the run is in this process, on the reader's own
// device, and never reaches the synced folder. It has no `requires`, because a
// device that can talk to the model at all can do this.

import { registerWorker, type WorkerContext, type WorkerHandle } from "../../legion/execute/worker";
import { OUTPUTS_DIR, writeRunOutput } from "../../legion/execute/outputs";
import {
  createSubagentQuota,
  runSubagent,
  runSubagentTurnLive,
  type SubagentDefinition,
  type SubagentTurnFn,
} from "../../legion/subagent";
import { StoppedError } from "../../legion/stop";
import { appData } from "../../platform/app/appdata";
import { loadSettings } from "../../platform/app/settings";
import { buildResearchAgent, RESEARCH_KIND, RESEARCH_TURN_ROUNDS } from "./research-agent";
import { readingFetch } from "./http";
import { searchPapers, type PaperSearchFn } from "./paper-search";

export { RESEARCH_KIND, OUTPUTS_DIR };

export interface ResearchWorkerDeps {
  /** The sub-agent turn. The live one unless a test hands one in. */
  turn?: SubagentTurnFn;
  /** The sub-agent itself. Built from the reader's settings unless injected. */
  agent?: () => Promise<SubagentDefinition>;
  /** Where the brief that comes back is put, answering the path. */
  writeOutput?: (runId: string, text: string) => Promise<string>;
  /** The brief the soul wrote, read back off its path. */
  readBrief?: (path: string) => Promise<string>;
}

// The literature sub-agent as this device would build it: the reader's own
// Semantic Scholar key where they have one, and the four databases behind it.
async function liveAgent(): Promise<SubagentDefinition> {
  const settings = await loadSettings().catch(() => null);
  const deps = {
    fetchFn: readingFetch,
    s2ApiKey: settings?.semanticScholarApiKey ?? undefined,
  };
  return buildResearchAgent({
    ...deps,
    search: ((query, opts) => searchPapers(query, opts, deps)) satisfies PaperSearchFn,
  });
}

/**
 * Run one literature research run.
 *
 * The brief the soul wrote is on disk; the sub-agent's own progress is reported
 * through the runner's wording, so a person looking at the run sees which tool
 * it is on and which round. A run that could not finish throws, which is what
 * makes it an attempt the runner counts — the same pot of attempts every kind
 * has, retried in place and then `failed` (docs/55).
 */
export function researchWorker(deps: ResearchWorkerDeps = {}) {
  const readBrief = deps.readBrief ?? ((path: string) => appData.readText(path));
  const writeOutput = deps.writeOutput ?? writeRunOutput;
  const buildAgent = deps.agent ?? liveAgent;
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
          // this device injected ever travels this way (legion/subagent/types.ts).
          onProgress: (progress) => {
            if (progress.tool) void ctx.reportTool(progress.tool, progress.round);
          },
        },
        { run: turn, quota: createSubagentQuota(RESEARCH_TURN_ROUNDS) },
      );
      // A run that established nothing is a failed attempt, not an answer: the
      // brief says plainly that it could not finish, and delivering that into
      // the reader's thread as though it were a finding is the one thing the
      // sub-agent contract exists to prevent (docs/25).
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

/** Hand legion the literature kind. Called once at startup; the undo is for tests. */
export function registerResearchWorker(deps: ResearchWorkerDeps = {}): void {
  registerWorker({
    kind: RESEARCH_KIND,
    tier: "local",
    agent: true,
    run: researchWorker(deps),
  });
}
