// The book on the desk (docs/61), and the articles the reader kept beside it.
//
// This is everything a reading turn's material contributes to one call: which
// tools the book mounts, how much of it is inlined, the prompt those blocks come
// out in, the replayed conversation and the ladder of what to give up when the
// window is tight (M6/M9, docs/03, docs/09, docs/14, docs/21, docs/24). What it
// does not do is assemble a call — the desk hands these items to src/soul,
// which is the one place a turn is put together, whatever is lying on it.
//
// There is one prompt (docs/09, 2026-08-19). What used to be two modes is now
// one assembly whose blocks are attached by data: a chapter table when the book
// has a usable one, a body when the tier says so, prep notes when a prep run
// produced them. Nothing here asks which mode the reader is in, because there is
// no longer such a thing.

import {
  annotationPage,
  buildReadingTools,
  spineOverviewSection,
  surroundingText,
} from "./context";
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
import { EXPLAIN_KICKOFF } from "./intents";
import { asideParentTail, ASIDE_KICKOFF } from "./aside";
import { markedReplyText } from "./chat-marks";
import { READING_LADDER, type ReadingReductionId } from "./ladder";
import { isPageMark, type Annotation } from "../platform/app/reader-contract";
import { buildSystemPrompt, type BooklistItem } from "../platform/app/context";
import { loadAnnotations } from "../platform/app/annotations";
import {
  getThread,
  listThreads,
  readThreadImages,
  setThreadFocusChapter,
  threadKind,
  type ThreadKind,
} from "../platform/app/threads";
import { chapterAt } from "../fulltext/query";
import { getFulltext, saveFulltext } from "../fulltext/store";
import type { Fulltext } from "../fulltext/types";
import { buildFigureTools } from "./figures/tools";
import { buildVisualAidGuidance } from "./figures/prompt";
import { renderFigure, renderPageImage } from "./figures/render";
import {
  attachPageWindow,
  pageImageTokens,
  pageWindowPrompt,
  planPageWindow,
  type PageWindowImage,
  type PageWindowPlan,
} from "./figures/page-window";
import type { Figure } from "./figures/types";
import { logEvent } from "../platform/app/events";
import { AI_EVENT_TOPIC } from "../platform/app/structured-output";
import {
  distillThread,
  distillUnitOf,
  getObservationAdapter,
  pagelessMarkIds,
  type DistillAnnotation,
  type Observation,
} from "../memory";
import { readSpineOverview } from "./prep/chapters/store";
import { chapterIndexForPage } from "./prep/papers/scheduler";
import { paperFulltextHash, readPrepNote } from "./prep/papers/store";
import { parseNote } from "./prep/papers/notes";
import {
  classroomNoteBody,
  prepNotesSection,
  prepStatusSection,
  selectClassroomNotes,
  surveyBodyPageCount,
  CLASSROOM_NOTE_BUDGET_TIGHT,
  type ClassroomNote,
} from "./prep/papers/classroom";
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
import { INGEST_URL_PROMPT, buildSourceTools } from "./prep/papers/source-tool";
import {
  buildSavedArticleTools,
  prepareSavedArticle,
  SAVED_ARTICLES_PROMPT,
  type SavedArticleStore,
} from "./saved-article-tools";
import {
  hasSavedArticles,
  loadSavedArticles,
  loadSavedArticleBody,
  NO_ARTICLE_BODY,
  type SavedArticle,
} from "./saved-articles";
import { readingFetch } from "./papers/http";
import { searchPapers, type PaperSearchFn } from "./papers/paper-search";
import { buildFindPaperTool, FIND_PAPER_PROMPT } from "./papers/citation-tool";
import {
  buildResearchAgent,
  RESEARCH_PROMPT,
  RESEARCH_TURN_ROUNDS,
} from "./papers/research-agent";
import {
  createSubagentLedger,
  runSubagentTurnLive,
  subagentTool,
  type SubagentProgress,
  type SubagentTurnFn,
} from "../legion/subagent";
import type { PrepPipeline } from "./prep/papers/pipeline";

// The two kinds of thing a reading turn puts on the desk. Named here because
// the caller lists them by name and the palace table marks the rows they open.
export const BOOK_KIND = "book";
export const SAVED_ARTICLES_KIND = "saved-articles";

// Replayed thread history is trimmed to this many messages per turn; crossing
// the cap fires the fallback distillation before older turns fall out
// of context (docs/02: hangup is the main trigger, trimming the backstop).
export const HISTORY_KEEP = 40;
// The trim-triggered distillation re-fires only after this many new messages.
export const TRIM_DISTILL_MIN_NEW = 20;
// How short the replayed history gets when the budget ladder reaches its last
// rung. Three exchanges: above the two rounds that are never dropped, below
// anything that would still be called a conversation.
export const HISTORY_KEEP_TIGHT = 6;

// The real kept-article store. A failed read answers "nothing kept" rather than
// failing the turn: the tools are an offer, and a turn the reader is waiting for
// is not the place to raise a store problem the library screen will raise.
export const savedArticleStoreOnDisk: SavedArticleStore = {
  any: () => hasSavedArticles().catch(() => false),
  all: () => loadSavedArticles().catch((): SavedArticle[] => []),
  body: (article) => loadSavedArticleBody(article).catch(() => NO_ARTICLE_BODY),
};

// The live reading position and topic scope for the turn (App's ctxRef).
export interface ReadingTurnContext {
  topicId: string | null;
  topicName: string;
  fileName: string;
  pageLabel: string | null;
  pageIndex: number | null;
  files: { path: string; name: string; hash?: string }[];
}

export interface ReadingTurnMessage {
  role: "user" | "ai";
  text: string;
  images?: { data: string; mediaType: string }[];
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
  // One line for the reader while the research sub-agent runs. Never its tool
  // calls: what arrives here is a phase, the label this turn wrote, and a round
  // count (src/legion/subagent/types.ts).
  onSubagentProgress?: (progress: SubagentProgress) => void;
  // The sub-agent turn behind research_literature. Injected so the assembly and
  // its research tool can be exercised with no provider, no key and no network.
  runSubagentTurn?: SubagentTurnFn;
  // Rasterize one whole page of the open book (the visual window around the
  // reader's highlight, figures/page-window.ts). Injected for the same reason
  // the figure renderer is: it needs a canvas and a loaded pdf.js, and the
  // assembly around it has to run under `bun test`.
  renderPage?: PageRenderFn;
}

// The articles the reader kept on the info side (docs/21), as a thing that lies
// beside the book rather than a branch inside it: it brings two tools and a
// paragraph, and nothing else about the turn changes when it is there.
export interface SavedArticlesDeskRef {
  // The book the kept article would be put on the prep list of.
  bookId: string;
  getPipeline: () => PrepPipeline | null;
  // Injected so the assembly runs with no AppData. It is asked `any` here — the
  // records themselves are read when a tool actually runs.
  savedArticles?: SavedArticleStore;
}

const bookKind: DeskItemKind<BookDeskRef> = { kind: BOOK_KIND, open: openBook };
const savedArticlesKind: DeskItemKind<SavedArticlesDeskRef> = {
  kind: SAVED_ARTICLES_KIND,
  open: openSavedArticles,
};

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
    threadId,
    annotationId,
    annotation: ann,
    annotations,
    fulltext: currentFulltext,
    figures: figuresIndex,
    buffer,
    context,
    getPipeline,
    distillAnnotations,
    onSubagentProgress,
    runSubagentTurn = runSubagentTurnLive,
    renderPage = async (pageNo, widthPx) => {
      if (!buffer) return null;
      const r = await renderPageImage(bookId, buffer, pageNo, widthPx);
      return r ? { data: r.base64, mediaType: r.mimeType, width: r.width, height: r.height } : null;
    },
  } = ref;
  const s = env.settings;
  const signal = env.signal;
  const topicId = env.topic.id;
  const topicName = env.topic.name;
  const { fileName, pageLabel, pageIndex, files } = context;
  const materials = await gatherTopicMaterials(files, bookId, currentFulltext, annotations);
  // Which of the three doors this conversation came in by
  // (platform/app/threads.ts). Whether a mark is hosting it is the caller's to
  // say — it opened the conversation — and whether it hangs off another one is
  // only on the record, so the two are read together through the one derivation.
  // A thread the store has not got yet answers exactly as it did before asides
  // existed.
  const thread = getThread(bookId, threadId);
  const kind: ThreadKind = threadKind({ ...thread, annotationId });
  const isBook = kind === "book";
  // The classroom and everything opened off it: the reader has read none of this
  // book (docs/09). It decides the prompt's opening and how much the reading
  // position counts for; only a mark-anchored thread is outside it.
  const bookLevel = kind !== "mark";
  // The conversation this aside was pulled out of. Read live, like everything
  // else about the thread: the parent goes on being written to while an aside is
  // open, and none of it is copied onto the aside.
  const parent =
    kind === "aside" && thread?.parentThreadId
      ? getThread(bookId, thread.parentThreadId)
      : undefined;
  // Anchored on a page: a mark thread, and an aside drawn on the page. The
  // book-level thread's position is wherever the reader currently is, and so is
  // a chat-span aside's — its span came out of a reply, not out of a page.
  //
  // A mark drawn on a reply is not a page anchor either (docs/09). It has an
  // annotation like a drawn one and no page like a selected one, so what tells
  // the two apart is the mark and not the presence of an id.
  const onMark = annotationId !== "" && isPageMark(ann as Annotation | undefined);
  const aside: { from: "chat" | "mark" } | null =
    kind === "aside" ? { from: onMark ? "mark" : "chat" } : null;
  const currentPage = pageIndex !== null ? pageIndex + 1 : null;
  const page = onMark
    ? annotationPage(ann as { position?: { pageIndex?: number } } | undefined)
    : currentPage;
  const chapterTitle =
    currentFulltext && page ? chapterAt(currentFulltext, page)?.title ?? null : null;
  const surrounding =
    onMark && currentFulltext && page ? surroundingText(currentFulltext, page) : "";
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
  // The passage in the prompt's anchor slot. A chat-span aside has no mark, so
  // it is the span the reader selected out of the reply, stored verbatim on the
  // thread (platform/app/threads.ts: never an offset).
  const markText = typeof ann?.text === "string" ? ann.text : "";
  const selectionText =
    aside?.from === "chat" ? thread?.asideAnchor?.text ?? markText : markText;
  const selectionComment = typeof ann?.comment === "string" ? ann.comment : undefined;

  let tools = buildReadingTools({ currentFulltext, materials });

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

  // Link ingestion (docs/09): when a prep pipeline exists for this book, the
  // model can ingest a user-pasted URL with ingest_url and read it with the
  // paper tools, on any thread — "compare this link with ch.3" is a question a
  // marked passage can raise as easily as the book-level thread can.
  const livePipeline = getPipeline();
  let canIngestUrl = false;
  if (livePipeline && currentFulltext?.status === "ok") {
    tools = [
      ...tools,
      ...buildSourceTools({
        ingest: async (url) => {
          const paper = await livePipeline.ingestSource(url);
          const ft = await getFulltext(paperFulltextHash(bookId, paper.slug));
          const chars = ft ? ft.pages.reduce((n, pg) => n + pg.length, 0) : 0;
          return {
            slug: paper.slug,
            title: paper.title,
            kind: paper.kind ?? "pdf",
            pages: ft?.pages.length ?? paper.pages ?? 0,
            chars,
            status: paper.status,
            error: paper.error,
          };
        },
      }),
    ];
    canIngestUrl = true;
  }
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
  // bites (prep/papers/classroom.ts) — including in the tight list, which is why that
  // one is a smaller budget rather than a filter on the chapter number.
  //
  // The body stored here is the body that gets printed: classroomNoteBody is the
  // one place a stored note becomes prompt text, so what selectClassroomNotes
  // prices is what the prompt carries.
  let classroomNotes: ClassroomNote[] = [];
  let classroomNotesTight: ClassroomNote[] = [];
  if (prepState) {
    // An aside orders them from where its parent would, never from its own
    // mark. This ordering is in the stable half: a mark two chapters away from
    // the reader's position re-sorts the notes, and the lesson's copy of the
    // block — 40k of budget, above the spine and the overview — stops matching
    // and gets written again instead of read from the cache.
    const notePage = kind === "aside" ? currentPage : page;
    const here = focusChapter?.startPage ?? notePage ?? (pageIndex !== null ? pageIndex + 1 : 1);
    const chapterIdx = chapterIndexForPage(prepState.chapters, here);
    const notePapers = (prepState?.papers ?? []).filter(
      (p) => p.status === "done" || p.status === "abstract-only",
    );
    const onDisk = (
      await Promise.all(
        notePapers.map(async (p): Promise<ClassroomNote | null> => {
          const raw = await readPrepNote(bookId, p.slug);
          if (!raw) return null;
          return {
            slug: p.slug,
            title: p.title,
            body: classroomNoteBody(parseNote(raw).body, p.slug),
          };
        }),
      )
    ).filter((n): n is ClassroomNote => n !== null);
    const sel = { chapter: chapterIdx, chapterCount: prepState?.chapters.length ?? 0 };
    classroomNotes = selectClassroomNotes(onDisk, notePapers, sel);
    classroomNotesTight = selectClassroomNotes(onDisk, notePapers, {
      ...sel,
      budget: CLASSROOM_NOTE_BUDGET_TIGHT,
    });
  }

  // Academic literature (docs/24, docs/25), mounted on every reading turn. Not gated on
  // the prep pipeline or on the turn being in the book's own thread: "what is the
  // latest research on this" is a question the reader can have on any page of any book,
  // and a tool that is only sometimes there is one the model cannot learn to reach for.
  const literatureDeps = {
    fetchFn: readingFetch,
    s2ApiKey: s.semanticScholarApiKey ?? undefined,
  };
  // A pot for the whole turn. Without one, runSubagent grants every request in
  // full and a model that calls the research tool nine times spends nine times
  // the turns, each call perfectly legal on its own.
  const researchLedger = createSubagentLedger(RESEARCH_TURN_ROUNDS);
  tools = [
    ...tools,
    // Topic search and the citation walk live inside this run, not out here: their
    // candidate lists and abstract extracts are what the reader's context cannot
    // afford. Only the brief comes back.
    subagentTool(
      buildResearchAgent({
        ...literatureDeps,
        search: ((query, opts) =>
          searchPapers(query, opts, literatureDeps)) satisfies PaperSearchFn,
      }),
      {
        run: runSubagentTurn,
        ledger: researchLedger,
        signal,
        onProgress: onSubagentProgress,
      },
    ),
    // find_paper stays on the reader's turn. Pointing at one endnote is a different
    // job from a topic search: the answer is a single record, the companion wants
    // that record rather than prose about it, and delegating it would spend model
    // turns to come back with less.
    buildFindPaperTool(literatureDeps),
  ];
  // The whole-book outline from the reader's notes (docs/14), when they exist.
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
      surroundingText: surrounding,
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
      toolPrompts: [
        ...(canIngestUrl ? [INGEST_URL_PROMPT] : []),
        ...view.toolPrompts,
        FIND_PAPER_PROMPT,
        RESEARCH_PROMPT,
      ],
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
        ...(spineProgress ? { spine: spineProgress } : {}),
        ...(aside ? { aside: { ...aside, lessonReplayed: replayedLesson(dropped) > 0 } } : {}),
      }),
    });
  }

  const threadMsgs = getThread(bookId, threadId)?.messages ?? [];
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
  // Replay only the tail of a long thread, and before the older turns fall
  // out of context, run the fallback distillation (docs/02: hangup is the
  // main trigger, the trim is the backstop).
  //
  // Counted on the thread's own messages, not on what gets replayed: the
  // parent's tail rides an aside's every turn and is not a length this
  // conversation reached.
  if (threadMsgs.length > HISTORY_KEEP && topicId) {
    // Whose arrears these are (memory/observations/arrears.ts). A chat-span
    // aside has no mark, so it is no unit of its own and this stretch belongs to
    // the conversation it was pulled out of.
    const marks = distillAnnotations();
    const unit = distillUnitOf(listThreads(bookId), threadId, pagelessMarkIds(marks));
    // Where the pass says it happened follows the unit. Folded into the lesson,
    // the position is the reader's own page — the same answer the lesson gives
    // for itself — and there is no marked passage, because the lesson has none.
    const folded = !!unit && unit.threadId !== threadId;
    void distillThread(
      {
        topicId,
        topicName,
        bookId,
        bookName: fileName,
        threadId: unit?.threadId ?? threadId,
        trigger: "trim",
        annotationId: unit?.annotationId ?? annotationId,
        page: folded ? (unit.annotationId === "" ? currentPage : null) : page,
        markedText: folded ? "" : selectionText,
        messages:
          unit?.messages ??
          threadMsgs.map(({ id, role, text, ts }) => ({ ...(id ? { id } : {}), role, text, ts })),
        ...(unit ? { parts: unit.parts } : {}),
        annotations: marks,
      },
      TRIM_DISTILL_MIN_NEW,
    );
  }

  // How many messages of the parent's stretch survive into this turn, given what
  // the budget gave up. composeMessages trims the joined history from the front,
  // so the borrowed half is the first thing to go — and on an aside long enough
  // to fill the history by itself, or one whose parent is gone, there was never
  // any. The prompt says so rather than describing a stretch that is not there.
  function replayedLesson(dropped: ReadonlySet<string>): number {
    const keep = dropped.has("history-trim") ? HISTORY_KEEP_TIGHT : HISTORY_KEEP;
    const cut = Math.max(0, parentTail.length + prior.length - keep);
    return Math.max(0, parentTail.length - cut);
  }

  function composeMessages(dropped: ReadonlySet<string>): ReadingTurnMessage[] {
    const keep = dropped.has("history-trim") ? HISTORY_KEEP_TIGHT : HISTORY_KEEP;
    // The parent's stretch first, this conversation's own after. Trimmed from
    // the front, so the borrowed context is what the tight rung gives up before
    // it starts cutting into what the reader said here.
    const history = [...parentTail, ...prior];
    const tail = history.length > keep ? history.slice(history.length - keep) : history;
    // Every provider wants the exchange to open on a user message. A thread the
    // reader started from a chip already does, and is replayed as it stands so
    // the model reads the ask they actually picked. What needs a stand-in is a
    // tail that opens on a reply: a thread from before the chips, and any thread
    // long enough that the trim above cut its first message off.
    const opensOnUser = tail.length > 0 && tail[0].role === "user";
    const msgs: ReadingTurnMessage[] = opensOnUser
      ? [...tail]
      : [{ role: "user" as const, text: aside ? ASIDE_KICKOFF : EXPLAIN_KICKOFF }, ...tail];
    // The pictures ride the message being answered and nothing else. Every
    // earlier turn of this thread was sent the same window when it was the
    // current one, so those messages carry the line that says so instead — one
    // window in context at a time, however long the conversation runs.
    if (!pageWindow || pageImages.length === 0 || dropped.has("page-window")) return msgs;
    return attachPageWindow(msgs, pageWindow, windowImages);
  }

  // The catalog is only redundant while nothing is leaning on it: once the
  // conversation has cited a [fig:N], dropping the list of figures makes the
  // reference dangle. The two bulk rungs are only worth pricing when this turn
  // has the material they give up — composing the prompt to price a block that
  // is not there costs a full re-render for nothing.
  const skip = new Set<ReadingReductionId>();
  if (composeMessages(new Set()).some((m) => m.text.includes("[fig:"))) skip.add("figure-catalog");
  if (inline === "none") skip.add("chapter-inline");
  if (classroomNotes.length === 0) skip.add("prep-notes-trim");
  if (!pageWindow || pageImages.length === 0) skip.add("page-window");

  // An aside is priced as if it were paying for the inlined chapter in full:
  // src/budget/fit.ts knows one assembled call, not two conversations sharing a
  // provider cache. For a chat-span aside that costs nothing — its stable half is
  // the lesson's byte for byte, it carries no page window and no surrounding
  // text, and its history is a handful of messages against the lesson's forty, so
  // its call is smaller than the lesson's and a window the lesson fits in fits it.
  //
  // One drawn on the page is bigger: the page images and the text around the mark
  // are its own. If that is what puts it over the line, the ladder gives up
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
      observations: topicObservations,
      snapshot: (tight: boolean) => (tight ? observationSnapshotTight : observationSnapshot),
    },
    history: { compose: composeMessages },
    report: { inline },
    afterFit: (dropped) =>
      reportPageWindow(threadId, pageWindow, pageImages, !dropped.has("page-window")),
  };
}

// Saved info articles (docs/21): the model can list what the reader kept and
// put one into this book's prep list, then read it with read_paper. Gated on
// there being something kept — a tool whose only possible answer is "nothing"
// is one the model learns to call for nothing — and on the prep state
// existing, since read_paper is what the answer sends it to.
async function openSavedArticles(
  ref: SavedArticlesDeskRef,
  _env: DeskEnv,
): Promise<DeskItem | null> {
  const { bookId, getPipeline, savedArticles = savedArticleStoreOnDisk } = ref;
  const livePipeline = getPipeline();
  const prepState = livePipeline?.snapshot().state ?? null;
  if (!livePipeline || !prepState) return null;
  if (!(await savedArticles.any().catch(() => false))) return null;
  // The records are read on the first tool call, not here: most turns mount
  // these tools without the model ever reaching for them. Read once per
  // turn, however often it does. The bodies are not in there — only the one
  // article the reader names is read, in add below.
  let records: Promise<SavedArticle[]> | null = null;
  const list = () => (records ??= savedArticles.all().catch((): SavedArticle[] => []));
  return {
    kind: SAVED_ARTICLES_KIND,
    label: "Kept articles",
    tools: buildSavedArticleTools({
      list,
      add: async (article) => {
        const body = await savedArticles.body(article);
        const prepared = prepareSavedArticle(article, body.text);
        const paper = await livePipeline.ingestCaptured(prepared.mint, prepared.fetched);
        // The kept text goes into the fulltext cache under the slug the paper
        // got, which is why it is written after the ingest and not before:
        // the slug is minted in there. Nothing reads that cache in between —
        // the digest was handed the text directly, and read_paper is not
        // reachable until this call answers.
        await saveFulltext(paperFulltextHash(bookId, paper.slug), prepared.fulltext);
        return {
          slug: paper.slug,
          title: paper.title,
          kind: "article",
          pages: prepared.fulltext.pages.length,
          chars: prepared.chars,
          status: paper.status,
          error: paper.error,
        };
      },
    }),
    toolPrompts: [SAVED_ARTICLES_PROMPT],
    rungs: [],
    // Nothing of its own in the prompt: what a kept article contributes is two
    // tools and the paragraph that says when to reach for them, and that
    // paragraph belongs among the book's own (see composePrompt above).
    prompt: () => "",
  };
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
