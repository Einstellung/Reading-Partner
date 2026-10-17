// The phone's door sheet pulled down to close (docs/68, 2026-10-15). It rises
// from the bottom when it opens, and a finger on its top bar drags it back down:
// far enough, or flicked, and it goes; otherwise it springs back. No half
// height to stop at.
//
// Arithmetic only; DoorChat.tsx binds the pointer on the header and writes the
// offset as a transform.

/** How far down the sheet has to be pulled to close on release. */
export const SHEET_CLOSE_PX = 120;

/** A flick: down at least this fast (px per ms) at the release closes it too… */
export const SHEET_FLICK_PX_PER_MS = 0.5;
/** …once it has moved this far, so a tap's jitter is never a flick. */
export const SHEET_FLICK_MIN_PX = 24;

/** How far the sheet is drawn down for a finger `dy` below where it went down. */
export function sheetOffset(dy: number): number {
  return dy > 0 ? dy : 0;
}

/** Whether a release `dy` below the start, moving at `velocity` px/ms, closes the sheet. */
export function sheetCloses(dy: number, velocity: number): boolean {
  if (dy >= SHEET_CLOSE_PX) return true;
  return dy >= SHEET_FLICK_MIN_PX && velocity >= SHEET_FLICK_PX_PER_MS;
}
