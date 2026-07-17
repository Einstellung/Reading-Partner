// Public surface of the lesson-prep module (docs/09).

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
  linkifyCitations,
  parseCitationHref,
  pageCitationHref,
  paperCitationHref,
  figureCitationHref,
  type Citation,
} from "./anchors";
export {
  chapterIndexForPage,
  nextQueued,
  normalizeOnLoad,
  paperPriority,
  papersForChapter,
} from "./scheduler";
export {
  PrepPipeline,
  type PipelineDeps,
  type PrepSnapshot,
  type PrepActivity,
} from "./pipeline";
export { getPrepPipeline, peekPrepPipeline, hasPrepState } from "./live";
export { readPrepNote, paperFulltextHash } from "./store";
export { buildClassroomSystemPrompt, classroomPromptPrefix, type ClassroomNote } from "./classroom";
export { buildClassroomTools } from "./tools";
