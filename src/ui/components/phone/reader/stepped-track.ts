// The arithmetic behind the Display sheet's stepped tracks (SteppedTrack.tsx):
// which rung a stored value sits on, where each tick is drawn, and where a
// press on either end button or a value from the slider lands. Where a pointer
// lands on the track is Radix's (ui/slider.tsx); it hands back a number that
// may still need snapping into the ladder.

/** The rung `value` is on, or the rung of `fallback` when it is on none. */
export function stepIndexOf<T>(ladder: readonly T[], value: T, fallback: T): number {
  const i = ladder.indexOf(value);
  if (i >= 0) return i;
  return Math.max(0, ladder.indexOf(fallback));
}

/** A step index rounded and held inside a ladder of `count` rungs. */
export function clampStep(index: number, count: number): number {
  if (count <= 1 || !Number.isFinite(index)) return 0;
  return Math.min(count - 1, Math.max(0, Math.round(index)));
}

/**
 * The rung a press on one end of the track moves to: one step toward that
 * end, and the same rung once it is already there.
 */
export function stepFromEnd(index: number, count: number, end: "start" | "end"): number {
  return clampStep(index + (end === "start" ? -1 : 1), count);
}

/** The step a slider change lands on: Radix reports an array of values. */
export function stepFromSlider(values: readonly number[], count: number): number {
  return clampStep(values[0] ?? 0, count);
}

/**
 * Where tick `index` sits along the track, as a fraction of its length. The
 * first rung is at the start and the last at the end; a ladder of one rung has
 * its only tick in the middle.
 */
export function tickFraction(index: number, count: number): number {
  if (count <= 1) return 0.5;
  return clampStep(index, count) / (count - 1);
}
