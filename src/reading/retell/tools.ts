// The retell's agent tools: write a chapter's decision to the retell's outline,
// read back a chapter note the reader already wrote, and read the outline as it
// now stands.
//
// record_chapter_decision is the one tool in this app whose side effect is not
// derived from anything (docs/31: the decisions are the outline of the retell).
// It writes without asking, which is deliberate — a confirm gate on every
// chapter would make the retell a form to fill in — but the write is bounded:
// one chapter, replacing that chapter's previous decision, and the reader sees
// exactly what landed in the card it raises.

import { Type } from "@earendil-works/pi-ai";
import type { AgentTool } from "../../ai/agent";
import type { RetellDecisionCardData } from "./cards";
import { formatOutline } from "./plan";
import type { RetellChapter, PlanDecision, RetellPlan } from "./types";

export interface RetellToolDeps {
  chapters: readonly RetellChapter[];
  // Merge one decision into the book's plan file and return nothing useful; the
  // model's confirmation is the card, not a payload.
  record(decision: PlanDecision): Promise<void>;
  // A chapter note's body, or null when the reader never generated one.
  readNote(chapter: number): Promise<string | null>;
  // The decision file as it is on disk right now — re-read rather than closed
  // over, so a decision recorded earlier in this same turn is in the answer.
  readPlan(): Promise<RetellPlan | null>;
  // Raise the decision card in the conversation. Absent in headless tests.
  onCard?(card: RetellDecisionCardData): void;
  now?(): number;
}

function chapterList(chapters: readonly RetellChapter[]): string {
  return chapters.map((c) => `${c.index}. ${c.title}`).join("; ") || "(none)";
}

export function buildRetellTools(deps: RetellToolDeps): AgentTool[] {
  const now = deps.now ?? (() => Date.now());
  const find = (n: number) => deps.chapters.find((c) => c.index === n);

  return [
    {
      name: "record_chapter_decision",
      description:
        "Record what this chapter contributes to the retell, after discussing it with " +
        "the reader. Call once per chapter, when that chapter's exchange is finished; " +
        "calling it again for the same chapter replaces the earlier decision.",
      parameters: Type.Object({
        chapter: Type.Number({ description: "The chapter's number in the skeleton." }),
        include: Type.Boolean({ description: "Whether the chapter goes in the retell." }),
        points: Type.Array(Type.String(), {
          description:
            "What the chapter contributes, in the reader's own framing. One short " +
            "line each. Empty when the chapter is cut.",
        }),
        figure: Type.Optional(
          Type.String({
            description: "The figure that carries it — a [fig:N] id, or a description.",
          }),
        ),
        note: Type.Optional(
          Type.String({ description: "One line of why, when the exchange produced one." }),
        ),
      }),
      execute: async (args) => {
        const chapter = Math.round(Number(args.chapter));
        const target = find(chapter);
        if (!target) {
          return `No chapter ${args.chapter} in this book's skeleton. Chapters: ${chapterList(deps.chapters)}.`;
        }
        const points = Array.isArray(args.points)
          ? (args.points as unknown[]).map((p) => String(p).trim()).filter(Boolean)
          : [];
        const figure = typeof args.figure === "string" ? args.figure.trim() : "";
        const note = typeof args.note === "string" ? args.note.trim() : "";
        const decision: PlanDecision = {
          chapter,
          title: target.title,
          include: !!args.include,
          points,
          ...(figure ? { figure } : {}),
          ...(note ? { note } : {}),
          updatedAt: now(),
        };
        await deps.record(decision);
        const { updatedAt, ...rest } = decision;
        void updatedAt;
        deps.onCard?.({ kind: "retell-decision", ...rest });
        return decision.include
          ? `Recorded chapter ${chapter} as going in the retell, with ${points.length} point(s). The reader can see the entry.`
          : `Recorded chapter ${chapter} as cut from the retell. The reader can see the entry.`;
      },
    },
    {
      name: "read_chapter_note",
      description:
        "Read the note the reader's notes pass wrote for a chapter of this book, by " +
        "chapter number. Background only — it is not the reader talking.",
      parameters: Type.Object({
        chapter: Type.Number({ description: "The chapter's number in the skeleton." }),
      }),
      execute: async (args) => {
        const chapter = Math.round(Number(args.chapter));
        const target = find(chapter);
        if (!target) {
          return `No chapter ${args.chapter} in this book's skeleton. Chapters: ${chapterList(deps.chapters)}.`;
        }
        const body = await deps.readNote(chapter);
        if (!body) return `No note on file for chapter ${chapter} ("${target.title}").`;
        return body;
      },
    },
    {
      name: "read_retell_outline",
      description:
        "Read the whole retell outline back: every chapter settled so far, what each " +
        "one contributes, which were cut, and which are not settled yet. Use it when " +
        "the reader asks what their retell looks like now. Read-only.",
      parameters: Type.Object({}),
      execute: async () => formatOutline(deps.chapters, await deps.readPlan()),
    },
  ];
}
