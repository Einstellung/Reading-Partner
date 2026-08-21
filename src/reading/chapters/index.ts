// The book's chapter table (docs/09), owned by neither the side that prepares
// chapter spines nor the side that teaches a chapter. Both need the same table
// — parsed from a PDF outline, filtered of entries with nothing behind them,
// stitched into contiguous whole-book ranges, looked up by printed number — so it
// belongs to neither and imports neither.
//
// Pure: nothing here reads or writes disk.

export {
  buildChapterTable,
  chapterByNumber,
  chapterFocusLabel,
  chapterNumber,
  chapterRanges,
  chapterTableSection,
  chapterTableUsable,
  chapterTokens,
  pageRangeText,
  pickChapterTable,
  MIN_CHAPTERS,
  MIN_CHAPTER_CHARS,
  type BookChapter,
  type ChapterEntry,
  type RangeOptions,
  type TableChapter,
} from "./table";
export { chaptersFromOutline, outlineEntries, MIN_OUTLINE_ENTRIES } from "./outline";
