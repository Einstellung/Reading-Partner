// What the topic's Rehearsal section lists (docs/43, "入口"): every talk under
// this topic that can be given, whether its outline came out of a retell or was
// started on its own.
//
// A retell that has produced an outline belongs here before anyone has ever
// pressed Rehearse on it — otherwise the section is empty for exactly the reader
// who has already done the work, and the only door to the talk stays the retell's
// own header. So the list is a join, and a row without an id is a rehearsal that
// has not been created yet: pressing it creates one (store.ts's
// rehearsalForRetell), which is how the two doors end at one object.
//
// Pure. The reads are the section's, and the join is here so it can be tested.

import type { Rehearsal } from "./types";

// The half of a retell this needs: it is named structurally rather than imported
// from reading/retell, because reading/retell imports this module (deleting a
// retell deletes its rehearsal) and the two must not point at each other.
export interface DeckedRetell {
  retellId: string;
  name: string;
  outlineId: string;
}

export interface RehearsalRow {
  // Stable across a refresh, and unique whether or not the rehearsal exists yet.
  key: string;
  // null until the first Rehearse creates the object.
  id: string | null;
  retellId: string | null;
  name: string;
  outlineId: string;
  runs: number;
  // When the last pass started, or null when there has not been one.
  lastRunAt: number | null;
}

export interface RunCount {
  runs: number;
  lastRunAt: number | null;
}

/**
 * The rows for one topic, newest first: this topic's rehearsals, plus the
 * retells of this topic whose deck has never been rehearsed. A retell that
 * already has a rehearsal appears once — as the rehearsal, which is the object
 * carrying the history.
 */
export function rehearsalRows(
  rehearsals: readonly Rehearsal[],
  retells: readonly DeckedRetell[],
  counts: ReadonlyMap<string, RunCount>,
): RehearsalRow[] {
  const rehearsed = new Set<string>();
  const rows: { row: RehearsalRow; at: number }[] = [];
  for (const r of rehearsals) {
    if (r.retellId) rehearsed.add(r.retellId);
    const count = counts.get(r.id);
    rows.push({
      row: {
        key: r.id,
        id: r.id,
        retellId: r.retellId,
        name: r.name,
        outlineId: r.outlineId,
        runs: count?.runs ?? 0,
        lastRunAt: count?.lastRunAt ?? null,
      },
      at: r.createdAt,
    });
  }
  for (const t of retells) {
    if (rehearsed.has(t.retellId)) continue;
    rows.push({
      row: {
        key: `retell:${t.retellId}`,
        id: null,
        retellId: t.retellId,
        name: t.name,
        outlineId: t.outlineId,
        runs: 0,
        lastRunAt: null,
      },
      // A retell's id is the millisecond it was started (reading/retell/types.ts),
      // so an unrehearsed deck sorts among the rehearsals by when its retell
      // began. A non-numeric id sorts last rather than to 1970.
      at: Number(t.retellId) || 0,
    });
  }
  return rows.sort((a, b) => b.at - a.at).map((r) => r.row);
}

/** The line under a row's name. */
export function rehearsalSummary(row: RehearsalRow): string {
  const where = row.retellId ? "From a retell" : "Brought in";
  if (row.runs === 0) return `${where} · not rehearsed yet`;
  return `${where} · ${row.runs} ${row.runs === 1 ? "rehearsal" : "rehearsals"}`;
}
