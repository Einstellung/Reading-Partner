// The arithmetic every pointer machine in the app shares, kept in one place so
// a gesture that feels wrong is retuned once instead of in four files.

// Release velocity is an exponential average of the per-move samples, not the
// last one: a single jittery sample must not decide where a fling lands. These
// are the two halves of one blend — how much of the running average survives a
// sample, and how much the newest sample brings. Higher sample weight = more
// responsive to a late flick, and more sensitive to hand tremor.
const HISTORY_WEIGHT = 0.3;
const SAMPLE_WEIGHT = 0.7;

// One pointer sample folded into a running velocity, px/ms along one axis.
// `position` and `t` are the new sample, `lastPosition` and `lastT` the one
// before it; the gap is floored at 1ms so two samples in the same millisecond
// cannot divide by zero.
//
// The weights are per sample, not per millisecond, so a machine that wants the
// blend to account for the real gap between samples uses vertical-gesture.ts's
// smoothVelocity instead — that one compounds over dt and is configurable,
// which is a different feel, not a different spelling of this one.
export function velocityStep(
  prev: number,
  position: number,
  t: number,
  lastPosition: number,
  lastT: number,
): number {
  const dt = Math.max(t - lastT, 1);
  const inst = (position - lastPosition) / dt;
  return prev * HISTORY_WEIGHT + inst * SAMPLE_WEIGHT;
}
