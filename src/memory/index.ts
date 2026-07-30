// Public surface of the per-topic memory module (docs/02 part 2, M8).

export type {
  EvidenceAnchors,
  MemoryEntry,
  MemoryHit,
  MemoryIndexEntry,
  MemoryPatch,
  MemoryType,
  RetainInput,
} from "./types";
export { MEMORY_TYPES, isMemoryType } from "./types";
export { isoDate, parseIndex, parseMemory, serializeMemory } from "./files";
export { MemoryFileStore, type MemoryFs, type MemoryMeta } from "./store";
export { FileMemoryAdapter, type MemoryAdapter } from "./adapter";
export { buildMemorySnapshot, memoryPromptSection } from "./snapshot";
export {
  assembleIdentity,
  assembleReadingContext,
  assembleReadingSignal,
  READING_SIGNAL_BUDGET,
  type TopicMemorySignal,
} from "./assemble";
export { buildMemoryTools, type MemoryToolOptions, type MemoryWriteAction } from "./tools";
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
  getMemoryAdapter,
  notifyMemoryChange,
  onMemoryChange,
  type DistillThreadOptions,
} from "./live";
