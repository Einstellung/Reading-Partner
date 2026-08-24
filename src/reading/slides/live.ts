// Live wiring of the slides pipeline (docs/14, docs/29, docs/31): real deps
// bound to the dep-injected SlidesPipeline. A deck is the product of one talk
// (reading/talks) — its materials are the talk's, its spine is the outline the
// talk settled — and it carries the talk's own id, so slides/<talkId>/ is where
// that talk's deck keeps its state and its pages (store.ts). One id, one talk,
// one deck, whichever end you come at it from.
//
// A single module-level pipeline holds the deck run in flight so the UI can
// attach to it. Source material (overviews, chapter notes, figures) is read
// straight from disk by book id, so no reader has to be mounted.

import { getImageGenKey } from "../../ai/credentials";
import { callModel, resolveModel } from "../../ai/model-call";
import { realTimers } from "../../ai/observable-run";
import { findFigureById } from "../figures/lookup";
import { getFigures } from "../figures/store";
import { renderFigure } from "../figures/render";
import { getLibraryEntry, readLibraryBook } from "../../platform/app/library";
import { loadChapterSpineState, readChapterSpine, readSpineOverview } from "../prep/chapters/store";
import { loadSettings } from "../../platform/app/settings";
import { recordParse } from "../../platform/app/structured-output";
import { contentSystemPrompt, contentUserMessage, sanitizeFragment } from "./content";
import { generateImage, resolveImageGenConfig, type ImageGenDeps } from "./imageGen";
import { cleanTauriFetch } from "../../platform/app/tauri-fetch";
import { loadMaterial } from "../talks/material";
import { listAllTalks, loadTalk } from "../talks/store";
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
async function bookHasSpine(bookId: string): Promise<boolean> {
  const st = await loadChapterSpineState(bookId);
  return !!st && st.chapters.some((c) => c.status === "done");
}

// A talk that has something to build a deck out of.
export interface DeckTalk {
  talkId: string;
  name: string;
  topicId: string;
  // How many of the talk's entries are in the talk. Zero means the deck falls
  // back to planning from the materials' notes, the way it did before a talk was
  // an object.
  settled: number;
}

// Every talk a deck can be built from (docs/31: the deck is a talk's product, so
// what gets listed is talks, not books). A talk qualifies when its retell
// settled at least one entry as in — the decisions are the material, whether or
// not a notes pass ever ran — or, failing that, when one of its materials has
// notes for the old plan path to work from.
export async function listDeckTalks(): Promise<DeckTalk[]> {
  const talks = await listAllTalks();
  const out: DeckTalk[] = [];
  for (const talk of talks) {
    const settled = talk.decisions.filter((d) => d.include).length;
    if (settled === 0) {
      let usable = false;
      for (const m of talk.materials) {
        if (await bookHasSpine(m.bookId)) {
          usable = true;
          break;
        }
      }
      if (!usable) continue;
    }
    out.push({ talkId: talk.id, name: talk.name, topicId: talk.topicId, settled });
  }
  return out;
}

// Build the plan input for one book: the real chapter list (number, title, page
// range, whether a note exists, and its opening words), the whole-book overview
// when there is one, and the figures available to cite. The chapter list is not
// optional — the overview contains no chapter numbers, so a plan built on it
// alone can only guess at sourceChapters (docs/29).
//
// The chapters come from the same projection the retell walked
// (talks/material.ts, retell/skeleton.ts): the notes plan when there is one,
// the PDF's table of contents when there is not, and the whole book as one
// chapter when there is neither. Reading the notes state directly instead is
// what left the second book of a talk with an empty chapter table — a talk is
// listed as deck-ready when *any* of its materials has notes, but every material
// is planned, and an empty table becomes the citable set validateDeckPlan checks
// the model's citations against.
export async function planMaterial(bookId: string): Promise<PlanBook> {
  const material = await loadMaterial({ bookId, title: "" });
  const overview = (await readSpineOverview(bookId))?.trim() ?? "";
  const chapters: PlanChapter[] = [];
  for (const c of material.skeleton.chapters) {
    const note = c.hasNote ? await readChapterSpine(bookId, c.index) : null;
    chapters.push({
      index: c.index,
      title: c.title,
      startPage: c.startPage,
      endPage: c.endPage,
      hasNote: !!note,
      digest: note ? first40Words(note) : undefined,
    });
  }
  const figures = material.figures.map((f) => ({ id: f.id, caption: f.caption }));
  return { bookId, title: material.title, overview, chapters, figures };
}

// This talk's settled outline: the one place the deck pipeline reads it, and the
// only place that knows where a talk lives. Everything downstream works on the
// TalkOutline shape, where each entry already says which material and which
// chapter it came from and the order is the talk's.
//
// Null means the talk has settled nothing, which is what puts the plan stage
// back on its old path. Read fresh per run rather than cached across the deck's
// lifetime: the reader goes back into the retell and changes their mind, and
// the next re-run has to see that.
export async function readDeckOutline(talkId: string): Promise<TalkOutline | null> {
  return buildTalkOutline(await loadTalk(talkId));
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
      const note = await readChapterSpine(slide.bookId, i);
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
    const ov = await readSpineOverview(slide.bookId);
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
    const ov = await readSpineOverview(id);
    // The title is a heading over notes that are already in hand; a registry
    // that would not open costs the heading, not the deck.
    if (ov) {
      const entry = await getLibraryEntry(id).catch(() => null);
      parts.push(`# ${entry?.title ?? id}\n${ov.trim()}`);
    }
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
    // The same real clock the pipelines run on; the image client needs two of
    // its three members.
    sleep: realTimers.sleep,
    now: realTimers.now,
    signal,
  };
}

function makeDeps(talkId: string, bookIds: string[], instruction: string): SlidesDeps {
  // One read of the talk per pipeline instance, shared by the plan and content
  // stages of that run.
  let outlineOnce: Promise<TalkOutline | null> | null = null;
  const outline = () => (outlineOnce ??= readDeckOutline(talkId));

  return {
    async buildPlan(opts) {
      const model = await resolveModel("prep");
      const books = await Promise.all(bookIds.map(planMaterial));
      // The talk's outline is the deck's skeleton (docs/31). The plan call then
      // only pages it out; with nothing settled, the model designs the outline
      // from the chapter list as before.
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
      const fig = findFigureById(figures, ref.figId);
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

    ...realTimers,
  };
}

let current: SlidesPipeline | null = null;

// Build this talk's deck: a fresh pipeline over the talk's materials, under the
// talk's own id. The instruction is a steer on top of the settled outline
// (theme, audience, length), not the description of the talk — the talk already
// says what it is.
//
// Starting again on a talk that already has a deck re-plans it from scratch,
// which is what the reader asked for by pressing it; the finer-grained re-runs
// (one page, one image, re-assemble) are on the pipeline itself. Null when the
// talk is gone.
export async function startDeck(
  talkId: string,
  instruction: string,
): Promise<SlidesPipeline | null> {
  const talk = await loadTalk(talkId);
  if (!talk) return null;
  const bookIds = talk.materials.map((m) => m.bookId);
  const pipeline = SlidesPipeline.create(makeDeps(talkId, bookIds, instruction), {
    talkId,
    createdAt: Date.now(),
    instruction,
    bookIds,
  });
  current = pipeline;
  void pipeline.start();
  return pipeline;
}

// Re-attach to a deck that is already on disk: a run a restart interrupted, or a
// finished deck whose pages the reader wants to re-run. The caller decides what
// to run (resume, one page, re-assemble) — reopening by itself spends nothing.
export async function openDeck(talkId: string): Promise<SlidesPipeline | null> {
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

// The current/last deck pipeline, if any (lets the UI re-attach after a remount).
export function getCurrentDeck(): SlidesPipeline | null {
  return current;
}

// The last deck this module built, forgotten. It is held for the life of the
// process so the UI can re-attach after a remount, which also means a case that
// starts a deck leaves `getCurrentDeck` answering with it for every case after.
// Not rebuilt: the pipeline is dropped rather than stopped, which is only safe
// where nothing started one.
export function resetCurrentDeckForTests(): void {
  current = null;
}

// Every deck with a state on disk, newest first.
export function listDeckStates(): Promise<SlidesState[]> {
  return listSlidesStates();
}

// The generated-deck registry, newest first, for the UI list.
export async function listDecks(): Promise<TalkEntry[]> {
  return (await loadTalks()).slice().reverse();
}
