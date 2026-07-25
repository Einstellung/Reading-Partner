// The rubber band: the offset a gesture with nowhere to go leaves on the scroll
// content, the damping that keeps it bounded, and the spring that pulls it back.
// Pure — the host owns the element, the rAF loop and the moment the band is
// dropped. Both reading modes go through here, so "nothing to scroll this way"
// feels the same whether the page was flipped or scrolled.
//
// The band offsets the content, not the scroll position: at fit-page there is
// nothing left to scroll, which is the whole point of it, and in vertical mode
// the scroll position is already pinned at 0 / max when the band appears.
//
// It writes the same `transform` the engine's pinch preview writes
// (docs/pitfall/41), so the rules live here with the physics: the spring-back
// runs on rAF and never leaves a CSS transition behind (a transition would
// interpolate the engine's own per-frame preview and make a pinch feel laggy),
// and at rest the property is cleared to "" rather than set to an identity
// transform, so the element is handed back untouched.

// Fraction of the remaining offset kept per 16ms frame, and the px below which
// the band snaps to rest.
export const BAND_SPRING_DECAY = 0.68;
export const BAND_SPRING_MIN_PX = 0.5;

export interface BandOffset {
  x: number;
  y: number;
}

export const BAND_REST: BandOffset = { x: 0, y: 0 };

export function bandAtRest(o: BandOffset): boolean {
  return o.x === 0 && o.y === 0;
}

// What to assign to element.style.transform. Empty string at rest: clearing the
// property is not the same as writing a no-op transform (a transform of any
// kind creates a containing block the pinch preview then composes against).
export function bandTransform(o: BandOffset): string {
  return bandAtRest(o) ? "" : `translate3d(${o.x}px, ${o.y}px, 0)`;
}

// One frame of spring-back after dt ms. Snaps to exact rest once both axes are
// under the threshold, so the animation terminates instead of chasing zero.
export function stepBandSpring(
  o: BandOffset,
  dt: number,
  decayPerFrame: number = BAND_SPRING_DECAY,
  minPx: number = BAND_SPRING_MIN_PX,
): BandOffset {
  const keep = Math.pow(decayPerFrame, Math.max(dt, 1) / 16);
  const x = o.x * keep;
  const y = o.y * keep;
  if (Math.abs(x) < minPx && Math.abs(y) < minPx) return { x: 0, y: 0 };
  return { x, y };
}

// Damped follow for a pull with nowhere to go: grows with the finger but never
// past `limit`, so the content visibly gives a little and springs back. Sign is
// the pull's; magnitude is limit/2 at a pull of one limit, and asymptotic after.
//
// Used two ways. Paged feeds it the finger's raw displacement. Vertical feeds it
// the overshoot past the scroll range, which the same curve then turns into the
// px the content is allowed to leave the edge by.
export function rubberBand(delta: number, limit: number): number {
  if (limit <= 0) return 0;
  const d = Math.abs(delta);
  const damped = limit * (1 - 1 / (d / limit + 1));
  return delta < 0 ? -damped : damped;
}
