// Where the conversation's composer is, for whatever has to keep off the bottom
// edge of the screen — Lumen's corner (lumen/corner-placement.ts).
//
// A context rather than a prop, because on the phone every conversation is the
// whole screen and its composer is always on that edge: the briefing's call,
// the lesson and the lesson's aside all have the same problem, and they are
// reached through three different screens. The shell hangs one slot over all of
// them and a conversation fills it by being mounted; a screen added later needs
// nothing. The desktop passes CallView the callback directly instead — there it
// is one call site, and the corner only stands down for the full-window view.

import { createContext, useContext } from "react";

/** A callback ref for the element the composer sits in. */
export type ComposerSlot = (el: HTMLElement | null) => void;

const NO_SLOT: ComposerSlot = () => {};

export const ComposerSlotContext = createContext<ComposerSlot>(NO_SLOT);

export function useComposerSlot(): ComposerSlot {
  return useContext(ComposerSlotContext);
}
