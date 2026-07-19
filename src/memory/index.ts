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
export { buildMemoryTools, type MemoryToolOptions, type MemoryWriteAction } from "./tools";
export {
  buildDistillSystemPrompt,
  buildDistillUserMessage,
  formatSilentMarks,
  runDistillation,
  selectSilentMarks,
  type DistillAnnotation,
  type DistillInput,
  type DistillMessage,
  type DistillResult,
  type DistillRunner,
} from "./distill";
export {
  distillThread,
  getLastDistillation,
  getMemoryAdapter,
  notifyMemoryChange,
  onMemoryChange,
  type DistillThreadOptions,
} from "./live";
