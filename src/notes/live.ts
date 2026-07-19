// Live wiring of the notes pipeline (docs/14): real deps (Tauri fs store, pi-ai
// through the app's provider config, the book's figure index for view_figure)
// bound to the dep-injected NotesPipeline. One pipeline instance per book id for
// the app's lifetime, so generation keeps running in the background across book
// switches. The book's full text, figures, buffer and reader emphasis signals
// are supplied by the host (App) so this module stays decoupled from the reader.

import type { ThinkingLevel } from "@earendil-works/pi-ai";
import { modelSupportsImages, streamChat, type ProviderId } from "../ai/providers";
import { buildFigureCatalog } from "../figures/catalog";
import { renderFigure } from "../figures/render";
import type { Figure } from "../figures/types";
import type { Fulltext } from "../fulltext/types";
import { loadSettings, toReasoning } from "../settings";
import {
  buildChapterTools,
  formatChatThreads,
  formatEmphasisSignals,
  runNoteChapter,
  type ChatThread,
  type EmphasisSignal,
} from "./chapter";
import {
  chaptersFromOutline,
  NOTES_PLAN_SYSTEM_PROMPT,
  parseNotesPlan,
  planUserMessage,
} from "./plan";
import { OVERVIEW_SYSTEM_PROMPT, overviewUserMessage } from "./overview";
import { NotesPipeline, type NotesDeps } from "./pipeline";
import {
  loadNotesState,
  readChapterNote,
  saveNotesState,
  writeChapterNote,
  writeOverviewNote,
} from "./store";

// What the host feeds a book's notes pipeline. Getters are read at generation
// time so figures finishing extraction and fresh annotations are picked up.
export interface NotesInputs {
  fulltext: Fulltext; // the book's full text (status "ok")
  getBuffer(): ArrayBuffer | null; // book bytes for figure rasterization
  getFigures(): Promise<Figure[]>; // the book's figure index
  getEmphasisSignals(): EmphasisSignal[]; // highlights / underlines / discussed spots
  // The book's AI-pen chat threads that carry a page anchor, resolved fresh at
  // generation time so a regenerate picks up conversations added since. Threads
  // with no page anchor (the book-level thread) are left out (docs/14).
  getChatThreads(): Promise<ChatThread[]>;
}

async function resolveModel(): Promise<{
  providerId: ProviderId;
  modelId: string;
  reasoning: ThinkingLevel | undefined;
}> {
  const s = await loadSettings();
  if (!s.defaultProviderId || !s.defaultModelId) {
    throw new Error("no default AI provider configured (Settings)");
  }
  return {
    providerId: s.defaultProviderId as ProviderId,
    modelId: s.defaultModelId,
    reasoning: toReasoning(s.prepThinking),
  };
}

// One plain (tool-less) model call, promisified — for the plan and overview
// stages. onProgress reports the cumulative received character count so the
// watchdog and liveness counter can track a long stream; signal aborts it.
function callModel(
  systemPrompt: string,
  userText: string,
  opts: { signal: AbortSignal; onProgress: (chars: number) => void },
): Promise<string> {
  return resolveModel().then(
    (model) =>
      new Promise<string>((resolve, reject) => {
        let chars = 0;
        const bump = (t: string) => {
          chars += t.length;
          opts.onProgress(chars);
        };
        void streamChat({
          providerId: model.providerId,
          modelId: model.modelId,
          systemPrompt,
          messages: [{ role: "user", text: userText }],
          signal: opts.signal,
          reasoning: model.reasoning,
          onDelta: bump,
          onThinking: bump,
          onDone: resolve,
          onError: (m) => reject(new Error(m)),
        });
      }),
  );
}

function makeDeps(bookId: string, bookName: string, inputs: NotesInputs): NotesDeps {
  const { fulltext } = inputs;
  return {
    loadState: loadNotesState,
    saveState: saveNotesState,

    async buildPlan(opts) {
      // The PDF outline is the chapter structure when it has one; otherwise the
      // model reads the front matter's table of contents.
      const fromOutline = chaptersFromOutline(fulltext.outline, fulltext.pages.length);
      if (fromOutline) return { chapters: fromOutline, source: "outline" };
      const text = await callModel(NOTES_PLAN_SYSTEM_PROMPT, planUserMessage(fulltext), opts);
      return { chapters: parseNotesPlan(text, fulltext.pages.length), source: "ai" };
    },

    async generateChapter({ chapter, instruction }, opts) {
      const model = await resolveModel();
      const figures = await inputs.getFigures().catch(() => []);
      const inRange = figures.filter((f) => f.page >= chapter.startPage && f.page <= chapter.endPage);
      const supportsImages = modelSupportsImages(model.providerId, model.modelId);
      const buffer = inputs.getBuffer();
      const tools = buildChapterTools({
        fulltext,
        figures: inRange,
        modelSupportsImages: supportsImages,
        renderImage: async (fig) => {
          if (!buffer) return null;
          const r = await renderFigure(bookId, buffer, fig, "view");
          return r ? { base64: r.base64, mimeType: r.mimeType } : null;
        },
      });
      const figureCatalog = inRange.length
        ? buildFigureCatalog(inRange, { currentPage: chapter.startPage })
        : "";
      const emphasis = formatEmphasisSignals(
        inputs.getEmphasisSignals(),
        chapter.startPage,
        chapter.endPage,
      );
      const chats = formatChatThreads(
        await inputs.getChatThreads().catch(() => []),
        chapter.startPage,
        chapter.endPage,
      );
      return runNoteChapter({
        bookName,
        chapter,
        tools,
        model: { providerId: model.providerId, modelId: model.modelId, reasoning: model.reasoning },
        figureCatalog,
        emphasis,
        chats,
        instruction,
        signal: opts.signal,
        onProgress: opts.onProgress,
      });
    },

    writeChapter: (index, body) => writeChapterNote(bookId, index, body),
    readChapterNote: (index) => readChapterNote(bookId, index),

    async buildOverview(chapters, opts) {
      return callModel(OVERVIEW_SYSTEM_PROMPT, overviewUserMessage(chapters), opts);
    },

    writeOverview: (body) => writeOverviewNote(bookId, body),

    now: () => Date.now(),
    sleep: (ms) => new Promise<void>((r) => setTimeout(r, ms)),
    setTimer: (ms, cb) => {
      const id = setTimeout(cb, ms);
      return () => clearTimeout(id);
    },
  };
}

const pipelines = new Map<string, NotesPipeline>();

export function getNotesPipeline(bookId: string, bookName: string, inputs: NotesInputs): NotesPipeline {
  let p = pipelines.get(bookId);
  if (!p) {
    p = new NotesPipeline(bookId, bookName, makeDeps(bookId, bookName, inputs));
    pipelines.set(bookId, p);
  }
  return p;
}

// A pipeline that may already exist for a book (no creation): lets the app
// re-attach UI after switching books without restarting anything.
export function peekNotesPipeline(bookId: string): NotesPipeline | null {
  return pipelines.get(bookId) ?? null;
}

// Whether a book has notes state on disk (drives auto-resume on book open).
export async function hasNotesState(bookId: string): Promise<boolean> {
  return (await loadNotesState(bookId)) !== null;
}
