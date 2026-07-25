// The paged rubber band: the offset a swipe with nowhere to go leaves on the
// scroll content, and the spring that pulls it back. Pure — the host owns the
// element, the rAF loop and the moment the band is dropped.
//
// The band offsets the content, not the scroll position: at fit-page there is
// nothing left to scroll, which is the whole point of it.
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
