// Assembly of one reading-companion turn (M6/M9, docs/03, docs/09, docs/14,
// docs/24): system prompt, tool set and replayed history for the AI-pen bubble and
// the book-level thread. Extracted from App so the branching (classroom vs
// companion, figure tools, link ingestion, literature search, memory, history
// trimming) is testable on its own. Pure assembly plus reads — it never touches React state
// and never starts the stream; the caller owns runAgentTurn.

import type { Api, Context as PiContext, Model } from "@earendil-works/pi-ai";
import type { AgentTool } from "../ai/agent";
import {
  annotationPage,
  buildReadingTools,
  notesOverviewSection,
  surroundingText,
} from "./context";
import type { AnnotationLite, TopicMaterial } from "../fulltext/format";
import { modelSupportsImages, type ProviderId } from "../ai/aiClient";
import { providers, toPiMessages } from "../ai/providers";
import {
  contextBudget,
  estimateContextTokens,
  estimateTextTokens,
  fitsBudget,
  planReductions,
  type ReductionId,
} from "../budget";
import type { Annotation } from "../platform/app/reader-contract";
import { buildSystemPrompt, readerProfileSection, type BooklistItem } from "../platform/app/context";
import { languageInstruction, type Settings } from "../platform/app/settings";
import { loadAnnotations } from "../platform/app/annotations";
import { getThread, readThreadImages } from "../platform/app/threads";
import { chapterAt } from "../fulltext/query";
import { getFulltext } from "../fulltext/store";
import type { Fulltext } from "../fulltext/types";
import { buildFigureCatalog } from "./figures/catalog";
import { buildFigureTools } from "./figures/tools";
import { renderFigure } from "./figures/render";
import type { Figure } from "./figures/types";
import {
  assembleIdentity,
  buildMemorySnapshot,
  buildMemoryTools,
  distillThread,
  getMemoryAdapter,
  memoryPromptSection,
  notifyMemoryChange,
  type DistillAnnotation,
  type MemoryEntry,
} from "../memory";
import { readOverviewNote } from "./notes/store";
import { chapterIndexForPage, papersForChapter } from "./prep/scheduler";
import { paperFulltextHash, readPrepNote } from "./prep/store";
import { parseNote } from "./prep/notes";
import { buildClassroomSystemPrompt, type ClassroomNote } from "./prep/classroom";
import { buildClassroomTools } from "./prep/tools";
import { ADD_SOURCE_PROMPT, buildSourceTools } from "./prep/source-tool";
import { prepFetch } from "./prep/http";
import { searchPapers, type PaperSearchFn } from "./prep/paper-search";
import { buildPaperSearchTools, SEARCH_PAPERS_PROMPT } from "./prep/search-tool";
import { buildCitationTools, SEARCH_CITATIONS_PROMPT } from "./prep/citation-tool";
import type { PrepPipeline } from "./prep/pipeline";

// Auto-explanation kickoff (docs/03: the bubble starts explaining, unprompted).
export const EXPLAIN_KICKOFF =
  "Please explain the passage I just marked, using the reading context above.";
// Replayed thread history is trimmed to this many messages per turn; crossing
// the cap fires the fallback memory distillation before older turns fall out
// of context (docs/02: hangup is the main trigger, trimming the backstop).
export const HISTORY_KEEP = 40;
// The trim-triggered distillation re-fires only after this many new messages.
export const TRIM_DISTILL_MIN_NEW = 20;
// How short the replayed history gets when the budget ladder reaches its last
// rung. Three exchanges: above the two rounds that are never dropped, below
// anything that would still be called a conversation.
export const HISTORY_KEEP_TIGHT = 6;
// Memory observations kept when the ladder trims the opening snapshot.
const MEMORY_KEEP_TIGHT = 3;

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
  signal?: AbortSignal;
}

export interface ReadingTurn {
  systemPrompt: string;
  tools: AgentTool[];
  messages: ReadingTurnMessage[];
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
  // What the failed reply row says, in full.
  text: string;
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
  if (kind === "refusal") return { text: message, toast: null, retry: false };
  return {
    text: `⚠️ Couldn't reach the model. ${message}`,
    toast: "AI reply failed",
    retry: true,
  };
}

// The configured model's metadata (its context window is all we want). A
// synchronous catalog lookup — no credentials, no network. Null when settings
// name a provider or model pi doesn't know, in which case the turn is assembled
// without a budget rather than blocked on one.
function configuredModel(s: Settings): Model<Api> | null {
  const provider = providers[s.defaultProviderId as ProviderId];
  if (!provider) return null;
  return provider.getModels().find((m) => m.id === s.defaultModelId) ?? null;
}

function piContext(
  systemPrompt: string,
  messages: ReadingTurnMessage[],
  tools: AgentTool[],
): PiContext {
  return {
    systemPrompt,
    messages: toPiMessages(messages),
    tools: tools.map(({ name, description, parameters }) => ({ name, description, parameters })),
  };
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
    signal,
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
  // Per-topic memory (M8): the memory tools join the same loop as the
  // reading tools; the opening snapshot rides the system prompt below.
  let memorySection = "";
  let memorySectionTight = "";
  if (topicId) {
    const memory = getMemoryAdapter(topicId);
    const observations = await memory.listObservations().catch((): MemoryEntry[] => []);
    tools = [...tools, ...buildMemoryTools(memory, { onWrite: () => notifyMemoryChange(topicId) })];
    memorySection = memoryPromptSection(buildMemorySnapshot(observations), true);
    const recent = [...observations]
      .sort((a, b) => b.updated.localeCompare(a.updated))
      .slice(0, MEMORY_KEEP_TIGHT);
    memorySectionTight = memoryPromptSection(buildMemorySnapshot(recent), true);
  }
  // Figure catalog + view_figure tool (M9): the model can cite figures as
  // [fig:N] (rendered inline in chat) and open one to actually see it.
  const figureCatalog = figuresIndex.length
    ? buildFigureCatalog(figuresIndex, { currentPage: page ?? currentPage ?? null })
    : "";
  if (figuresIndex.length) {
    const supportsImages = modelSupportsImages(
      s.defaultProviderId as ProviderId,
      s.defaultModelId as string,
    );
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
  let classroomNotes: ClassroomNote[] = [];
  if (isClassroom) {
    const here = page ?? (pageIndex !== null ? pageIndex + 1 : 1);
    const chapterIdx = prepState ? chapterIndexForPage(prepState.chapters, here) : 1;
    const notePapers = prepState ? papersForChapter(prepState.papers, chapterIdx) : [];
    classroomNotes = (
      await Promise.all(
        notePapers.map(async (p): Promise<ClassroomNote | null> => {
          const raw = await readPrepNote(bookId, p.slug);
          return raw ? { slug: p.slug, title: p.title, body: parseNote(raw).body } : null;
        }),
      )
    ).filter((n): n is ClassroomNote => n !== null);
    if (prepState) {
      tools = [...tools, ...buildClassroomTools(() => getPipeline()?.snapshot().state ?? prepState)];
    }
  }

  // Whether anything that reads *this book* was wired. Captured before the
  // literature search joins the list, because the tools paragraph in the system
  // prompt describes the reading tools by name: a book with no text layer mounts
  // none of them, and search_papers must not make that paragraph appear.
  const hasReadingTools = tools.length > 0;
  // Academic literature search (docs/24), mounted on every reading turn. Not
  // gated on the prep pipeline or on classroom mode: "what is the latest research
  // on this" is a question the reader can have on any page of any book, and a tool
  // that is only sometimes there is one the model cannot learn to reach for.
  const literatureDeps = {
    fetchFn: prepFetch,
    s2ApiKey: s.semanticScholarApiKey ?? undefined,
  };
  tools = [
    ...tools,
    ...buildPaperSearchTools({
      search: ((query, opts) =>
        searchPapers(query, opts, literatureDeps)) satisfies PaperSearchFn,
      canIngest: canIngestUrl,
    }),
    // The citation graph rides along with the topic search on the same reasoning:
    // the reader's way into recent work often starts at a citation in the book they
    // are holding, which does not depend on prep or on classroom mode either.
    ...buildCitationTools({ ...literatureDeps, canIngest: canIngestUrl }),
  ];
  // The cross-scenario user profile: who the companion is reading with, so it
  // pitches explanation depth to their background. Empty profile → no section.
  const profileSection = readerProfileSection(await assembleIdentity().catch(() => ""));
  // The whole-book outline from the reader's notes (docs/14), when they exist.
  const notesOverview = notesOverviewSection(await readOverviewNote(bookId));
  // A booklist entry with no text layer and no marks is a title the model can do
  // nothing with; the first thing to go when the window is tight.
  const booklistThin = booklist.filter((m) => m.fulltextAvailable || m.annotationCount > 0);

  // The prompt as a function of what this turn had to give up (src/budget). The
  // pieces named by a ReductionId are the optional ones; everything else — the
  // role, the instructions, the marked passage and its note, the position, this
  // chapter's prep notes — is assembled the same way no matter how tight the
  // window is.
  function composePrompt(dropped: ReadonlySet<ReductionId>): string {
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
        notes: classroomNotes,
        prep: prepState,
        hasTools: hasReadingTools,
        figureCatalog: catalog,
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
        hasTools: hasReadingTools,
        bookLevel: isBook,
        aiLanguage: s.aiLanguage,
      });
    }
    const memory = dropped.has("memory-trim") ? memorySectionTight : memorySection;
    if (memory) prompt += "\n\n" + memory;
    if (profileSection && !dropped.has("reader-profile")) prompt += "\n\n" + profileSection;
    if (notesOverview && !dropped.has("notes-overview")) prompt += "\n\n" + notesOverview;
    if (canIngestUrl) prompt += "\n\n" + ADD_SOURCE_PROMPT;
    prompt += "\n\n" + SEARCH_PAPERS_PROMPT;
    prompt += "\n\n" + SEARCH_CITATIONS_PROMPT;
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
        bookName: fileName,
        threadId,
        annotationId,
        page,
        markedText: selectionText,
        messages: threadMsgs.map(({ role, text, ts }) => ({ role, text, ts })),
        annotations: distillAnnotations(),
      },
      TRIM_DISTILL_MIN_NEW,
    );
  }

  function composeMessages(dropped: ReadonlySet<ReductionId>): ReadingTurnMessage[] {
    const keep = dropped.has("history-trim") ? HISTORY_KEEP_TIGHT : HISTORY_KEEP;
    const tail = prior.length > keep ? prior.slice(prior.length - keep) : prior;
    return [{ role: "user" as const, text: EXPLAIN_KICKOFF }, ...tail];
  }

  const none: ReadonlySet<ReductionId> = new Set();
  let systemPrompt = composePrompt(none);
  let messages = composeMessages(none);
  let notice = "";
  let refusal = "";

  // Fit the call to the model's context window before it is sent. Left
  // unchecked, an over-full request comes back one token long with a normal
  // `done` and no error — a one-word reply, or a "malformed" answer wherever one
  // gets parsed (src/budget/estimate.ts).
  const model = configuredModel(s);
  if (model) {
    const budget = contextBudget(model, piContext(systemPrompt, messages, tools));
    if (!fitsBudget(budget, "chat")) {
      // Price each rung by composing without it. The classroom body dominates,
      // so it is held out of the base and priced as the difference — the small
      // rungs are then measured against a prompt that does not carry the book.
      const withoutBook: ReadonlySet<ReductionId> = new Set<ReductionId>(["classroom-inline"]);
      const baseTokens = estimateTextTokens(composePrompt(withoutBook));
      const priceOf = (id: ReductionId): number =>
        Math.max(0, baseTokens - estimateTextTokens(composePrompt(new Set([...withoutBook, id]))));
      const tightMessages = composeMessages(new Set<ReductionId>(["history-trim"]));
      // The catalog is only redundant while nothing is leaning on it: once the
      // conversation has cited a [fig:N], dropping the list of figures makes the
      // reference dangle.
      const figuresInPlay = messages.some((m) => m.text.includes("[fig:"));
      const savings: Partial<Record<ReductionId, number>> = {
        "figure-catalog": figuresInPlay ? 0 : priceOf("figure-catalog"),
        "reader-profile": priceOf("reader-profile"),
        "notes-overview": priceOf("notes-overview"),
        "booklist-thin": priceOf("booklist-thin"),
        "memory-trim": priceOf("memory-trim"),
        "classroom-inline": Math.max(0, estimateTextTokens(systemPrompt) - baseTokens),
        "history-trim": Math.max(
          0,
          estimateContextTokens({ messages: toPiMessages(messages) }) -
            estimateContextTokens({ messages: toPiMessages(tightMessages) }),
        ),
      };
      // Tool results are stubbed inside the agent loop, not here; this assembly
      // has no results yet, so that rung has nothing to offer.
      const total = Object.values(savings).reduce((n, v) => n + (v ?? 0), 0);
      const plan = planReductions({
        contextWindow: budget.contextWindow,
        purpose: "chat",
        used: budget.used,
        floorTokens: budget.used - total,
        savings,
      });
      if (plan.apply.length > 0) {
        const dropped = new Set(plan.apply);
        systemPrompt = composePrompt(dropped);
        messages = composeMessages(dropped);
      }
      notice = plan.notice;
      refusal = plan.refusal;
    }
  }

  return { systemPrompt, tools, messages, notice, refusal };
}

// An annotation flattened for the read_annotations tool: 1-based page + selected
// text + comment. Skips annotations with neither text nor comment (e.g. legacy
// image regions).
function toAnnotationLite(ann: Annotation): AnnotationLite | null {
  const text = typeof ann.text === "string" ? ann.text.trim() : "";
  const comment = typeof ann.comment === "string" ? ann.comment.trim() : "";
  if (!text && !comment) return null;
  return { page: annotationPage(ann as { position?: { pageIndex?: number } }), text, comment };
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
