// The one reaction the corner has to something arriving (docs/68): when the
// count goes up, the eyes drop to the case for about half a second and come
// back. Once, not a loop, and it happens beside an open book too — `still`
// stops the breath, not the noticing.
//
// The eyes borrow the check act's numbers (lumen-motion.ts): the same depth the
// scan reads the desk at, and the same snap, because a glance that eased would
// still be on its way out when it was due back.

import { GAZE_K_ACT, GAZE_ZERO, SCAN_DOWN, clampGaze, type Gaze } from "./lumen-motion";

/** How long the whole glance lasts, out and back. */
export const GLANCE_MS = 600;

/** How long the eyes stay on the case before they come back. */
export const GLANCE_HOLD_MS = 420;

/** The pull, taken from the act the motion is borrowed from. */
export const GLANCE_K = GAZE_K_ACT.check;

/**
 * Where the case is, in the eye-widths the gaze is written in: down, and as far
 * to the left as an iris goes. The case stands off the body's left edge, so the
 * direction is the corner of the socket and the clamp is what puts it there.
 */
export const GLANCE_TARGET: Gaze = clampGaze({ x: -0.75, y: SCAN_DOWN });

/** Where the eyes are asked to point, this far into a glance. */
export function glanceGaze(elapsedMs: number): Gaze {
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) return GLANCE_TARGET;
  return elapsedMs < GLANCE_HOLD_MS ? GLANCE_TARGET : GAZE_ZERO;
}

/** Whether a glance that began `elapsedMs` ago is over. */
export function glanceOver(elapsedMs: number): boolean {
  return !(Number.isFinite(elapsedMs) && elapsedMs < GLANCE_MS);
}

/**
 * The count as the corner last saw it, and a number that goes up once per
 * glance owed. The nonce and not a boolean: two items arriving one after the
 * other are two glances, and a flag would collapse them into one.
 */
export interface GlanceState {
  seen: number;
  nonce: number;
}

export const NO_GLANCE: GlanceState = { seen: 0, nonce: 0 };

/**
 * What the corner knows after reading the count again. A rise is a glance; a
 * fall — an item followed or pressed away — is only a new number to remember.
 * The same count back is the same object, so nothing re-renders for a tick that
 * found nothing.
 */
export function stepGlance(state: GlanceState, openCount: number): GlanceState {
  const count = Number.isFinite(openCount) && openCount > 0 ? Math.floor(openCount) : 0;
  if (count === state.seen) return state;
  return count > state.seen
    ? { seen: count, nonce: state.nonce + 1 }
    : { seen: count, nonce: state.nonce };
}
