// Every registered source's units turned into arrears, and one of them looked up
// by id (docs/58, docs/61).
//
// The sweep's half of the source contract. Nothing in here knows what a book, a
// briefing or a retell is: a domain registers a source (sources.ts), this asks
// each one for its units, applies the one cursor rule and the one threshold to
// all of them, and hands the sweep a single list to choose from.
//
// Pure but for the sources' own reads: live.ts supplies the cursors, which is
// where the observation store is.

import {
  unitArrears,
  type SourceArrears,
  type SourceUnit,
} from "../observations/arrears";
import type { MessageCursor } from "../observations/distill";
import { distillSources } from "./sources";

/**
 * Where one topic's cursors stand. One reader per topic rather than one lookup
 * per unit, because a unit merged from several threads carries a cursor per
 * part, and because a topic's meta.json is one file read.
 */
export interface CursorReader {
  /** Which of that thread's messages a pass has already folded in. */
  messages(threadId: string): number | MessageCursor;
  /** The newest mark of that book already folded in, or null for none. */
  marks(bookId: string): number | null;
}

export type SourceCursors = (topicId: string) => Promise<CursorReader> | CursorReader;

export interface SourceArrearsOptions {
  // A unit whose reply is still being written is left out: a pass over half a
  // sentence is a pass over the wrong transcript, and the next sweep picks it
  // up. Asked of every thread the unit is merged from, so an aside still being
  // written holds up the lesson it belongs to.
  isBusy?: (threadId: string) => boolean;
}

function busyUnit(unit: SourceUnit, isBusy?: (threadId: string) => boolean): boolean {
  if (!isBusy) return false;
  if (unit.cursor === "distilledMarks") return false;
  const parts = unit.parts ?? [{ threadId: unit.id, messages: unit.messages }];
  return parts.some((p) => isBusy(p.threadId));
}

/**
 * What every registered source owes, grouped by the topic each unit names.
 *
 * A source that throws is skipped with a warning rather than taking the sweep
 * down with it: one domain's readDir must not be able to stop every other
 * domain's material from ever being read.
 */
export async function collectSourceArrears(
  cursorsOf: SourceCursors,
  opts: SourceArrearsOptions = {},
): Promise<Map<string, SourceArrears[]>> {
  const byTopic = new Map<string, SourceArrears[]>();
  const readers = new Map<string, CursorReader>();
  const readerOf = async (topicId: string): Promise<CursorReader> => {
    let reader = readers.get(topicId);
    if (!reader) {
      reader = await cursorsOf(topicId);
      readers.set(topicId, reader);
    }
    return reader;
  };
  for (const source of distillSources()) {
    let units: SourceUnit[];
    try {
      units = await source.listUnits();
    } catch (e) {
      console.warn(`distill source ${source.kind} could not be listed`, e);
      continue;
    }
    for (const unit of units) {
      // Nothing has said what this material is about, so nothing distils it: an
      // observation is filed under a topic and there is none. It comes back the
      // moment the reader confirms one (memory/filing).
      const topicId = unit.topicId;
      if (topicId === null) continue;
      if (busyUnit(unit, opts.isBusy)) continue;
      const cursors = await readerOf(topicId);
      const owed = unitArrears(
        source.kind,
        unit,
        unit.cursor === "distilledMarks"
          ? cursors.marks(unit.id)
          : (threadId: string) => cursors.messages(threadId),
      );
      byTopic.set(topicId, [...(byTopic.get(topicId) ?? []), owed]);
    }
  }
  return byTopic;
}

/**
 * The unit one id names, across every registered source. Null when no source
 * lists it — a conversation a source leaves out (the onboarding thread, whose id
 * repeats across days: docs/pitfall/209) is not distillable, and a trigger that
 * names one asks for nothing rather than for a guess. The unit may still be one
 * with no topic; whether that is distillable is the caller's rule
 * (collectSourceArrears skips it).
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
