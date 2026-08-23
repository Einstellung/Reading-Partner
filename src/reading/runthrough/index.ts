// A run-through (docs/31): the reader gives the talk once against its finished
// deck, the AI silent throughout, and what is left is a record of which page was
// up when and what was said to it. Recording only — no feedback, no AI, no UI.

export { buildRun, type BuildRunInput } from "./build";
export type { TranscriptSource } from "./source";
export { appendRun, deleteRunthroughs, loadRunthroughs, runthroughFile } from "./store";
export { countWords, runSummary, type RunSummary } from "./summary";
export {
  emptyLog,
  normalizeLog,
  RUNTHROUGH_VERSION,
  type RunthroughEvent,
  type RunthroughLog,
  type RunthroughPage,
  type RunthroughRun,
} from "./types";
