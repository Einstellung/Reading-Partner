// The nightly reclamation (docs/80): palace rows say their retention, garbage
// markers say what has outlived it, and the housekeeper carries the marks out
// sync-safely, on a Drive budget, one log line per mark.

export {
  garbageMarkerRegistered,
  registerGarbageMarker,
  registeredGarbageMarkers,
  type GarbageMarker,
  type Mark,
  type MarkAction,
  type MarkContext,
  type MarkEntry,
  type MarkedBy,
  type MarkReadIo,
} from "./marker";
export { GENERIC_MARKER, genericMarker, isGenericRule } from "./generic";
export {
  executeMarks,
  type ExecuteIo,
  type ExecuteOptions,
  type ExecuteResult,
  type HousekeeperLogLine,
  type Outcome,
} from "./execute";
export {
  HOUSEKEEPER_JOB,
  HOUSEKEEPER_LOG,
  REMOTE_PURGES_PER_NIGHT,
  collectMarks,
  runHousekeeper,
  type HousekeeperDeps,
} from "./night";
