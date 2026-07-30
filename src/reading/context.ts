// M6 "let the AI see the book": the pure parts of context assembly and the three
// reading tools. No Tauri and no cache access here — callers gather the data
// (current book's full text, topic materials, annotations) and hand it in, so
// this module stays headless and unit-testable. Full-text helpers are 1-based.

import { Type } from "@earendil-works/pi-ai";
import type { AgentTool } from "../ai/agent";
import { chapterAt, textAround } from "../fulltext/query";
import { formatPages, formatSearch, MAX_PAGES, type TopicMaterial } from "../fulltext/format";
import type { Fulltext } from "../fulltext/types";

const SURROUND_RADIUS = 200;
const SURROUND_MAX = 700;

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

// The whole-book outline from the reader's notes (docs/14), as a labeled block
// for the opening context, or "" when there is no overview. Truncated to ~max
// chars at a paragraph boundary so a long framework can't crowd out the prompt.
export function notesOverviewSection(overview: string | null | undefined, max = 1500): string {
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

// A short window of text around a marked page, for the kickoff context. Empty
// when the book has no usable text layer.
export function surroundingText(ft: Fulltext, page: number): string {
  if (ft.status !== "ok") return "";
  return clip(textAround(ft, page, SURROUND_RADIUS), SURROUND_MAX);
}

// The chapter title a page falls under, or null (no outline / no text).
export function chapterTitleAt(ft: Fulltext | null, page: number | null): string | null {
  if (!ft || ft.status !== "ok" || page === null) return null;
  return chapterAt(ft, page)?.title ?? null;
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
    case "search_papers":
      return `Searching the literature for “${args.query}”`;
    case "memory_search":
      return `Searching memory for “${args.query}”`;
    case "memory_read":
      return "Reading a memory";
    case "memory_update":
      return args.action === "delete" ? "Forgetting a memory" : "Updating memory";
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
}): AgentTool[] {
  const { currentFulltext, materials } = ctx;
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
      execute: async (args) =>
        formatPages(currentFulltext, Math.round(Number(args.from)), Math.round(Number(args.to))),
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
