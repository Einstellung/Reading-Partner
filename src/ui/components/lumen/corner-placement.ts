// Where Lumen stands when a conversation has the whole window (docs/68).
//
// The corner sits on the bottom edge everywhere else. In the full-window chat
// the composer is on that edge, so the corner rises above it by however tall
// the composer is — measured, not guessed, because the bar grows with the text
// in it, with staged images and with the safe area under it.
//
// The one thing it stands down for is a hold-to-talk press. The landing zones
// float in a panel over the full width of the composer, exactly in the band the
// lifted corner occupies, and the right-hand zone (Edit) is under the corner
// itself: a thumb travelling to it must not find Lumen in the way.

/** The gap between the top of the composer and the bottom of the corner. */
export const CORNER_GAP_PX = 8;

/**
 * How near the bottom of the window the composer has to be for the corner to
 * count it as in the way. The empty conversation centres its composer in the
 * middle of the screen, and the corner has the bottom edge to itself then.
 */
export const BOTTOM_BAND_PX = 96;

/** What was measured of the composer, in viewport coordinates. */
export interface ComposerBox {
  top: number;
  bottom: number;
}

export interface CornerPlacementInput {
  /** The logo's own switch, per device (corner-pref.ts). */
  shown: boolean;
  /** Whether the call has the whole window. */
  chatMain: boolean;
  /** A hold-to-talk press is in progress. */
  holding: boolean;
  viewportHeight: number;
  /** Null when nothing was measured — no chat on screen, or not laid out yet. */
  composer: ComposerBox | null;
}

export interface CornerPlacement {
  shown: boolean;
  /** How far above the bottom edge the corner is drawn. */
  liftPx: number;
}

const HIDDEN: CornerPlacement = { shown: false, liftPx: 0 };

/**
 * How far the corner has to rise to clear a composer sitting on the bottom
 * edge. Zero when the composer is nowhere near it — or was never measured.
 */
export function composerLift(
  viewportHeight: number,
  composer: ComposerBox | null,
  band = BOTTOM_BAND_PX,
): number {
  if (!composer) return 0;
  if (viewportHeight - composer.bottom > band) return 0;
  return Math.max(0, Math.round(viewportHeight - composer.top + CORNER_GAP_PX));
}

/** Whether Lumen is drawn at all, and how high. */
export function cornerPlacement(input: CornerPlacementInput): CornerPlacement {
  if (!input.shown) return HIDDEN;
  if (!input.chatMain) return { shown: true, liftPx: 0 };
  if (input.holding) return HIDDEN;
  return { shown: true, liftPx: composerLift(input.viewportHeight, input.composer) };
}
