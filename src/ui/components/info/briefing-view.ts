// What the briefing page has to decide before it can render (docs/63), minus
// React: which of the two shapes the briefing is, whether the day was empty,
// which lab picked an item. All of it reads off the briefing itself — the lab
// name on an item's line is looked up by id rather than carried in the item,
// so a renamed lab renames everywhere at once.

import type { Briefing, LabCover } from "../../../info/collect/types";

// The one line for a day where every lab ran and none of them changed.
export const NOTHING_CHANGED = "Nothing changed today.";

// A briefing built by labs carries `labs`, even when it is empty; one built
// before labs existed has an overview and no `labs` at all. The two are
// different days, so the check is presence, not length.
export function isLabBriefing(briefing: Briefing): boolean {
  return briefing.labs !== undefined;
}

export function briefingCovers(briefing: Briefing): LabCover[] {
  return briefing.labs ?? [];
}

// A day with labs and nothing to say. Not the same as a legacy briefing whose
// overview happens to be short.
export function isEmptyDay(briefing: Briefing): boolean {
  return briefing.labs !== undefined && briefing.labs.length === 0;
}

// Which labs ran and stayed quiet. Faint, and only on an empty day: on a day
// that had covers the covers are the answer to "what did you look at".
export function quietLine(briefing: Briefing): string | null {
  const names = briefing.quiet ?? [];
  return names.length > 0 ? `Checked: ${names.join(" · ")}` : null;
}

// The lab tag that goes next to the source on an item's line. Empty string when
// the item carries no lab (legacy briefing) or names one this briefing does not
// cover — a tag naming nothing is worse than no tag.
export function labTag(briefing: Briefing, labId?: string): string {
  if (!labId) return "";
  return briefing.labs?.find((l) => l.labId === labId)?.name ?? "";
}
