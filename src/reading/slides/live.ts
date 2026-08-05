// Live wiring of the slides pipeline (docs/14, docs/29): real deps bound to the
// dep-injected SlidesPipeline. A talk is a run over a chosen set of books that
// have notes plus a free-text instruction; a single module-level pipeline holds
// the current talk so the UI can attach to it. Source material (overviews,
// chapter notes, figures) is read straight from disk by book id, so a talk can
// span books that aren't the one currently open.
//
// A talk's own state and products live under slides/<talkId>/ (store.ts), which
// is what lets a talk be resumed after a restart and re-run one page at a time.

import { BaseDirectory, readDir } from "@tauri-apps/plugin-fs";
import { getImageGenKey } from "../../ai/credentials";
import { callModel, resolveModel } from "../../ai/model-call";
import { getFigures } from "../figures/store";
import { renderFigure } from "../figures/render";
import { getLibraryEntry, readLibraryBook } from "../../platform/app/library";
import { loadNotesState, readChapterNote, readOverviewNote } from "../notes/store";
import { loadSettings } from "../../platform/app/settings";
import { recordParse } from "../../platform/app/structured-output";
import { contentSystemPrompt, contentUserMessage, sanitizeFragment } from "./content";
import { generateImage, resolveImageGenConfig, type ImageGenDeps } from "./imageGen";
import { cleanTauriFetch } from "../../platform/app/tauri-fetch";
import { listRehearsedBooks, loadRehearsalPlan } from "../rehearsal/store";
import {
  parseSlidePlan,
  planUserMessage,
  slidesPlanSystemPrompt,
  validateDeckPlan,
  type PlanBook,
  type PlanChapter,
} from "./plan";
import {
  applyTalkOutline,
  buildTalkOutline,
  citableWithOutline,
  outlinePlanSystemPrompt,
  outlinePlanUserMessage,
  readerPointsFor,
  type TalkOutline,
} from "./outline";
import {
  SlidesPipeline,
  type AssembleInput,
  type AssetOutcome,
  type SlidesDeps,
} from "./pipeline";
import {
  listSlidesStates,
  loadSlidesState,
  loadTalks,
  readAsset,
  readFragment,
  recordTalk,
  saveSlidesState,
  writeAsset,
  writeDeck,
  writeFragment,
} from "./store";
import { assembleDeck, slugify } from "./template";
import type { SlideFigureRef, SlideRun, SlidesState, TalkEntry } from "./types";

// A fixed deck-wide illustration style, prefixed to every slide illustration
// prompt so the images read as one set. Text-free by instruction.
const DECK_ILLUSTRATION_STYLE =
  "Clean editorial illustration, flat vector style, muted desaturated palette, " +
  "generous negative space, subtle geometric shapes, no text or letters or " +
  "numbers anywhere in the image, no logos. Depict: ";

// Cap on how much note text feeds a single slide, so a rich chapter can't blow
// up the content prompt.
const SLIDE_NOTES_MAX_CHARS = 8_000;

const first40Words = (text: string): string =>
  text.trim().split(/\s+/).slice(0, 40).join(" ");

// Whether a book has usable notes for a talk: notes state exists with at least
// one done chapter (docs/14).
async function bookHasNotes(bookId: string): Promise<boolean> {
  const st = await loadNotesState(bookId);
  return !!st && st.chapters.some((c) => c.status === "done");
}

export interface TalkBook {
  bookId: string;
  title: string;
  // A rehearsal settled at least one chapter of this book (docs/31). Such a book
  // can carry a talk on its own: the decisions are the material, so it belongs in
  // the picker even with no notes pass ever run on it.
  rehearsed: boolean;
}

// Every book a talk can be built from: one with notes (a done chapter), or one
// the reader rehearsed. Notes are found by their directories under AppData;
// rehearsed books are asked of the rehearsal store rather than found by file
// name, since that store is about to key its records by talk instead of by book.
export async function listTalkBooks(): Promise<TalkBook[]> {
  let entries;
  try {
    entries = await readDir(".", { baseDir: BaseDirectory.AppData });
  } catch {
    return [];
  }
  const rehearsed = new Set(await listRehearsedBooks());
  const candidates = new Set(rehearsed);
  for (const e of entries) {
    if (e.isDirectory && e.name?.startsWith("notes-")) candidates.add(e.name.slice("notes-".length));
  }
  const out: TalkBook[] = [];
  for (const bookId of candidates) {
    if (!rehearsed.has(bookId) && !(await bookHasNotes(bookId))) continue;
    const entry = await getLibraryEntry(bookId);
    out.push({ bookId, title: entry?.title ?? bookId, rehearsed: rehearsed.has(bookId) });
  }
  out.sort((a, b) => a.title.localeCompare(b.title));
  return out;
}

// Build the plan input for one book: the real chapter list (number, title, page
// range, whether a note exists, and its opening words), the whole-book overview
// when there is one, and the figures available to cite. The chapter list is not
// optional — the overview contains no chapter numbers, so a plan built on it
// alone can only guess at sourceChapters (docs/29).
async function planMaterial(bookId: string): Promise<PlanBook> {
  const entry = await getLibraryEntry(bookId);
  const title = entry?.title ?? bookId;

  const overview = (await readOverviewNote(bookId))?.trim() ?? "";
  const st = await loadNotesState(bookId);
  const chapters: PlanChapter[] = [];
  for (const c of st?.chapters ?? []) {
    const note = c.status === "done" ? await readChapterNote(bookId, c.index) : null;
    chapters.push({
      index: c.index,
      title: c.title,
      startPage: c.startPage,
      endPage: c.endPage,
      hasNote: !!note,
      digest: note ? first40Words(note) : undefined,
    });
  }

  const figures = ((await getFigures(bookId))?.figures ?? []).map((f) => ({
    id: f.id,
    caption: f.caption,
  }));
  return { bookId, title, overview, chapters, figures };
}

// Getting this talk's settled decisions: the one place the deck pipeline asks
// for them, and the only place that knows they are keyed by book. The decisions
// are moving to being keyed by the talk instead, at which point this function is
// what changes — everything downstream of it works on the TalkOutline shape,
// where each entry already says which book and which chapter it came from.
//
// Null means no material in this talk was rehearsed, which is what puts the plan
// stage back on its old path. Read fresh per run rather than cached across a
// talk's lifetime: the reader may go back into rehearsal and change their mind.
export async function readTalkOutline(bookIds: readonly string[]): Promise<TalkOutline | null> {
  const sources = await Promise.all(
    bookIds.map(async (bookId) => ({
      bookId,
      title: (await getLibraryEntry(bookId))?.title ?? bookId,
      plan: await loadRehearsalPlan(bookId),
    })),
  );
  return buildTalkOutline(sources);
}

interface GatheredNotes {
  text: string;
  // Set when the slide is not being written from what the plan asked for.
  notice?: string;
}

// The chapter notes a content slide distils from. Book-and-chapter scoped when
// the plan named them; otherwise the book's overview; otherwise (a synthesis
// slide) the overviews of every selected book. Every fallback is reported: a
// slide silently written from the same overview as every other slide is the
// failure mode docs/29 describes.
async function gatherSlideNotes(slide: SlideRun, bookIds: string[]): Promise<GatheredNotes> {
  const parts: string[] = [];
  if (slide.bookId && slide.sourceChapters?.length) {
    const missing: number[] = [];
    for (const i of slide.sourceChapters) {
      const note = await readChapterNote(slide.bookId, i);
      if (note) parts.push(note.trim());
      else missing.push(i);
    }
    if (parts.length) {
      return {
        text: clip(parts.join("\n\n")),
        notice: missing.length
          ? `Chapter ${missing.join(", ")} had no note on disk; written from the others.`
          : undefined,
      };
    }
  }
  const lost = slide.sourceChapters?.length
    ? `Chapter ${slide.sourceChapters.join(", ")} had no note on disk. `
    : "";
  if (slide.bookId) {
    const ov = await readOverviewNote(slide.bookId);
    if (ov) {
      return {
        text: clip(ov.trim()),
        notice: lost
          ? `${lost}Written from the book overview instead — the same source every other fallback slide gets.`
          : undefined,
      };
    }
    return {
      text: "",
      notice: `${lost}This book has no overview either, so the slide was written from its title alone.`,
    };
  }
  for (const id of bookIds) {
    const ov = await readOverviewNote(id);
    if (ov) parts.push(`# ${(await getLibraryEntry(id))?.title ?? id}\n${ov.trim()}`);
  }
  return { text: clip(parts.join("\n\n")) };
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

function makeDeps(talkId: string, bookIds: string[], instruction: string): SlidesDeps {
  // One read of the decision files per pipeline instance, shared by the plan and
  // content stages of that run.
  let outlineOnce: Promise<TalkOutline | null> | null = null;
  const outline = () => (outlineOnce ??= readTalkOutline(bookIds));

  return {
    async buildPlan(opts) {
      const model = await resolveModel("prep");
      const books = await Promise.all(bookIds.map(planMaterial));
      // A rehearsed book's outline is the deck's skeleton (docs/31). The plan
      // call then only pages it out; with no decision file anywhere, the model
      // designs the outline from the chapter list as before.
      const settled = await outline();
      const text = await callModel(
        "prep",
        "plan",
        settled ? outlinePlanSystemPrompt(model.aiLanguage) : slidesPlanSystemPrompt(model.aiLanguage),
        settled
          ? outlinePlanUserMessage(books, settled, instruction)
          : planUserMessage(books, instruction),
        opts,
      );
      const plan = recordParse("slides-plan", model, text, (tally) => parseSlidePlan(text, tally));
      // Check the plan's citations against the books it claims to draw on, so a
      // chapter or figure that does not exist is caught here, with a note the
      // user can see, instead of becoming a silent fallback two stages later.
      const checked = validateDeckPlan(plan, citableWithOutline(books, settled));
      // Then against the decisions: a cut chapter gets no page, a kept chapter
      // that the plan skipped gets one back.
      return settled ? applyTalkOutline(checked, settled) : checked;
    },

    async generateContent({ slide, instruction: steer }, opts) {
      const { aiLanguage } = await resolveModel("prep");
      const notes = await gatherSlideNotes(slide, bookIds);
      const points = readerPointsFor(await outline(), slide);
      // One slide's body from the gathered notes: a single unit of prose, so it
      // is held to the same output floor as a chapter note.
      const text = await callModel(
        "prep",
        "chapter-note",
        contentSystemPrompt(aiLanguage),
        contentUserMessage(slide, notes.text, steer, points),
        opts,
      );
      return {
        html: sanitizeFragment(text),
        // "This chapter had no note, so the slide fell back to the overview" is a
        // downgrade only when the notes were the material. With the reader's own
        // points in hand they are the material and the notes are background, so
        // the warning would be false.
        sourceNotice: points.length ? undefined : notes.notice,
      };
    },

    async generateIllustration(slide, refImage, opts): Promise<AssetOutcome> {
      if (!slide.illustration) return { url: null, reason: "This slide has no illustration prompt." };
      const key = await getImageGenKey();
      if (!key) return { url: null, reason: "No illustration key is configured (Settings)." };
      const s = await loadSettings();
      const config = resolveImageGenConfig({
        apiBase: s.illustrationApiBase,
        model: s.illustrationModel,
        apiKey: key,
      });
      const deps = imageDeps(opts.signal);
      const url = await generateImage(
        config,
        { prompt: DECK_ILLUSTRATION_STYLE + slide.illustration.prompt, image: refImage ?? undefined },
        deps,
      );
      return url ? { url } : { url: null, reason: "The image service returned no image." };
    },

    async renderFigureAsset(ref: SlideFigureRef): Promise<AssetOutcome> {
      const figures = (await getFigures(ref.bookId))?.figures ?? [];
      if (!figures.length) return { url: null, reason: "This book has no figure index." };
      const fig = figures.find((f) => f.id === ref.figId);
      if (!fig) return { url: null, reason: `Figure ${ref.figId} is not in this book's figure index.` };
      // Known extraction gap (docs/29): a figure whose caption sits above the
      // artwork gets no bbox, so there is no region to crop.
      if (!fig.bbox) {
        return {
          url: null,
          reason: `Figure ${ref.figId} has no usable area in the figure index, so it cannot be cropped.`,
        };
      }
      const bytes = await readLibraryBook(ref.bookId);
      const rendered = await renderFigure(
        ref.bookId,
        bytes.slice().buffer as ArrayBuffer,
        fig,
        "view",
      );
      return rendered?.dataUrl
        ? { url: rendered.dataUrl }
        : { url: null, reason: `Figure ${ref.figId} could not be rendered from the page.` };
    },

    saveState: (state) => saveSlidesState(state),
    writeFragment: (index, html) => writeFragment(talkId, index, html),
    readFragment: (index) => readFragment(talkId, index),
    writeAsset: (index, dataUrl) => writeAsset(talkId, index, dataUrl),
    readAsset: (index) => readAsset(talkId, index),

    async assemble(input: AssembleInput) {
      const html = assembleDeck({
        title: input.title,
        slides: input.slides.map((s) => ({ kind: s.kind, fragment: s.fragment, asset: s.asset })),
      });
      const file = await writeDeck(input.id, slugify(input.title), html);
      const entry: TalkEntry = {
        talkId: input.id,
        title: input.title,
        file,
        createdAt: input.createdAt,
        bookIds: input.bookIds,
        instruction: input.instruction,
      };
      // Recorded after the deck is on disk; re-assembling replaces this talk's
      // row instead of adding a second one for the same talk.
      await recordTalk(entry);
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

// Start a new talk: a fresh pipeline over the chosen books + instruction, with
// its own directory under slides/. Returns the pipeline so the UI can subscribe.
export function startTalk(bookIds: string[], instruction: string): SlidesPipeline {
  const createdAt = Date.now();
  const talkId = `${createdAt}`;
  const pipeline = SlidesPipeline.create(makeDeps(talkId, bookIds, instruction), {
    talkId,
    createdAt,
    instruction,
    bookIds,
  });
  current = pipeline;
  void pipeline.start();
  return pipeline;
}

// Re-attach to a talk that is already on disk: a run a restart interrupted, or a
// finished deck whose pages the user wants to re-run. The caller decides what to
// run (resume, one page, re-assemble) — reopening by itself spends nothing.
export async function openTalk(talkId: string): Promise<SlidesPipeline | null> {
  if (current?.snapshot().state.id === talkId) return current;
  const state = await loadSlidesState(talkId);
  if (!state) return null;
  const pipeline = new SlidesPipeline(
    makeDeps(state.id, state.bookIds, state.instruction),
    state,
  );
  current = pipeline;
  return pipeline;
}

// The current/last talk pipeline, if any (lets the UI re-attach after a remount).
export function getCurrentTalk(): SlidesPipeline | null {
  return current;
}

// Every talk with a state on disk, newest first: what the dialog can resume or
// re-run.
export function listTalkStates(): Promise<SlidesState[]> {
  return listSlidesStates();
}

// The generated-deck registry, newest first, for the UI list.
export async function listTalks(): Promise<TalkEntry[]> {
  return (await loadTalks()).slice().reverse();
}
