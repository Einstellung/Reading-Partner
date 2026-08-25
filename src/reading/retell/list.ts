// The Retell list of a topic: what each retell says about itself before you open
// it (docs/31, "界面" — 讲是这个 topic 下的几场讲).
//
// A retell's state is two questions, and they are answered from two places that
// share one id: how far the retell has got, which is the retell file, and
// whether a deck has come out of it, which is the deck registry
// (slides/retells.json, keyed by the same retell id). The second one arrives as a
// plain map from the caller rather than as the registry's own type — the deck is
// the retell's product, so slides reads retells and not the other way round.

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

export type RetellStage = "preparing" | "deck";

export interface RetellRow {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  stage: RetellStage;
  // How many chapters have been settled. The total is not here: it needs every
  // material's skeleton off disk, which is not worth a list row.
  settled: number;
  materials: number;
  // The deck file to open, when one has been built.
  deckFile: string | null;
}

// One line under the name. Says what the retell is and what has happened to it —
// never a percentage, because the denominator (how many chapters there are)
// costs a read per material.
export function retellSummary(row: RetellRow): string {
  const materials = `${row.materials} material${row.materials === 1 ? "" : "s"}`;
  if (row.stage === "deck") return `${materials} · deck ready`;
  if (row.settled === 0) return `${materials} · not started`;
  return `${materials} · ${row.settled} chapter${row.settled === 1 ? "" : "s"} settled`;
}

// Newest first, by when the retell was last worked on rather than when it was
// created: a retell picked up again yesterday is the one being prepared now.
// `deckFiles` maps a retell id to the deck file built from it, when one has been.
export function retellRows(
  retells: readonly Retell[],
  deckFiles: ReadonlyMap<string, string>,
): RetellRow[] {
  return retells
    .map((t): RetellRow => {
      const deckFile = deckFiles.get(t.id) ?? null;
      return {
        id: t.id,
        name: t.name,
        createdAt: t.createdAt,
        updatedAt: t.updatedAt,
        stage: deckFile ? "deck" : "preparing",
        settled: t.decisions.length,
        materials: t.materials.length,
        deckFile,
      };
    })
    .sort((a, b) => b.updatedAt - a.updatedAt || b.createdAt - a.createdAt);
}
