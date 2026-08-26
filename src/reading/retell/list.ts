// The Retell list of a topic: what each retell says about itself before you open
// it (docs/31, "界面" — 讲是这个 topic 下的几场讲).
//
// A retell's state is one question — how far it has got — and the retell file
// answers it. The deck it used to end in is gone (docs/44): the talk note is the
// product now, and the note's own list is the topic's Rehearsal section.

import type { Retell, RetellMaterial } from "./types";

// A candidate material when a retell is being started: everything in the topic
// that has a book id, with how much of it the reader has marked.
export interface MaterialCandidate extends RetellMaterial {
  marks: number;
}

// What a new retell starts with ticked (docs/31: 默认把这个 topic 里有痕迹的材料放进去,
// 用户在里面减). A material with no marks is one the reader has not read against
// this question yet, and a retell of it would have nothing of theirs to work
// from. When nothing in the topic has been marked, everything is offered rather
// than nothing — an empty dialog gives the reader no way forward.
export function defaultMaterialSelection(candidates: readonly MaterialCandidate[]): string[] {
  const marked = candidates.filter((c) => c.marks > 0);
  return (marked.length > 0 ? marked : candidates).map((c) => c.bookId);
}

export interface RetellRow {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  // How many chapters have been settled. The total is not here: it needs every
  // material's skeleton off disk, which is not worth a list row.
  settled: number;
  materials: number;
}

// One line under the name. Says what the retell is and what has happened to it —
// never a percentage, because the denominator (how many chapters there are)
// costs a read per material.
export function retellSummary(row: RetellRow): string {
  const materials = `${row.materials} material${row.materials === 1 ? "" : "s"}`;
  if (row.settled === 0) return `${materials} · not started`;
  return `${materials} · ${row.settled} chapter${row.settled === 1 ? "" : "s"} settled`;
}

// Newest first, by when the retell was last worked on rather than when it was
// created: a retell picked up again yesterday is the one being prepared now.
export function retellRows(retells: readonly Retell[]): RetellRow[] {
  return retells
    .map(
      (t): RetellRow => ({
        id: t.id,
        name: t.name,
        createdAt: t.createdAt,
        updatedAt: t.updatedAt,
        settled: t.decisions.length,
        materials: t.materials.length,
      }),
    )
    .sort((a, b) => b.updatedAt - a.updatedAt || b.createdAt - a.createdAt);
}
