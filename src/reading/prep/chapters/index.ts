// Public surface of the chapter-spine module (docs/09): the material a document
// whose citations are not load-bearing gets — one spine per chapter and the graph
// connecting them. The book's own chapter table is reading/chapters; this is what
// the model is told about each of those chapters.

export type {
  ChapterStatus,
  SpineChapter,
  ChapterSpineState,
  OverviewStatus,
  PhaseStatus,
} from "./types";
export {
  CHAPTER_SPINE_VERSION,
  createChapterSpineState,
  normalizeChapterSpineOnLoad,
} from "./types";
export {
  parseChapterSpinePlan,
  planUserMessage,
  CHAPTER_SPINE_PLAN_SYSTEM_PROMPT,
  TOC_MAX_PAGES,
} from "./plan";
export { formatChapterTable, formatEmphasisSignals, type EmphasisSignal } from "./chapter";
export {
  ChapterSpinePipeline,
  type ChapterSpineActivity,
  type ChapterSpineDeps,
  type ChapterSpineSnapshot,
  type PlanOutcome,
} from "./pipeline";
export {
  getChapterSpinePipeline,
  hasChapterSpineState,
  peekChapterSpinePipeline,
  type ChapterSpineInputs,
} from "./live";
export {
  chapterFileName,
  readChapterSpine,
  readSpineOverview,
} from "./store";
export { findLegacyChapterNotes, purgeLegacyChapterNotes } from "./purge";
