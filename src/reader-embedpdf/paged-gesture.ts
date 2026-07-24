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
// owns it on the raw-touch channel. This machine yields (goes idle) the moment a
// second finger lands, so the two never fight over the same gesture.
//
// Coordinate convention: dragging the finger LEFT (dx < 0) pulls the NEXT page
// in (turn = +1); dragging RIGHT (dx > 0) brings the PREVIOUS page (turn = -1).

export type GestureTool = "pointer" | "pen";

export interface PagedGestureConfig {
  // "pen" = a drawing tool is active (highlight / underline / ink / AI pen):
  // one finger draws, so a page turn must start from a screen edge band.
  tool: GestureTool;
  // The page is larger than the viewport (zoomed past fit-page): one finger pans
  // instead of turning, and turning is locked until back at fit-page.
  zoomedIn: boolean;
  // Viewport width in CSS px — sets the turn-commit distance and edge bands.
  width: number;
  slop?: number; // movement before a one-finger gesture commits (default 10)
  axisRatio?: number; // dominant axis must beat the other by this (default 1.2)
  edgeZone?: number; // edge band width for pen-mode edge swipe (default 32)
  commitFraction?: number; // fraction of width to commit a turn (default 0.22)
  commitVelocity?: number; // fling speed px/ms that commits a turn (default 0.45)
}

type Cfg = Required<PagedGestureConfig>;

function resolve(config: PagedGestureConfig): Cfg {
  return {
    slop: 10,
    axisRatio: 1.2,
    edgeZone: 32,
    commitFraction: 0.22,
    commitVelocity: 0.45,
    ...config,
  };
}

export type GestureInput =
  | { type: "pointerdown"; id: number; x: number; y: number; t: number }
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
  | { type: "panMove"; dx: number; dy: number };

interface Pt {
  x: number;
  y: number;
  t: number;
}

export type GesturePhase = "idle" | "pending" | "drag" | "pan" | "off";

export interface GestureState {
  phase: GesturePhase;
  order: number[]; // active pointer ids, in arrival order
  down: Record<number, Pt>; // gesture-start position per pointer
  now: Record<number, Pt>; // latest position per pointer
  primary: number | null; // the finger driving a one-finger drag/pan
  dragBaseX: number; // x that drag dx is measured from
  lastDx: number; // last emitted drag dx (for release resolution)
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

// --- reducer ---------------------------------------------------------------

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
      } else {
        // A second finger means pinch-zoom (engine wrapper's job) or multi-touch
        // we don't drive — yield. If a page drag was mid-flight, spring it back.
        if (s.phase === "drag") cmds.push({ type: "dragEnd", turn: 0 });
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

        if (cfg.tool === "pen") {
          // One finger with a pen draws; a turn must start inside an edge band.
          if (edgeOf(d.x, cfg.width, cfg.edgeZone) && lockAxis(dx, dy, cfg.slop, cfg.axisRatio) === "x") {
            s.phase = "drag";
            s.dragBaseX = d.x;
            s.lastDx = dx;
            cmds.push({ type: "capture", id: input.id });
            cmds.push({ type: "dragMove", dx });
          } else if (Math.abs(dx) >= cfg.slop || Math.abs(dy) >= cfg.slop) {
            s.phase = "off"; // hand the stroke to the annotation layer
          }
          break;
        }

        // pointer tool at fit-page.
        const axis = lockAxis(dx, dy, cfg.slop, cfg.axisRatio);
        if (axis === "x") {
          s.phase = "drag";
          s.dragBaseX = d.x;
          s.lastDx = dx;
          cmds.push({ type: "capture", id: input.id });
          cmds.push({ type: "dragMove", dx });
        } else if (axis === "y") {
          s.phase = "off"; // vertical drag has nothing to move at fit-page
        }
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
        cmds.push({ type: "panMove", dx: cur.x - prevPos.x, dy: cur.y - prevPos.y });
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
        const turn =
          input.type === "pointercancel"
            ? 0
            : resolveSwipe(s.lastDx, s.vx, cfg.width, cfg.commitFraction, cfg.commitVelocity);
        cmds.push({ type: "dragEnd", turn });
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
