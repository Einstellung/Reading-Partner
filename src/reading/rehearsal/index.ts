// A rehearsal (docs/43): a deck the reader gives out loud, again and again, and
// the record of every pass — which page was up when, and what was said to it.
// An object of the topic, level with a retell: a retell's deck gets one, and so
// does a deck brought in from outside. Recording only — no feedback, no AI, no UI.

export { buildRun, type BuildRunInput } from "./build";
export { createDesktopTranscriptSource } from "./desktop-source";
export {
  closingTail,
  createDictatedTranscriptSource,
  type DictatedSourceOptions,
} from "./dictated-source";
export {
  deckNameFromPath,
  importRehearsalDeck,
  isDeckPath,
  type ImportDeckInput,
} from "./import-deck";
export {
  rehearsalRows,
  rehearsalSummary,
  type DeckedRetell,
  type RehearsalRow,
  type RunCount,
} from "./rows";
export {
  createSegmentedTranscriptSource,
  MAX_SEGMENT_SECONDS,
  type RecordingSession,
  type Schedule,
  type SegmentedSourceOptions,
  type TranscribeSegment,
} from "./segmented-source";
export type { TranscriptSource, Utterance } from "./source";
export {
  chooseTranscriptSource,
  createTranscriptSource,
  type TranscriptSourceHost,
  type TranscriptSourceOptions,
} from "./transcript-source";
export {
  appendRun,
  deleteRehearsal,
  deleteRehearsalsForRetell,
  importedDeckFile,
  isImportedDeck,
  listAllRehearsals,
  listRehearsalsForTopic,
  loadRehearsal,
  loadRehearsalRuns,
  readRehearsalDeck,
  rehearsalFile,
  rehearsalForRetell,
  rehearsalRunsFile,
  REHEARSAL_DECK_DIR,
  renameRehearsal,
  startRehearsal,
  type StartRehearsalInput,
} from "./store";
export { countWords, runSummary, type RunSummary } from "./summary";
export {
  emptyLog,
  newRehearsal,
  normalizeLog,
  normalizeRehearsal,
  REHEARSAL_VERSION,
  RUN_LOG_VERSION,
  type Rehearsal,
  type RehearsalEvent,
  type RehearsalLog,
  type RehearsalPage,
  type RehearsalRun,
} from "./types";
