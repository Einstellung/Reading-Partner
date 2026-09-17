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
// device that can talk to the model at all can do this. The skeleton around the
// sub-agent is legion's (legion/subagent/worker.ts).

import { registerWorker } from "../../legion/execute/worker";
import { OUTPUTS_DIR } from "../../legion/execute/outputs";
import { agentWorker, type AgentWorkerDeps, type SubagentDefinition } from "../../legion/subagent";
import { loadSettings } from "../../platform/app/settings";
import { buildResearchAgent, RESEARCH_KIND, RESEARCH_TURN_ROUNDS } from "./research-agent";
import { readingFetch } from "../../platform/http/throttled-fetch";
import { searchPapers, type PaperSearchFn } from "./paper-search";

export { RESEARCH_KIND, OUTPUTS_DIR };

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

/** Run one literature research run, over the databases the reader has keys for. */
export function researchWorker(deps: AgentWorkerDeps = {}) {
  return agentWorker({ agent: liveAgent, rounds: RESEARCH_TURN_ROUNDS }, deps);
}

/** Hand legion the literature kind. Called once at startup; the undo is for tests. */
export function registerResearchWorker(deps: AgentWorkerDeps = {}): void {
  registerWorker({
    kind: RESEARCH_KIND,
    tier: "local",
    agent: true,
    run: researchWorker(deps),
  });
}
