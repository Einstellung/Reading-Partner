// Public surface of the per-topic AI observations module (docs/02 part 2, M8).

export type {
  EvidenceAnchors,
  Observation,
  ObservationHit,
  ObservationIndexEntry,
  ObservationPatch,
  ObservationType,
  RetainInput,
} from "./observations/types";
export { OBSERVATION_TYPES, isObservationType } from "./observations/types";
export {
  isoDate,
  localDate,
  parseIndex,
  parseObservation,
  serializeIndexLine,
  serializeObservation,
} from "./observations/files";
export {
  ObservationFileStore,
  type ObservationConflict,
  type ObservationFs,
  type ObservationMeta,
} from "./observations/store";
export { FileObservationAdapter, type ObservationAdapter } from "./observations/adapter";
export { buildObservationSnapshot, observationPromptSection, trimObservations } from "./observations/select";
export { openStuckPoints } from "./observations/open-stuck";
export { stripToolResidue } from "./observations/residue";
export {
  anchorNames,
  messageAnchor,
  messageAnchorKeys,
  parseMessageAnchor,
  resolveMessageAnchor,
  type AnchoredMessage,
  type ParsedAnchor,
} from "./observations/anchors";
export {
  anchorSiblings,
  buildAnchorIndex,
  mentionedIds,
  observationsById,
  observationsForAnnotation,
  observationsForMessage,
  resolveReferences,
  type AnchorIndex,
  type ResolvedReferences,
} from "./observations/links";
export {
  assembleReaderSection,
  assembleStatements,
  assembleReadingContext,
  assembleReadingSignal,
  READING_SIGNAL_BUDGET,
  type TopicObservationSignal,
} from "./live/assemble";
export {
  otherTopicNames,
  rankObservations,
  searchOtherTopics,
  unionById,
  CROSS_RECALL_LIMIT,
  type ScopedHit,
  type TopicObservations,
} from "./observations/recall";
export {
  OBSERVATION_WRITE_TOOL,
  buildObservationTools,
  type ObservationToolOptions,
  type ObservationWriteAction,
} from "./observations/tools";
export {
  buildDistillAgent,
  buildDistillSystemPrompt,
  buildDistillUserMessage,
  buildMarksDistillAgent,
  buildMarksDistillSystemPrompt,
  buildMarksDistillUserMessage,
  classifyDistillFailure,
  countNewReaderMessages,
  countNewUnitMessages,
  datingRule,
  distillCoverage,
  distillFailurePayload,
  evidenceDates,
  formatEvidenceSpan,
  formatSilentMarks,
  markCursor,
  markDates,
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
  type DistillCoverage,
  type DistillDeps,
  type DistillFailureInput,
  type DistillFailureReason,
  type DistillFailureStage,
  type DistillInput,
  type DistillMessage,
  type DistillPassDeps,
  type DistillPassInput,
  type DistillPassResult,
  type DistillPassStore,
  type DistillResult,
  type DistillSkip,
  type DistillUnitPart,
  type EvidenceDates,
  type MarksDistillInput,
  type MarksPassInput,
  type MarksPassResult,
} from "./observations/distill";
export {
  countNewMarks,
  countUnitOwed,
  distillUnitOf,
  distillUnits,
  isTopicDue,
  maxUnitMarks,
  pagelessMarkIds,
  selectDistillJob,
  toDistillAnnotations,
  topicDebt,
  unitArrears,
  MIN_DISTILL_GAP_MS,
  MIN_NEW_MARKS,
  MIN_NEW_MESSAGES,
  SWEEP_INTERVAL_MS,
  type DistillCursor,
  type DistillJob,
  type DistillUnit,
  type SourceArrears,
  type SourceMarksUnit,
  type SourceMessagesUnit,
  type SourceUnit,
  type TopicArrears,
  type UnitThread,
} from "./observations/arrears";
export {
  buildRetellDistillAgent,
  buildRetellDistillSystemPrompt,
  buildRetellDistillUserMessage,
  runRetellDistillation,
  runRetellDistillPass,
  selectNewMessages,
  RETELL_DISTILL_AGENT_NAME,
  type RetellDistillInput,
  type RetellPassDeps,
  type RetellPassInput,
  type RetellPassResult,
  type RetellPassStore,
} from "./observations/retell";
// Which conversations outside reading are raw material for distillation
// (docs/58): a domain registers its kind at startup and the sweep reads it.
export {
  distillSourceOf,
  distillSources,
  registerDistillSource,
  type DistillSource,
} from "./distill/sources";
export {
  collectSourceArrears,
  findSourceUnit,
  type CursorReader,
  type SourceArrearsOptions,
  type SourceCursors,
} from "./distill/collect";
export {
  distillInfoThread,
  distillMarks,
  distillRetell,
  distillThread,
  getLastDistillation,
  getObservationAdapter,
  listObservationConflicts,
  listOtherTopicObservations,
  notifyObservationChange,
  onObservationChange,
  startDistillSweeps,
  sweepDistillation,
  type DistillInfoThreadOptions,
  type DistillMarksOptions,
  type DistillRetellOptions,
  type DistillThreadOptions,
  type DistillTrigger,
} from "./live/live";

// The statement layer on top of the observations (docs/48): what is held to be
// true about the reader, pointing back at the observations it rests on.
export type { Statement, StatementAuthor, StatementKind } from "./statements/types";
export { isObservationId } from "./statements/dates";
export { listStatements, statementStore } from "./live/statements";
export {
  buildStatementTools,
  latestReaderMessage,
  type ReaderMessage,
  type StatementToolContext,
} from "./statements/tools";
export { readerStatementSection } from "./statements/section";
export {
  dropCoveredObservations,
  memorySection,
  type MemorySectionInput,
} from "./live/memory-section";

// Where a conversation belongs (docs/21, docs/61): the tool that proposes a
// topic, the card it draws and the Apply that files it. Memory's and not the
// soul's — a topic is the key data is filed under, and the person at the desk is
// under none of them.
export { proposedTopicName, type TopicProposalCardData } from "./filing/card";
export {
  buildProposeTopicTool,
  filingTools,
  liveTopicChoices,
  resolveProposedTopic,
  topicGuidance,
  type FilingMount,
  type ProposeTopicDeps,
  type TopicChoice,
  type TopicProposalSurface,
} from "./filing/propose";
export {
  applyTopicProposal,
  type TopicApplied,
  type TopicSettledHook,
  type TopicSettlePorts,
} from "./filing/settle";
