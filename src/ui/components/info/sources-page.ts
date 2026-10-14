// What the source list says about each source besides its health: which research
// rooms read it (docs/63 「有哪些源、各被谁用、健康如何」). Pure so it can be
// tested; SourcesPage.tsx only draws the strings.

import { labsForSource } from "../../../info/labs/labs";
import type { Lab } from "../../../info/labs/types";
import type { SourceHealth, TopicSearchLineHealth } from "../../../info/sources/engine";

/**
 * The names of the rooms that read this source, in the order the rooms are
 * stored.
 *
 * "Uses" is what the screening step actually does, not what the charter happens
 * to list: a source some open room has claimed is read by its claimants alone,
 * and a source nobody has claimed is read by every open room (labs.ts
 * labsForSource, which this defers to so the page cannot drift from the
 * pipeline). So an unclaimed source shows every open room, which is the truth —
 * showing nothing there would say it is read by nobody.
 *
 * Empty when there is no open room at all: then nothing reads the source, and
 * the row draws no chips.
 */
export function roomsUsingSource(labs: readonly Lab[], sourceId: string): string[] {
  return labsForSource(labs, sourceId).map((l) => l.name);
}

/**
 * The topic searches' lines in the health map (docs/info/88 源健康), grouped by
 * search name, then query, X before arXiv.
 */
export function topicSearchHealthRows(
  health: Readonly<Record<string, SourceHealth>>,
): { key: string; health: SourceHealth; line: TopicSearchLineHealth }[] {
  return Object.entries(health)
    .filter((e): e is [string, SourceHealth & { topicSearch: TopicSearchLineHealth }] => !!e[1].topicSearch)
    .map(([key, h]) => ({ key, health: h, line: h.topicSearch }))
    .sort(
      (a, b) =>
        a.line.name.localeCompare(b.line.name) ||
        a.line.query.localeCompare(b.line.query) ||
        (a.line.source === b.line.source ? 0 : a.line.source === "x" ? -1 : 1),
    );
}
