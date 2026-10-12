// Sub-agents: run a task in an isolated agent loop and get one brief back
// (docs/25).
//
// Not re-exported from src/ai/index.ts, and not reachable from it at all:
// legion is built on ai, so an edge back the other way would be a cycle
// (tests/layering.test.ts checks exactly this). Callers import
// "../legion/subagent" directly, the way they already do for "../ai/voice".

// Only the surface a caller wires. The brief composition is internal, with its
// own tests. A programmatic caller's turn is legion/durable's runBackgroundTurn.
export { runSubagent, type SubagentDeps, type SubagentRequest } from "./run";
export { agentWorker, type AgentWorkerDeps, type AgentWorkerSpec } from "./worker";
export { subagentTool, type SubagentToolDeps } from "./tool";
export { createSubagentQuota, type SubagentQuota } from "./quota";
export {
  DEFAULT_BRIEF_TOKEN_CAP,
  DEFAULT_SUBAGENT_ROUNDS,
  type SubagentBrief,
  type SubagentDefinition,
  type SubagentFailure,
  type SubagentModel,
  type SubagentOutcome,
  type SubagentPhase,
  type SubagentProgress,
  type SubagentToolFailure,
  type SubagentTurnFn,
  type SubagentTurnOutcome,
  type SubagentTurnRequest,
} from "./types";
