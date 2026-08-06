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
export { buildObservationSnapshot, observationPromptSection } from "./snapshot";
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
  formatSilentMarks,
  runDistillPass,
  runDistillation,
  selectSilentMarks,
  DISTILL_AGENT_NAME,
  DISTILL_BRIEF_TOKENS,
  DISTILL_MAX_ROUNDS,
  type DistillAnnotation,
  type DistillDeps,
  type DistillInput,
  type DistillMessage,
  type DistillPassDeps,
  type DistillPassInput,
  type DistillPassStore,
  type DistillResult,
} from "./distill";
export {
  distillThread,
  getLastDistillation,
  getObservationAdapter,
  notifyObservationChange,
  onObservationChange,
  type DistillThreadOptions,
} from "./live";
