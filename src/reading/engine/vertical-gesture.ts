// Touch gesture state machine for the vertical (continuous scroll) reading
// mode: follow-finger scrolling, the rubber band at the ends of the document,
// and the inertia fling that follows a release. Pure and DOM-free, the same
// shape as paged-gesture.ts — it consumes normalized pointer samples plus the
// live scroll geometry and emits commands the host executes (pointer capture,
// scrollTop/scrollLeft writes, the content transform the band rides on, engine
// pause/resume, the rAF loop that drives everything that outlives the finger).
//
// Why this exists at all: every page div carries touch-action:none in every
// mode (docs/pitfall/37), so native touch scrolling over a page is impossible
// and the scroll has to be driven in JS. That makes the follow, the bounce and
// the inertia our physics, not the browser's, and this is where they live.
//
// Which pointers reach this machine is decided elsewhere: touch-routing.ts says
// whether a pointer scrolls or draws, and the host swallows everything that is
// multi-touch or locked out by a working stylus. A pointer planned as "draw" is
// left to the annotation layer and never enters the machine.
//
// Sign convention: scroll velocity is the finger's, negated — a finger moving
// up (negative dy) scrolls the content down (scrollTop grows).
//
// The virtual position: follow and coast both work on `scroll + over`, where
// `over` is how far past the scrollable range the gesture has pushed. Splitting
// that sum back into a clamped scroll position and a leftover overshoot each
// frame is what makes the band continuous — pulling past the end and dragging
// back into the document is one uninterrupted motion, and a finger landing on a
// bouncing document picks the band up where it was.

import { shouldCommitScroll, type PointerPlan } from "./touch-routing";
import { bandAtRest, rubberBand, stepBandSpring, type BandOffset } from "./rubber-band";

// --- feel constants ---------------------------------------------------------
// All of it lives here so a device session can be answered by editing numbers.

// Movement (CSS px) in any direction before a scroll-classified pointer commits.
// Higher = a tap is harder to turn into an accidental scroll; lower = the page
// starts moving sooner.
export const VERTICAL_SCROLL_SLOP = 6;

// Inertia decay per 16ms frame for the fling, and the scroll speed (px/ms)
// below which an axis stops coasting. Lower decay = the throw dies sooner;
// higher min speed = it stops more abruptly instead of creeping to a halt.
export const VERTICAL_FLING_DECAY = 0.95;
export const VERTICAL_FLING_MIN_SPEED = 0.02;

// Release velocity is an exponential average of the per-move samples, not the
// last one: a single jittery sample must not decide how far the throw goes.
// This is the weight the newest sample gets in a 16ms frame (paged mode uses
// the same 0.7); a longer gap between samples weighs it more, so a finger that
// slows to a stop before lifting really does release at a stop. Higher = more
// responsive to a late flick, and more sensitive to hand tremor.
export const VERTICAL_VELOCITY_SMOOTHING = 0.7;

// The px the content is allowed to leave the end of the document by, asymptot-
// ically: pulling forever gets you this far and no further. Bigger = a softer,
// looser end-of-document; smaller = closer to a hard stop.
export const VERTICAL_BAND_LIMIT = 120;

// The raw overshoot is what the spring works on, and it is not what is drawn —
// the curve above has all but saturated well before this. Capping it keeps the
// spring-back short and keeps a very deep pull from leaving a stretch of
// dragging back that moves nothing. Higher = a longer, looser return.
export const VERTICAL_BAND_OVERSHOOT_CAP = 360;

// Spring-back after the finger lifts (or after the inertia is spent), quoted as
// the fraction of the remaining overshoot kept per 16ms frame, plus the px it
// snaps to rest under. Lower decay = a snappier return.
export const VERTICAL_BAND_DECAY = 0.72;
export const VERTICAL_BAND_MIN_PX = 0.3;

// Speed kept per 16ms frame while an axis is banded, i.e. how fast inertia dies
// once the coast hits the end of the document. Much lower than the free-coast
// decay: the edge absorbs the throw rather than grinding against it. Lower =
// less bounce off a fast fling.
export const VERTICAL_BAND_ABSORB = 0.55;

// A finger landing on content that is still moving at least this fast (px/ms)
// grabs it and follows immediately, with no slop — the system behaviour when
// paging through a document in a hurry. Slower than this and the coast is
// visually over, so the touch stays an ordinary tap that can still reach the
// engine. A document mid-bounce is always grabbable, however slow.
export const VERTICAL_TAKEOVER_MIN_SPEED = 0.05;

export interface VerticalGestureConfig {
  // Live scroll geometry, read fresh off the container by the host each event.
  // The follow measures from the virtual position latched at pointerdown, so it
  // only needs the bounds to split scroll from overshoot; the fling reads the
  // real position every frame, so anything else that scrolls mid-fling is
  // picked up.
  scrollTop: number;
  scrollLeft: number;
  maxScrollTop: number;
  maxScrollLeft: number;
  slop?: number;
  flingDecay?: number; // fraction of speed kept per 16ms frame
  flingMinSpeed?: number; // px/ms below which an axis stops coasting
  velocitySmoothing?: number; // weight of the newest velocity sample
  bandLimit?: number; // px the band asymptotically approaches
  bandOvershootCap?: number; // px of raw overshoot the spring may have to undo
  bandDecay?: number; // fraction of the overshoot kept per 16ms frame
  bandMinPx?: number; // overshoot px below which the band snaps to rest
  bandAbsorb?: number; // fraction of speed kept per frame while banded
  takeoverMinSpeed?: number; // px/ms of coast a landing finger grabs at once
}

type Cfg = Required<VerticalGestureConfig>;

function resolve(config: VerticalGestureConfig): Cfg {
  return {
    slop: VERTICAL_SCROLL_SLOP,
    flingDecay: VERTICAL_FLING_DECAY,
    flingMinSpeed: VERTICAL_FLING_MIN_SPEED,
    velocitySmoothing: VERTICAL_VELOCITY_SMOOTHING,
    bandLimit: VERTICAL_BAND_LIMIT,
    bandOvershootCap: VERTICAL_BAND_OVERSHOOT_CAP,
    bandDecay: VERTICAL_BAND_DECAY,
    bandMinPx: VERTICAL_BAND_MIN_PX,
    bandAbsorb: VERTICAL_BAND_ABSORB,
    takeoverMinSpeed: VERTICAL_TAKEOVER_MIN_SPEED,
    ...config,
  };
}

export type VerticalInput =
  // The plan comes from planPointer at the moment the pointer lands: a "draw"
  // plan is ignored outright, and an annotation tool's plan pauses the engine
  // here and now, before the stroke's lead-in can leave ink (docs/pitfall/37).
  // `takeover` is the host saying this finger is inheriting a gesture already in
  // progress (the survivor of a pinch): it follows at once, no slop.
  | {
      type: "pointerdown";
      id: number;
      x: number;
      y: number;
      t: number;
      plan: PointerPlan;
      takeover?: boolean;
    }
  | { type: "pointermove"; id: number; x: number; y: number; t: number }
  // The release position, when the host has it: the last few px between the
  // final pointermove and the lift are part of the throw.
  | { type: "pointerup"; id: number; x?: number; y?: number; t?: number }
  | { type: "pointercancel"; id: number }
  // One animation frame of whatever outlives the finger — inertia, the band's
  // spring-back, or both. dt is the ms since the previous frame.
  | { type: "flingFrame"; dt: number }
  // Stop the inertia and leave the rest alone (a stylus landing on an otherwise
  // empty glass outranks a coasting fling).
  | { type: "cancelFling" }
  // Drop the whole gesture: a layout switch, a second finger, teardown.
  | { type: "reset" };

export type VerticalCommand =
  // The engine's pointer pipeline must not see this gesture.
  | { type: "pause" }
  | { type: "resume" }
  // Hand the engine the pointerup it is owed for this pointer. From the capture
  // below onwards every event for it is retargeted to the viewport, so the
  // engine's own up never arrives and its text anchor stays armed
  // (docs/pitfall/38). Always emitted before `pause`: a paused engine drops the
  // event and the anchor survives.
  | { type: "releaseEnginePointer"; id: number }
  | { type: "capture"; id: number }
  // id is null when nothing was captured — the host no-ops.
  | { type: "releaseCapture"; id: number | null }
  // Drop a text selection this gesture caused on its way in (the host decides
  // whether the selection predates the gesture and has to be kept).
  | { type: "dropSelection" }
  | { type: "scrollTo"; top: number; left: number }
  // The band offset to put on the scroll content, already damped and ready for
  // bandTransform. (0, 0) means "back to rest, clear the property" — the host
  // must apply it with a plain style write and no CSS transition, because the
  // engine's pinch preview writes the same property (docs/pitfall/41).
  | { type: "band"; x: number; y: number }
  | { type: "preventDefault" }
  // Start / stop the host's rAF loop, which feeds flingFrame back in.
  | { type: "startFling" }
  | { type: "stopFling" };

export type VerticalPhase = "idle" | "pending" | "scroll";

// Inertia in flight: scroll-space velocity, px/ms.
export interface FlingMotion {
  vx: number;
  vy: number;
}

export interface VerticalState {
  phase: VerticalPhase;
  id: number | null; // the pointer this machine follows
  startX: number;
  startY: number;
  // The virtual scroll position the follow measures from: the scroll position
  // at pointerdown plus any overshoot the gesture inherited.
  startScrollLeft: number;
  startScrollTop: number;
  lastX: number;
  lastY: number;
  lastT: number;
  velX: number; // smoothed finger velocity px/ms (positive = right / down)
  velY: number;
  capturedId: number | null;
  // Whether the engine's pointer pipeline was live when this pointer landed, so
  // it heard the pointerdown and is owed the matching up once the router takes
  // the gesture over (docs/pitfall/38). False when the engine was already paused
  // at the down (an annotation tool) or when the gesture was taken over on the
  // down itself (landing on a coast, inheriting a pinch): it never heard it.
  engineHeardDown: boolean;
  fling: FlingMotion | null;
  // How far past the scrollable range the gesture currently is, in scroll-space
  // px (positive = past the bottom / right edge). The band the host paints is
  // this run through rubberBand.
  over: BandOffset;
}

export function initVerticalState(): VerticalState {
  return {
    phase: "idle",
    id: null,
    startX: 0,
    startY: 0,
    startScrollLeft: 0,
    startScrollTop: 0,
    lastX: 0,
    lastY: 0,
    lastT: 0,
    velX: 0,
    velY: 0,
    capturedId: null,
    engineHeardDown: false,
    fling: null,
    over: { x: 0, y: 0 },
  };
}

// --- pure helpers (exported for direct unit tests) --------------------------

export function clampScroll(value: number, max: number): number {
  return Math.min(Math.max(value, 0), Math.max(max, 0));
}

// The fling a release hands over, or null when the finger was too slow for the
// content to be worth coasting. Each scroll axis runs opposite its finger axis.
export function flingFrom(velX: number, velY: number, minSpeed: number): FlingMotion | null {
  const vx = -velX;
  const vy = -velY;
  if (Math.abs(vx) < minSpeed && Math.abs(vy) < minSpeed) return null;
  return { vx, vy };
}

// Speed kept after dt ms, expressed per 16ms frame so the feel does not change
// with the frame rate.
export function flingDecayFactor(decayPerFrame: number, dt: number): number {
  return Math.pow(decayPerFrame, dt / 16);
}

// One velocity sample folded into the running average. `weightPerFrame` is how
// much of a sample taken 16ms after the last one is kept; the history's share
// is what is left, compounded over the real gap. A sample that arrives 10
// frames late therefore all but replaces the history, which is what makes a
// finger that pauses before lifting release at a standstill rather than at the
// speed it had ten frames ago.
export function smoothVelocity(
  prev: number,
  sample: number,
  weightPerFrame: number,
  dt: number,
): number {
  const keep = Math.pow(1 - weightPerFrame, Math.max(dt, 1) / 16);
  return prev * keep + sample * (1 - keep);
}

// Split a virtual position into the scroll position the container can actually
// hold and the overshoot left over. An axis with no scroll range at all never
// bands: a document that fits the screen should sit still, not wobble.
export function splitOvershoot(
  virtual: number,
  max: number,
  cap: number = VERTICAL_BAND_OVERSHOOT_CAP,
): { scroll: number; over: number } {
  const scroll = clampScroll(virtual, max);
  if (max <= 0) return { scroll, over: 0 };
  return { scroll, over: Math.min(Math.max(virtual - scroll, -cap), cap) };
}

// The content offset an overshoot is worth: damped, so the end of the document
// gives a little and then stops giving. Sign is flipped because pushing the
// scroll position past the bottom moves the content up.
export function bandOffsetFor(over: BandOffset, limit: number): BandOffset {
  return { x: -rubberBand(over.x, limit), y: -rubberBand(over.y, limit) };
}

// Whether the host still owes this state animation frames: inertia in flight,
// or a band that has not sprung back yet.
export function verticalNeedsFrames(s: VerticalState): boolean {
  return s.fling !== null || !bandAtRest(s.over);
}

// Whether a finger landing on this state inherits the motion instead of
// starting from a standstill: content still coasting fast enough to see, or a
// band that has not finished springing back.
export function shouldTakeOver(s: VerticalState, minSpeed: number): boolean {
  if (!bandAtRest(s.over)) return true;
  if (!s.fling) return false;
  return Math.abs(s.fling.vx) >= minSpeed || Math.abs(s.fling.vy) >= minSpeed;
}

// One axis of one animation frame: carry the virtual position forward by the
// remaining velocity, split it, decay the velocity (fast while banded, so the
// edge absorbs the throw), and spring the overshoot home once the velocity is
// spent. `live` is whether this axis still has anything to do.
export function stepFlingAxis(
  scroll: number,
  over: number,
  v: number,
  max: number,
  dt: number,
  cfg: {
    flingDecay: number;
    flingMinSpeed: number;
    bandDecay: number;
    bandMinPx: number;
    bandAbsorb: number;
    bandOvershootCap: number;
  },
): { scroll: number; over: number; v: number; live: boolean } {
  const split = splitOvershoot(scroll + over + v * dt, max, cfg.bandOvershootCap);
  let nextOver = split.over;
  let nextV = v * flingDecayFactor(nextOver !== 0 ? cfg.bandAbsorb : cfg.flingDecay, dt);
  if (Math.abs(nextV) < cfg.flingMinSpeed) nextV = 0;
  // An axis that could not move and is not banding is against a wall it cannot
  // give at (a document with no room on this axis at all) — it is done.
  if (nextV !== 0 && nextOver === 0 && split.scroll === scroll && v !== 0) nextV = 0;
  if (nextV === 0 && nextOver !== 0) {
    nextOver = stepBandSpring({ x: nextOver, y: 0 }, dt, cfg.bandDecay, cfg.bandMinPx).x;
  }
  return { scroll: split.scroll, over: nextOver, v: nextV, live: nextV !== 0 || nextOver !== 0 };
}

// --- reducer ----------------------------------------------------------------

// Fold one input into the machine, returning the next state and any commands.
// The input state is treated as immutable; a shallow clone is mutated.
export function stepVertical(
  prev: VerticalState,
  input: VerticalInput,
  config: VerticalGestureConfig,
): { state: VerticalState; commands: VerticalCommand[] } {
  const cfg = resolve(config);
  const s: VerticalState = {
    ...prev,
    fling: prev.fling ? { ...prev.fling } : null,
    over: { ...prev.over },
  };
  const cmds: VerticalCommand[] = [];

  // Publish the band only when the overshoot actually changed, so a scroll that
  // never reaches an end of the document emits nothing about it at all.
  const emitBandIfChanged = (before: BandOffset) => {
    if (s.over.x === before.x && s.over.y === before.y) return;
    const b = bandOffsetFor(s.over, cfg.bandLimit);
    cmds.push({ type: "band", x: b.x, y: b.y });
  };

  // The pointer's whole hold on the viewport, dropped as one unit. The resume
  // and the release go out unconditionally (the host's own guards make them
  // no-ops) so no exit path can leave half of it behind.
  const endGesture = () => {
    cmds.push({ type: "resume" }, { type: "releaseCapture", id: s.capturedId });
    s.capturedId = null;
    s.phase = "idle";
    s.id = null;
  };

  switch (input.type) {
    case "pointerdown": {
      // A pointer the routing table hands to the annotation layer never enters
      // this machine — it does not even stop a fling in flight.
      if (input.plan.action !== "scroll") break;
      if (input.plan.pauseAtDown) cmds.push({ type: "pause" });
      // Landing on content that is still moving grabs it: the inertia stops but
      // the band it may be riding stays, and the follow starts on this frame
      // rather than after another slop's worth of movement.
      const grab = input.takeover === true || shouldTakeOver(s, cfg.takeoverMinSpeed);
      if (s.fling) {
        s.fling = null;
        cmds.push({ type: "stopFling" });
      }
      s.id = input.id;
      s.startX = input.x;
      s.startY = input.y;
      // The follow measures from the virtual position, so an inherited band is
      // carried by the new gesture instead of snapping away under the finger.
      s.startScrollLeft = cfg.scrollLeft + s.over.x;
      s.startScrollTop = cfg.scrollTop + s.over.y;
      s.lastX = input.x;
      s.lastY = input.y;
      s.lastT = input.t;
      s.velX = 0;
      s.velY = 0;
      // A grab pauses on the down itself, so the engine never hears it either.
      s.engineHeardDown = !input.plan.pauseAtDown && !grab;
      if (grab) {
        s.phase = "scroll";
        s.capturedId = input.id;
        if (!input.plan.pauseAtDown) cmds.push({ type: "pause" });
        cmds.push({ type: "dropSelection" }, { type: "capture", id: input.id });
      } else {
        s.phase = "pending";
      }
      break;
    }

    case "pointermove": {
      if (s.id !== input.id || s.phase === "idle") break;
      const dt = Math.max(input.t - s.lastT, 1);
      // Smoothed, not instantaneous: one twitchy sample must not decide the
      // throw. The average is seeded at zero by pointerdown, so the first few
      // samples of a gesture ramp in.
      s.velX = smoothVelocity(s.velX, (input.x - s.lastX) / dt, cfg.velocitySmoothing, dt);
      s.velY = smoothVelocity(s.velY, (input.y - s.lastY) / dt, cfg.velocitySmoothing, dt);
      s.lastX = input.x;
      s.lastY = input.y;
      s.lastT = input.t;

      if (s.phase === "pending") {
        // This pointer is already classified as scroll, so a move past the slop
        // in ANY direction commits it — a horizontal pan must never fall
        // through to the drawing layer. Direction only picks the axis below.
        if (!shouldCommitScroll(input.x - s.startX, input.y - s.startY, cfg.slop)) break;
        s.phase = "scroll";
        s.capturedId = input.id;
        // The engine has had this pointer's down and the few px of moves before
        // the slop, and is about to stop hearing from it: close it out before
        // the pause, or the anchor it armed stays armed.
        if (s.engineHeardDown) {
          cmds.push({ type: "releaseEnginePointer", id: input.id });
          s.engineHeardDown = false;
        }
        cmds.push({ type: "pause" }, { type: "dropSelection" }, { type: "capture", id: input.id });
      }

      if (s.phase === "scroll") {
        // Both axes follow the finger; the horizontal one only moves when the
        // container is scrollable that way (zoomed in / page wider than the
        // viewport), otherwise there is no range and the axis holds still.
        const before = s.over;
        const y = splitOvershoot(
          s.startScrollTop - (input.y - s.startY),
          cfg.maxScrollTop,
          cfg.bandOvershootCap,
        );
        const x = splitOvershoot(
          s.startScrollLeft - (input.x - s.startX),
          cfg.maxScrollLeft,
          cfg.bandOvershootCap,
        );
        s.over = { x: x.over, y: y.over };
        cmds.push({ type: "scrollTo", top: y.scroll, left: x.scroll });
        emitBandIfChanged(before);
        cmds.push({ type: "preventDefault" });
      }
      break;
    }

    case "pointerup":
    case "pointercancel": {
      if (s.id !== input.id) break;
      const wasScroll = s.phase === "scroll";
      if (input.type === "pointerup" && wasScroll && typeof input.t === "number") {
        // The lift carries the last few px of the throw. Without them a quick
        // flick releases at a velocity the finger had already left behind.
        const dt = Math.max(input.t - s.lastT, 1);
        if (typeof input.x === "number") {
          s.velX = smoothVelocity(s.velX, (input.x - s.lastX) / dt, cfg.velocitySmoothing, dt);
        }
        if (typeof input.y === "number") {
          s.velY = smoothVelocity(s.velY, (input.y - s.lastY) / dt, cfg.velocitySmoothing, dt);
        }
      }
      endGesture();
      // A cancelled pointer coasts nowhere: the gesture was taken away, not
      // released. A release from inside the band does not coast either — the
      // band is already holding the motion, and it springs home instead.
      if (wasScroll && input.type === "pointerup" && bandAtRest(s.over)) {
        const f = flingFrom(s.velX, s.velY, cfg.flingMinSpeed);
        if (f) s.fling = f;
      }
      if (verticalNeedsFrames(s)) cmds.push({ type: "startFling" });
      break;
    }

    case "flingFrame": {
      if (!verticalNeedsFrames(s)) break;
      const dt = Math.max(input.dt, 1);
      const before = s.over;
      const y = stepFlingAxis(cfg.scrollTop, s.over.y, s.fling?.vy ?? 0, cfg.maxScrollTop, dt, cfg);
      const x = stepFlingAxis(cfg.scrollLeft, s.over.x, s.fling?.vx ?? 0, cfg.maxScrollLeft, dt, cfg);
      s.over = { x: x.over, y: y.over };
      cmds.push({ type: "scrollTo", top: y.scroll, left: x.scroll });
      emitBandIfChanged(before);
      s.fling = x.v === 0 && y.v === 0 ? null : { vx: x.v, vy: y.v };
      if (!x.live && !y.live) {
        s.fling = null;
        cmds.push({ type: "stopFling" });
      }
      break;
    }

    case "cancelFling": {
      // Only the inertia is dropped; a band still springs home, so the content
      // is never left parked off its edge.
      if (s.fling) {
        s.fling = null;
        if (!verticalNeedsFrames(s)) cmds.push({ type: "stopFling" });
      }
      break;
    }

    case "reset": {
      cmds.push({ type: "stopFling" });
      if (!bandAtRest(s.over)) cmds.push({ type: "band", x: 0, y: 0 });
      endGesture();
      // Back to the initial state outright: the follow origin and the velocity
      // are re-seeded at the next pointerdown anyway, and nothing left behind
      // can be inherited by whatever gesture the new layout starts.
      return { state: initVerticalState(), commands: cmds };
    }
  }

  return { state: s, commands: cmds };
}
