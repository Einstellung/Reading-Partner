// The prep side of a retell's context: which of the materials' paper notes ride
// in the prompt, and how their prep lists are printed. Pure.
//
// A retell of a survey is a retell of the papers it strings together, so the
// notes the prep run wrote about those papers are material here in the same way
// they are in the reader (reading/turn.ts). What is different is that a retell
// holds several materials, each with its own prep run: the budget is one budget
// across all of them, and the ordering has no reader's scroll position to work
// from.

import {
  CLASSROOM_NOTE_BUDGET,
  classroomNoteCost,
  prepStatusSection,
  selectClassroomNotes,
  type ClassroomNote,
} from "../prep/papers/classroom";
import { chapterIndexForPage } from "../prep/papers/scheduler";
import type { PrepState } from "../prep/papers/types";

// As much of a material as this file needs, so the selection is testable without
// a fulltext, a figure list or a library entry (material.ts's LoadedMaterial
// satisfies it).
export interface PreppedMaterial {
  bookId: string;
  title: string;
  prep: PrepState | null;
  prepNotes: readonly ClassroomNote[];
}

// Where the retell is about to go, which is all there is to order the notes by:
// nobody is scrolled anywhere, so the position that stands in for the reader's
// is the chapter this turn is heading into (retell/turn.ts computes it). The page
// is in that material's own numbering, not the combined chapter list's.
export interface PrepNoteFocus {
  bookId: string;
  startPage: number;
}

// The chapter number to order one material's notes by. The prep run keeps its
// own chapter table, and it is not the one the retell walks — PrepState.chapters
// comes from the plan call, prep-*/chapters/state.json is a different table with
// a different numbering — so the retell's chapter reaches it as a page and is
// re-resolved here. A material the retell is not heading into orders from its
// first chapter; the order only matters once the budget bites.
function chapterFor(m: PreppedMaterial, focus: PrepNoteFocus | null): number {
  if (!m.prep || !focus || focus.bookId !== m.bookId) return 1;
  return chapterIndexForPage(m.prep.chapters, focus.startPage);
}

// The notes that ride in this turn's prompt, across every material, under one
// budget. Walked in the retell's material order, each material offered what the
// ones before it left — a shelf is a shelf however many books it stands beside,
// and two materials each spending the full cap would put eighty thousand tokens
// of references in front of a conversation about what the reader can say.
//
// A slug already carried is skipped rather than printed again: the same paper is
// routinely prepped under several materials (the two survey files this was
// measured on are the same paper, so every slug collides), and the second copy is
// the same text bought twice. The status lists still name it under each material
// that nominated it, which is true — it is the note that is shared, not the
// nomination.
export function selectRetellPrepNotes(
  materials: readonly PreppedMaterial[],
  focus: PrepNoteFocus | null,
  budget: number = CLASSROOM_NOTE_BUDGET,
): ClassroomNote[] {
  const out: ClassroomNote[] = [];
  const seen = new Set<string>();
  let left = budget;
  for (const m of materials) {
    if (!m.prep) continue;
    const fresh = m.prepNotes.filter((n) => !seen.has(n.slug));
    const picked = selectClassroomNotes(fresh, m.prep.papers, {
      chapter: chapterFor(m, focus),
      chapterCount: m.prep.chapters.length,
      budget: left,
    });
    for (const note of picked) {
      seen.add(note.slug);
      left -= classroomNoteCost(note);
      out.push(note);
    }
  }
  return out;
}

// The prep lists of every material that has one. One material's is the prep
// list; several get a heading each, the same way the figure catalog does
// (retell/turn.ts) — a slug means a paper of that material's reference list, and
// two lists laid end to end with no headings read as one.
export function retellPrepStatus(
  materials: readonly PreppedMaterial[],
  inContext: ReadonlySet<string>,
): string {
  const lists = materials
    .map((m) => ({ title: m.title, text: prepStatusSection(m.prep, inContext) }))
    .filter((l) => l.text !== "");
  if (lists.length === 0) return "";
  if (lists.length === 1) return lists[0].text;
  return lists.map((l) => `In "${l.title}":\n${l.text}`).join("\n\n");
}
