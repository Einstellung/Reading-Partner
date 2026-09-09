// Two-finger pinch zoom, driven off raw touch events.
//
// It is a separate listener from the pointer router next door on purpose: the
// router swallows every multi-touch pointer and pans the content by the
// centroid, so the scale has to come from somewhere the router is not. On the
// PDF side that somewhere is EmbedPDF's own ZoomGestureWrapper; this is the
// same gesture written once for both, so a book and a paper pinch alike.
//
// The scale is relative to the span the fingers landed with: two fingers that
// end up twice as far apart make the page twice as big, whatever they did in
// between. Absolute rather than incremental, so rounding on the way through the
// host cannot accumulate.

// A pinch only starts once the span has changed by this much, so a two-finger
// pan does not nudge the zoom on its way.
export const PINCH_SLOP_PX = 12;

export interface PinchPoint {
  x: number;
  y: number;
}

export interface PinchState {
  /** The span the fingers landed with, or null when no pinch is live. */
  baseSpan: number | null;
  /** The scale in force when they landed. */
  baseScale: number;
  /** Whether the span has passed the slop and the zoom is being written. */
  active: boolean;
}

export const IDLE_PINCH: PinchState = { baseSpan: null, baseScale: 1, active: false };

export function pinchSpan(a: PinchPoint, b: PinchPoint): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

export function pinchCentre(a: PinchPoint, b: PinchPoint): PinchPoint {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/** Two fingers land: remember the span and the scale they are measured from. */
export function beginPinch(span: number, scale: number): PinchState {
  return { baseSpan: span > 0 ? span : null, baseScale: scale, active: false };
}

export interface PinchStep {
  state: PinchState;
  /** The scale to write, or null while the pinch is still inside the slop. */
  scale: number | null;
}

export function stepPinch(state: PinchState, span: number): PinchStep {
  const base = state.baseSpan;
  if (base === null || base <= 0 || span <= 0) return { state, scale: null };
  const active = state.active || Math.abs(span - base) >= PINCH_SLOP_PX;
  if (!active) return { state, scale: null };
  return { state: { ...state, active }, scale: state.baseScale * (span / base) };
}

// --------------------------------------------------------------------- wiring

export interface PinchTarget {
  /** The scale in force, so a pinch that starts after a button press measures from it. */
  currentScale(): number;
  /**
   * Zoom to `scale`, keeping the content under `centre` (offsets inside the
   * element's client box) where it is.
   */
  requestScale(scale: number, centre: { vx: number; vy: number }): void;
}

/**
 * Attach to the scroll container. Only two-finger touches are read; anything
 * else is left for the pointer router, which is watching the same element.
 */
export function attachPinchZoom(el: HTMLElement, target: PinchTarget): () => void {
  let state = IDLE_PINCH;

  const twoTouches = (e: TouchEvent): [PinchPoint, PinchPoint] | null => {
    if (e.touches.length !== 2) return null;
    const a = e.touches[0];
    const b = e.touches[1];
    return [
      { x: a.clientX, y: a.clientY },
      { x: b.clientX, y: b.clientY },
    ];
  };

  const onStart = (e: TouchEvent) => {
    const pair = twoTouches(e);
    if (!pair) {
      state = IDLE_PINCH;
      return;
    }
    state = beginPinch(pinchSpan(pair[0], pair[1]), target.currentScale());
  };

  const onMove = (e: TouchEvent) => {
    const pair = twoTouches(e);
    if (!pair || state.baseSpan === null) return;
    const r = stepPinch(state, pinchSpan(pair[0], pair[1]));
    state = r.state;
    if (r.scale === null) return;
    // The browser's own page zoom would ride on top of this one otherwise
    // (docs/pitfall/128), and the touch is the router's and ours, not the
    // document's.
    if (e.cancelable) e.preventDefault();
    const c = pinchCentre(pair[0], pair[1]);
    const box = el.getBoundingClientRect();
    target.requestScale(r.scale, { vx: c.x - box.left, vy: c.y - box.top });
  };

  const onEnd = (e: TouchEvent) => {
    if (e.touches.length >= 2) {
      // A third finger left: re-measure rather than carry the old span.
      onStart(e);
      return;
    }
    state = IDLE_PINCH;
  };

  el.addEventListener("touchstart", onStart, { passive: true });
  el.addEventListener("touchmove", onMove, { passive: false });
  el.addEventListener("touchend", onEnd, { passive: true });
  el.addEventListener("touchcancel", onEnd, { passive: true });
  return () => {
    el.removeEventListener("touchstart", onStart);
    el.removeEventListener("touchmove", onMove);
    el.removeEventListener("touchend", onEnd);
    el.removeEventListener("touchcancel", onEnd);
  };
}
