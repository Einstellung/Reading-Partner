// Stage a+b of the prep pipeline, pure parts: the prompt for the single AI call
// that reads the whole survey and returns the citation map plus 15-20
// load-bearing nominations, and the robust parsing of that JSON back into the
// prep data model. The AI call itself lives in live.ts.

import type { PrepChapter, PrepPaper, PrepReference } from "./types";
import type { Fulltext } from "../fulltext/types";

export interface PlanResult {
  chapters: PrepChapter[];
  references: PrepReference[];
  papers: PrepPaper[]; // the nominations, already merged with their reference data
}

export const PLAN_SYSTEM_PROMPT = [
  "You are the lesson-prep stage of a reading companion. You are given the full",
  "text of a survey paper, page by page. Produce a machine-readable study plan",
  "as a single JSON object and nothing else — no prose, no markdown fences.",
  "",
  "The JSON shape:",
  "{",
  '  "chapters": [{ "index": 1, "title": "Introduction", "startPage": 1 }],',
  '  "references": [{',
  '    "key": "12",',
  '    "title": "...",',
  '    "authors": ["..."],',
  '    "year": 2023,',
  '    "arxivId": "2303.12345",',
  '    "citedInChapters": [1, 3],',
  '    "expanded": true',
  "  }],",
  '  "nominations": [{ "key": "12", "reason": "why the survey leans on it" }]',
  "}",
  "",
  "Rules:",
  "- chapters: the survey's top-level sections in reading order, with the",
  "  1-based page each starts on.",
  "- references: every entry of the reference list you can identify. key is the",
  "  citation key as used in the text. arxivId only when the reference states",
  "  one (e.g. arXiv:2303.12345); otherwise null. citedInChapters lists the",
  "  chapters whose body text cites it. expanded is true when the survey",
  "  discusses the work in its own paragraph or subsection rather than a",
  "  passing citation.",
  "- nominations: the 15-20 load-bearing papers, chosen because they are cited",
  "  across several chapters and/or expanded individually. reason is one",
  "  sentence, from the survey's point of view.",
].join("\n");

// The survey text with explicit page markers so citedInChapters/startPage can
// be grounded. No truncation: the survey is the whole input by design.
export function planUserMessage(ft: Fulltext): string {
  const parts: string[] = ["Here is the survey, page by page:"];
  for (let i = 0; i < ft.pages.length; i++) {
    parts.push(`=== Page ${i + 1} ===\n${ft.pages[i]}`);
  }
  return parts.join("\n\n");
}

// --- parsing ---

// Models wrap JSON in fences or preamble despite instructions; cut from the
// first "{" to the last "}" before parsing.
export function extractJson(text: string): string {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("no JSON object in the model output");
  return text.slice(start, end + 1);
}

function asString(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v.trim() : fallback;
}

// Citation keys are often numeric ("[12]"); models emit them as numbers.
function asKey(v: unknown): string {
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return asString(v);
}

function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

function asNumberArray(v: unknown): number[] {
  return Array.isArray(v)
    ? v.map(Number).filter((n) => Number.isFinite(n) && n > 0).map((n) => Math.round(n))
    : [];
}

function asYear(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n > 1900 && n < 2200 ? Math.round(n) : null;
}

// A filesystem-safe, human-readable name from a paper title.
export function slugify(title: string): string {
  const s = title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50)
    .replace(/-+$/, "");
  return s || "paper";
}

export function uniqueSlug(taken: Set<string>, title: string): string {
  const base = slugify(title);
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) {
    const candidate = `${base}-${i}`;
    if (!taken.has(candidate)) return candidate;
  }
}

// Parse the plan call's output into chapters + references + nominated papers.
// Tolerant of missing optional fields; throws on structural problems (no JSON,
// no references, no nominations) so the pipeline can surface a plan failure.
export function parsePlan(text: string): PlanResult {
  const raw = JSON.parse(extractJson(text)) as Record<string, unknown>;

  const chapters: PrepChapter[] = (Array.isArray(raw.chapters) ? raw.chapters : [])
    .map((c: any, i: number) => ({
      index: Number.isFinite(Number(c?.index)) ? Math.round(Number(c.index)) : i + 1,
      title: asString(c?.title, `Chapter ${i + 1}`),
      startPage: Number.isFinite(Number(c?.startPage)) ? Math.max(1, Math.round(Number(c.startPage))) : 1,
    }))
    .sort((a, b) => a.startPage - b.startPage);

  const references: PrepReference[] = (Array.isArray(raw.references) ? raw.references : [])
    .map((r: any): PrepReference | null => {
      const title = asString(r?.title);
      if (!title) return null;
      return {
        key: asKey(r?.key),
        title,
        authors: asStringArray(r?.authors),
        year: asYear(r?.year),
        arxivId: asString(r?.arxivId) || null,
        citedInChapters: asNumberArray(r?.citedInChapters),
        expanded: r?.expanded === true,
      };
    })
    .filter((r): r is PrepReference => r !== null);
  if (references.length === 0) throw new Error("plan has no parseable references");

  const byKey = new Map(references.map((r) => [r.key, r]));
  const taken = new Set<string>();
  const papers: PrepPaper[] = (Array.isArray(raw.nominations) ? raw.nominations : [])
    .map((n: any): PrepPaper | null => {
      const ref = byKey.get(asKey(n?.key));
      if (!ref) return null;
      const slug = uniqueSlug(taken, ref.title);
      taken.add(slug);
      return {
        slug,
        title: ref.title,
        authors: ref.authors,
        year: ref.year,
        arxivId: ref.arxivId,
        citedInChapters: ref.citedInChapters,
        reason: asString(n?.reason),
        status: "queued",
      };
    })
    .filter((p): p is PrepPaper => p !== null);
  if (papers.length === 0) throw new Error("plan has no resolvable nominations");

  return { chapters, references, papers };
}
