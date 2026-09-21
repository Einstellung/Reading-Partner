// Where Lumen stands once the reader has moved it (docs/68).
//
// The corner is the bottom right until it is dragged. A drag ends at whichever
// side edge the body is nearer, at the height the finger let go at, and the
// pair is what this device remembers. Nothing else about the corner changes:
// the column still rises from it, the case still stands beside the body.
//
// All of it is arithmetic over the window's box and its safe-area insets. The
// two docks are where `pl-safe-4` / `pr-safe-4` put the body and the floor is
// where `pb-safe-6` does — a `max()` of the utility's own margin and the inset
// — so the numbers are here, in a file with no DOM in it, beside the rest of
// the corner's maths (corner-placement.ts, case-box.ts).

import type { SafeAreaInsets } from "../base/safe-area";

export type CornerSide = "left" | "right";

export interface CornerSpot {
  side: CornerSide;
  /**
   * How far above the resting spot the body stands, as a fraction of the
   * window's height. A fraction and not pixels: a rotation halves the height,
   * and a corner remembered in pixels would be off the top of the short side.
   */
  lift: number;
}

/** The bottom right, which is where the corner has always been. */
export const CORNER_SPOT_DEFAULT: CornerSpot = { side: "right", lift: 0 };

/** The body's box, as the corner draws it (`h-18 w-18`). */
export const CORNER_BODY_PX = 72;

/** The corner's own margin from the side edge, where there is no inset (`p*-safe-4`). */
export const CORNER_EDGE_PX = 16;

/** And from the bottom edge (`pb-safe-6`). */
export const CORNER_REST_PX = 24;

/**
 * What the top of the window is spoken for by: the status bar's inset plus the
 * top bar under it. The body may not be dragged into that band — a companion
 * over the shelf's title or the reader's controls is a companion in the way of
 * the one thing it must never cover.
 */
export const TOP_KEEP_PX = 64;

/**
 * How far a press has to travel before it is a drag. Under the hold's own
 * HOLD_MOVE_PX (hold-toggle.ts), so that a press which becomes a drag has not
 * yet been let go of by the hold: the corner cancels the hold on the same move
 * that starts the drag, and the two never both act on one press.
 */
export const DRAG_SLOP_PX = 8;

/** How long the snap to the edge takes. */
export const SNAP_MS = 180;

export interface CornerFrame {
  width: number;
  height: number;
  insets: SafeAreaInsets;
}

function clamp(value: number, low: number, high: number): number {
  if (!Number.isFinite(value)) return low;
  return value < low ? low : value > high ? high : value;
}

/** The body's left edge when it is docked at that side, in viewport pixels. */
export function dockX(side: CornerSide, frame: CornerFrame): number {
  const left = Math.max(CORNER_EDGE_PX, frame.insets.left);
  const right = Math.max(CORNER_EDGE_PX, frame.insets.right);
  // The two docks are the whole of the body's horizontal travel, so a window
  // too narrow to hold both keeps them in order rather than crossed.
  return side === "left" ? left : Math.max(left, frame.width - right - CORNER_BODY_PX);
}

/** How far above the resting spot the body may rise and still be clear of the top. */
export function maxLiftPx(frame: CornerFrame): number {
  const rest = Math.max(CORNER_REST_PX, frame.insets.bottom);
  return Math.max(0, frame.height - rest - CORNER_BODY_PX - frame.insets.top - TOP_KEEP_PX);
}

/** A remembered spot's lift in this window, clamped back into what is visible. */
export function liftPxOf(spot: CornerSpot, frame: CornerFrame): number {
  return clamp(spot.lift * frame.height, 0, maxLiftPx(frame));
}

/** The same the other way round, for a lift that has just been dragged to. */
export function liftFraction(px: number, frame: CornerFrame): number {
  if (!(frame.height > 0)) return 0;
  return clamp(px, 0, maxLiftPx(frame)) / frame.height;
}

/**
 * How far above the bottom edge the corner is actually drawn: the reader's own
 * lift, or the composer's, whichever is higher (corner-placement.ts). A corner
 * the reader has parked up the screen is already clear of the composer and has
 * nothing to rise for; one left at the bottom still stands above it.
 */
export function cornerBottomPx(liftPx: number, composerLiftPx: number): number {
  return Math.max(liftPx, composerLiftPx);
}

/** Which way the column hangs off the corner it rises from. */
export function columnAlign(side: CornerSide): "start" | "end" {
  return side === "left" ? "start" : "end";
}

/** Where the body was when the press began: its left edge, and its lift. */
export interface DragAnchor {
  x: number;
  lift: number;
}

/** How far the corner is drawn from where it was committed, in pixels. */
export interface DragOffset {
  dx: number;
  dy: number;
}

export const NO_DRAG: DragOffset = { dx: 0, dy: 0 };

/** Whether a press has travelled far enough to be a drag. */
export function passedSlop(dx: number, dy: number): boolean {
  return Math.hypot(dx, dy) >= DRAG_SLOP_PX;
}

/**
 * The offset the corner is drawn at under the finger, clamped to the travel
 * between the two docks and between the floor and the top band. The body stays
 * whole and on screen for the whole drag; there is nowhere to throw it.
 */
export function dragOffset(raw: DragOffset, from: DragAnchor, frame: CornerFrame): DragOffset {
  const x = clamp(from.x + raw.dx, dockX("left", frame), dockX("right", frame));
  const lift = clamp(from.lift - raw.dy, 0, maxLiftPx(frame));
  return { dx: x - from.x, dy: from.lift - lift };
}

/** Which edge a body whose left edge is at `x` belongs to: the nearer one. */
export function snapSide(x: number, frame: CornerFrame): CornerSide {
  return x + CORNER_BODY_PX / 2 <= frame.width / 2 ? "left" : "right";
}

/** Where the corner comes to rest when the finger lets go. */
export function dropSpot(
  offset: DragOffset,
  from: DragAnchor,
  frame: CornerFrame,
): CornerSpot {
  return {
    side: snapSide(from.x + offset.dx, frame),
    lift: liftFraction(from.lift - offset.dy, frame),
  };
}

/**
 * The offset the snap travels to. It is where the corner will be drawn once
 * the spot is committed — the composer's lift included — and not where the
 * spot alone would put it, so the body lands on its place rather than beside
 * it and then hopping.
 */
export function snapOffset(
  spot: CornerSpot,
  from: DragAnchor,
  frame: CornerFrame,
  composerLiftPx: number,
): DragOffset {
  return {
    dx: dockX(spot.side, frame) - from.x,
    dy: from.lift - cornerBottomPx(liftPxOf(spot, frame), composerLiftPx),
  };
}

/** The offset as a transform, and nothing at all where there is no offset. */
export function dragTransform(offset: DragOffset): string {
  if (offset.dx === 0 && offset.dy === 0) return "";
  return `translate3d(${offset.dx.toFixed(2)}px, ${offset.dy.toFixed(2)}px, 0)`;
}

// The stored shape. JSON in one slot rather than two, because a side without a
// lift is half a position and there is no moment when only one of them is
// known.

export function serializeCornerSpot(spot: CornerSpot): string {
  return JSON.stringify({ side: spot.side, lift: Number(spot.lift.toFixed(4)) });
}

/**
 * Anything that is not a side and a fraction is the default corner. The slot
 * is hand-editable and survives versions of the app that wrote something else
 * into it; a companion that failed to appear over a bad number would be an app
 * with no way back to its own box.
 */
export function parseCornerSpot(raw: string | null | undefined): CornerSpot {
  if (!raw) return CORNER_SPOT_DEFAULT;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return CORNER_SPOT_DEFAULT;
  }
  if (typeof value !== "object" || value === null) return CORNER_SPOT_DEFAULT;
  const { side, lift } = value as { side?: unknown; lift?: unknown };
  if (side !== "left" && side !== "right") return CORNER_SPOT_DEFAULT;
  if (typeof lift !== "number" || !Number.isFinite(lift) || lift < 0 || lift > 1) {
    return CORNER_SPOT_DEFAULT;
  }
  return { side, lift };
}
