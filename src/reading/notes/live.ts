// Live wiring of the chapter-spine pipeline (docs/09): real deps (Tauri fs store, pi-ai
// through the app's provider config, the book's figure index for view_figure)
// bound to the dep-injected NotesPipeline. One pipeline instance per book id for
// the app's lifetime, so generation keeps running in the background across book
// switches. The book's full text, figures, buffer and reader emphasis signals
// are supplied by the host (App) so this module stays decoupled from the reader.

import { modelSupportsImages } from "../../ai/providers";
import { callModel, resolveModel } from "../../ai/model-call";
import { realTimers } from "../../ai/observable-run";
import { recordParse } from "../../platform/app/structured-output";
import { buildFigureCatalog } from "../figures/catalog";
import { renderFigure } from "../figures/render";
import type { Figure } from "../figures/types";
import type { Fulltext } from "../../fulltext/types";
import {
  buildChapterTools,
  formatChatThreads,
  formatEmphasisSignals,
  runNoteChapter,
  type ChatThread,
  type EmphasisSignal,
} from "./chapter";
import { outlineEntries, pickChapterTable, type TableChapter } from "../chapters";
import { NOTES_PLAN_SYSTEM_PROMPT, parseNotesPlan, planUserMessage } from "./plan";
import type { NoteChapter } from "./types";
import { overviewSystemPrompt, overviewUserMessage } from "./overview";
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

// A row of the book's chapter table as a chapter of this run: nothing prepared
// yet. The printed chapter number is not carried into the state file — it is a
// function of the title, and a persisted copy is one more thing to keep true.
function pending(c: TableChapter): NoteChapter {
  return {
    index: c.index,
    title: c.title,
    startPage: c.startPage,
    endPage: c.endPage,
    status: "pending",
  };
}

function makeDeps(bookId: string, bookName: string, inputs: NotesInputs): NotesDeps {
  const { fulltext } = inputs;
  return {
    loadState: loadNotesState,
    saveState: saveNotesState,

    async buildPlan(opts) {
      // The PDF outline is the chapter structure when it has one, minus the
      // entries that point at a cover or a part divider rather than a chapter;
      // otherwise the model reads the front matter's table of contents, and its
      // answer goes through the same filter. Both go through reading/chapters,
      // so a book's chapters are the same list here and in a lecture turn.
      // fromFirstPage: what is prepared here is every page of the book, so the
      // pages before the first heading belong to the first chapter.
      const total = fulltext.pages.length;
      const fromOutline = pickChapterTable([outlineEntries(fulltext.outline, total)], fulltext, {
        fromFirstPage: true,
      });
      if (fromOutline) return { chapters: fromOutline.map(pending), source: "outline" };
      // Resolved up front only so the parse can be attributed to the model that
      // produced it; the call itself resolves the same settings again.
      const model = await resolveModel("prep");
      const text = await callModel(
        "prep",
        "plan",
        NOTES_PLAN_SYSTEM_PROMPT,
        planUserMessage(fulltext),
        opts,
      );
      const parsed = recordParse("notes-plan", model, text, (tally) =>
        parseNotesPlan(text, total, tally),
      );
      // Filtered when the filter leaves a usable table; the model's own answer
      // when it does not, because a plan the filter rejects is still better than
      // no chapters at all here (a lecture, which can fall back to page ranges,
      // decides that differently).
      const filtered = pickChapterTable([parsed], fulltext, { fromFirstPage: true });
      return { chapters: (filtered ?? parsed).map(pending), source: "ai" };
    },

    async generateChapter({ chapter, chapters, instruction }, opts) {
      const model = await resolveModel("prep");
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
        chapters,
        tools,
        model: { providerId: model.providerId, modelId: model.modelId, reasoning: model.reasoning },
        figureCatalog,
        emphasis,
        chats,
        instruction,
        aiLanguage: model.aiLanguage,
        signal: opts.signal,
        onProgress: opts.onProgress,
      });
    },

    writeChapter: (index, body) => writeChapterNote(bookId, index, body),
    readChapterNote: (index) => readChapterNote(bookId, index),

    async buildOverview(chapters, opts) {
      return callModel(
        "prep",
        "overview",
        (m) => overviewSystemPrompt(m.aiLanguage),
        overviewUserMessage(chapters),
        opts,
      );
    },

    writeOverview: (body) => writeOverviewNote(bookId, body),

    ...realTimers,
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
