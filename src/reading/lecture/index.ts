// Teaching a book, or a chapter of one (docs/09). The pure decisions a lecture
// turn is made of — which chapters a book has, how much of it goes in the
// prompt, which of the reader's stuck points ride along — plus the one tool that
// hands back a whole chapter. reading/turn.ts is the only assembler; this
// directory holds nothing that reaches for state of its own.

export {
  buildChapterTable,
  chapterAtPage,
  chapterByNumber,
  chapterFocusLabel,
  chapterNumber,
  chapterTableSection,
  chapterTableUsable,
  chapterTokens,
  pageRangeText,
  pickChapterTable,
  MIN_CHAPTERS,
  MIN_CHAPTER_CHARS,
  type ChapterEntry,
  type LectureChapter,
} from "./chapters";
export {
  chapterSection,
  correctEstimate,
  decideInline,
  inlinePages,
  lectureTokens,
  wholeBookSection,
  CHAPTER_MAX_TOKENS,
  LECTURE_TOKEN_SAFETY,
  MAX_CHAPTER_PAGES,
  WHOLE_BOOK_MAX_TOKENS,
  type InlineInput,
  type InlineMode,
} from "./inline";
export { buildReadChapterTool, READ_CHAPTER_MAX_PAGES, type ReadChapterDeps } from "./tools";
export {
  annotationPageMap,
  lectureObservationSnapshot,
  observationScope,
  selectLectureObservations,
  stripToolResidue,
  BOOK_HIT_CAP,
  CHAPTER_HIT_CAP,
  CORRECTION_QUOTA,
  LECTURE_OBSERVATION_CAP,
  LECTURE_OBSERVATION_CAP_TIGHT,
  type LectureFocus,
  type ObservationPick,
  type ObservationScope,
} from "./stuck";
export {
  chapterOutlineSection,
  turnLoadStatement,
  OUTLINE_BUDGET_TOKENS,
  type ChapterOutline,
  type TurnLoad,
} from "./prompt";
export { loadChapterOutlines, loadChapterTable } from "./live";
