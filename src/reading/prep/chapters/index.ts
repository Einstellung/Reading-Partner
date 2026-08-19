// Public surface of the chapter-spine module (docs/09): the material a document
// whose citations are not load-bearing gets — one spine per chapter and the graph
// connecting them. The book's own chapter table is reading/chapters; this is what
// the model is told about each of those chapters.

export type {
  ChapterStatus,
  NoteChapter,
  NotesState,
  OverviewStatus,
  PhaseStatus,
} from "./types";
export { NOTES_VERSION, createNotesState, normalizeNotesOnLoad } from "./types";
export {
  parseNotesPlan,
  planUserMessage,
  NOTES_PLAN_SYSTEM_PROMPT,
  TOC_MAX_PAGES,
} from "./plan";
export { formatChapterTable, formatEmphasisSignals, type EmphasisSignal } from "./chapter";
export {
  NotesPipeline,
  type NotesActivity,
  type NotesDeps,
  type NotesSnapshot,
  type PlanOutcome,
} from "./pipeline";
export { getNotesPipeline, hasNotesState, peekNotesPipeline, type NotesInputs } from "./live";
export {
  chapterFileName,
  readChapterNote,
  readOverviewNote,
} from "./store";
