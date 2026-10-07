// What a finger on the reflow view means beyond the press itself (docs/70).
// The press reducer is shared with the iPad's pages (engine/gesture/press.ts);
// what is here is the column's own. The scroll is the browser's: the view never
// moves the page itself, and the browser cancels the pointer once it takes the
// touch.
//
// The paged view (paged-view.ts) feeds the reducer too, with one difference: there
// nothing scrolls, and a drag is the page-turn router's, which follows the
// finger from 10px but only turns past a fifth of the screen or on a fling.
// A drift short of that springs back and is a tap, so the press there allows
// PAGED_TAP_SLOP_PX of travel, and the router's turn, when there is one, ends
// the press with a `yield` (docs/pitfall/489).

import { FLOW_PAD_Y, type FlowDisplay } from "./flow-display";

/**
 * How far a press may travel and still be a tap in the paged view, where no
 * travel is a scroll. Above the drift a real tap has (20px measured on the
 * simulator), well short of the 22% of the screen a drag needs to turn.
 */
export const PAGED_TAP_SLOP_PX = 30;

// -------------------------------------------------------------- the column ---

/**
 * A guess at how tall a document lays out in a column this wide, for
 * `contain-intrinsic-size` while it is off screen: its characters over an
 * average glyph width, in lines of the column's line height. The browser
 * remembers the real height once the document has been laid out, so the guess
 * only has to be the right order of magnitude — but it is the reader's type
 * that decides it, so the display settings are an argument rather than a
 * constant (flow-display.ts).
 */
export function intrinsicHeightEstimate(
  chars: number,
  columnWidth: number,
  display: FlowDisplay,
): number {
  const line = Math.max(1, columnWidth - 2 * display.padX);
  const perLine = Math.max(1, Math.floor(line / (display.fontPx * 0.5)));
  const lines = Math.ceil(chars / perLine);
  return Math.max(120, Math.round(lines * display.fontPx * display.lineHeight + 2 * FLOW_PAD_Y));
}
