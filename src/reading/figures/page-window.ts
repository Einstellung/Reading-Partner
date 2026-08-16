// The visual window around a highlight (docs/12): when the reader marks a
// passage and asks about it, the turn carries page renderings of that page and
// the pages either side, so the model can see the layout the text extract drops
// — figures, plots, equations, tables, marginalia.
//
// What this is not: a crop of the marked region. The highlight says "I am here",
// not "look at this rectangle". Figure bboxes pair badly on two-column and
// multi-panel pages (figures/extract.ts), so nothing here intersects the
// selection with anything; the model is handed whole pages and finds the
// relevant part itself. The bboxes are used for one thing only — deciding
// whether a page has any figure art at all, which is the one judgement the index
// makes reliably.
//
// Pure: the pages to render, the gate, the resolutions, the prompt line and the
// history degradation. The rasterizing is injected by the caller (turn.ts).

import type { Fulltext } from "../../fulltext/types";
import type { Figure } from "./types";

// Pages either side of the highlighted one. One, because a figure that belongs
// to a passage is on that page or its neighbour: a caption on p.12 whose art
// sits at the top of p.13, or a plot on p.11 the text on p.12 is still
// discussing. Two either side doubles the cost to reach material the reader is
// no longer looking at, and read_pages / view_figure already cover the rest of
// the document on request.
export const PAGE_WINDOW_RADIUS = 1;

// Render widths, in pixels. Anthropic prices an image at about (w × h) / 750
// tokens, so a letter page (1:1.29) costs ~1.7k at 1000px and ~0.7k at 640px:
// the three-page window lands near 3.1k tokens, the size of a long tool result.
//
// The anchor page is the one the reader is asking about, so it is rendered where
// axis labels and inline formulae are still legible (1000px across a letter page
// is ~120 dpi). The neighbours are there to answer "is the figure this refers to
// over the page", which is a question about shape and position, not about small
// print — half the linear resolution is a quarter of the cost for it.
export const ANCHOR_PAGE_WIDTH_PX = 1000;
export const NEIGHBOUR_PAGE_WIDTH_PX = 640;

// A page holding less text than this is treated as one the extract cannot
// describe: a scanned page (no text layer at all), a full-page plate, a page
// that is one large table. Set well under a normal typeset page (2-3k
// characters) and above a page that is just a running head.
export const SPARSE_PAGE_CHARS = 400;

// Why the window was sent. Recorded rather than inferred so the telemetry can
// say which arm of the gate is actually paying for itself.
//
//   "figures"     the figure index found figure art on one of these pages.
//   "sparse-text" one of these pages has (almost) no extractable text, so the
//                 page is a picture as far as the model is concerned. This is
//                 the arm scanned documents come in on: figure detection is
//                 caption-anchored (/^Figure N/ in the text layer), so a scan
//                 has no figures to find and would otherwise be the one kind of
//                 document that needs the images most and never gets them.
export type PageWindowGate = "figures" | "sparse-text";

export interface PageWindowPage {
  // 1-based page number.
  page: number;
  widthPx: number;
  // The page the highlight is on.
  anchor: boolean;
}

export interface PageWindowPlan {
  anchor: number;
  pages: PageWindowPage[];
  gate: PageWindowGate;
}

export interface PageWindowImage {
  data: string;
  mediaType: string;
}

// The pages of the window, clamped to the document. A null pageCount means the
// text extract has not landed yet: clamp at the bottom only and let a render
// that runs off the end fail on its own.
export function pageWindowPages(
  anchor: number,
  pageCount: number | null,
  radius: number = PAGE_WINDOW_RADIUS,
): PageWindowPage[] {
  const out: PageWindowPage[] = [];
  const last = pageCount && pageCount > 0 ? pageCount : Number.MAX_SAFE_INTEGER;
  if (anchor < 1 || anchor > last) return out;
  for (let p = Math.max(1, anchor - radius); p <= Math.min(last, anchor + radius); p++) {
    out.push({
      page: p,
      widthPx: p === anchor ? ANCHOR_PAGE_WIDTH_PX : NEIGHBOUR_PAGE_WIDTH_PX,
      anchor: p === anchor,
    });
  }
  return out;
}

// Whether this window is worth an image at all, and on which arm. A window of
// plain typeset prose is not: a screenshot of text the model already has in full
// adds nothing and costs a few thousand tokens every turn.
export function pageWindowGate(
  pages: readonly number[],
  figures: readonly Figure[],
  fulltext: Fulltext | null,
): PageWindowGate | null {
  if (pages.length === 0) return null;
  const inWindow = new Set(pages);
  if (figures.some((f) => inWindow.has(f.page))) return "figures";
  if (!fulltext) return null;
  // A document with no text layer is a scan, whichever page you land on.
  if (fulltext.status !== "ok") return "sparse-text";
  for (const p of pages) {
    const text = fulltext.pages[p - 1];
    if (text === undefined) continue;
    if (text.trim().length < SPARSE_PAGE_CHARS) return "sparse-text";
  }
  return null;
}

export interface PlanPageWindowInput {
  // 1-based page the highlight sits on, or null when the turn has no position.
  anchor: number | null;
  // The document's page count, or null while the extract is still running.
  pageCount: number | null;
  figures: readonly Figure[];
  fulltext: Fulltext | null;
  // False for a text-only model. No images are planned at all then: the prompt
  // must not announce a window the request cannot carry, and pi rejects the call
  // outright rather than dropping the pictures (ai/providers.ts resolveCall).
  modelSupportsImages: boolean;
  radius?: number;
}

// The whole decision, in one pure call. Null means this turn sends no images.
export function planPageWindow(input: PlanPageWindowInput): PageWindowPlan | null {
  const { anchor, pageCount, figures, fulltext, modelSupportsImages } = input;
  if (!modelSupportsImages || anchor === null) return null;
  const pages = pageWindowPages(anchor, pageCount, input.radius ?? PAGE_WINDOW_RADIUS);
  if (pages.length === 0) return null;
  const gate = pageWindowGate(
    pages.map((p) => p.page),
    figures,
    fulltext,
  );
  if (!gate) return null;
  return { anchor, pages, gate };
}

// "p.12" for one page, "pp.11–13" for a run.
export function pageRangeLabel(pages: readonly PageWindowPage[]): string {
  if (pages.length === 0) return "";
  const first = pages[0].page;
  const last = pages[pages.length - 1].page;
  return first === last ? `p.${first}` : `pp.${first}–${last}`;
}

// The line in the system prompt that says what the pictures are. Without it the
// model is handed three page scans with no account of where they came from and
// treats them as something the reader chose to show, rather than as the view
// around the mark.
export function pageWindowPrompt(plan: PageWindowPlan): string {
  const others = plan.pages.filter((p) => !p.anchor).map((p) => `p.${p.page}`);
  const around = others.length ? ` and, at lower resolution, ${others.join(" and ")}` : "";
  return [
    `Attached to the reader's latest message are page images from this document: p.${plan.anchor}, the page their highlight is on${around}.`,
    "They are there so you can see what the text extract cannot carry — figures, plots, equations, tables, page layout.",
    "The highlight marks where the reader is, not a region to look at: work out for yourself which part of these pages the question is about, and ignore the rest.",
    "Only this turn carries them; earlier turns of the conversation show a line naming the pages that were attached there.",
  ].join(" ");
}

// What an attached window degrades to once the turn is over. Sending the images
// again on every later turn would put a fresh copy of the window in context each
// time and eat the window within a few exchanges, so history keeps the fact and
// drops the pixels.
export function pageWindowMarker(plan: PageWindowPlan): string {
  return `[page images of ${pageRangeLabel(plan.pages)} were attached here]`;
}

// Anthropic's image cost rule, (width × height) / 750 tokens. Used for the
// telemetry line only — the budget planner prices an image at its own flat rate
// (src/budget/estimate.ts) and that is the number the ladder plans against.
export function pageImageTokens(width: number, height: number): number {
  return Math.ceil((width * height) / 750);
}

// A message as this module needs to see it: role, text, and an optional image
// list. Structural so the reading turn keeps its own message type.
export interface WindowMessage {
  role: "user" | "ai";
  text: string;
  images?: PageWindowImage[];
}

// Put the window on the turn: images on the message being answered, a one-line
// marker on every earlier user message, which is what those turns carried when
// they were the current one. Both halves are the same statement — the reader has
// been asking about this page all along — but only one of them costs tokens per
// picture.
//
// A mark-anchored thread is the only place this holds: its page never moves, so
// what an earlier turn showed is what this turn shows. The book-level thread
// follows the reader's scrolling and would need the range recorded per message
// to say anything true here, so it sends no window at all (turn.ts).
export function attachPageWindow<M extends WindowMessage>(
  messages: readonly M[],
  plan: PageWindowPlan,
  images: readonly PageWindowImage[],
): M[] {
  if (images.length === 0) return [...messages];
  let current = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") {
      current = i;
      break;
    }
  }
  if (current < 0) return [...messages];
  const marker = pageWindowMarker(plan);
  return messages.map((m, i) => {
    if (m.role !== "user") return m;
    if (i === current) {
      return { ...m, images: [...(m.images ?? []), ...images] } as M;
    }
    return { ...m, text: m.text ? `${m.text}\n\n${marker}` : marker } as M;
  });
}
