// A rehearsal (docs/31): the reader gives the talk once against its finished
// deck, the AI silent throughout, and what is left is a record of which page was
// up when and what was said to it. Recording only — no feedback, no AI, no UI.

export { buildRun, type BuildRunInput } from "./build";
export { createDesktopTranscriptSource } from "./desktop-source";
export {
  createSegmentedTranscriptSource,
  MAX_SEGMENT_SECONDS,
  type RecordingSession,
  type Schedule,
  type SegmentedSourceOptions,
  type TranscribeSegment,
} from "./segmented-source";
export type { TranscriptSource, Utterance } from "./source";
export { appendRun, deleteRehearsals, loadRehearsals, rehearsalFile } from "./store";
export { countWords, runSummary, type RunSummary } from "./summary";
export {
  emptyLog,
  normalizeLog,
  REHEARSAL_VERSION,
  type RehearsalEvent,
  type RehearsalLog,
  type RehearsalPage,
  type RehearsalRun,
} from "./types";
