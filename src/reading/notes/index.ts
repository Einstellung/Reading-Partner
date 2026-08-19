// Public surface of the chapter-spine module (docs/09, docs/14).

export type {
  ChapterStatus,
  BookChapter,
  NoteChapter,
  NotesState,
  OverviewStatus,
  PhaseStatus,
} from "./types";
export { NOTES_VERSION, createNotesState, normalizeNotesOnLoad } from "./types";
export {
  filterChapterTable,
  outlineChapterTable,
  MIN_CHAPTERS,
  MIN_CHAPTER_CHARS,
} from "./chapter-table";
export {
  chaptersFromOutline,
  parseNotesPlan,
  planUserMessage,
  toChapters,
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
