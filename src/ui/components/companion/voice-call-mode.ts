// Where a call from the corner is held (docs/68, 2026-10-20). A screen that has
// published something to talk about holds it there — today only the briefing
// page (voice-context.ts) — and every other screen holds it at the door. Read
// once, when the call starts: a call outlives the screen it was started on.

import type { Briefing } from "../../../info/boxes/types";
import type { VoiceContext } from "./voice-context";

export type VoiceCallMode =
  | { kind: "briefing"; dateKey: string; briefing: Briefing | null }
  | { kind: "door"; date: string; inReader: boolean };

/** The mode for a call starting now, from the published context and the day at the door. */
export function voiceCallMode(
  context: VoiceContext | null,
  door: { date: string; inReader: boolean },
): VoiceCallMode {
  if (context) return { kind: "briefing", dateKey: context.dateKey, briefing: context.briefing };
  return { kind: "door", date: door.date, inReader: door.inReader };
}
