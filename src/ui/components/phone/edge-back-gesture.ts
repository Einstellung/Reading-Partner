// The left-edge back swipe on the phone shell (docs/22). Pure and DOM-free: it
// eats normalized pointer samples and emits commands the host turns into a
// transform and a stack pop. Same shape as the reader's paged-gesture.ts, for
// the same reason — the thresholds are the whole gesture, and they need to be
// readable and testable without a device.
//
// Why an edge band and not the whole page: an article can carry a wide table or
// a code block that scrolls sideways (docs/pitfall/68 is about exactly those on
// a phone). A page-wide horizontal swipe would take those over, so the gesture
// only starts within EDGE_ZONE of the left edge, where nothing scrolls.
//
// A vertical drag that starts at the edge scrolls the page natively; the
// browser then sends a pointercancel and this machine drops the gesture.
// Claiming the gesture is what takes the pointer over, and only a rightward,
// horizontally dominant move claims it (see shouldClaimTouch — the claim runs
// on the raw touch channel, because the pointer channel cannot hold a gesture
// the browser has decided to scroll with).

// Distance from the left edge a gesture may start in, CSS px. UIKit's own
// screen-edge recognizer lives in roughly the outer 20pt; 24 is that with a
// margin, and still under the 44px touch target the rest of the UI uses, so the
// band is never wide enough to look like a control of its own.
export const EDGE_ZONE = 24;
// Movement before a gesture commits. Same 10px the reader uses — it was tuned
// on a device, and this gesture starts from the same kind of finger.
export const SLOP = 10;
// The dominant axis must beat the other by this much, so a diagonal keeps
// waiting instead of guessing.
export const AXIS_RATIO = 1.2;
// Fraction of the width the drag must pass to commit. The reader commits a page
// turn at 0.22; a back is coarser on purpose, because it is not symmetrical —
// an unwanted page turn costs one more swipe, an unwanted back costs the screen
// you were reading and its scroll position, and there is no forward.
export const COMMIT_FRACTION = 0.35;
// Fling speed, px/ms, that commits regardless of distance. Just above the
// reader's 0.45 for the same reason.
export const COMMIT_VELOCITY = 0.5;

// Rightward movement, in CSS px, at which the host takes the gesture away from
// the browser by cancelling the touch. Far below SLOP on purpose: the browser
// decides whether a touch is a scroll well before the gesture has resolved, and
// once it has decided it cancels the pointer and the swipe is over. Measured in
// Chromium with touch emulation: preventing the touch at 3px keeps the pointer
// alive to its pointerup, waiting for 10px is already too late, and preventing
// only the first move does not hold the sequence (docs/pitfall/70).
export const TOUCH_CLAIM_PX = 3;

// Whether a touch that started in the band has moved enough, and clearly
// enough sideways, to be taken from the browser. Deliberately the same axis
// ratio the gesture itself uses, so a claim and a commit disagree as rarely as
// possible — a claimed gesture that then resolves to a scroll cannot hand the
// scroll back.
export function shouldClaimTouch(
  dx: number,
  dy: number,
  claimPx: number = TOUCH_CLAIM_PX,
  ratio: number = AXIS_RATIO,
): boolean {
  return dx >= claimPx && dx > Math.abs(dy) * ratio;
}

export interface EdgeBackConfig {
  // Width of the sliding surface in CSS px, read once when the gesture starts.
  width: number;
  edgeZone?: number;
  slop?: number;
  axisRatio?: number;
  commitFraction?: number;
  commitVelocity?: number;
}

type Cfg = Required<EdgeBackConfig>;

function resolve(config: EdgeBackConfig): Cfg {
  return {
    edgeZone: EDGE_ZONE,
    slop: SLOP,
    axisRatio: AXIS_RATIO,
    commitFraction: COMMIT_FRACTION,
    commitVelocity: COMMIT_VELOCITY,
    ...config,
  };
}

export type EdgeBackInput =
  // x is measured from the left edge of the surface, not the viewport.
  | { type: "pointerdown"; id: number; x: number; y: number; t: number }
  | { type: "pointermove"; id: number; x: number; y: number; t: number }
  | { type: "pointerup"; id: number; x: number; y: number; t: number }
  | { type: "pointercancel"; id: number };

export type EdgeBackCommand =
  // The gesture is ours from here: setPointerCapture(id) and preventDefault.
  | { type: "capture"; id: number }
  // Follow the finger: the surface sits dx px to the right of rest.
  | { type: "dragMove"; dx: number }
  // Released. `back` true means run the back action, false means settle home.
  | { type: "dragEnd"; back: boolean };

export type EdgeBackPhase =
  // Nothing in flight.
  | "idle"
  // A pointer is down inside the band, still deciding.
  | "pending"
  // Following the finger.
  | "drag"
  // This pointer is not ours (started outside the band, went the wrong way, or
  // a second finger landed). Ignored until every pointer is up.
  | "off";

export interface EdgeBackState {
  phase: EdgeBackPhase;
  pointerId: number | null;
  // How many pointers are down, so the machine only returns to idle when the
  // glass is clear: a second finger must not hand the gesture back mid-flight.
  downCount: number;
  startX: number;
  startY: number;
  lastDx: number;
  vx: number; // smoothed horizontal velocity, px/ms
  vLastX: number;
  vLastT: number;
}

export function initEdgeBackState(): EdgeBackState {
  return {
    phase: "idle",
    pointerId: null,
    downCount: 0,
    startX: 0,
    startY: 0,
    lastDx: 0,
    vx: 0,
    vLastX: 0,
    vLastT: 0,
  };
}

// --- pure decision helpers (exported for direct unit tests) -----------------

export function inEdgeZone(x: number, edgeZone: number): boolean {
  return x >= 0 && x <= edgeZone;
}

// What a move past the slop means: "back" once it is rightward and horizontally
// dominant, "abandon" once it is vertical or leftward, "wait" while it is still
// small or too diagonal to call.
export function classifyMove(
  dx: number,
  dy: number,
  slop: number,
  ratio: number,
): "wait" | "back" | "abandon" {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (ax < slop && ay < slop) return "wait";
  if (ay >= ax * ratio) return "abandon"; // the page is being scrolled
  if (ax >= ay * ratio) return dx > 0 ? "back" : "abandon";
  return "wait"; // diagonal: let the move resolve
}

// Whether a release goes back. A fling wins by its direction, so a fast flick
// commits early and a flick back cancels however far the finger travelled;
// otherwise the drag has to have passed commitFraction of the width.
export function resolveEdgeBack(
  dx: number,
  vx: number,
  width: number,
  commitFraction: number,
  commitVelocity: number,
): boolean {
  if (vx >= commitVelocity) return true;
  if (vx <= -commitVelocity) return false;
  return dx >= width * commitFraction;
}

function updateVelocity(s: EdgeBackState, x: number, t: number): void {
  const dt = Math.max(t - s.vLastT, 1);
  const inst = (x - s.vLastX) / dt;
  s.vx = s.vx * 0.3 + inst * 0.7;
  s.vLastX = x;
  s.vLastT = t;
}

// Fold one input in. The input state is treated as immutable; a shallow clone
// is mutated and returned.
export function stepEdgeBack(
  prev: EdgeBackState,
  input: EdgeBackInput,
  config: EdgeBackConfig,
): { state: EdgeBackState; commands: EdgeBackCommand[] } {
  const cfg = resolve(config);
  const s: EdgeBackState = { ...prev };
  const cmds: EdgeBackCommand[] = [];

  switch (input.type) {
    case "pointerdown": {
      s.downCount += 1;
      if (s.downCount > 1) {
        // A second finger is a pinch or a two-finger scroll, never a back.
        if (s.phase === "drag") cmds.push({ type: "dragEnd", back: false });
        s.phase = "off";
        s.pointerId = null;
        break;
      }
      s.pointerId = input.id;
      s.startX = input.x;
      s.startY = input.y;
      s.lastDx = 0;
      s.vx = 0;
      s.vLastX = input.x;
      s.vLastT = input.t;
      s.phase = inEdgeZone(input.x, cfg.edgeZone) ? "pending" : "off";
      break;
    }

    case "pointermove": {
      if (input.id !== s.pointerId) break;
      updateVelocity(s, input.x, input.t);

      if (s.phase === "pending") {
        const verdict = classifyMove(
          input.x - s.startX,
          input.y - s.startY,
          cfg.slop,
          cfg.axisRatio,
        );
        if (verdict === "abandon") {
          s.phase = "off";
          break;
        }
        if (verdict === "wait") break;
        s.phase = "drag";
        s.lastDx = Math.max(0, input.x - s.startX);
        cmds.push({ type: "capture", id: input.id });
        cmds.push({ type: "dragMove", dx: s.lastDx });
        break;
      }

      if (s.phase === "drag") {
        // Clamped at rest: dragging back past the start must not push the
        // screen off the other side, it must only undo the pull.
        s.lastDx = Math.max(0, input.x - s.startX);
        cmds.push({ type: "dragMove", dx: s.lastDx });
      }
      break;
    }

    case "pointerup":
    case "pointercancel": {
      const mine = input.id === s.pointerId;
      s.downCount = Math.max(0, s.downCount - 1);
      if (mine && s.phase === "drag") {
        if (input.type === "pointerup") updateVelocity(s, input.x, input.t);
        const back =
          input.type === "pointercancel"
            ? false
            : resolveEdgeBack(
                s.lastDx,
                s.vx,
                cfg.width,
                cfg.commitFraction,
                cfg.commitVelocity,
              );
        cmds.push({ type: "dragEnd", back });
      }
      if (mine) s.pointerId = null;
      // Only a clear screen returns the machine to idle: a finger left over
      // from an abandoned gesture must not start a new one mid-way.
      if (s.downCount === 0) return { state: initEdgeBackState(), commands: cmds };
      s.phase = "off";
      break;
    }
  }

  return { state: s, commands: cmds };
}
