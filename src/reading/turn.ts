// Assembly of one reading-companion turn (M6/M9, docs/03, docs/09, docs/14,
// docs/21, docs/24): system prompt, tool set and replayed history for the AI-pen
// bubble and the book-level thread. Extracted from App so the branching (classroom
// vs companion, figure tools, link ingestion, kept info articles, literature
// search, observations, history trimming) is testable on its own. Pure assembly plus reads — it never touches React state
// and never starts the stream; the caller owns runAgentTurn.

import type { Api, Model } from "@earendil-works/pi-ai";
import type { AgentTool } from "../ai/agent";
import {
  annotationPage,
  buildReadingTools,
  notesOverviewSection,
  surroundingText,
} from "./context";
import { toAnnotationLite, type AnnotationLite, type TopicMaterial } from "../fulltext/format";
import { modelSupportsImages, type ProviderId } from "../ai/aiClient";
import { providers, toPiMessages } from "../ai/providers";
import { fitToBudget } from "../budget";
import { READING_LADDER, type ReadingReductionId } from "./ladder";
import type { Annotation } from "../platform/app/reader-contract";
import { buildSystemPrompt, readerProfileSection, type BooklistItem } from "../platform/app/context";
import { languageInstruction, type Settings } from "../platform/app/settings";
import { loadAnnotations } from "../platform/app/annotations";
import { getThread, readThreadImages } from "../platform/app/threads";
import { chapterAt } from "../fulltext/query";
import { getFulltext, saveFulltext } from "../fulltext/store";
import type { Fulltext } from "../fulltext/types";
import { buildFigureCatalog } from "./figures/catalog";
import { buildFigureTools } from "./figures/tools";
import { buildDiagramTools, type DiagramToolDeps } from "./diagrams/tools";
import { buildVisualAidGuidance } from "./diagrams/prompt";
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
  assembleIdentity,
  buildObservationSnapshot,
  buildObservationTools,
  distillThread,
  getObservationAdapter,
  observationPromptSection,
  notifyObservationChange,
  profileForPrompt,
  type DistillAnnotation,
  type Observation,
} from "../observation";
import { readOverviewNote } from "./notes/store";
import { chapterIndexForPage } from "./prep/scheduler";
import { paperFulltextHash, readPrepNote } from "./prep/store";
import { parseNote } from "./prep/notes";
import {
  buildClassroomSystemPrompt,
  classroomNoteBody,
  selectClassroomNotes,
  CLASSROOM_NOTE_BUDGET_TIGHT,
  type ClassroomNote,
} from "./prep/classroom";
import { buildClassroomTools } from "./prep/tools";
import { ADD_SOURCE_PROMPT, buildSourceTools } from "./prep/source-tool";
import {
  buildSavedArticleTools,
  prepareSavedArticle,
  SAVED_ARTICLES_PROMPT,
  type SavedArticleStore,
} from "./saved-article-tools";
import { hasSavedArticles, loadSavedArticles, type SavedArticle } from "./saved-articles";
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
} from "../ai/subagent";
import type { PrepPipeline } from "./prep/pipeline";

// Auto-explanation kickoff (docs/03: the bubble starts explaining, unprompted).
export const EXPLAIN_KICKOFF =
  "Please explain the passage I just marked, using the reading context above.";
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
// Observations kept when the ladder trims the opening snapshot.
const OBSERVATION_KEEP_TIGHT = 3;

// The real kept-article store. A failed read answers "nothing kept" rather than
// failing the turn: the tools are an offer, and a turn the reader is waiting for
// is not the place to raise a store problem the library screen will raise.
const savedArticleStoreOnDisk: SavedArticleStore = {
  any: () => hasSavedArticles().catch(() => false),
  all: () => loadSavedArticles().catch((): SavedArticle[] => []),
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

export interface ReadingTurnInput {
  // The open book's content hash: keys its threads, prep notes and figure crops.
  bookId: string;
  threadId: string;
  // The AI-pen mark hosting this thread; empty string for the book-level thread.
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
  classroom: boolean;
  settings: Settings;
  // Read live rather than captured: a classroom tool invoked mid-turn should see
  // the pipeline the reader is on now, matching the pre-extraction behaviour.
  getPipeline: () => PrepPipeline | null;
  distillAnnotations: () => DistillAnnotation[];
  // The store of articles the reader kept on the info side (docs/21). Injected so
  // the assembly runs with no AppData. Only classroom turns touch it at all, and
  // they ask `any` — the records themselves are read when a tool actually runs.
  savedArticles?: SavedArticleStore;
  // The turn's abort signal. It drops the assembly when the reader has already
  // moved on, and it is the signal the research sub-agent runs under, so hanging
  // up mid-search kills the run rather than leaving it fetching in the background.
  signal?: AbortSignal;
  // One line for the reader while the research sub-agent runs. Never its tool
  // calls: what arrives here is a phase, the label this turn wrote, and a round
  // count (src/ai/subagent/types.ts).
  onSubagentProgress?: (progress: SubagentProgress) => void;
  // The sub-agent turn behind research_literature. Injected so the assembly and
  // its research tool can be exercised with no provider, no key and no network.
  runSubagentTurn?: SubagentTurnFn;
  // Rasterize one whole page of the open book (the visual window around the
  // reader's highlight, figures/page-window.ts). Injected for the same reason
  // the figure renderer is: it needs a canvas and a loaded pdf.js, and the
  // assembly around it has to run under `bun test`.
  renderPage?: PageRenderFn;
  // The channel draw_diagram / update_diagram write through: the caller owns the
  // chat rows and the thread file, this assembly only mounts the tools. Absent
  // in headless tests and on any surface with no card rows, and then the two
  // tools are not mounted at all and the prompt does not offer them.
  diagrams?: DiagramToolDeps;
}

// One page of the open book as an image, with the pixel size it came out at so
// the turn can price what it is about to send.
export interface RenderedPage extends PageWindowImage {
  width: number;
  height: number;
}

export type PageRenderFn = (page: number, widthPx: number) => Promise<RenderedPage | null>;

export interface ReadingTurn {
  systemPrompt: string;
  tools: AgentTool[];
  messages: ReadingTurnMessage[];
  // Whether this turn was actually assembled as a classroom turn. Not the same
  // as the caller's classroom flag: classroom mode needs the book's text, and a
  // turn taken before extraction finishes runs the companion prompt instead.
  // The caller reports which face it was (platform/app/cache-telemetry.ts), so
  // it has to be told which one it got rather than which one it asked for.
  classroom: boolean;
  // A low-key line for the end of the reply, naming what this turn had to leave
  // out, or "" when nothing was dropped that the user has a stake in.
  notice: string;
  // Set when the turn cannot be assembled small enough to leave the model room
  // to answer. Show this instead of sending; retrying changes nothing, since the
  // same inputs assemble the same call.
  refusal: string;
}

// Why a turn produced no reply. The distinction the UI has to make is not what
// went wrong but what a second press would change.
//
//   "refusal" — the turn was declined for a reason it can state: it did not fit
//     the model's window (before sending, or after growing mid-flight), or the
//     loop went round and round without answering. Every request that went out
//     was answered; nothing was unreachable.
//   "error" — the call itself did not complete: no network, a rejected key, a
//     provider failure. The reason is outside the conversation, so it may well
//     be gone by the next press.
export type TurnFailure = "refusal" | "error";

export interface TurnFailureView {
  // What the row says, in full.
  text: string;
  // Where that sentence goes on the row. "reply" stands in for the answer that
  // never came: it takes the row's text and is drawn as a failure. "notice" is
  // the app talking about a turn that reached the model and came back without
  // one; it sits beside the row's text rather than in it, and so is never
  // replayed as the assistant's own words next turn (turn-rows.ts).
  as: "reply" | "notice";
  // The toast to raise, or null for none. A refusal raises none: it is already
  // sitting where the reply would be, and a red banner over it would say the
  // opposite of what it says.
  toast: string | null;
  // Whether to offer Retry. False for a refusal — the same inputs are declined
  // the same way, so the button would only promise a second identical stop.
  retry: boolean;
}

// One place deciding how a turn that produced no reply is shown, so the two
// refusal paths (declined before sending, declined mid-loop) cannot drift apart
// or drift into the error path's wording.
export function turnFailureView(kind: TurnFailure, message: string): TurnFailureView {
  if (kind === "refusal") return { text: message, as: "notice", toast: null, retry: false };
  return {
    text: `⚠️ Couldn't reach the model. ${message}`,
    as: "reply",
    toast: "AI reply failed",
    retry: true,
  };
}

// The same failure, for a turn whose conversation is no longer on screen: it
// kept running after the bubble was closed (docs/03), so the row it writes is
// nowhere to be seen and a toast is the only place left to say so. Named by the
// marked passage, since several threads can be running at once.
export function backgroundFailureToast(kind: TurnFailure, markedText: string): string {
  const trimmed = markedText.trim().replace(/\s+/g, " ");
  const where = trimmed ? `“${trimmed.length > 40 ? `${trimmed.slice(0, 40)}…` : trimmed}”` : "a closed conversation";
  return kind === "refusal" ? `AI reply stopped on ${where}` : `AI reply failed on ${where}`;
}

// The configured model's metadata (its context window is all we want). A
// synchronous catalog lookup — no credentials, no network. Null when settings
// name a provider or model pi doesn't know, in which case the turn is assembled
// without a budget rather than blocked on one. Shared with the rehearsal turn
// (talks/turn.ts): the lookup is the same one either way.
export function configuredModel(s: Settings): Model<Api> | null {
  const provider = providers[s.defaultProviderId as ProviderId];
  if (!provider) return null;
  return provider.getModels().find((m) => m.id === s.defaultModelId) ?? null;
}

// Assemble the live reading context, tools and replayed history for one turn.
// Returns null when the signal aborts while the history is being read (the
// caller has already been superseded).
export async function buildReadingTurn(input: ReadingTurnInput): Promise<ReadingTurn | null> {
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
    classroom,
    settings: s,
    getPipeline,
    distillAnnotations,
    savedArticles = savedArticleStoreOnDisk,
    signal,
    onSubagentProgress,
    runSubagentTurn = runSubagentTurnLive,
    renderPage = async (pageNo, widthPx) => {
      if (!buffer) return null;
      const r = await renderPageImage(bookId, buffer, pageNo, widthPx);
      return r ? { data: r.base64, mediaType: r.mimeType, width: r.width, height: r.height } : null;
    },
    diagrams,
  } = input;
  const { topicId, topicName, fileName, pageLabel, pageIndex, files } = context;
  const materials = await gatherTopicMaterials(files, bookId, currentFulltext, annotations);
  // The book-level thread (top-bar AI button) has no mark: its position is
  // wherever the reader currently is, and it carries no selection-derived
  // context (marked passage / surrounding text).
  const isBook = annotationId === "";
  const currentPage = pageIndex !== null ? pageIndex + 1 : null;
  const page = isBook
    ? currentPage
    : annotationPage(ann as { position?: { pageIndex?: number } } | undefined);
  const chapterTitle =
    currentFulltext && page ? chapterAt(currentFulltext, page)?.title ?? null : null;
  const surrounding =
    !isBook && currentFulltext && page ? surroundingText(currentFulltext, page) : "";
  const booklist: BooklistItem[] = materials
    .filter((m) => m.path !== bookId)
    .map((m) => ({
      label: m.label,
      pageCount: m.fulltext?.pages.length ?? 0,
      annotationCount: m.annotations.length,
      fulltextAvailable: m.fulltext?.status === "ok",
      isCurrent: false,
    }));
  const selectionText = typeof ann?.text === "string" ? ann.text : "";
  const selectionComment = typeof ann?.comment === "string" ? ann.comment : undefined;

  // Classroom mode swaps the context assembly (docs/09): the whole survey
  // rides in a stable prompt prefix, this chapter's prep notes follow, and
  // paper tools join the M6 reading tools. Companion mode is untouched.
  let tools = buildReadingTools({ currentFulltext, materials });
  // Per-topic AI observations (M8): the observation tools join the same loop as
  // the reading tools; the opening snapshot rides the system prompt below.
  let observationSection = "";
  let observationSectionTight = "";
  // Whether the snapshot carries anything, as opposed to the tool guidance that
  // rides with it either way. The classroom prompt points at it by name.
  let hasObservations = false;
  if (topicId) {
    const observationsAdapter = getObservationAdapter(topicId);
    const observations = await observationsAdapter.listObservations().catch((): Observation[] => []);
    tools = [
      ...tools,
      ...buildObservationTools(observationsAdapter, {
        onWrite: () => notifyObservationChange(topicId),
      }),
    ];
    const snapshot = buildObservationSnapshot(observations);
    hasObservations = snapshot !== "";
    observationSection = observationPromptSection(snapshot, true);
    const recent = [...observations]
      .sort((a, b) => b.updated.localeCompare(a.updated))
      .slice(0, OBSERVATION_KEEP_TIGHT);
    observationSectionTight = observationPromptSection(buildObservationSnapshot(recent), true);
  }
  // Figure catalog + view_figure tool (M9): the model can cite figures as
  // [fig:N] (rendered inline in chat) and open one to actually see it.
  const figureCatalog = figuresIndex.length
    ? buildFigureCatalog(figuresIndex, { currentPage: page ?? currentPage ?? null })
    : "";
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
  // Only on a mark-anchored thread. The book-level thread's page moves with the
  // reader's scrolling, so a window sent on one of its turns says nothing about
  // where the earlier ones were, and the history line that stands in for the
  // pictures next turn would be a guess.
  const pageWindow: PageWindowPlan | null = isBook
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

  const prepState = getPipeline()?.snapshot().state ?? null;

  // Link ingestion (docs/09): when a prep pipeline exists for this book, the
  // model can ingest a user-pasted URL with add_source and read it with the
  // paper tools — in companion mode too, so "compare this link with ch.3"
  // works outside the classroom. Classroom mode wires the paper tools below
  // with its own prompt; here we add them for companion mode.
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
    if (!classroom) {
      tools = [...tools, ...buildClassroomTools(() => livePipeline.snapshot().state ?? prepState!)];
    }
  }

  const isClassroom = classroom && currentFulltext?.status === "ok";
  // Every prep note there is, capped, and the same list under a quarter of the
  // budget for when the window is tight (the "prep-notes-trim" rung).
  //
  // Which chapter the reader is scrolled to used to decide *whether* a note rode
  // along at all, and it is a bad witness: a reader parked on p.12 of the
  // embodied-AI survey was two days into chapter 4, and the turn carried one of
  // the twenty notes. The position now only orders them, and only once the cap
  // bites (prep/classroom.ts) — including in the tight list, which is why that
  // one is a smaller budget rather than a filter on the chapter number.
  //
  // The body stored here is the body that gets printed: classroomNoteBody is the
  // one place a stored note becomes prompt text, so what selectClassroomNotes
  // prices is what the prompt carries.
  let classroomNotes: ClassroomNote[] = [];
  let classroomNotesTight: ClassroomNote[] = [];
  if (isClassroom) {
    const here = page ?? (pageIndex !== null ? pageIndex + 1 : 1);
    const chapterIdx = prepState ? chapterIndexForPage(prepState.chapters, here) : 1;
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
    if (prepState) {
      tools = [...tools, ...buildClassroomTools(() => getPipeline()?.snapshot().state ?? prepState)];
    }
  }

  // Drawing (docs/40). Classroom mode only, and only where the caller owns chat
  // rows to put a card in: mounting the tools is promising the reader a picture,
  // so a surface that cannot show one must not be told it can draw. Not gated on
  // the document having figures — the commonest use is a structure the book
  // never drew at all.
  const canDraw = isClassroom && !!diagrams;
  if (canDraw && diagrams) tools = [...tools, ...buildDiagramTools(diagrams)];

  // Saved info articles (docs/21): in classroom mode the model can list what the
  // reader kept and put one into this book's prep list, then read it with
  // read_paper. Gated on there being something kept — a tool whose only possible
  // answer is "nothing" is one the model learns to call for nothing — and on the
  // prep state existing, since read_paper is what the answer sends it to.
  // Companion mode mounts neither: the prep list is the classroom's list.
  let savedArticlesMounted = false;
  if (isClassroom && livePipeline && prepState) {
    savedArticlesMounted = await savedArticles.any().catch(() => false);
    if (savedArticlesMounted) {
      // The records are read on the first tool call, not here: reading them
      // sanitizes every stored body, and most turns mount these tools without the
      // model ever reaching for them. Read once per turn, however often it does.
      let records: Promise<SavedArticle[]> | null = null;
      const list = () => (records ??= savedArticles.all().catch((): SavedArticle[] => []));
      tools = [
        ...tools,
        ...buildSavedArticleTools({
          list,
          add: async (article) => {
            const prepared = prepareSavedArticle(article);
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
      ];
    }
  }

  // Academic literature (docs/24, docs/25), mounted on every reading turn. Not
  // gated on the prep pipeline or on classroom mode: "what is the latest research
  // on this" is a question the reader can have on any page of any book, and a tool
  // that is only sometimes there is one the model cannot learn to reach for.
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
  // The cross-scenario user profile: who the companion is reading with, so it
  // pitches explanation depth to their background. Empty profile → no section.
  // The declared half and the AI's own guess section go in separately, and the
  // guesses go in labelled as guesses (observation/profile/guess.ts).
  const identity = profileForPrompt(await assembleIdentity().catch(() => ""));
  const profileSection = readerProfileSection(identity.declared, identity.guesses);
  // The whole-book outline from the reader's notes (docs/14), when they exist.
  const notesOverview = notesOverviewSection(await readOverviewNote(bookId));
  // A booklist entry with no text layer and no marks is a title the model can do
  // nothing with; the first thing to go when the window is tight.
  const booklistThin = booklist.filter((m) => m.fulltextAvailable || m.annotationCount > 0);
  // What the prompt is allowed to say exists. The tools paragraph is rendered
  // from these names, so a tool that was not mounted — read_annotations on a book
  // with no marks, read_paper with no prep run — is not announced. Taken after
  // the whole list is assembled: the names the paragraph does not know are simply
  // not in its table (platform/app/context.ts).
  const toolNames = tools.map((t) => t.name);

  // The prompt as a function of what this turn had to give up (src/budget). The
  // pieces named by a ReadingReductionId are the optional ones; everything else — the
  // role, the instructions, the marked passage and its note, the position, the
  // prep status list — is assembled the same way no matter how tight the window
  // is.
  function composePrompt(dropped: ReadonlySet<ReadingReductionId>): string {
    const catalog = dropped.has("figure-catalog") ? "" : figureCatalog;
    let prompt: string;
    if (isClassroom) {
      prompt = buildClassroomSystemPrompt({
        topicName,
        surveyName: fileName,
        fulltext: currentFulltext as Fulltext,
        pageLabel,
        chapterTitle,
        selectionText,
        selectionComment,
        notes: dropped.has("prep-notes-trim") ? classroomNotesTight : classroomNotes,
        prep: prepState,
        toolNames,
        // The classroom prompt takes the whole visual-aid ladder here, not the
        // bare figure list: when to cite a figure and when to draw one is one
        // judgement and is written in one place (reading/diagrams/prompt.ts).
        figureCatalog: buildVisualAidGuidance({
          figures: figuresIndex,
          currentPage: page ?? currentPage ?? null,
          omitCatalog: dropped.has("figure-catalog"),
          canDraw,
        }),
        hasObservations,
        inlineSurvey: !dropped.has("classroom-inline"),
      });
      // Classroom mode shares the AI output-language setting; the companion
      // prompt gets it inside buildSystemPrompt.
      const lang = languageInstruction(s.aiLanguage);
      if (lang) prompt += "\n\n" + lang;
    } else {
      prompt = buildSystemPrompt({
        topicName,
        fileName,
        pageLabel,
        selectionText,
        selectionComment,
        chapterTitle,
        surroundingText: surrounding,
        fulltextAvailable: currentFulltext?.status === "ok",
        materials: dropped.has("booklist-thin") ? booklistThin : booklist,
        figureCatalog: catalog,
        toolNames,
        bookLevel: isBook,
        aiLanguage: s.aiLanguage,
      });
    }
    // Said only when the pictures are actually going: a prompt that describes a
    // window the ladder took back is a prompt that tells the model to look at
    // something that is not there.
    if (pageWindow && pageImages.length > 0 && !dropped.has("page-window")) {
      prompt += "\n\n" + pageWindowPrompt(pageWindow);
    }
    const observed = dropped.has("observation-trim") ? observationSectionTight : observationSection;
    if (observed) prompt += "\n\n" + observed;
    if (profileSection && !dropped.has("reader-profile")) prompt += "\n\n" + profileSection;
    if (notesOverview && !dropped.has("notes-overview")) prompt += "\n\n" + notesOverview;
    if (canIngestUrl) prompt += "\n\n" + ADD_SOURCE_PROMPT;
    if (savedArticlesMounted) prompt += "\n\n" + SAVED_ARTICLES_PROMPT;
    prompt += "\n\n" + FIND_PAPER_PROMPT;
    prompt += "\n\n" + RESEARCH_PROMPT;
    return prompt;
  }

  const threadMsgs = getThread(bookId, threadId)?.messages ?? [];
  const prior = await Promise.all(
    threadMsgs.map(async (m) => ({
      role: m.role,
      text: m.text,
      images: m.images?.length ? await readThreadImages(threadId, m.images) : undefined,
    })),
  );
  if (signal?.aborted) return null;
  // Replay only the tail of a long thread, and before the older turns fall
  // out of context, run the fallback distillation (docs/02: hangup is the
  // main trigger, the trim is the backstop).
  if (prior.length > HISTORY_KEEP && topicId) {
    void distillThread(
      {
        topicId,
        topicName,
        bookId,
        bookName: fileName,
        threadId,
        trigger: "trim",
        annotationId,
        page,
        markedText: selectionText,
        messages: threadMsgs.map(({ role, text, ts }) => ({ role, text, ts })),
        annotations: distillAnnotations(),
      },
      TRIM_DISTILL_MIN_NEW,
    );
  }

  function composeMessages(dropped: ReadonlySet<ReadingReductionId>): ReadingTurnMessage[] {
    const keep = dropped.has("history-trim") ? HISTORY_KEEP_TIGHT : HISTORY_KEEP;
    const tail = prior.length > keep ? prior.slice(prior.length - keep) : prior;
    const msgs: ReadingTurnMessage[] = [{ role: "user" as const, text: EXPLAIN_KICKOFF }, ...tail];
    // The pictures ride the message being answered and nothing else. Every
    // earlier turn of this thread was sent the same window when it was the
    // current one, so those messages carry the line that says so instead — one
    // window in context at a time, however long the conversation runs.
    if (!pageWindow || pageImages.length === 0 || dropped.has("page-window")) return msgs;
    return attachPageWindow(msgs, pageWindow, windowImages);
  }

  // Fit the call to the model's context window before it is sent. Left
  // unchecked, an over-full request comes back one token long with a normal
  // `done` and no error — a one-word reply, or a "malformed" answer wherever one
  // gets parsed (src/budget/estimate.ts).
  const model = configuredModel(s);
  if (!model) {
    reportPageWindow(threadId, pageWindow, pageImages, true);
    return {
      systemPrompt: composePrompt(new Set()),
      tools,
      messages: composeMessages(new Set()),
      classroom: isClassroom,
      notice: "",
      refusal: "",
    };
  }
  // The catalog is only redundant while nothing is leaning on it: once the
  // conversation has cited a [fig:N], dropping the list of figures makes the
  // reference dangle. And the two classroom rungs are only worth pricing when
  // this turn is a classroom turn — composing the prompt to price them otherwise
  // costs a full re-render for nothing.
  const skip = new Set<ReadingReductionId>();
  if (composeMessages(new Set()).some((m) => m.text.includes("[fig:"))) skip.add("figure-catalog");
  if (!isClassroom) {
    skip.add("classroom-inline");
    skip.add("prep-notes-trim");
  }
  if (!pageWindow || pageImages.length === 0) skip.add("page-window");

  const fitted = fitToBudget<ReadingReductionId, ReadingTurnMessage>({
    model,
    tools,
    composePrompt,
    composeMessages,
    toPi: toPiMessages,
    rungs: READING_LADDER,
    purpose: "chat",
    skip,
  });
  reportPageWindow(threadId, pageWindow, pageImages, !fitted.dropped.has("page-window"));
  return {
    systemPrompt: fitted.systemPrompt,
    tools,
    messages: fitted.messages,
    classroom: isClassroom,
    notice: fitted.notice,
    refusal: fitted.refusal,
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
