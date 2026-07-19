// Public surface of the notes module (docs/14).

export type {
  ChapterStatus,
  NoteChapter,
  NotesState,
  OverviewStatus,
  PhaseStatus,
} from "./types";
export { NOTES_VERSION, createNotesState, normalizeNotesOnLoad } from "./types";
export {
  highlightFrontier,
  planAutoNotes,
  type AutoAnnotation,
  type AutoChapter,
  type AutoNotesPlan,
  type FinalPass,
} from "./auto";
export {
  chaptersFromOutline,
  parseNotesPlan,
  planUserMessage,
  toChapters,
  NOTES_PLAN_SYSTEM_PROMPT,
  TOC_MAX_PAGES,
} from "./plan";
export { formatEmphasisSignals, type EmphasisSignal } from "./chapter";
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
