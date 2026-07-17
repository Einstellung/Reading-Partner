// Classroom-mode agent tools over the prep artefacts: read a pre-read paper's
// full text (from the fulltext cache keyed by the synthetic prep path) or its
// whole note. Complements the M6 reading tools, which stay wired for the
// survey/topic side.

import { Type } from "@earendil-works/pi-ai";
import type { AgentTool } from "../ai/agent";
import { formatPages } from "../ai/reading-context";
import { getFulltext } from "../fulltext/store";
import { parseNote } from "./notes";
import { paperFulltextHash, readPrepNote } from "./store";
import type { PrepState } from "./types";

function slugList(state: PrepState): string {
  return state.papers.map((p) => p.slug).join(", ") || "(none)";
}

export function buildClassroomTools(state: PrepState): AgentTool[] {
  const surveyHash = state.surveyHash;
  const bySlug = new Map(state.papers.map((p) => [p.slug, p]));

  return [
    {
      name: "read_paper",
      description:
        "Read a 1-based, inclusive page range from a pre-read reference paper's " +
        "full text. Use the paper's slug from the prep notes (at most 10 pages per call).",
      parameters: Type.Object({
        slug: Type.String({ description: "The paper's slug." }),
        from: Type.Number({ description: "First page (1-based)." }),
        to: Type.Number({ description: "Last page (1-based, inclusive)." }),
      }),
      execute: async (args) => {
        const slug = String(args.slug);
        if (!bySlug.has(slug)) {
          return `No prepped paper with slug "${slug}". Available: ${slugList(state)}.`;
        }
        const ft = await getFulltext(paperFulltextHash(surveyHash, slug));
        if (!ft) {
          return `The full text of "${slug}" isn't cached (its prep may be abstract-only). Try read_note instead.`;
        }
        return formatPages(ft, Math.round(Number(args.from)), Math.round(Number(args.to)));
      },
    },
    {
      name: "read_note",
      description: "Read the whole prep note of a pre-read reference paper, by slug.",
      parameters: Type.Object({
        slug: Type.String({ description: "The paper's slug." }),
      }),
      execute: async (args) => {
        const slug = String(args.slug);
        if (!bySlug.has(slug)) {
          return `No prepped paper with slug "${slug}". Available: ${slugList(state)}.`;
        }
        const raw = await readPrepNote(surveyHash, slug);
        if (!raw) return `No note on disk yet for "${slug}" (status: ${bySlug.get(slug)?.status}).`;
        return parseNote(raw).body;
      },
    },
  ];
}
