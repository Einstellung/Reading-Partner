// A rehearsal (docs/44): a talk the reader gives out loud, again and again,
// against an outline (reading/talk), and the record of every pass — which
// segment was up when, and what was said to it. An object of the topic, level
// with a retell.
//
// A pass is handed in whole and then the coach speaks (docs/44), so this
// directory holds both halves: the recording, and the conversation that reads a
// recording back (coach.ts, coach-turn.ts, handoff.ts). No UI.

export { buildRun, type BuildRunInput } from "./build";
export { buildCoachSystemPrompt, COACH_INSTRUCTIONS, type CoachContext } from "./coach";
export {
  buildCoachTurn,
  COACH_LADDER,
  type CoachReductionId,
  type CoachTalkAccess,
  type CoachTurn,
  type CoachTurnInput,
  type CoachTurnMessage,
} from "./coach-turn";
export { passMessage, type PassHandoff } from "./handoff";
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
  loadRehearsalRun,
  loadRehearsalRuns,
  loadRunPages,
  readRehearsalDeck,
  rehearsalFile,
  rehearsalForOutline,
  rehearsalForRetell,
  rehearsalRunsFile,
  REHEARSAL_DECK_DIR,
  renameRehearsal,
  RUN_PAGES_DIR,
  runPagesDir,
  runPagesFile,
  splitRehearsalRunPages,
  splitRehearsalRunPagesEverywhere,
  splitRehearsalRunPagesOnce,
  startRehearsal,
  type StartRehearsalInput,
} from "./store";
export {
  countWords,
  coverageOf,
  runEntryOf,
  runSummary,
  segmentIdOf,
  type RunSummary,
} from "./summary";
export {
  emptyLog,
  newRehearsal,
  normalizeLog,
  normalizePages,
  normalizeRehearsal,
  normalizeRunPages,
  REHEARSAL_VERSION,
  RUN_LOG_VERSION,
  type BuiltRun,
  type Rehearsal,
  type RehearsalEvent,
  type RehearsalLog,
  type RehearsalPage,
  type RehearsalRun,
  type RehearsalRunEntry,
  type RehearsalRunPages,
} from "./types";
