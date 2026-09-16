// What the home screen says when the bureau has no open room (docs/63).
//
// A collection only runs for a lab: the gate in info/program/live.ts refuses to
// start one when every room is closed, and a hand-driven run throws NO_LABS_ERROR
// before it spends anything. Both of those are by design, and both are silent —
// the hourly source polling keeps going, so from the outside the day simply
// stops arriving. This is the sentence that says so, and where the screen has to
// show it.
//
// A room is opened by talking: the companion drafts a charter out of what the
// reader says they want followed (info/briefer/lab-tool.ts) and the reader nods
// at the card. There is no page where rooms are made, so the notice's one action
// is the conversation.

import { NO_LABS_ERROR } from "../../../info/boxes/pipeline";
import { activeLabs } from "../../../info/labs/labs";
import type { Lab } from "../../../info/labs/types";

export const NO_LAB_NOTICE =
  'No lab is open, so nothing is being collected and no briefing is being built. ' +
  'Say what you want followed — "keep an eye on embodied AI" — and the companion will propose one.';

/**
 * Whether the notice belongs on the screen: true when the labs file has been
 * read and holds no open room. Null while it has not been read — the card holds
 * its placeholder rather than claiming there is no lab and then taking it back,
 * which is what an empty list standing in for an unread file would do.
 *
 * An archived room is not an open one: a bureau whose only lab was closed
 * collects nothing, and the notice is exactly as true there.
 */
export function noLabsOpen(labs: readonly Lab[] | null): boolean | null {
  return labs === null ? null : activeLabs(labs).length === 0;
}

/**
 * A pipeline error as the reader is shown it. Only one is rewritten: "No labs
 * yet." is a sentence for the log, and on a screen it is the notice above —
 * which says what stopped and what to do about it. Every other error is the
 * reader's to read as it came.
 */
export function briefingErrorText(error: string | null | undefined): string | null {
  if (!error) return null;
  return error === NO_LABS_ERROR ? NO_LAB_NOTICE : error;
}
