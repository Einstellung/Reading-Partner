// M6 "let the AI see the book": the pure parts of context assembly and the three
// reading tools. No Tauri and no cache access here — callers gather the data
// (current book's full text, topic materials, annotations) and hand it in, so
// this module stays headless and unit-testable. Full-text helpers are 1-based.

import { Type } from "@earendil-works/pi-ai";
import type { AgentTool } from "./agent";
import { chapterAt, readPages, searchTopic, textAround } from "../fulltext/query";
import type { Fulltext, SearchDoc } from "../fulltext/types";

// One material's annotations, flattened for the read_annotations tool. `page` is
// 1-based (converted from the engine's 0-based position.pageIndex) or null when
// the annotation carries no page.
export interface AnnotationLite {
  page: number | null;
  text: string;
  comment: string;
}

// A topic material as the tools see it: its label (file name), its cached full
// text (null when never extracted), and its user annotations.
export interface TopicMaterial {
  label: string;
  fulltext: Fulltext | null;
  annotations: AnnotationLite[];
}

// Max pages one read_pages call may pull, so the model can't dump a whole book.
const MAX_PAGES = 10;
const SEARCH_LIMIT = 8;
const SURROUND_RADIUS = 200;
const SURROUND_MAX = 700;

// Engine annotation page (0-based position.pageIndex) -> 1-based page for the
// full-text helpers. Null when the annotation has no page.
export function annotationPage(
  ann: { position?: { pageIndex?: number } } | null | undefined,
): number | null {
  const idx = ann?.position?.pageIndex;
  return typeof idx === "number" ? idx + 1 : null;
}

// Trim to `max` characters on a word boundary, adding an ellipsis when cut.
export function clip(text: string, max: number): string {
  const t = text.trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const sp = cut.lastIndexOf(" ");
  return (sp > max * 0.6 ? cut.slice(0, sp) : cut).trimEnd() + "…";
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
    default:
      return `Running ${name}`;
  }
}

// --- tool result formatting (pure) ---

// A 1-based, inclusive page range from one book, capped at MAX_PAGES and clamped
// to the book, each page labelled so the model can cite it.
export function formatPages(ft: Fulltext | null, from: number, to: number): string {
  if (!ft || ft.status !== "ok") {
    return "The full text of this book isn't machine-readable, so its pages can't be read.";
  }
  const total = ft.pages.length;
  const lo = Math.max(1, Math.min(from, to));
  if (lo > total) return `This book has ${total} pages; page ${lo} is out of range.`;
  const hi = Math.min(total, Math.max(from, to), lo + MAX_PAGES - 1);
  const parts: string[] = [];
  for (let p = lo; p <= hi; p++) parts.push(`=== Page ${p} ===\n${readPages(ft, p, p)}`);
  return parts.join("\n\n");
}

// BM25 across every material with a usable text layer, ranked, book + page cited.
export function formatSearch(query: string, materials: TopicMaterial[]): string {
  const docs: SearchDoc[] = materials
    .filter((m) => m.fulltext?.status === "ok")
    .map((m) => ({ label: m.label, fulltext: m.fulltext as Fulltext }));
  if (docs.length === 0) return "No material in this topic has a searchable text layer.";
  const hits = searchTopic(query, docs, SEARCH_LIMIT);
  if (hits.length === 0) return `No matches for "${query}" across the topic.`;
  return hits.map((h) => `[${h.label}, p${h.page}] ${h.snippet}`).join("\n\n");
}

// Match a material by label: exact (case-insensitive) first, then substring.
export function findMaterial(materials: TopicMaterial[], label: string): TopicMaterial | null {
  const q = label.trim().toLowerCase();
  return (
    materials.find((m) => m.label.toLowerCase() === q) ??
    materials.find((m) => m.label.toLowerCase().includes(q)) ??
    null
  );
}

// The user's highlights/underlines + notes for one named material.
export function formatAnnotations(materials: TopicMaterial[], label: string): string {
  const m = findMaterial(materials, label);
  if (!m) {
    const names = materials.map((x) => x.label).join("; ");
    return `No material named "${label}" in this topic. Available: ${names || "(none)"}.`;
  }
  if (m.annotations.length === 0) return `${m.label} has no annotations yet.`;
  return m.annotations
    .map((a) => {
      const head = a.page !== null ? `p${a.page}` : "—";
      const quote = a.text ? `"${a.text}"` : "(no selected text)";
      const note = a.comment ? ` — note: ${a.comment}` : "";
      return `${head}: ${quote}${note}`;
    })
    .join("\n");
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
