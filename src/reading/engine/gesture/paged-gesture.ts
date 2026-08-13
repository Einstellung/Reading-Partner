// Touch gesture state machine for the paged (horizontal page-flip) reading
// mode. Pure and engine-agnostic: it consumes normalized pointer/touch samples
// and emits high-level commands (follow-finger drag, page turn, pan) that the
// host translates into engine calls. No DOM, no timers, no side effects — the
// host owns pointer capture, the long-press timer, the drag animation, and the
// touch-to-input adaptation, and feeds events back in. This keeps the conflict
// rules (tool mode, zoom, edge zones, direction lock, fling thresholds) unit-
// testable in isolation.
//
// Two-finger pinch-zoom is NOT handled here: the engine's own ZoomGestureWrapper
// owns it on the raw-touch channel. The host stops feeding this machine the
// moment a second finger lands (and springs back a drag in flight), so the two
// never fight over the same gesture; a second pointerdown that does reach it
// still yields, as a safety net.
//
// Coordinate convention: dragging the finger LEFT (dx < 0) pulls the NEXT page
// in (turn = +1); dragging RIGHT (dx > 0) brings the PREVIOUS page (turn = -1).
//
// Paged mode is locked to one whole page per screen (fit-page), so only a
// horizontal swipe means anything. A vertical swipe, and a horizontal swipe with
// no page on that side, get a damped follow that springs back — the page moves a
// few px under the finger and returns, so "nothing to scroll here" is felt
// instead of the screen appearing frozen.

// The damped follow lives with the rest of the band physics (vertical mode uses
// the same curve). Re-exported here because it is part of this machine's
// vocabulary and its callers/tests have always read it from here.
import { rubberBand } from "./rubber-band";
export { rubberBand };

export type GestureTool = "pointer" | "pen";

export interface PagedGestureConfig {
  // "pen" = a drawing tool is active (highlight / underline / ink / AI pen):
  // one finger draws, so a page turn must start from a screen edge band.
  tool: GestureTool;
  // Zoomed past fit-page (temporary magnification): one finger pans the page
  // instead of turning it, until the pan runs into the horizontal edge.
  zoomedIn: boolean;
  // Viewport width in CSS px — sets the turn-commit distance and edge bands.
  width: number;
  // Whether a page exists on that side. Without one the swipe rubber-bands
  // instead of turning, so the first/last page never feels like a hard wall.
  canTurnPrev?: boolean;
  canTurnNext?: boolean;
  // Whether the zoomed page still has room to pan that way (host reads the live
  // scroll position). Pushing past the edge is what turns a page while zoomed.
  canPanLeft?: boolean;
  canPanRight?: boolean;
  slop?: number; // movement before a one-finger gesture commits (default 10)
  axisRatio?: number; // dominant axis must beat the other by this (default 1.2)
  edgeZone?: number; // edge band width for pen-mode edge swipe (default 32)
  commitFraction?: number; // fraction of width to commit a turn (default 0.22)
  commitVelocity?: number; // fling speed px/ms that commits a turn (default 0.45)
  bandLimit?: number; // px the rubber band asymptotically approaches (default 48)
  edgeTurnPull?: number; // px of pull past a zoomed edge that turns (default 60)
}

type Cfg = Required<PagedGestureConfig>;

function resolve(config: PagedGestureConfig): Cfg {
  return {
    canTurnPrev: true,
    canTurnNext: true,
    canPanLeft: true,
    canPanRight: true,
    slop: 10,
    axisRatio: 1.2,
    edgeZone: 32,
    commitFraction: 0.22,
    commitVelocity: 0.45,
    bandLimit: 48,
    edgeTurnPull: 60,
    ...config,
  };
}

export type GestureInput =
  // `takeover` marks the finger a two-finger pinch left behind: it is already on
  // the glass and already moving the page, so on a magnified page it becomes a
  // pan at once instead of asking for another slop's worth of movement.
  | { type: "pointerdown"; id: number; x: number; y: number; t: number; takeover?: boolean }
  | { type: "pointermove"; id: number; x: number; y: number; t: number }
  | { type: "pointerup"; id: number; x: number; y: number; t: number }
  | { type: "pointercancel"; id: number }
  // The host's long-press timer fired while the primary finger stayed put.
  | { type: "longpress"; id: number };

export type GestureCommand =
  // Host should setPointerCapture(id) / preventDefault from here on.
  | { type: "capture"; id: number }
  // Follow the finger: offset the current page by dx px (0 = rest).
  | { type: "dragMove"; dx: number }
  // Release: -1 previous page, +1 next page, 0 spring back to rest.
  | { type: "dragEnd"; turn: -1 | 0 | 1 }
  // Zoomed-in pan: shift the viewport by (dx, dy) since the last sample.
  | { type: "panMove"; dx: number; dy: number }
  // Nothing to scroll this way: offset the page by an already-damped (dx, dy)
  // so the gesture is felt, then spring it back on bandEnd.
  | { type: "bandMove"; dx: number; dy: number }
  | { type: "bandEnd" };

interface Pt {
  x: number;
  y: number;
  t: number;
}

export type GesturePhase = "idle" | "pending" | "drag" | "pan" | "band" | "off";

export interface GestureState {
  phase: GesturePhase;
  order: number[]; // active pointer ids, in arrival order
  down: Record<number, Pt>; // gesture-start position per pointer
  now: Record<number, Pt>; // latest position per pointer
  primary: number | null; // the finger driving a one-finger drag/pan
  dragBaseX: number; // x that drag dx is measured from
  lastDx: number; // last emitted drag dx (for release resolution)
  bandAxis: "x" | "y" | null; // axis the rubber band follows
  edgePull: number; // px pulled past a zoomed pan edge, one direction only
  vx: number; // smoothed horizontal velocity, px/ms
  vLastX: number;
  vLastT: number;
}

export function initGestureState(): GestureState {
  return {
    phase: "idle",
    order: [],
    down: {},
    now: {},
    primary: null,
    dragBaseX: 0,
    lastDx: 0,
    bandAxis: null,
    edgePull: 0,
    vx: 0,
    vLastX: 0,
    vLastT: 0,
  };
}

// --- pure decision helpers (exported for direct unit tests) ----------------

// Which axis a one-finger move has committed to, or "none" while still within
// the slop or too diagonal to call.
export function lockAxis(
  dx: number,
  dy: number,
  slop: number,
  ratio: number,
): "none" | "x" | "y" {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (ax < slop && ay < slop) return "none";
  if (ax >= ay * ratio) return "x";
  if (ay >= ax * ratio) return "y";
  return "none"; // diagonal: keep waiting for the move to resolve
}

// Decide a page turn from the final drag displacement and release velocity. A
// fling (speed past commitVelocity) wins by its direction; otherwise the drag
// must pass commitFraction of the width. Returns +1 next, -1 previous, 0 cancel.
export function resolveSwipe(
  dx: number,
  vx: number,
  width: number,
  commitFraction: number,
  commitVelocity: number,
): -1 | 0 | 1 {
  if (Math.abs(vx) >= commitVelocity) return vx < 0 ? 1 : -1;
  const commit = width * commitFraction;
  if (dx <= -commit) return 1;
  if (dx >= commit) return -1;
  return 0;
}

// The screen edge a point started from, for pen-mode edge-swipe turns.
export function edgeOf(x: number, width: number, edgeZone: number): "left" | "right" | null {
  if (x <= edgeZone) return "left";
  if (x >= width - edgeZone) return "right";
  return null;
}

// Which page a horizontal drag is reaching for, and whether it exists: -1 the
// previous page (finger moving right), +1 the next (finger moving left).
export function turnDirection(dx: number): -1 | 1 {
  return dx < 0 ? 1 : -1;
}

export function canTurn(dir: -1 | 1, cfg: { canTurnPrev: boolean; canTurnNext: boolean }): boolean {
  return dir === 1 ? cfg.canTurnNext : cfg.canTurnPrev;
}

// Accumulated pull against a zoomed pan edge. Only counts while the pan is
// blocked on that side and the finger keeps going the same way; any step with
// room left, or a reversal, restarts it.
export function accumulateEdgePull(prev: number, step: number, blocked: boolean): number {
  if (!blocked) return 0;
  if (prev === 0 || Math.sign(prev) === Math.sign(step)) return prev + step;
  return step;
}

// Centring a page in the viewport: the alignX percentage scrollToPage takes
// (it subtracts clientWidth * alignX/100 from the page's left edge). 0 once the
// page is at least as wide as the viewport.
export function pageCenterAlign(pageWidthPx: number, viewportWidthPx: number): number {
  if (viewportWidthPx <= 0 || pageWidthPx <= 0) return 0;
  return Math.max(0, Math.min(50, 50 * (1 - pageWidthPx / viewportWidthPx)));
}

// --- reducer ---------------------------------------------------------------

// A band only ever moves along its locked axis, damped.
function bandCommand(dx: number, dy: number, axis: "x" | "y", limit: number): GestureCommand {
  return {
    type: "bandMove",
    dx: axis === "x" ? rubberBand(dx, limit) : 0,
    dy: axis === "y" ? rubberBand(dy, limit) : 0,
  };
}

function updateVelocity(s: GestureState, x: number, t: number): void {
  const dt = Math.max(t - s.vLastT, 1);
  const inst = (x - s.vLastX) / dt;
  s.vx = s.vx * 0.3 + inst * 0.7;
  s.vLastX = x;
  s.vLastT = t;
}

// Fold one input into the machine, returning the next state and any commands.
// The input state is treated as immutable; a shallow clone is mutated.
export function stepGesture(
  prev: GestureState,
  input: GestureInput,
  config: PagedGestureConfig,
): { state: GestureState; commands: GestureCommand[] } {
  const cfg = resolve(config);
  const s: GestureState = {
    ...prev,
    order: [...prev.order],
    down: { ...prev.down },
    now: { ...prev.now },
  };
  const cmds: GestureCommand[] = [];

  switch (input.type) {
    case "pointerdown": {
      const p: Pt = { x: input.x, y: input.y, t: input.t };
      s.down[input.id] = p;
      s.now[input.id] = p;
      if (!s.order.includes(input.id)) s.order.push(input.id);
      const n = s.order.length;
      if (n === 1) {
        s.phase = "pending";
        s.primary = input.id;
        s.vx = 0;
        s.vLastX = input.x;
        s.vLastT = input.t;
        // The survivor of a pinch on a magnified page keeps panning without a
        // pause. At fit-page there is nothing to pan, so it waits for the slop
        // like any other finger and can still turn the page.
        if (input.takeover && cfg.zoomedIn) {
          s.phase = "pan";
          cmds.push({ type: "capture", id: input.id });
        }
      } else {
        // A second finger means pinch-zoom (engine wrapper's job) or multi-touch
        // we don't drive — yield. Anything mid-flight springs back.
        if (s.phase === "drag") cmds.push({ type: "dragEnd", turn: 0 });
        if (s.phase === "band") cmds.push({ type: "bandEnd" });
        s.phase = "off";
        s.primary = null;
      }
      break;
    }

    case "pointermove": {
      if (!s.now[input.id]) break;
      const prevPos = s.now[input.id];
      const cur: Pt = { x: input.x, y: input.y, t: input.t };
      s.now[input.id] = cur;

      if (s.phase === "pending") {
        if (input.id !== s.primary) break;
        updateVelocity(s, input.x, input.t);
        const d = s.down[input.id];
        const dx = cur.x - d.x;
        const dy = cur.y - d.y;

        if (cfg.zoomedIn) {
          if (Math.abs(dx) >= cfg.slop || Math.abs(dy) >= cfg.slop) {
            s.phase = "pan";
            cmds.push({ type: "capture", id: input.id });
            cmds.push({ type: "panMove", dx: cur.x - prevPos.x, dy: cur.y - prevPos.y });
          }
          break;
        }

        // At fit-page the whole page is on screen, so only the horizontal axis
        // can go anywhere: it turns the page when there is one on that side,
        // and rubber-bands when there is not. The vertical axis always bands.
        const axis = lockAxis(dx, dy, cfg.slop, cfg.axisRatio);
        const startTurnOrBand = (a: "x" | "y") => {
          cmds.push({ type: "capture", id: input.id });
          if (a === "x" && canTurn(turnDirection(dx), cfg)) {
            s.phase = "drag";
            s.dragBaseX = d.x;
            s.lastDx = dx;
            cmds.push({ type: "dragMove", dx });
            return;
          }
          s.phase = "band";
          s.bandAxis = a;
          cmds.push(bandCommand(dx, dy, a, cfg.bandLimit));
        };

        if (cfg.tool === "pen") {
          // One finger with a pen draws; a turn must start inside an edge band.
          if (edgeOf(d.x, cfg.width, cfg.edgeZone) && axis === "x") {
            startTurnOrBand("x");
          } else if (Math.abs(dx) >= cfg.slop || Math.abs(dy) >= cfg.slop) {
            s.phase = "off"; // hand the stroke to the annotation layer
          }
          break;
        }

        // pointer tool at fit-page.
        if (axis !== "none") startTurnOrBand(axis);
        break;
      }

      if (s.phase === "drag") {
        if (input.id !== s.primary) break;
        updateVelocity(s, cur.x, input.t);
        s.lastDx = cur.x - s.dragBaseX;
        cmds.push({ type: "dragMove", dx: s.lastDx });
        break;
      }

      if (s.phase === "pan") {
        if (input.id !== s.primary) break;
        const stepX = cur.x - prevPos.x;
        const blocked = stepX < 0 ? !cfg.canPanRight : stepX > 0 ? !cfg.canPanLeft : false;
        s.edgePull = accumulateEdgePull(s.edgePull, stepX, blocked);
        // Pushing past the edge of a magnified page is how it turns: the host
        // snaps to the neighbour page and drops back to fit-page.
        if (Math.abs(s.edgePull) >= cfg.edgeTurnPull) {
          const dir = turnDirection(s.edgePull);
          if (canTurn(dir, cfg)) {
            cmds.push({ type: "dragEnd", turn: dir });
            s.phase = "off";
            break;
          }
        }
        cmds.push({ type: "panMove", dx: stepX, dy: cur.y - prevPos.y });
        break;
      }

      if (s.phase === "band") {
        if (input.id !== s.primary) break;
        const d = s.down[input.id];
        cmds.push(bandCommand(cur.x - d.x, cur.y - d.y, s.bandAxis ?? "y", cfg.bandLimit));
        break;
      }
      break; // "off" / "idle": ignore
    }

    case "longpress": {
      // The primary finger dwelled: hand off to native text selection so a later
      // handle drag is never hijacked as a page turn.
      if (s.phase === "pending" && input.id === s.primary) s.phase = "off";
      break;
    }

    case "pointerup":
    case "pointercancel": {
      const wasPhase = s.phase;
      const wasPrimary = input.id === s.primary;
      if (input.type === "pointerup" && wasPrimary && wasPhase === "drag") {
        updateVelocity(s, input.x, input.t);
      }
      delete s.down[input.id];
      delete s.now[input.id];
      s.order = s.order.filter((id) => id !== input.id);

      if (wasPhase === "drag" && wasPrimary) {
        const rawTurn =
          input.type === "pointercancel"
            ? 0
            : resolveSwipe(s.lastDx, s.vx, cfg.width, cfg.commitFraction, cfg.commitVelocity);
        // A flick back at the end can resolve to the side with no page left;
        // that springs back instead of asking for a page that isn't there.
        const turn = rawTurn !== 0 && !canTurn(rawTurn, cfg) ? 0 : rawTurn;
        cmds.push({ type: "dragEnd", turn });
        s.phase = s.order.length > 0 ? "off" : "idle";
      } else if (wasPhase === "band" && wasPrimary) {
        cmds.push({ type: "bandEnd" });
        s.bandAxis = null;
        s.phase = s.order.length > 0 ? "off" : "idle";
      } else if (wasPhase === "pan" && wasPrimary) {
        s.phase = s.order.length > 0 ? "off" : "idle";
      } else {
        // pending / off / a non-primary lift: a tap or an abandoned gesture.
        // Nothing to emit — an uncaptured tap becomes a native click.
        s.phase = s.order.length > 0 ? (wasPhase === "off" ? "off" : "pending") : "idle";
        s.primary = s.order.length === 1 ? s.order[0] : s.order.length === 0 ? null : s.primary;
      }

      if (s.order.length === 0) return { state: initGestureState(), commands: cmds };
      break;
    }
  }

  return { state: s, commands: cmds };
}
