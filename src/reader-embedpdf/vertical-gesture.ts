// Touch gesture state machine for the vertical (continuous scroll) reading
// mode: follow-finger scrolling and the inertia fling that follows it. Pure and
// DOM-free, the same shape as paged-gesture.ts — it consumes normalized pointer
// samples plus the live scroll geometry and emits commands the host executes
// (pointer capture, scrollTop/scrollLeft writes, engine pause/resume, the rAF
// loop that drives the fling).
//
// Why this exists at all: every page div carries touch-action:none in every
// mode (docs/pitfall/37), so native touch scrolling over a page is impossible
// and the scroll has to be driven in JS. That makes the follow and the inertia
// our physics, not the browser's, and this is where they live.
//
// Which pointers reach this machine is decided elsewhere: touch-routing.ts says
// whether a pointer scrolls or draws, and the host swallows everything that is
// multi-touch or locked out by a working stylus. A pointer planned as "draw" is
// left to the annotation layer and never enters the machine.
//
// Sign convention: scroll velocity is the finger's, negated — a finger moving
// up (negative dy) scrolls the content down (scrollTop grows).

import { shouldCommitScroll, type PointerPlan } from "./touch-routing";

// Movement (CSS px) in any direction before a scroll-classified pointer commits.
export const VERTICAL_SCROLL_SLOP = 6;
// Inertia decay per 16ms frame for the fling, and the scroll speed (px/ms)
// below which an axis stops coasting.
export const VERTICAL_FLING_DECAY = 0.95;
export const VERTICAL_FLING_MIN_SPEED = 0.02;

export interface VerticalGestureConfig {
  // Live scroll geometry, read fresh off the container by the host each event.
  // The follow phase measures from the position latched at pointerdown, so it
  // only needs the bounds to clamp; the fling reads the real position every
  // frame, so anything else that scrolls mid-fling is picked up.
  scrollTop: number;
  scrollLeft: number;
  maxScrollTop: number;
  maxScrollLeft: number;
  slop?: number;
  flingDecay?: number; // fraction of speed kept per 16ms frame
  flingMinSpeed?: number; // px/ms below which an axis stops coasting
}

type Cfg = Required<VerticalGestureConfig>;

function resolve(config: VerticalGestureConfig): Cfg {
  return {
    slop: VERTICAL_SCROLL_SLOP,
    flingDecay: VERTICAL_FLING_DECAY,
    flingMinSpeed: VERTICAL_FLING_MIN_SPEED,
    ...config,
  };
}

export type VerticalInput =
  // The plan comes from planPointer at the moment the pointer lands: a "draw"
  // plan is ignored outright, and an annotation tool's plan pauses the engine
  // here and now, before the stroke's lead-in can leave ink (docs/pitfall/37).
  | { type: "pointerdown"; id: number; x: number; y: number; t: number; plan: PointerPlan }
  | { type: "pointermove"; id: number; x: number; y: number; t: number }
  | { type: "pointerup"; id: number }
  | { type: "pointercancel"; id: number }
  // One inertia frame; dt is the ms since the previous frame.
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
  | { type: "capture"; id: number }
  // id is null when nothing was captured — the host no-ops.
  | { type: "releaseCapture"; id: number | null }
  // Drop a text selection this gesture caused on its way in (the host decides
  // whether the selection predates the gesture and has to be kept).
  | { type: "dropSelection" }
  | { type: "scrollTo"; top: number; left: number }
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
  startScrollLeft: number;
  startScrollTop: number;
  lastX: number;
  lastY: number;
  lastT: number;
  velX: number; // finger velocity px/ms (positive = moving right / down)
  velY: number;
  capturedId: number | null;
  fling: FlingMotion | null;
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
    fling: null,
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

// --- reducer ----------------------------------------------------------------

// Fold one input into the machine, returning the next state and any commands.
// The input state is treated as immutable; a shallow clone is mutated.
export function stepVertical(
  prev: VerticalState,
  input: VerticalInput,
  config: VerticalGestureConfig,
): { state: VerticalState; commands: VerticalCommand[] } {
  const cfg = resolve(config);
  const s: VerticalState = { ...prev, fling: prev.fling ? { ...prev.fling } : null };
  const cmds: VerticalCommand[] = [];

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
      if (s.fling) {
        s.fling = null;
        cmds.push({ type: "stopFling" });
      }
      s.phase = "pending";
      s.id = input.id;
      s.startX = input.x;
      s.startY = input.y;
      s.startScrollLeft = cfg.scrollLeft;
      s.startScrollTop = cfg.scrollTop;
      s.lastX = input.x;
      s.lastY = input.y;
      s.lastT = input.t;
      s.velX = 0;
      s.velY = 0;
      break;
    }

    case "pointermove": {
      if (s.id !== input.id || s.phase === "idle") break;
      const dt = Math.max(input.t - s.lastT, 1);
      s.velX = (input.x - s.lastX) / dt;
      s.velY = (input.y - s.lastY) / dt;
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
        cmds.push({ type: "pause" }, { type: "dropSelection" }, { type: "capture", id: input.id });
      }

      if (s.phase === "scroll") {
        // Both axes follow the finger; the horizontal one only moves when the
        // container is scrollable that way (zoomed in / page wider than the
        // viewport), otherwise the clamp pins it and that axis holds still.
        cmds.push({
          type: "scrollTo",
          top: clampScroll(s.startScrollTop - (input.y - s.startY), cfg.maxScrollTop),
          left: clampScroll(s.startScrollLeft - (input.x - s.startX), cfg.maxScrollLeft),
        });
        cmds.push({ type: "preventDefault" });
      }
      break;
    }

    case "pointerup":
    case "pointercancel": {
      if (s.id !== input.id) break;
      const wasScroll = s.phase === "scroll";
      endGesture();
      // A cancelled pointer coasts nowhere: the gesture was taken away, not
      // released.
      if (wasScroll && input.type === "pointerup") {
        const f = flingFrom(s.velX, s.velY, cfg.flingMinSpeed);
        if (f) {
          s.fling = f;
          cmds.push({ type: "startFling" });
        }
      }
      break;
    }

    case "flingFrame": {
      if (!s.fling) break;
      const dt = Math.max(input.dt, 1);
      const nextTop = clampScroll(cfg.scrollTop + s.fling.vy * dt, cfg.maxScrollTop);
      const nextLeft = clampScroll(cfg.scrollLeft + s.fling.vx * dt, cfg.maxScrollLeft);
      // An axis that could not move is against its edge and is done, however
      // much speed it has left.
      const topStuck = nextTop === cfg.scrollTop;
      const leftStuck = nextLeft === cfg.scrollLeft;
      cmds.push({ type: "scrollTo", top: nextTop, left: nextLeft });
      const decay = flingDecayFactor(cfg.flingDecay, dt);
      const vx = s.fling.vx * decay;
      const vy = s.fling.vy * decay;
      const yLive = !topStuck && Math.abs(vy) > cfg.flingMinSpeed;
      const xLive = !leftStuck && Math.abs(vx) > cfg.flingMinSpeed;
      if (yLive || xLive) {
        s.fling = { vx, vy };
      } else {
        s.fling = null;
        cmds.push({ type: "stopFling" });
      }
      break;
    }

    case "cancelFling": {
      if (s.fling) {
        s.fling = null;
        cmds.push({ type: "stopFling" });
      }
      break;
    }

    case "reset": {
      cmds.push({ type: "stopFling" });
      endGesture();
      // Back to the initial state outright: the follow origin and the velocity
      // are re-seeded at the next pointerdown anyway, and nothing left behind
      // can be inherited by whatever gesture the new layout starts.
      return { state: initVerticalState(), commands: cmds };
    }
  }

  return { state: s, commands: cmds };
}
