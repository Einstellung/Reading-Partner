// Classroom-mode context assembly, pure. The prompt is two parts: a stable
// prefix (role + the whole survey with page markers) that never changes between
// turns of the same book — so provider prompt caching can hold it — and a
// variable tail (current position, this chapter's prep notes, prep status,
// citation/tool instructions) appended after it.

import type { Fulltext } from "../fulltext/types";
import type { PrepPaper, PrepState } from "./types";

export interface ClassroomNote {
  slug: string;
  title: string;
  body: string;
}

export interface ClassroomContext {
  topicName: string;
  surveyName: string;
  fulltext: Fulltext;
  pageLabel: string | null;
  chapterTitle: string | null;
  selectionText: string;
  selectionComment?: string | null;
  notes: ClassroomNote[];
  prep: PrepState | null;
  hasTools: boolean;
  // Compact figure catalog for the survey (M9), or "" when none detected.
  figureCatalog?: string;
}

// The stable prefix: everything before the per-turn context. Depends only on
// the survey itself, so its string identity survives across turns.
export function classroomPromptPrefix(surveyName: string, ft: Fulltext): string {
  const lines = [
    "You are a reading companion in classroom mode: you have digested this",
    "entire survey and pre-read its load-bearing references, and you teach by",
    "walking the user through the survey itself — a newcomer to the field who",
    "picked this survey as their textbook.",
    "",
    "How to teach:",
    "- Follow the survey's own structure; it is the syllabus.",
    "- Explain in plain terms a newcomer can follow; expand jargon on first use.",
    "- Ground every claim in the text. Cite survey pages as [p.N]. When you",
    "  draw on a pre-read reference paper, cite it as [paper-slug p.N] using",
    "  the slug from the prep notes. These citations become clickable links.",
    "- Follow the user's language: if they write in Chinese, answer in Chinese.",
    "- Your replies render as Markdown: math as $...$ / $$...$$, code fenced.",
    "",
    `The full survey ("${surveyName}"), page by page:`,
  ];
  for (let i = 0; i < ft.pages.length; i++) {
    lines.push(`=== Page ${i + 1} ===`, ft.pages[i]);
  }
  return lines.join("\n");
}

function paperLine(p: PrepPaper): string {
  const status = p.status === "done" ? "note ready" : p.status;
  return `- ${p.slug} — ${p.title}${p.year ? ` (${p.year})` : ""} [${status}]`;
}

export function buildClassroomSystemPrompt(ctx: ClassroomContext): string {
  const lines: string[] = [classroomPromptPrefix(ctx.surveyName, ctx.fulltext)];

  lines.push("", "Current position:", `- Topic: ${ctx.topicName}`);
  if (ctx.pageLabel) lines.push(`- Page: ${ctx.pageLabel}`);
  if (ctx.chapterTitle) lines.push(`- Chapter: ${ctx.chapterTitle}`);
  if (ctx.selectionText.trim()) {
    lines.push(`- Marked passage: "${ctx.selectionText.trim()}"`);
  }
  if (ctx.selectionComment && ctx.selectionComment.trim()) {
    lines.push(`- The user's note on it: "${ctx.selectionComment.trim()}"`);
  }

  if (ctx.notes.length > 0) {
    lines.push("", "Prep notes for references this chapter leans on:");
    for (const n of ctx.notes) {
      lines.push("", `--- ${n.slug}: ${n.title} ---`, n.body);
    }
    lines.push(
      "",
      "Note page anchors like [p.3] refer to pages of that paper, not the",
      "survey; cite them as [paper-slug p.3].",
    );
  }

  if (ctx.prep && ctx.prep.papers.length > 0) {
    lines.push("", "All pre-read references (prep status):");
    for (const p of ctx.prep.papers) lines.push(paperLine(p));
  }

  if (ctx.figureCatalog && ctx.figureCatalog.trim()) {
    lines.push("", ctx.figureCatalog.trim());
  }

  if (ctx.hasTools) {
    lines.push(
      "",
      "Tools:",
      "The survey is already fully in your context above. When a question goes",
      "deeper than the prep notes, call tools instead of guessing:",
      "read_paper(slug, from, to) reads pages of a pre-read paper's full text;",
      "read_note(slug) returns a paper's whole prep note; search_topic(query)",
      "keyword-searches the topic's materials; read_annotations(material) lists",
      "the user's marks. Call tools directly — never ask permission to read.",
      ...(ctx.figureCatalog && ctx.figureCatalog.trim()
        ? ["view_figure(id) shows you a survey figure so you can describe what it depicts."]
        : []),
    );
  }

  return lines.join("\n");
}
