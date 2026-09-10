// A registered source's units turned into arrears, and one of them looked up by
// id (docs/58, docs/61).
//
// Named for the first kind that goes through it, `info-thread`: a day's briefing
// conversations, which until now were the only thing the reader said to this app
// that nothing ever read back. Nothing in here knows what a briefing is — the
// info domain registers a source (memory/distill/sources.ts) and this is the
// sweep's half of the same contract.
//
// Pure but for the sources' own reads: live.ts supplies the cursors, which is
// where the observation store is.

import { countNewReaderMessages } from "../observations/distill";
import type { SourceArrears, SourceUnit } from "../observations/arrears";
import { distillSources } from "./sources";

/** Where a unit's cursor stands, by the topic whose meta.json holds it. */
export type SourceCursor = (topicId: string, unitId: string) => Promise<number> | number;

export interface SourceArrearsOptions {
  // A unit whose reply is still being written is left out, exactly as a book's
  // thread is: a pass over half a sentence is a pass over the wrong transcript,
  // and the next sweep picks it up.
  isBusy?: (unitId: string) => boolean;
}

/**
 * What every registered source owes, grouped by the topic each unit names.
 *
 * A source that throws is skipped with a warning rather than taking the sweep
 * down with it: the books' arrears are the reader's oldest debt and must not
 * depend on a domain's readDir.
 */
export async function collectSourceArrears(
  cursorOf: SourceCursor,
  opts: SourceArrearsOptions = {},
): Promise<Map<string, SourceArrears[]>> {
  const byTopic = new Map<string, SourceArrears[]>();
  for (const source of distillSources()) {
    let units: SourceUnit[];
    try {
      units = await source.listUnits();
    } catch (e) {
      console.warn(`distill source ${source.kind} could not be listed`, e);
      continue;
    }
    for (const unit of units) {
      if (opts.isBusy?.(unit.id)) continue;
      // Grouped by topic, so a unit with none has nowhere to go.
      if (unit.topicId === null) continue;
      const topicId = unit.topicId;
      const newMessages = countNewReaderMessages(
        unit.messages,
        await cursorOf(topicId, unit.id),
      );
      const owed: SourceArrears = { source: source.kind, unit, newMessages };
      byTopic.set(topicId, [...(byTopic.get(topicId) ?? []), owed]);
    }
  }
  return byTopic;
}

/**
 * The unit one thread id names, across every registered source. Null when no
 * source lists it — a conversation a source leaves out (the onboarding thread,
 * whose id repeats across days: docs/pitfall/209) is not distillable, and a
 * trigger that names one asks for nothing rather than for a guess.
 */
export async function findSourceUnit(
  unitId: string,
): Promise<{ source: string; unit: SourceUnit } | null> {
  for (const source of distillSources()) {
    let units: SourceUnit[];
    try {
      units = await source.listUnits();
    } catch (e) {
      console.warn(`distill source ${source.kind} could not be listed`, e);
      continue;
    }
    const unit = units.find((u) => u.id === unitId);
    if (unit) return { source: source.kind, unit };
  }
  return null;
}
