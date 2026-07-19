// Live wiring of the slides pipeline (docs/14): real deps bound to the
// dep-injected SlidesPipeline. A talk is a one-shot run over a chosen set of
// books that have notes plus a free-text instruction; a single module-level
// pipeline holds the current/last run so the UI can attach to it. Source
// material (overviews, chapter notes, figures) is read straight from disk by
// book id, so a talk can span books that aren't the one currently open.

import type { ThinkingLevel } from "@earendil-works/pi-ai";
import { BaseDirectory, readDir } from "@tauri-apps/plugin-fs";
import { getImageGenKey } from "../ai/credentials";
import { streamChat, type ProviderId } from "../ai/providers";
import { getFigures } from "../figures/store";
import { renderFigure } from "../figures/render";
import { getLibraryEntry, readLibraryBook } from "../library";
import { loadNotesState, readChapterNote, readOverviewNote } from "../notes/store";
import { loadSettings, toReasoning } from "../settings";
import { contentSystemPrompt, contentUserMessage, sanitizeFragment } from "./content";
import { generateImage, resolveImageGenConfig, type ImageGenDeps } from "./imageGen";
import { cleanTauriFetch } from "../tauri-fetch";
import {
  parseSlidePlan,
  planUserMessage,
  SLIDES_PLAN_SYSTEM_PROMPT,
  type PlanBook,
} from "./plan";
import { SlidesPipeline, type AssembleInput, type SlidesDeps } from "./pipeline";
import { appendTalk, loadTalks, writeDeck } from "./store";
import { assembleDeck } from "./template";
import type { SlideFigureRef, SlideRun, TalkEntry } from "./types";

// A fixed deck-wide illustration style, prefixed to every slide illustration
// prompt so the images read as one set. Text-free by instruction.
const DECK_ILLUSTRATION_STYLE =
  "Clean editorial illustration, flat vector style, muted desaturated palette, " +
  "generous negative space, subtle geometric shapes, no text or letters or " +
  "numbers anywhere in the image, no logos. Depict: ";

// Cap on how much note text feeds a single slide, so a rich chapter can't blow
// up the content prompt.
const SLIDE_NOTES_MAX_CHARS = 8_000;

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

// One plain (tool-less) model call, promisified — for the plan and content
// stages. onProgress reports cumulative characters so the watchdog/liveness
// counter track a long stream; signal aborts it.
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

const first40Words = (text: string): string =>
  text.trim().split(/\s+/).slice(0, 40).join(" ");

// Whether a book has usable notes for a talk: notes state exists with at least
// one done chapter (docs/14).
async function bookHasNotes(bookId: string): Promise<boolean> {
  const st = await loadNotesState(bookId);
  return !!st && st.chapters.some((c) => c.status === "done");
}

export interface BookWithNotes {
  bookId: string;
  title: string;
}

// Every book that has notes (a done chapter), for the talk picker. Reads the
// notes-<bookId>/ directories under AppData and joins titles from the library.
export async function listBooksWithNotes(): Promise<BookWithNotes[]> {
  let entries;
  try {
    entries = await readDir(".", { baseDir: BaseDirectory.AppData });
  } catch {
    return [];
  }
  const out: BookWithNotes[] = [];
  for (const e of entries) {
    if (!e.isDirectory || !e.name?.startsWith("notes-")) continue;
    const bookId = e.name.slice("notes-".length);
    if (!(await bookHasNotes(bookId))) continue;
    const entry = await getLibraryEntry(bookId);
    out.push({ bookId, title: entry?.title ?? bookId });
  }
  out.sort((a, b) => a.title.localeCompare(b.title));
  return out;
}

// Build the plan input for one book: its overview (or a fallback summary from
// the chapter notes) plus the figure list to cite.
async function planMaterial(bookId: string): Promise<PlanBook> {
  const entry = await getLibraryEntry(bookId);
  const title = entry?.title ?? bookId;

  let material = (await readOverviewNote(bookId))?.trim() ?? "";
  if (!material) {
    const st = await loadNotesState(bookId);
    const lines: string[] = [];
    for (const c of st?.chapters ?? []) {
      if (c.status !== "done") continue;
      const note = (await readChapterNote(bookId, c.index)) ?? "";
      lines.push(`Chapter ${c.index}: ${c.title} — ${first40Words(note)}`);
    }
    material = lines.join("\n");
  }

  const figures = ((await getFigures(bookId))?.figures ?? []).map((f) => ({
    id: f.id,
    caption: f.caption,
  }));
  return { bookId, title, material, figures };
}

// The chapter notes a content slide distills from. Book-and-chapter scoped when
// the plan named them; otherwise the book's overview; otherwise (a synthesis
// slide) the overviews of every selected book.
async function gatherSlideNotes(slide: SlideRun, bookIds: string[]): Promise<string> {
  const parts: string[] = [];
  if (slide.bookId && slide.sourceChapters?.length) {
    for (const i of slide.sourceChapters) {
      const note = await readChapterNote(slide.bookId, i);
      if (note) parts.push(note.trim());
    }
    if (parts.length) return clip(parts.join("\n\n"));
  }
  if (slide.bookId) {
    const ov = await readOverviewNote(slide.bookId);
    if (ov) return clip(ov.trim());
  }
  if (!slide.bookId) {
    for (const id of bookIds) {
      const ov = await readOverviewNote(id);
      if (ov) parts.push(`# ${(await getLibraryEntry(id))?.title ?? id}\n${ov.trim()}`);
    }
  }
  return clip(parts.join("\n\n"));
}

function clip(text: string): string {
  return text.length <= SLIDE_NOTES_MAX_CHARS ? text : text.slice(0, SLIDE_NOTES_MAX_CHARS) + "\n…";
}

// The image-client deps over the app's Tauri fetch. AbortSignal threads through
// so a Stop cancels an in-flight generation/poll.
function imageDeps(signal: AbortSignal): ImageGenDeps {
  return {
    fetch: async (req) => {
      const res = await cleanTauriFetch(req.url, {
        method: req.init.method,
        headers: req.init.headers,
        body: req.init.body,
        signal,
      });
      return { ok: res.ok, status: res.status, json: () => res.json() };
    },
    fetchBytes: async (url) => {
      const res = await cleanTauriFetch(url, { signal });
      return new Uint8Array(await res.arrayBuffer());
    },
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    now: () => Date.now(),
    signal,
  };
}

function makeDeps(bookIds: string[], instruction: string): SlidesDeps {
  return {
    async buildPlan(opts) {
      const books = await Promise.all(bookIds.map(planMaterial));
      const text = await callModel(SLIDES_PLAN_SYSTEM_PROMPT, planUserMessage(books, instruction), opts);
      return parseSlidePlan(text);
    },

    async generateContent(slide, opts) {
      const notes = await gatherSlideNotes(slide, bookIds);
      const text = await callModel(contentSystemPrompt(), contentUserMessage(slide, notes), opts);
      return sanitizeFragment(text);
    },

    async generateIllustration(slide, refImage, opts) {
      const key = await getImageGenKey();
      if (!key || !slide.illustration) return null;
      const s = await loadSettings();
      const config = resolveImageGenConfig({
        apiBase: s.illustrationApiBase,
        model: s.illustrationModel,
        apiKey: key,
      });
      const deps = imageDeps(opts.signal);
      return generateImage(
        config,
        { prompt: DECK_ILLUSTRATION_STYLE + slide.illustration.prompt, image: refImage ?? undefined },
        deps,
      );
    },

    async renderFigureAsset(ref: SlideFigureRef) {
      // Known extraction gap (docs/14): a figure with no bbox can't be cropped —
      // drop the slot silently.
      const figures = (await getFigures(ref.bookId))?.figures ?? [];
      const fig = figures.find((f) => f.id === ref.figId);
      if (!fig || !fig.bbox) return null;
      try {
        const bytes = await readLibraryBook(ref.bookId);
        const rendered = await renderFigure(
          ref.bookId,
          bytes.slice().buffer as ArrayBuffer,
          fig,
          "view",
        );
        return rendered?.dataUrl ?? null;
      } catch (e) {
        console.warn("figure crop failed", ref, e);
        return null;
      }
    },

    async assemble(input: AssembleInput) {
      const html = assembleDeck({
        title: input.title,
        slides: input.slides.map((s) => ({ kind: s.kind, fragment: s.fragment, asset: s.asset })),
      });
      const file = await writeDeck(input.id, html);
      const entry: TalkEntry = {
        title: input.title,
        file,
        createdAt: input.createdAt,
        bookIds: input.bookIds,
        instruction: input.instruction,
      };
      await appendTalk(entry);
      return file;
    },

    now: () => Date.now(),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    setTimer: (ms, cb) => {
      const id = setTimeout(cb, ms);
      return () => clearTimeout(id);
    },
  };
}

let current: SlidesPipeline | null = null;

// Start a new talk run: a fresh pipeline over the chosen books + instruction.
// Replaces any prior run's pipeline (v1 runs one talk at a time). Returns the
// pipeline so the UI can subscribe.
export function startTalk(bookIds: string[], instruction: string): SlidesPipeline {
  const pipeline = new SlidesPipeline(makeDeps(bookIds, instruction), {
    createdAt: Date.now(),
    instruction,
    bookIds,
  });
  current = pipeline;
  void pipeline.start();
  return pipeline;
}

// The current/last talk pipeline, if any (lets the UI re-attach after a remount).
export function getCurrentTalk(): SlidesPipeline | null {
  return current;
}

// The generated-deck registry, newest first, for the UI list.
export async function listTalks(): Promise<TalkEntry[]> {
  return (await loadTalks()).slice().reverse();
}
