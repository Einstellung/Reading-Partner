// The tasking kind, as a legion worker (docs/63, docs/55 step 10b).
//
// The secretary hands over a question the briefing does not answer and the turn
// ends there; this is what takes it. An agent worker, `local` tier — the run is
// in this process, on the device the reader asked on, and never reaches the
// synced folder. It has no `requires`: every record it reads is already on this
// device, and a device that can talk to the model at all can do this.
//
// The skeleton is legion's (legion/subagent/worker.ts), down to the failure: a
// run that established nothing throws, so the runner counts the attempt instead
// of delivering an empty answer into the reader's briefing.

import { registerWorker } from "../../legion/execute/worker";
import { agentWorker, type AgentWorkerDeps } from "../../legion/subagent";
import { buildTaskingAgent, TASKING_KIND, TASKING_TURN_ROUNDS } from "./tasking-agent";

export { TASKING_KIND };

/** Run one tasking run, over this device's own records. */
export function taskingWorker(deps: AgentWorkerDeps = {}) {
  return agentWorker({ agent: async () => buildTaskingAgent(), rounds: TASKING_TURN_ROUNDS }, deps);
}

/** Hand legion the tasking kind. Called once at startup; the undo is for tests. */
export function registerTaskingWorker(deps: AgentWorkerDeps = {}): void {
  registerWorker({
    kind: TASKING_KIND,
    tier: "local",
    agent: true,
    run: taskingWorker(deps),
  });
}
