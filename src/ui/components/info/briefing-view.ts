// What the briefing page has to decide before it can render (docs/63), minus
// React: whether the day was empty, which lab picked an item. All of it reads
// off the briefing itself — the lab name on an item's line is looked up by id
// rather than carried in the item, so a renamed lab renames everywhere at once.
//
// There is one shape here and not two: a briefing written by the triage build
// is normalized on the way in (info/boxes/briefing.ts), so its overview arrives
// as the day's one nameless cover.

import type { Briefing, LabCover } from "../../../info/boxes/types";

// The one line for a day where every lab ran and none of them changed.
export const NOTHING_CHANGED = "Nothing changed today.";

export function briefingCovers(briefing: Briefing): LabCover[] {
  return briefing.labs;
}

/** A day the labs looked at and had nothing to say about. */
export function isEmptyDay(briefing: Briefing): boolean {
  return briefing.labs.length === 0;
}

// Which labs ran and stayed quiet. Faint, and only on an empty day: on a day
// that had covers the covers are the answer to "what did you look at".
export function quietLine(briefing: Briefing): string | null {
  return briefing.quiet.length > 0 ? `Checked: ${briefing.quiet.join(" · ")}` : null;
}

// The lab tag that goes next to the source on an item's line. Empty string when
// the item carries no lab or names one this briefing does not cover — a tag
// naming nothing is worse than no tag.
export function labTag(briefing: Briefing, labId?: string): string {
  if (!labId) return "";
  return briefing.labs.find((l) => l.labId === labId)?.name ?? "";
}
