// Public surface of the paper-prep module (docs/09): the material a document
// with load-bearing inline citations gets — the works it leans on, read and
// digested into one note each. The anchor grammar the notes are written in is
// the parent's (../index.ts).

export type {
  PaperStatus,
  PlanStatus,
  PrepChapter,
  PrepPaper,
  PrepReference,
  PrepState,
} from "./types";
export { PREP_VERSION } from "./types";
export { parsePlan, planUserMessage, slugify, uniqueSlug, PLAN_SYSTEM_PROMPT } from "./plan";
export { parseNote, serializeNote, abstractNoteBody, type NoteMeta, type PrepNote } from "./notes";
export {
  chapterIndexForPage,
  nextQueued,
  normalizeOnLoad,
  paperPriority,
} from "./scheduler";
export {
  PrepPipeline,
  type PipelineDeps,
  type PrepSnapshot,
  type PrepActivity,
} from "./pipeline";
export { getPrepPipeline, peekPrepPipeline, hasPrepState } from "./live";
export { readPrepNote, paperFulltextHash } from "./store";
export {
  prepNotesSection,
  prepStatusSection,
  surveyBodyPageCount,
  type ClassroomNote,
} from "./classroom";
export { buildClassroomTools } from "./tools";
export {
  buildSourceTools,
  ADD_SOURCE_PROMPT,
  type SourceIngestor,
  type IngestResult,
} from "./source-tool";
