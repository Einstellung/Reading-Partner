// Assembly of one reading-companion turn (M6/M9, docs/03, docs/09, docs/14):
// system prompt, tool set and replayed history for the AI-pen bubble and the
// book-level thread. Extracted from App so the branching (classroom vs
// companion, figure tools, link ingestion, memory, history trimming) is
// testable on its own. Pure assembly plus reads — it never touches React state
// and never starts the stream; the caller owns runAgentTurn.

import type { AgentTool } from "../ai/agent";
import {
  annotationPage,
  buildReadingTools,
  notesOverviewSection,
  surroundingText,
} from "./context";
import type { AnnotationLite, TopicMaterial } from "../fulltext/format";
import { modelSupportsImages, type ProviderId } from "../ai/aiClient";
import type { Annotation } from "../app/reader-contract";
import { buildSystemPrompt, readerProfileSection, type BooklistItem } from "../app/context";
import { languageInstruction, type Settings } from "../app/settings";
import { loadAnnotations } from "../app/annotations";
import { getThread, readThreadImages } from "../app/threads";
import { chapterAt } from "../fulltext/query";
import { getFulltext } from "../fulltext/store";
import type { Fulltext } from "../fulltext/types";
import { buildFigureCatalog } from "../figures/catalog";
import { buildFigureTools } from "../figures/tools";
import { renderFigure } from "../figures/render";
import type { Figure } from "../figures/types";
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
import { readOverviewNote } from "../notes/store";
import { chapterIndexForPage, papersForChapter } from "../prep/scheduler";
import { paperFulltextHash, readPrepNote } from "../prep/store";
import { parseNote } from "../prep/notes";
import { buildClassroomSystemPrompt, type ClassroomNote } from "../prep/classroom";
import { buildClassroomTools } from "../prep/tools";
import { ADD_SOURCE_PROMPT, buildSourceTools } from "../prep/source-tool";
import type { PrepPipeline } from "../prep/pipeline";

// Auto-explanation kickoff (docs/03: the bubble starts explaining, unprompted).
export const EXPLAIN_KICKOFF =
  "Please explain the passage I just marked, using the reading context above.";
// Replayed thread history is trimmed to this many messages per turn; crossing
// the cap fires the fallback memory distillation before older turns fall out
// of context (docs/02: hangup is the main trigger, trimming the backstop).
export const HISTORY_KEEP = 40;
// The trim-triggered distillation re-fires only after this many new messages.
export const TRIM_DISTILL_MIN_NEW = 20;

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
  let systemPrompt: string;
  let tools = buildReadingTools({ currentFulltext, materials });
  // Per-topic memory (M8): the memory tools join the same loop as the
  // reading tools; the opening snapshot rides the system prompt below.
  let memorySection = "";
  if (topicId) {
    const memory = getMemoryAdapter(topicId);
    const observations = await memory.listObservations().catch((): MemoryEntry[] => []);
    tools = [...tools, ...buildMemoryTools(memory, { onWrite: () => notifyMemoryChange(topicId) })];
    memorySection = memoryPromptSection(buildMemorySnapshot(observations), true);
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

  if (classroom && currentFulltext?.status === "ok") {
    const here = page ?? (pageIndex !== null ? pageIndex + 1 : 1);
    const chapterIdx = prepState ? chapterIndexForPage(prepState.chapters, here) : 1;
    const notePapers = prepState ? papersForChapter(prepState.papers, chapterIdx) : [];
    const notes = (
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
    systemPrompt = buildClassroomSystemPrompt({
      topicName,
      surveyName: fileName,
      fulltext: currentFulltext,
      pageLabel,
      chapterTitle,
      selectionText,
      selectionComment,
      notes,
      prep: prepState,
      hasTools: tools.length > 0,
      figureCatalog,
    });
    // Classroom mode shares the AI output-language setting; the companion
    // prompt gets it inside buildSystemPrompt.
    const lang = languageInstruction(s.aiLanguage);
    if (lang) systemPrompt += "\n\n" + lang;
  } else {
    systemPrompt = buildSystemPrompt({
      topicName,
      fileName,
      pageLabel,
      selectionText,
      selectionComment,
      chapterTitle,
      surroundingText: surrounding,
      fulltextAvailable: currentFulltext?.status === "ok",
      materials: booklist,
      figureCatalog,
      hasTools: tools.length > 0,
      bookLevel: isBook,
      aiLanguage: s.aiLanguage,
    });
  }
  if (memorySection) systemPrompt += "\n\n" + memorySection;
  // The cross-scenario user profile: who the companion is reading with, so it
  // pitches explanation depth to their background. Empty profile → no section.
  const profileSection = readerProfileSection(await assembleIdentity().catch(() => ""));
  if (profileSection) systemPrompt += "\n\n" + profileSection;
  // The whole-book outline from the reader's notes (docs/14), when they exist.
  const notesOverview = notesOverviewSection(await readOverviewNote(bookId));
  if (notesOverview) systemPrompt += "\n\n" + notesOverview;
  if (canIngestUrl) systemPrompt += "\n\n" + ADD_SOURCE_PROMPT;

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
  let history = prior;
  if (prior.length > HISTORY_KEEP) {
    history = prior.slice(prior.length - HISTORY_KEEP);
    if (topicId) {
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
  }
  return {
    systemPrompt,
    tools,
    messages: [{ role: "user" as const, text: EXPLAIN_KICKOFF }, ...history],
  };
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
