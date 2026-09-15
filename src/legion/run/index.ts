// A run: one piece of work handed off, and the file two devices keep it in
// (docs/55).
//
// Importing this registers the run file's merge with sync. The engine may not
// import legion — platform is the floor — so the arrow goes this way, the same
// way pull-routes are registered by whoever owns the file rather than by the
// engine that dispatches to them.

import { registerLattice } from "../../platform/sync/merge/lattice";
import { joinRunFiles } from "./merge";

registerLattice("run", joinRunFiles);

export {
  MAX_ATTEMPTS,
  RUN_STATES,
  idempotencyKey,
  isTerminal,
  runRank,
  type Delegator,
  type Run,
  type RunClaimant,
  type RunState,
  type RunTier,
} from "./types";
export { asRun, collided, compareRun, joinRunFiles, mergeRun } from "./merge";
export {
  RUNS_DIR,
  appRunIo,
  appRuns,
  createRunStore,
  deriveRunId,
  randomRunId,
  type CreateRunInput,
  type CreateRunResult,
  type RunFilter,
  type RunIo,
  type RunStore,
  type TransitionPatch,
  type TransitionResult,
} from "./store";
