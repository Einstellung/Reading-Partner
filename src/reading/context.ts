// M6 "let the AI see the book": the pure parts of context assembly and the three
// reading tools. No Tauri and no cache access here — callers gather the data
// (current book's full text, topic materials, annotations) and hand it in, so
// this module stays headless and unit-testable. Full-text helpers are 1-based.

import { Type } from "@earendil-works/pi-ai";
import type { AgentTool } from "../legion/execute/turn";
import { estimateTextTokens } from "../budget";
import {
  formatPages,
  formatSearch,
  MAX_PAGES,
  type PageLabel,
  type TopicMaterial,
} from "../fulltext/format";
import type { Fulltext } from "../fulltext/types";
import { PAGE_WINDOW_RADIUS } from "./figures/page-window";

// Engine annotation page (0-based position.pageIndex) -> 1-based page for the
// full-text helpers. Defined with the annotation shape it reads so the units
// under reading/ can use it without importing this group root.
export { annotationPage } from "../platform/app/reader-contract";

// Trim to `max` characters on a word boundary, adding an ellipsis when cut.
export function clip(text: string, max: number): string {
  const t = text.trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const sp = cut.lastIndexOf(" ");
  return (sp > max * 0.6 ? cut.slice(0, sp) : cut).trimEnd() + "…";
}

// The whole-book outline from the reader's notes (docs/09), as a labeled block
// for the opening context, or "" when there is no overview. Truncated to ~max
// chars at a paragraph boundary so a long framework can't crowd out the prompt.
export function spineOverviewSection(overview: string | null | undefined, max = 1500): string {
  const body = (overview ?? "").trim();
  if (!body) return "";
  let text = body;
  if (body.length > max) {
    const cut = body.slice(0, max);
    const para = cut.lastIndexOf("\n\n");
    text = (para > max * 0.5 ? cut.slice(0, para) : cut).trimEnd() + "\n\n…";
  }
  return [
    "The whole-book outline from the reader's notes (their own lecture notes for",
    "this book; use it for orientation, cite the book itself for specifics):",
    '"""',
    text,
    '"""',
  ].join("\n");
}

// --- the pages a marked passage sits in ---

// The ceiling on the whole block. Three typeset pages come to about 2k tokens;
// a dense one can be twice that, and past this the block costs more than the
// round trip it exists to save. Measured the way the send path measures
// (src/budget/estimate.ts), so a CJK page is counted as a CJK page.
export const MARK_PAGES_MAX_TOKENS = 4000;

// The page header, identical to the one read_pages returns: the model copies the
// anchor it can see, and one page must not carry two spellings depending on
// which way it arrived. A supplement's anchor names its title (docs/67).
function pageLabel(pageAnchor?: (page: number) => string): PageLabel {
  return (p) => `=== Page ${p} === ${pageAnchor ? pageAnchor(p) : `[p.${p}]`}`;
}

// Cut `text` down to `maxTokens` on the same estimate. Proportional, then
// corrected, because the estimate is charged per character class and a straight
// ratio overshoots on mixed scripts.
function clipToTokens(text: string, maxTokens: number): string {
  let out = text;
  for (let i = 0; i < 12; i++) {
    const tokens = estimateTextTokens(out);
    if (tokens <= maxTokens || out.length === 0) break;
    const next = Math.max(1, Math.floor((out.length * maxTokens) / tokens) - 1);
    if (next >= out.length) break;
    out = out.slice(0, next);
  }
  return out;
}

// The pages the block below covers, clamped to the document, or null when there
// is nothing to inline. The turn's load statement names the same range, so it is
// answered once and read twice.
export function markedPageRange(
  ft: Fulltext | null,
  page: number,
): { from: number; to: number } | null {
  if (!ft || ft.status !== "ok") return null;
  const total = ft.pages.length;
  if (page < 1 || page > total) return null;
  return {
    from: Math.max(1, page - PAGE_WINDOW_RADIUS),
    to: Math.min(total, page + PAGE_WINDOW_RADIUS),
  };
}

// The page a passage was marked on and the page either side, inlined. The mark
// used to ride a few hundred characters of text around it, and the model
// answered by calling read_pages first and answering second — an extra round
// trip on two turns in three, 6.7s at the median. This is that fetch, made
// before the turn is sent.
//
// Same radius as the page-image window (figures/page-window.ts): a marked
// passage is answered out of its page and its neighbours, and the rest of the
// document is what read_pages and read_chapter are for.
//
// Empty when the document has no usable text layer or the page is off the end.
export function markedPagesSection(
  ft: Fulltext | null,
  page: number,
  pageAnchor?: (page: number) => string,
): string {
  const span = markedPageRange(ft, page);
  if (!ft || !span) return "";
  const label = pageLabel(pageAnchor);
  const render = (p: number): string => formatPages(ft, p, p, label, 1);

  const { from: first, to: last } = span;
  const nums: number[] = [];
  for (let p = first; p <= last; p++) nums.push(p);

  let body = nums.map(render).join("\n\n");
  let shown = nums.length;
  const notes: string[] = [];
  // The neighbours go first: they are the context, the marked page is the
  // subject. Either cut says so, because a cut the model cannot see reads as
  // "this is all those pages say".
  if (nums.length > 1 && estimateTextTokens(body) > MARK_PAGES_MAX_TOKENS) {
    body = render(page);
    shown = 1;
    notes.push(
      `[The pages either side of p.${page} were left out to keep this turn in budget;`,
      "read_pages returns them.]",
    );
  }
  if (estimateTextTokens(body) > MARK_PAGES_MAX_TOKENS) {
    const head = label(page);
    const room = Math.max(1, MARK_PAGES_MAX_TOKENS - estimateTextTokens(head));
    body = `${head}\n${clipToTokens(ft.pages[page - 1] ?? "", room)}`;
    notes.push(`[Page ${page} is cut off here; read_pages returns it in full.]`);
  }

  return [
    shown === 1
      ? "The page the marked passage sits on:"
      : "The page the marked passage sits on, and the page either side:",
    "",
    body,
    "",
    ...(notes.length > 0 ? [...notes, ""] : []),
    "These pages are already in front of you: answer from them and cite them by the",
    "anchors above. Call read_pages or read_chapter only for pages outside this",
    "window.",
  ].join("\n");
}

// Human phrase for a running/failed tool call, shown in the chat trace.
export function toolStatusLabel(name: string, args: Record<string, any>): string {
  switch (name) {
    case "read_pages": {
      const from = Number(args.from);
      const to = Number(args.to);
      const lo = Math.min(from, to);
      const hi = Math.max(from, to);
      return lo === hi ? `Reading page ${lo}` : `Reading pages ${lo}–${hi}`;
    }
    case "search_topic":
      return `Searching the topic for “${args.query}”`;
    case "read_annotations":
      return `Reading your notes on ${args.material}`;
    case "find_paper":
      return `Looking up “${args.paper}”`;
    case "observation_search":
      return `Searching its observations for “${args.query}”`;
    case "observation_read":
      return "Reading an observation";
    case "observation_update":
      return args.action === "delete" ? "Dropping an observation" : "Updating an observation";
    default:
      return `Running ${name}`;
  }
}

// --- tool result formatting (pure) ---

// Match a material by label: exact (case-insensitive) first, then substring.
export function findMaterial(materials: TopicMaterial[], label: string): TopicMaterial | null {
  const q = label.trim().toLowerCase();
  return (
    materials.find((m) => m.label.toLowerCase() === q) ??
    materials.find((m) => m.label.toLowerCase().includes(q)) ??
    null
  );
}

// read_annotations has no natural bound: a heavily marked book carries hundreds
// of highlights, and one of them can be a whole page of selected text. Cap the
// list and each entry, and say so when either bites — an unannounced cut reads
// to the model as "these are all the marks there are".
const MAX_ANNOTATIONS = 60;
const ANNOTATION_CHARS = 400;

// The user's highlights/underlines + notes for one named material, in page
// order, capped.
export function formatAnnotations(materials: TopicMaterial[], label: string): string {
  const m = findMaterial(materials, label);
  if (!m) {
    const names = materials.map((x) => x.label).join("; ");
    return `No material named "${label}" in this topic. Available: ${names || "(none)"}.`;
  }
  if (m.annotations.length === 0) return `${m.label} has no annotations yet.`;
  const shown = m.annotations.slice(0, MAX_ANNOTATIONS);
  const lines = shown.map((a) => {
    const head = a.page !== null ? `p${a.page}` : "—";
    const quote = a.text ? `"${clip(a.text, ANNOTATION_CHARS)}"` : "(no selected text)";
    const note = a.comment ? ` — note: ${clip(a.comment, ANNOTATION_CHARS)}` : "";
    return `${head}: ${quote}${note}`;
  });
  const hidden = m.annotations.length - shown.length;
  if (hidden > 0) {
    lines.push(`[${hidden} more annotation${hidden === 1 ? "" : "s"} on this material, not shown]`);
  }
  return lines.join("\n");
}

// Build the reading tools for the current call, scoped to one topic. Only tools
// with usable data are returned; an empty array is fine when nothing is
// extractable (the agent then answers from the prompt alone).
export function buildReadingTools(ctx: {
  currentFulltext: Fulltext | null;
  materials: TopicMaterial[];
  // The citation shorthand for one page of the document on screen. The
  // book's pages are cited bare; a supplement's carry its title, so the
  // header the model copies has to say which (docs/67).
  pageAnchor?: (page: number) => string;
}): AgentTool[] {
  const { currentFulltext, materials, pageAnchor } = ctx;
  const tools: AgentTool[] = [];

  if (currentFulltext?.status === "ok") {
    tools.push({
      name: "read_pages",
      description:
        "Read a page range from the book the user is currently in. Pages are 1-based and inclusive; at most " +
        `${MAX_PAGES} pages per call.`,
      parameters: Type.Object({
        from: Type.Number({ description: "First page (1-based)." }),
        to: Type.Number({ description: "Last page (1-based, inclusive)." }),
      }),
      // Each page header carries the citation shorthand for that page, so the
      // model copies an anchor it can see rather than assembling one.
      execute: async (args) =>
        formatPages(
          currentFulltext,
          Math.round(Number(args.from)),
          Math.round(Number(args.to)),
          (p) => `=== Page ${p} === ${pageAnchor ? pageAnchor(p) : `[p.${p}]`}`,
        ),
    });
  }

  if (materials.some((m) => m.fulltext?.status === "ok")) {
    tools.push({
      name: "search_topic",
      description:
        "Keyword-search the full text of every material in this topic. Returns ranked snippets, each tagged with its book and page.",
      parameters: Type.Object({
        query: Type.String({ description: "Search terms." }),
      }),
      execute: async (args) => formatSearch(String(args.query), materials),
    });
  }

  if (materials.some((m) => m.annotations.length > 0)) {
    tools.push({
      name: "read_annotations",
      description:
        "List the user's highlights, underlines, and notes on one named topic material. Use the material's title as shown in the topic booklist.",
      parameters: Type.Object({
        material: Type.String({ description: "The material's title from the topic booklist." }),
      }),
      execute: async (args) => formatAnnotations(materials, String(args.material)),
    });
  }

  return tools;
}
