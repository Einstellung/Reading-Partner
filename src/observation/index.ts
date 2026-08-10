// Public surface of the per-topic AI observations module (docs/02 part 2, M8).

export type {
  EvidenceAnchors,
  Observation,
  ObservationHit,
  ObservationIndexEntry,
  ObservationPatch,
  ObservationType,
  RetainInput,
} from "./types";
export { OBSERVATION_TYPES, isObservationType } from "./types";
export { isoDate, parseIndex, parseObservation, serializeObservation } from "./files";
export { ObservationFileStore, type ObservationFs, type ObservationMeta } from "./store";
export { FileObservationAdapter, type ObservationAdapter } from "./adapter";
export { buildObservationSnapshot, observationPromptSection, trimObservations } from "./snapshot";
export {
  assembleIdentity,
  assembleReadingContext,
  assembleReadingSignal,
  READING_SIGNAL_BUDGET,
  type TopicObservationSignal,
} from "./assemble";
export { buildObservationTools, type ObservationToolOptions, type ObservationWriteAction } from "./tools";
export {
  buildDistillAgent,
  buildDistillSystemPrompt,
  buildDistillUserMessage,
  buildMarksDistillAgent,
  buildMarksDistillSystemPrompt,
  buildMarksDistillUserMessage,
  countNewReaderMessages,
  formatSilentMarks,
  markCursor,
  messageCursor,
  runDistillPass,
  runDistillation,
  runMarksDistillPass,
  runMarksDistillation,
  selectSilentMarks,
  DISTILL_AGENT_NAME,
  DISTILL_BRIEF_TOKENS,
  DISTILL_MAX_ROUNDS,
  MARKS_DISTILL_AGENT_NAME,
  type DistillAnnotation,
  type DistillDeps,
  type DistillInput,
  type DistillMessage,
  type DistillPassDeps,
  type DistillPassInput,
  type DistillPassResult,
  type DistillPassStore,
  type DistillResult,
  type DistillSkip,
  type MarksDistillInput,
  type MarksPassInput,
  type MarksPassResult,
} from "./distill";
export {
  countNewMarks,
  isTopicDue,
  maxBookMarks,
  selectDistillJob,
  threadArrears,
  toDistillAnnotations,
  topicDebt,
  MIN_DISTILL_GAP_MS,
  MIN_NEW_MARKS,
  MIN_NEW_MESSAGES,
  SWEEP_INTERVAL_MS,
  type BookArrears,
  type DistillJob,
  type ThreadArrears,
  type TopicArrears,
} from "./arrears";
export {
  buildRehearsalDistillAgent,
  buildRehearsalDistillSystemPrompt,
  buildRehearsalDistillUserMessage,
  runRehearsalDistillation,
  runRehearsalDistillPass,
  selectNewMessages,
  REHEARSAL_DISTILL_AGENT_NAME,
  type RehearsalDistillInput,
  type RehearsalPassDeps,
  type RehearsalPassInput,
  type RehearsalPassResult,
  type RehearsalPassStore,
} from "./rehearsal";
export {
  distillMarks,
  distillRehearsal,
  distillThread,
  getLastDistillation,
  getObservationAdapter,
  notifyObservationChange,
  onObservationChange,
  startDistillSweeps,
  sweepDistillation,
  type DistillMarksOptions,
  type DistillRehearsalOptions,
  type DistillThreadOptions,
  type DistillTrigger,
} from "./live";
