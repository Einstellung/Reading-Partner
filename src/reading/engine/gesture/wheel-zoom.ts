// Ctrl/Cmd + wheel zoom, ours rather than the zoom plugin's.
//
// The plugin's own wheel handler (enableWheel) reads the delta as a percentage
// — `1 - deltaY * 0.01` — so one Chromium notch of 100px doubles the zoom, and
// there is no knob for it (docs/pitfall/137). This replaces it: same anchor on
// the pointer, a step a reader can aim with.
//
// The step is exponential in the delta, `exp(-px / FALLOFF)`, which is the one
// curve that fits both devices without a device check. Zoom is multiplicative
// (1 -> 1.13 -> 1.28 is one shape repeated, 1 -> 1.13 -> 1.26 is not), and the
// two inputs differ only in how much delta they deliver per second: a mouse
// notch arrives as one event of ~100px, a trackpad pinch as dozens of events of
// a few px each. Compose the same exponential over those dozens and the product
// is exp(sum), so the pinch stays continuous while the notch is one clean step.
//
// None of the arithmetic touches the DOM; attachWheelZoom is the wiring.

import { wheelDeltaPixels } from "../../../platform/app/wheel";

// Pixels of wheel delta per e-fold of zoom. One Chromium notch (deltaY 100) is
// exp(100/800) = 1.133, a 13% step — the range mainstream PDF readers use.
// WebKitGTK's smaller notch and Firefox's three lines both land near 1.06, which
// is a small step rather than a dead one; that is the point of the curve.
export const WHEEL_ZOOM_FALLOFF = 800;

// The plugin clamps to these itself (its config defaults, which the reader does
// not override). Mirrored here so the accumulated target cannot run past the end
// and leave the next few notches doing nothing on the way back.
export const ZOOM_MIN = 0.25;
export const ZOOM_MAX = 10;

// A wheel gesture is over once nothing has arrived for this long, and the next
// event starts again from whatever the zoom is by then — which is how a zoom
// changed in between (a toolbar press, ctrl+0, a fit after a resize) is picked
// up without watching for it.
export const WHEEL_GESTURE_IDLE_MS = 250;

// The zoom this event asks for, given where the last one left off. Scrolling up
// (negative deltaY) zooms in.
export function wheelZoomFactor(deltaY: number, deltaMode: number): number {
  const px = wheelDeltaPixels(deltaY, deltaMode);
  if (!Number.isFinite(px)) return 1;
  return Math.exp(-px / WHEEL_ZOOM_FALLOFF);
}

export function clampZoom(zoom: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom));
}

export interface WheelZoomState {
  // The zoom being accumulated, or null when no gesture is in flight.
  target: number | null;
  // When the last event was folded in.
  at: number;
}

export const IDLE_WHEEL_ZOOM: WheelZoomState = { target: null, at: 0 };

export interface WheelZoomEvent {
  deltaY: number;
  deltaMode: number;
  time: number;
}

// Fold one event into the accumulator. The target is carried in full precision
// between events on purpose: the plugin rounds what it stores to three decimals,
// so a pinch read back from it after every event would quantize away the smaller
// steps and stall.
export function foldWheelZoom(
  state: WheelZoomState,
  ev: WheelZoomEvent,
  currentZoom: number,
): WheelZoomState {
  const continuing = state.target !== null && ev.time - state.at <= WHEEL_GESTURE_IDLE_MS;
  const base = continuing ? (state.target as number) : currentZoom;
  if (!Number.isFinite(base) || base <= 0) return { target: null, at: ev.time };
  return { target: clampZoom(base * wheelZoomFactor(ev.deltaY, ev.deltaMode)), at: ev.time };
}

// Whether this press-and-scroll is a zoom rather than a scroll. A bare wheel is
// never one — it scrolls the page, which is the whole reason this is a modifier
// gesture — and AltGr arrives with ctrlKey set on the layouts that have it.
export function isZoomWheel(e: { ctrlKey: boolean; metaKey: boolean; altKey: boolean }): boolean {
  return !e.altKey && (e.ctrlKey || e.metaKey);
}

// What the DOM side needs from the zoom plugin, so the wiring can be driven by a
// stub in a test.
export interface WheelZoomTarget {
  currentZoom: () => number;
  // vx/vy are offsets inside the viewport's client box, which is what the zoom
  // plugin's focus point means (it reads them against scrollLeft/scrollTop).
  requestZoom: (level: number, center: { vx: number; vy: number }) => void;
}

export interface WheelZoomHost {
  now: () => number;
  // One apply per frame, not one per event: a trackpad delivers dozens a second
  // and each applied zoom is a relayout plus a re-raster.
  schedule: (run: () => void) => number;
  cancel: (handle: number) => void;
}

const DOM_HOST: WheelZoomHost = {
  now: () => performance.now(),
  schedule: (run) => requestAnimationFrame(run),
  cancel: (handle) => cancelAnimationFrame(handle),
};

// Attach to the scroll container the EmbedPDF viewport mounted — the same
// element the plugin's own handler would have used, so the pointer offsets mean
// the same thing.
export function attachWheelZoom(
  container: HTMLElement,
  target: WheelZoomTarget,
  host: WheelZoomHost = DOM_HOST,
): () => void {
  let state = IDLE_WHEEL_ZOOM;
  let frame = 0;
  let center = { vx: 0, vy: 0 };

  const apply = () => {
    frame = 0;
    const zoom = state.target;
    if (zoom === null) return;
    target.requestZoom(zoom, center);
  };

  const onWheel = (e: WheelEvent) => {
    if (!isZoomWheel(e)) return;
    // Non-passive, and prevented whatever happens next: without this the browser
    // zooms the whole app on top of whatever the page does (pitfall 128).
    e.preventDefault();
    const rect = container.getBoundingClientRect();
    center = { vx: e.clientX - rect.left, vy: e.clientY - rect.top };
    state = foldWheelZoom(state, { deltaY: e.deltaY, deltaMode: e.deltaMode, time: host.now() }, target.currentZoom());
    if (state.target === null || frame) return;
    frame = host.schedule(apply);
  };

  container.addEventListener("wheel", onWheel, { passive: false });
  return () => {
    container.removeEventListener("wheel", onWheel);
    if (frame) host.cancel(frame);
  };
}
