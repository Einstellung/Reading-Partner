// Sub-agents: run a task in an isolated agent loop and get one brief back
// (docs/25).
//
// Not re-exported from src/ai/index.ts on purpose. That barrel belongs to the
// `ai` entry, and an edge from it to `ai/subagent` would close a cycle between
// the two (tests/layering.test.ts checks exactly this). Callers import
// "../ai/subagent" directly, the way they already do for "../ai/voice".

// Only the surface a caller wires. The brief composition and the turn settler
// are internals with their own tests, reachable by path when a caller genuinely
// needs to supply its own turn.
export { runSubagent, type SubagentDeps, type SubagentRequest } from "./run";
export { subagentTool, type SubagentToolDeps } from "./tool";
export { createSubagentLedger, type SubagentLedger } from "./ledger";
export { runSubagentTurnLive } from "./live";
export {
  DEFAULT_BRIEF_TOKEN_CAP,
  DEFAULT_SUBAGENT_ROUNDS,
  type SubagentBrief,
  type SubagentDefinition,
  type SubagentModel,
  type SubagentOutcome,
  type SubagentPhase,
  type SubagentProgress,
  type SubagentToolFailure,
  type SubagentTurnFn,
  type SubagentTurnOutcome,
  type SubagentTurnRequest,
} from "./types";
