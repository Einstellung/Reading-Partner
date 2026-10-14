// Lumen's glance at the desk while the call's background work runs
// (docs/companion/136 prototype, the `scanning` state): a run is in flight and
// nobody is being spoken to, so the eyes go down and scan. Display logic with no
// React in it, beside attention.ts.

import type { SessionPhase } from "../../../soul/voice/voice-session";
import type { Attention } from "./lumen-motion";

/**
 * Whether the body should be scanning the desk. Only while the call waits on
 * the reader (`listening`): while the front speaks the face speaks, and while it
 * is composing its own reply the look upward is already the right act.
 */
export function backgroundScan(running: number, phase: SessionPhase): boolean {
  return running > 0 && phase === "listening";
}

/** The tool-driven attention, with the background scan laid over a resting gaze. */
export function attentionWithScan(base: Attention, scanning: boolean): Attention {
  return scanning && base === "reader" ? "work" : base;
}
