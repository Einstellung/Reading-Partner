// What a hold on Lumen would talk about, published by whichever screen has it.
//
// The corner is mounted at shell level, outside every screen (App.tsx,
// PhoneApp.tsx), and the thing a voice session needs — which day's thread, the
// briefing as that page holds it — belongs to the info screen. Six props of
// plumbing through two shells for one gesture is worse than a signal, and this
// is the same shape as ai/voice/hold-signal.ts for the same reason.
//
// One context at a time: there is one microphone. A screen registers while it
// is mounted and the undo clears it, unless something else has registered in
// the meantime — an unmount arriving after the next screen's mount must not
// take that screen's context down with it.
//
// Nothing here is the call. The corner builds the call and holds it, so a
// session survives the screen it was started from (the reader can walk away
// mid-sentence and still hang up from anywhere); what goes away with the screen
// is only the ability to start a new one.

import { useEffect } from "react";

import type { BriefingControl } from "../../../info/briefer/companion-live";
import type { Briefing } from "../../../info/boxes/types";

export interface VoiceContext {
  /** The day whose thread the session is about. */
  dateKey: string;
  /** The day's briefing as the screen holds it; see LiveVoiceCallOptions. */
  briefing: Briefing | null;
  /** What generate_briefing does, where the screen can offer one. */
  control?: BriefingControl;
}

let current: VoiceContext | null = null;
const listeners = new Set<() => void>();

/** Offer a context. Returns the undo. */
export function registerVoiceContext(context: VoiceContext): () => void {
  current = context;
  announce();
  return () => {
    if (current !== context) return;
    current = null;
    announce();
  };
}

/** What a hold would talk about right now, or null where nothing can be said. */
export function getVoiceContext(): VoiceContext | null {
  return current;
}

/** Hear about the next registration or clearing. Returns the undo. */
export function subscribeVoiceContext(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Test seam: the module is a singleton and a test is not. */
export function resetVoiceContext(): void {
  current = null;
  listeners.clear();
}

/**
 * Register for as long as this screen is on. `null` is a screen that has
 * nothing to talk about, which is most of them.
 */
export function useRegisterVoiceContext(context: VoiceContext | null): void {
  const dateKey = context?.dateKey ?? null;
  const briefing = context?.briefing ?? null;
  const control = context?.control;
  useEffect(() => {
    if (dateKey === null) return;
    return registerVoiceContext({ dateKey, briefing, control });
  }, [dateKey, briefing, control]);
}

function announce(): void {
  for (const listener of [...listeners]) listener();
}
