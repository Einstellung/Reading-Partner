// The book on the desk (docs/61). The articles the reader kept beside it are
// reading/saved-articles-desk.ts, registered here with it.
//
// This is everything a reading turn's material contributes to one call: which
// tools the book mounts, how much of it is inlined, the prompt those blocks come
// out in, the replayed conversation and the ladder of what to give up when the
// window is tight (M6/M9, docs/03, docs/09, docs/21, docs/24). The thread's
// shape is read by desk-frame.ts, the history by desk-history.ts, and the tools
// every thread carries are desk-tools.ts's. What it
// does not do is assemble a call — the desk hands these items to src/soul,
// which is the one place a turn is put together, whatever is lying on it.
//
// There is one prompt (docs/09, 2026-08-19). What used to be two modes is now
// one assembly whose blocks are attached by data: a chapter table when the book
// has a usable one, a body when the tier says so, prep notes when a prep run
// produced them. Nothing here asks which mode the reader is in, because there is
// no longer such a thing.

import { buildReadingTools, markedPageRange, markedPagesSection, spineOverviewSection } from "./context";
import { toAnnotationLite, type AnnotationLite, type TopicMaterial } from "../fulltext/format";
import { modelSupportsImages, type ProviderId } from "../ai";
import { estimateTextTokens } from "../budget";
import {
  registerDeskItemKind,
  type DeskEnv,
  type DeskItem,
  type DeskItemKind,
  type DeskPromptView,
} from "../desk";
import { asideParentTail } from "./aside";
import { markedReplyText } from "./chat-marks";
import { READING_LADDER, type ReadingReductionId } from "./ladder";
import type { Annotation } from "../platform/app/reader-contract";
import { buildSystemPrompt, type BooklistItem } from "../platform/app/context";
import { loadAnnotations } from "../platform/app/annotations";
import { getThread, setThreadFocusChapter } from "../platform/app/threads";
import { readThreadImages } from "../platform/app/thread-images";
import { chapterAt } from "../fulltext/query";
import { getFulltext } from "../fulltext/store";
import type { Fulltext } from "../fulltext/types";
import { buildFigureTools } from "./figures/tools";
import { buildVisualAidGuidance } from "./figures/prompt";
import { renderFigure, renderPageImage } from "./figures/render";
import {
  pageImageTokens,
  pageWindowPrompt,
  planPageWindow,
  type PageWindowImage,
  type PageWindowPlan,
} from "./figures/page-window";
import type { Figure } from "./figures/types";
import { logEvent } from "../platform/app/events";
import { AI_EVENT_TOPIC } from "../platform/app/structured-output";
import { getObservationAdapter, type DistillAnnotation, type Observation } from "../memory";
import { readSpineOverview } from "./prep/chapters/store";
import { readPrepNote } from "./prep/papers/store";
import { parseNote } from "./prep/papers/notes";
import {
  classroomNoteBody,
  notedPapers,
  prepNotesSection,
  prepStatusSection,
  surveyBodyPageCount,
  turnClassroomNotes,
  type ClassroomNote,
} from "./prep/papers/classroom";
import type { PrepPaper } from "./prep/papers/types";
import {
  buildReadChapterTool,
  chapterOutlineSection,
  decideInline,
  lectureObservationSnapshot,
  loadChapterSpine,
  loadChapterTable,
  selectLectureObservations,
  turnLoadStatement,
  wholeBookSection,
  chapterSection,
  annotationPageMap,
  LECTURE_OBSERVATION_CAP_TIGHT,
  type InlineMode,
} from "./lecture";
import {
  chapterByNumber,
  chapterFocusLabel,
  chapterTableSection,
  chapterTokens,
  pageRangeText,
  type TableChapter,
} from "./chapters";
import { buildClassroomTools } from "./prep/papers/tools";
import type { BoxOrigin } from "../box";
import type { PrepPipeline } from "./prep/papers/pipeline";
import { threadFrame } from "./desk-frame";
import {
  composeMessages,
  distillOnTrim,
  historyKeep,
  replayedLesson,
  type ReadingTurnMessage,
} from "./desk-history";
import { bookSideTools, LITERATURE_TOOL_PROMPTS, SHELF_TOOL_PROMPTS } from "./desk-tools";
import { savedArticlesKind } from "./saved-articles-desk";

// The book is one of the two kinds of thing a reading turn puts on the desk; the
// kept articles beside it are the other (reading/saved-articles-desk.ts). Named
// here because the caller lists them by name and the palace table marks the
// rows they open.
export const BOOK_KIND = "book";

// The live reading position and topic scope for the turn (App's ctxRef).
export interface ReadingTurnContext {
  topicId: string | null;
  topicName: string;
  fileName: string;
  pageLabel: string | null;
  pageIndex: number | null;
  files: { path: string; name: string; hash?: string }[];
}

// One page of the open book as an image, with the pixel size it came out at so
// the turn can price what it is about to send.
export interface RenderedPage extends PageWindowImage {
  width: number;
  height: number;
}

export type PageRenderFn = (page: number, widthPx: number) => Promise<RenderedPage | null>;

// The open book, as the desk takes it. Everything about this turn that is the
// book's own; the settings, the topic, the thread and the abort signal are the
// turn's and arrive in the DeskEnv.
export interface BookDeskRef {
  // The open book's content hash: keys its threads, prep notes and figure crops.
  bookId: string;
  // The document on screen — the book itself, or one of its supplements the
  // reader opened from the Outline (docs/67 「辅助资料」). Equal to bookId
  // for all of a session spent in the book.
  docId?: string;
  // The supplement on screen, when one is: its title, which is also what its
  // page citations are written with. Null while the book itself is showing.
  viewing?: { title: string } | null;
  // Every supplement this book has picked up, so the model knows what it may
  // send the reader to, how to cite it, and which one to take away.
  supplements?: readonly { hash: string; title: string }[];
  // A link the model ingested became a supplement: the Outline's list is
  // stale until the shell reads it again. Injected rather than announced,
  // so nothing here has to know there is a sidebar.
  onSupplement?: () => void;
  // A supplement is about to be deleted. The reader may be looking at it, and
  // this is what puts them back in the book before its bytes go; the shell
  // knows the reader, this file does not.
  onSupplementGone?: (hash: string) => void;
  // Which shell this turn was taken in. Absent — the desk and the iPad — is
  // today's behaviour, unchanged: the reader has the pages in front of them.
  // "phone" is the lesson (docs/74), where the PDF is never rendered and the
  // words are all there is. It reaches the prompt and nothing else.
  form?: "phone";
  threadId: string;
  // The AI-pen mark hosting this thread; empty string for the book-level thread
  // and for an aside pulled out of a chat message. Which of the three this is
  // comes off the thread record, not from here (platform/app/threads.ts:
  // threadKind), so a caller cannot open an aside as if it were the lesson.
  annotationId: string;
  // That mark, and every mark on the open book (the current book's materials use
  // the in-memory copies rather than re-reading them from disk).
  annotation: Annotation | undefined;
  annotations: Annotation[];
  // The open book's extracted text and figure index; null/empty while extraction
  // is still running or when the book has no text layer.
  fulltext: Fulltext | null;
  figures: Figure[];
  // The open book's bytes, for rasterizing a figure the model asks to see.
  buffer: ArrayBuffer | null;
  context: ReadingTurnContext;
  // Read live rather than captured: a prep tool invoked mid-turn should see the
  // pipeline the reader is on now, matching the pre-extraction behaviour.
  getPipeline: () => PrepPipeline | null;
  distillAnnotations: () => DistillAnnotation[];
  // A message that is not in the thread and never will be: the bell a delegated
  // run rang, put on the end of the conversation for this one turn (docs/68,
  // reading/deliver.ts). A reader's own turn passes nothing.
  trailing?: ReadingTurnMessage;
  // Rasterize one whole page of the open book (the visual window around the
  // reader's highlight, figures/page-window.ts). Injected for the same reason
  // the figure renderer is: it needs a canvas and a loaded pdf.js, and the
  // assembly around it has to run under `bun test`.
  renderPage?: PageRenderFn;
}

const bookKind: DeskItemKind<BookDeskRef> = { kind: BOOK_KIND, open: openBook };

/**
 * Register what reading can put on the desk. Called once at startup by the
 * shell (useShellBootstrap), and by the tests that lay a desk of their own.
 */
export function registerReadingDesk(): () => void {
  const off = [registerDeskItemKind(bookKind), registerDeskItemKind(savedArticlesKind)];
  return () => {
    for (const undo of off) undo();
  };
}

// Open the book: gather its materials, mount its tools, and hand back the
// blocks a turn is written from. Null when the signal aborts while the history
// is being read — the caller has already been superseded.
async function openBook(ref: BookDeskRef, env: DeskEnv): Promise<DeskItem | null> {
  const {
    bookId,
    docId = bookId,
    viewing = null,
    supplements = [],
    form,
    onSupplement,
    onSupplementGone,
    threadId,
    annotationId,
    annotations,
    fulltext: currentFulltext,
    figures: figuresIndex,
    buffer,
    context,
    getPipeline,
    distillAnnotations,
    trailing,
    renderPage = async (pageNo, widthPx) => {
      if (!buffer) return null;
      const r = await renderPageImage(docId, buffer, pageNo, widthPx);
      return r ? { data: r.base64, mediaType: r.mimeType, width: r.width, height: r.height } : null;
    },
  } = ref;
  const s = env.settings;
  const signal = env.signal;
  // The topic the book is listed under (App.tsx imports through addFileToTopic,
  // so there is always one). It comes off the material, not off the turn: a
  // topic is where data is filed, and this book's file is what is filed.
  const topicId = context.topicId;
  const topicName = context.topicName;
  const { fileName, pageLabel, files } = context;
  const materials = await gatherTopicMaterials(files, bookId, currentFulltext, annotations);
  // A conversation is in the file of the document it belongs to: the book's
  // for the lesson and everything pulled out of it, the document on screen for
  // a mark drawn on it (reading/session/documents.ts). Which of the two this
  // one is is read off the record, so the record has to be found before the
  // question can be answered — hence both files, which is one file whenever
  // the book itself is showing.
  const readThread = (id: string) =>
    getThread(docId, id) ?? (docId === bookId ? undefined : getThread(bookId, id));
  const thread = readThread(threadId);
  const {
    kind,
    isBook,
    bookLevel,
    onMark,
    aside,
    currentPage,
    page,
    selectionText,
    selectionComment,
    pageAnchor,
  } = threadFrame(ref, thread);
  // The conversation this aside was pulled out of. Read live, like everything
  // else about the thread: the parent goes on being written to while an aside is
  // open, and none of it is copied onto the aside.
  const parent =
    kind === "aside" && thread?.parentThreadId
      ? readThread(thread.parentThreadId)
      : undefined;
  const chapterTitle =
    currentFulltext && page ? chapterAt(currentFulltext, page)?.title ?? null : null;
  // Where the reader is, for a run delegated from this turn to be delivered back
  // to (docs/68). The page is the one the turn is about: the marked passage's
  // page on a mark thread, and the reader's position otherwise. A function
  // because this turn hands runs over from two places — the desk it answers
  // with, and the ingest tool.
  const deliveryOrigin = (): BoxOrigin => ({
    place: "book",
    bookId,
    threadId,
    ...(annotationId ? { annotationId } : {}),
    ...(page ?? currentPage ? { page: (page ?? currentPage) as number } : {}),
  });
  // The current book is in the list, marked as current. It used to be filtered
  // out, which read as "the other materials" and was fine until read_annotations
  // was mounted: that tool takes a title "as shown in the topic booklist", and
  // the book the reader is actually marking up was the one title not shown.
  const booklist: BooklistItem[] = materials.map((m) => ({
    label: m.label,
    pageCount: m.fulltext?.pages.length ?? 0,
    annotationCount: m.annotations.length,
    fulltextAvailable: m.fulltext?.status === "ok",
    isCurrent: m.path === bookId,
  }));

  // The text of the marked page and its neighbours, inlined so the turn does not
  // have to fetch them (reading/context.ts). Only where the page is the mark's:
  // the book-level thread's page follows the reader's scrolling and a chat-span
  // aside has no page at all. Whatever document is on screen, book or supplement
  // — it is the same full text read_pages would return, under the same anchors.
  const markedRange =
    onMark && currentFulltext && page ? markedPageRange(currentFulltext, page) : null;
  const markedPages =
    markedRange && currentFulltext && page
      ? markedPagesSection(currentFulltext, page, pageAnchor)
      : "";
  let tools = buildReadingTools({ currentFulltext, materials, pageAnchor });

  // The lecture load (docs/09). The chapter table decides what read_chapter can
  // be asked for and which chapter the thread can be parked on; the thread's own
  // focus decides what gets inlined. Read live from the thread rather than
  // carried in a parameter, because read_chapter writes it mid-turn and the next
  // turn has to see what the last one wrote.
  const prepState = getPipeline()?.snapshot().state ?? null;
  const chapterTable = await loadChapterTable(bookId, currentFulltext, prepState?.chapters ?? []);
  // An aside reads its parent's focus. That focus is what puts the chapter's
  // body in the prompt, overrides the position line, picks the observation
  // window and orders the prep notes; an aside that lost it would be answering
  // about a sentence from a chapter it can no longer see, and its stable half
  // would stop matching the lesson's.
  const focusHolder = kind === "aside" ? parent : thread;
  const focusNumber = kind === "mark" ? null : focusHolder?.focusChapter ?? null;
  const focusChapter: TableChapter | null =
    chapterTable && focusNumber !== null ? chapterByNumber(chapterTable, focusNumber) : null;
  const bodyPages =
    currentFulltext?.status === "ok"
      ? surveyBodyPageCount(currentFulltext, prepState?.chapters ?? [])
      : 0;
  const inline: InlineMode = decideInline({
    hasText: currentFulltext?.status === "ok",
    bodyEstimate: currentFulltext
      ? estimateTextTokens(pageRangeText(currentFulltext, 1, bodyPages))
      : 0,
    chapter: focusChapter,
    chapterEstimate:
      focusChapter && currentFulltext ? chapterTokens(currentFulltext, focusChapter) : 0,
  });
  // One call, one whole chapter (docs/09). read_pages caps at 10 pages, which
  // cannot return the measured 44-page chapter. Mounted on every kind of thread:
  // a marked passage's conversation may be asked to teach chapter 3 and gets it,
  // it just does not become a conversation about chapter 3 — only the book-level
  // thread writes a focus down.
  //
  // Nor does an aside, on either end. Writing one on itself would be dead — the
  // focus it reads is the parent's — and writing one on the parent would let a
  // side conversation move the lesson the reader is going back to.
  if (currentFulltext?.status === "ok") {
    tools = [
      ...tools,
      buildReadChapterTool({
        bookName: fileName,
        fulltext: currentFulltext,
        chapters: chapterTable,
        ...(isBook
          ? {
              onFocus: (c: TableChapter) => {
                if (c.number !== null) setThreadFocusChapter(bookId, threadId, c.number);
              },
            }
          : {}),
      }),
    ];
  }
  // The chapter spine, when the notes pass has written one (docs/09). By data:
  // absent until it runs, and a lecture never waits for it. A run still going
  // also reports how far it has got, which the turn states as a fact rather than
  // acts on.
  const { outlines: chapterOutlines, progress: spineProgress } = await loadChapterSpine(bookId);
  const chapterSpine = chapterOutlineSection(chapterOutlines);

  // Per-topic AI observations (M8): the retrieval this book anchors. Which of
  // them ride is reading/lecture/stuck.ts's judgement — anchored to this book
  // first, this chapter first of all, with corrections on a quota of their own.
  //
  // The observation tools themselves are the soul's and are mounted by the
  // assembly (src/soul): they are about the reader, not about the book,
  // and every kind of turn carries them.
  let observationSnapshot = "";
  let observationSnapshotTight = "";
  let topicObservations: Observation[] = [];
  if (topicId) {
    const observations = await getObservationAdapter(topicId)
      .listObservations()
      .catch((): Observation[] => []);
    const focus = focusChapter
      ? { startPage: focusChapter.startPage, endPage: focusChapter.endPage }
      : null;
    const pick = (limit?: number) =>
      selectLectureObservations({
        observations,
        bookId,
        annotationPages: annotationPageMap(annotations),
        focus,
        bookLevel,
        ...(limit === undefined ? {} : { limit }),
      });
    topicObservations = observations;
    observationSnapshot = lectureObservationSnapshot(pick());
    observationSnapshotTight = lectureObservationSnapshot(pick(LECTURE_OBSERVATION_CAP_TIGHT));
  }
  // Figures (M9): the model can cite one as [fig:N] (rendered inline in chat)
  // and open one to actually see it. The catalog itself is built inside the
  // visual-aid block below, which is where the judgement about when to reach for
  // a picture lives.
  const supportsImages = modelSupportsImages(
    s.defaultProviderId as ProviderId,
    s.defaultModelId as string,
  );
  if (figuresIndex.length) {
    tools = [
      ...tools,
      ...buildFigureTools({
        figures: figuresIndex,
        modelSupportsImages: supportsImages,
        renderImage: async (fig) => {
          if (!buffer) return null;
          const r = await renderFigure(bookId, buffer, fig, "view");
          return r ? { base64: r.base64, mimeType: r.mimeType } : null;
        },
      }),
    ];
  }
  // The visual window (docs/12, figures/page-window.ts): the marked page and the pages
  // either side, as images, so the model sees the plot the paragraph is about
  // instead of the text layer's account of the axis labels.
  //
  // Only where there is a mark. The book-level thread's page moves with the
  // reader's scrolling, so a window sent on one of its turns says nothing about
  // where the earlier ones were, and the history line that stands in for the
  // pictures next turn would be a guess. A chat-span aside has no page at all.
  const pageWindow: PageWindowPlan | null = !onMark
    ? null
    : planPageWindow({
        anchor: page,
        pageCount: currentFulltext?.pages.length ?? null,
        figures: figuresIndex,
        fulltext: currentFulltext,
        modelSupportsImages: supportsImages,
      });
  let pageImages: RenderedPage[] = [];
  if (pageWindow) {
    const rendered = await Promise.all(
      pageWindow.pages.map((p) => renderPage(p.page, p.widthPx).catch(() => null)),
    );
    pageImages = rendered.filter((r): r is RenderedPage => r !== null);
  }
  if (signal?.aborted) return null;
  // The pixel sizes are kept for the telemetry line only; what goes on the wire
  // is the image block and nothing else.
  const windowImages: PageWindowImage[] = pageImages.map(({ data, mediaType }) => ({
    data,
    mediaType,
  }));

  // The tools every thread of the book carries (reading/desk-tools.ts). The
  // pipeline is read here, at the point it always was.
  const sideTools = bookSideTools({
    bookId,
    docId,
    topicId,
    threadId,
    settings: s,
    pipeline: getPipeline(),
    origin: deliveryOrigin,
    ...(onSupplement ? { onSupplement } : {}),
    ...(onSupplementGone ? { onSupplementGone } : {}),
  });
  tools = [...tools, ...sideTools.shelf];

  // read_paper / read_note over whatever the prep run produced. Mounted wherever
  // there is a prep state to read, which is what "by data" means here: the tools
  // follow the material, not a mode.
  if (prepState) {
    tools = [...tools, ...buildClassroomTools(() => [getPipeline()?.snapshot().state ?? prepState])];
  }

  // Every prep note there is, capped, and the same list under a quarter of the
  // budget for when the window is tight (the "prep-notes-trim" rung).
  //
  // Which chapter the reader is scrolled to used to decide *whether* a note rode
  // along at all, and it is a bad witness: a reader parked on p.12 of the
  // embodied-AI survey was two days into chapter 4, and the turn carried one of
  // the twenty notes. The position now only orders them, and only once the cap
  // bites (prep/papers/classroom.ts).
  let classroomNotes: ClassroomNote[] = [];
  let classroomNotesTight: ClassroomNote[] = [];
  if (prepState) {
    // An aside orders them from where its parent would, never from its own
    // mark. This ordering is in the stable half: a mark two chapters away from
    // the reader's position re-sorts the notes, and the lesson's copy of the
    // block — 40k of budget, above the spine and the overview — stops matching
    // and gets written again instead of read from the cache.
    const notePage = kind === "aside" ? currentPage : page;
    const here = focusChapter?.startPage ?? notePage ?? currentPage ?? 1;
    const onDisk = await readClassroomNotes(bookId, notedPapers(prepState));
    ({ notes: classroomNotes, tight: classroomNotesTight } = turnClassroomNotes(
      onDisk,
      prepState,
      here,
    ));
  }

  tools = [...tools, ...sideTools.literature];
  // The whole-book outline from the reader's notes (docs/09), when they exist.
  const spineOverview = spineOverviewSection(await readSpineOverview(bookId));
  // A booklist entry with no text layer and no marks is a title the model can do
  // nothing with; the first thing to go when the window is tight.
  const booklistThin = booklist.filter((m) => m.fulltextAvailable || m.annotationCount > 0);

  // The prompt as a function of what this turn had to give up (src/budget). The
  // pieces named by a ReadingReductionId are the optional ones; everything else —
  // the role, the instructions, the marked passage and its note, the position,
  // the prep status list — is assembled the same way no matter how tight the
  // window is. The order the blocks come out in is buildSystemPrompt's, and it
  // is the cache order (docs/09).
  //
  // What the prompt is allowed to say exists is `view.toolNames`: every tool
  // this turn mounted, the soul's and the other items' included. The tools
  // paragraph is rendered from those names, so a tool that was not mounted —
  // read_annotations on a book with no marks, read_paper with no prep run — is
  // not announced (platform/app/context.ts).
  function composePrompt(view: DeskPromptView): string {
    const dropped = view.dropped;
    const notes = dropped.has("prep-notes-trim") ? classroomNotesTight : classroomNotes;
    const mode: InlineMode = dropped.has("chapter-inline") ? "none" : inline;
    let inlineBody = "";
    if (currentFulltext?.status === "ok") {
      if (mode === "whole") inlineBody = wholeBookSection(fileName, currentFulltext, bodyPages);
      else if (mode === "chapter" && focusChapter) {
        inlineBody = chapterSection(fileName, currentFulltext, focusChapter);
      }
    }
    return buildSystemPrompt({
      topicName,
      fileName,
      pageLabel,
      selectionText,
      selectionComment,
      chapterTitle,
      markedPages,
      fulltextAvailable: currentFulltext?.status === "ok",
      materials: dropped.has("booklist-thin") ? booklistThin : booklist,
      // The whole visual-aid block, not the bare figure list: when to cite a
      // figure and when to answer in words instead is one judgement and is
      // written in one place (reading/figures/prompt.ts).
      figureCatalog: buildVisualAidGuidance({
        figures: figuresIndex,
        currentPage: page ?? currentPage ?? null,
        omitCatalog: dropped.has("figure-catalog"),
      }),
      toolNames: view.toolNames,
      // An aside takes its parent's framing, which is what keeps the stable half
      // of this prompt byte-identical to the lesson's: the provider's cache
      // matches on a prefix, so one differing word in the first block turns a
      // read of the inlined chapter into a second write of it (measured at ~82k
      // tokens on a chapter-inlined turn). What the aside is gets said in the
      // volatile half — the anchor line below, and the load statement last.
      bookLevel,
      ...(aside ? { aside } : {}),
      ...(form ? { form } : {}),
      aiLanguage: s.aiLanguage,
      citePaperSlugs: notes.length > 0,
      chapterTable: chapterTable ? chapterTableSection(chapterTable) : "",
      inlineBody,
      prepNotes: prepNotesSection(notes),
      chapterSpine: dropped.has("notes-overview") ? "" : chapterSpine,
      spineOverview: dropped.has("notes-overview") ? "" : spineOverview,
      // The paragraphs belonging to individual tools, in the stable half of the
      // prompt: each is written where its tool is, and each rides only when that
      // tool was mounted. The book's own sit around what the rest of the desk
      // brought — a kept article's paragraph among them — because the order they
      // came out in before the desk existed is the order the provider's cache
      // still remembers.
      toolPrompts: [...SHELF_TOOL_PROMPTS, ...view.toolPrompts, ...LITERATURE_TOOL_PROMPTS],
      supplements: supplementsSection(supplements, viewing),
      ...(focusChapter ? { focusLabel: chapterFocusLabel(focusChapter) } : {}),
      // Memory, as one paragraph of three blocks in a fixed order (docs/48),
      // built by the assembly out of what this item anchors. The ladder's two
      // rungs there give up the statements and shorten the retrieved
      // observations; what this book has left open is a few lines and stays
      // until the paragraph goes.
      observations: view.memory,
      prepStatus: prepStatusSection(prepState, new Set(notes.map((n) => n.slug))),
      // Said only when the pictures are actually going: a prompt that describes
      // a window the ladder took back tells the model to look at something that
      // is not there.
      pageWindow:
        pageWindow && pageImages.length > 0 && !dropped.has("page-window")
          ? pageWindowPrompt(pageWindow)
          : "",
      loaded: turnLoadStatement({
        mode,
        bookName: fileName,
        pageCount: currentFulltext?.pages.length ?? 0,
        chapter: focusChapter,
        bodyPages,
        outlines: chapterSpine ? chapterOutlines.length : 0,
        prepNotes: notes.length,
        hasChapterTable: !!chapterTable,
        ...(markedRange ? { markedPages: markedRange } : {}),
        ...(spineProgress ? { spine: spineProgress } : {}),
        ...(aside
          ? {
              aside: {
                ...aside,
                lessonReplayed:
                  replayedLesson(parentTail.length, prior.length, historyKeep(dropped)) > 0,
              },
            }
          : {}),
      }),
    });
  }

  const threadMsgs = readThread(threadId)?.messages ?? [];
  // A reply the reader drew on comes back with what they marked named after it
  // (reading/chat-marks.ts). It rides the message, so it falls out of context
  // when the message does, and it sits in the replayed history rather than in
  // the prompt: the stable half stays byte-identical, and the only cache a new
  // mark disturbs is the history's, once, on the turn after it was drawn.
  const prior = await Promise.all(
    threadMsgs.map(async (m) => ({
      role: m.role,
      text: markedReplyText(m, annotations, threadId),
      images: m.images?.length ? await readThreadImages(threadId, m.images) : undefined,
    })),
  );
  // What an aside opens on: the stretch of the parent the span was pulled out
  // of. Read here rather than copied onto the aside when it was created — the
  // lesson goes on being written to while the aside is open, and two records
  // holding the same messages is two places for them to drift.
  //
  // Text only. The images on those messages belong to the lesson's own turns;
  // carrying them into every turn of an aside prices a picture the question is
  // not about.
  const parentTail: ReadingTurnMessage[] = parent
    ? asideParentTail(parent.messages, thread?.asideAnchor?.messageTs ?? null).map((m) => ({
        role: m.role,
        text: markedReplyText(m, annotations, parent.id),
      }))
    : [];
  if (signal?.aborted) return null;
  distillOnTrim({
    topicId,
    topicName,
    bookId,
    docId,
    bookName: fileName,
    threadId,
    annotationId,
    page,
    currentPage,
    selectionText,
    messages: threadMsgs,
    marks: distillAnnotations,
  });

  // The replayed history, given what the budget gave up (reading/desk-history.ts).
  // The page images go out only while the ladder has not taken the window back.
  const replay = (dropped: ReadonlySet<string>): ReadingTurnMessage[] =>
    composeMessages({
      parentTail,
      prior,
      ...(trailing ? { trailing } : {}),
      keep: historyKeep(dropped),
      aside: aside !== null,
      pageWindow:
        pageWindow && pageImages.length > 0 && !dropped.has("page-window")
          ? { plan: pageWindow, images: windowImages }
          : null,
    });

  // The catalog is only redundant while nothing is leaning on it: once the
  // conversation has cited a [fig:N], dropping the list of figures makes the
  // reference dangle. The two bulk rungs are only worth pricing when this turn
  // has the material they give up — composing the prompt to price a block that
  // is not there costs a full re-render for nothing.
  const skip = new Set<ReadingReductionId>();
  if (replay(new Set()).some((m) => m.text.includes("[fig:"))) skip.add("figure-catalog");
  if (inline === "none") skip.add("chapter-inline");
  if (classroomNotes.length === 0) skip.add("prep-notes-trim");
  if (!pageWindow || pageImages.length === 0) skip.add("page-window");

  // An aside is priced as if it were paying for the inlined chapter in full:
  // src/budget/fit.ts knows one assembled call, not two conversations sharing a
  // provider cache. For a chat-span aside that costs nothing — its stable half is
  // the lesson's byte for byte, it carries no page window and no inlined marked
  // pages, and its history is a handful of messages against the lesson's forty, so
  // its call is smaller than the lesson's and a window the lesson fits in fits it.
  //
  // One drawn on the page is bigger: the page images and the marked page's own
  // text are its own. If that is what puts it over the line, the ladder gives up
  // reader-statements and notes-overview before it gives up the page window.
  // The statements now ride the volatile half with the rest of memory, so it is
  // the notes that cut the shared prefix: it ends where the spine was, and the
  // chapter below it is written again. Left as it is: those rungs are ahead of
  // the window because they are the cheapest things in the call to lose, and the
  // same order costs the lesson its own prefix on its own tight turns. Pricing a rung by what it does to the next turn's cache is a change to
  // the ladder, not to this turn.
  return {
    kind: BOOK_KIND,
    label: fileName,
    tools,
    toolPrompts: [],
    rungs: READING_LADDER,
    skip,
    prompt: composePrompt,
    memory: {
      bookId,
      topicId,
      observations: topicObservations,
      snapshot: (tight: boolean) => (tight ? observationSnapshotTight : observationSnapshot),
    },
    history: { compose: replay },
    // Where the reader is, for a run delegated from this turn to be delivered
    // back to (docs/68).
    origin: deliveryOrigin(),
    report: { inline },
    afterFit: (dropped) =>
      reportPageWindow(threadId, pageWindow, pageImages, !dropped.has("page-window")),
  };
}

// The notes a prep run has on disk for these papers, each already through
// classroomNoteBody: that is the one place a stored note becomes prompt text,
// so what selectClassroomNotes prices is what the prompt carries.
async function readClassroomNotes(
  bookId: string,
  papers: readonly PrepPaper[],
): Promise<ClassroomNote[]> {
  const onDisk = await Promise.all(
    papers.map(async (p): Promise<ClassroomNote | null> => {
      const raw = await readPrepNote(bookId, p.slug);
      if (!raw) return null;
      return { slug: p.slug, title: p.title, body: classroomNoteBody(parseNote(raw).body, p.slug) };
    }),
  );
  return onDisk.filter((n): n is ClassroomNote => n !== null);
}

// One line per turn that sent page images, so what the visual window costs is a
// number somebody can read back rather than a guess (events-ai.jsonl). Fire and
// forget, like every other event: a turn is never failed by its instrumentation.
// Silent when the turn planned no window at all — a line saying "no pictures"
// on every companion turn would bury the ones that mean something.
function reportPageWindow(
  threadId: string,
  plan: PageWindowPlan | null,
  images: RenderedPage[],
  sent: boolean,
): void {
  if (!plan || images.length === 0) return;
  let tokens = 0;
  let px = 0;
  for (const im of images) {
    tokens += pageImageTokens(im.width, im.height);
    px += im.width * im.height;
  }
  logEvent(AI_EVENT_TOPIC, "page-window", {
    thread: threadId,
    gate: plan.gate,
    anchor: plan.anchor,
    from: plan.pages[0].page,
    to: plan.pages[plan.pages.length - 1].page,
    pages: images.length,
    tokens,
    px,
    sent,
  });
}

// Assemble the topic's materials for a call (M6): each file's cached full text
// and its annotations, scoped to the active topic. The current book uses the
// in-memory annotations and the just-extracted full text; other books read from
// the cache/disk (never re-extracted here, so they show only if opened before).
export async function gatherTopicMaterials(
  files: { path: string; name: string; hash?: string }[],
  currentBookId: string,
  currentFulltext: Fulltext | null,
  currentAnns: Annotation[],
): Promise<(TopicMaterial & { path: string })[]> {
  const out: (TopicMaterial & { path: string })[] = [];
  for (const f of files) {
    const isCurrent = f.hash === currentBookId;
    // Other books are read from their content-hash-keyed data; a file that has
    // never been opened since the upgrade has no book id yet, so it contributes
    // no cached full text / annotations (it will once opened).
    let fulltext: Fulltext | null;
    if (isCurrent) fulltext = currentFulltext;
    else if (!f.hash) fulltext = null;
    else {
      try {
        fulltext = await getFulltext(f.hash);
      } catch {
        fulltext = null;
      }
    }
    let anns: Annotation[];
    if (isCurrent) anns = currentAnns;
    else if (!f.hash) anns = [];
    else {
      try {
        anns = await loadAnnotations(f.hash);
      } catch {
        anns = [];
      }
    }
    const annotations = anns
      .map(toAnnotationLite)
      .filter((a): a is AnnotationLite => a !== null);
    out.push({ path: f.hash ?? f.path, label: f.name, fulltext, annotations });
  }
  return out;
}

/**
 * What the reader has put beside this book, and how to cite it (docs/67
 * 「辅助资料」). Nothing at all when the book has none, which is most books.
 *
 * No tool is named here: a supplement is opened by the reader from the Outline,
 * not fetched by the model, and the prompt must not mention a tool that is not
 * mounted (tests/reading/turn.test.ts).
 */
export function supplementsSection(
  supplements: readonly { title: string }[],
  viewing: { title: string } | null,
): string {
  if (supplements.length === 0) return "";
  const lines = [
    "Beside this book the reader keeps these supplements — pages and papers they",
    "brought in while reading. Each is open to them from the Outline sidebar:",
    ...supplements.map((s) => `- ${s.title}`),
    "",
    viewing
      ? `The reader is looking at the supplement "${viewing.title}", not at the book.`
      : "The reader is looking at the book itself.",
    'Cite a page of the book as [p.12] and a page of a supplement as ' +
      '[Title p.4], with the supplement\'s title exactly as listed above.',
  ];
  return lines.join("\n");
}
