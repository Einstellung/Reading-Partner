// The one single-finger, single-axis drag machine behind both phone gestures
// (docs/22). The left-edge back swipe and the pull down to ask are the same
// machine with the axes swapped: a pointer lands somewhere the gesture is
// allowed to start, the first move past the slop either claims the finger or
// hands it to the page, a claimed drag follows the finger along its axis, and
// the release resolves by distance or by fling.
//
// Pure and DOM-free. It eats normalized pointer samples and emits commands the
// host turns into a transform and an action. What differs between the two
// gestures is the spec each one passes in: which axis, where a gesture may
// start, what a move draws, and what a release decides. Nothing else may
// differ, because the two share a finger and the axis rule is the only thing
// keeping them apart.

import { velocityStep } from "../../../../reading/engine/gesture/physics";

export type GestureAxis = "x" | "y";

// Normalized pointer samples. `Down` is whatever extra reading the host takes
// at the moment the finger lands — the scroll position, say — for the spec's
// canStart to judge. Coordinates are measured from the surface, not the
// viewport.
export type AxisGestureInput<Down = unknown> =
  | ({ type: "pointerdown"; id: number; x: number; y: number; t: number } & Down)
  | { type: "pointermove"; id: number; x: number; y: number; t: number }
  | { type: "pointerup"; id: number; x: number; y: number; t: number }
  | { type: "pointercancel"; id: number };

// The gesture is ours from here: setPointerCapture(id) and preventDefault.
// Emitted by the machine itself, because claiming the pointer is not something
// either gesture gets to decide differently.
export type CaptureCommand = { type: "capture"; id: number };

export type AxisGesturePhase =
  // Nothing in flight.
  | "idle"
  // A pointer is down somewhere the gesture may start from, still deciding.
  | "pending"
  // Following the finger.
  | "drag"
  // This pointer is not ours (it started somewhere the gesture may not start,
  // it went the wrong way, or a second finger landed). Ignored until every
  // pointer is up.
  | "off";

export interface AxisGestureState {
  phase: AxisGesturePhase;
  pointerId: number | null;
  // How many pointers are down, so the machine only returns to idle when the
  // glass is clear: a second finger must not hand the gesture back mid-flight.
  downCount: number;
  startX: number;
  startY: number;
  // Raw travel along the axis in the gesture's own direction, clamped at rest —
  // what the thresholds are read against, whatever the host is drawing.
  distance: number;
  velocity: number; // smoothed, px/ms along the axis
  vLast: number;
  vLastT: number;
}

export function initAxisGestureState(): AxisGestureState {
  return {
    phase: "idle",
    pointerId: null,
    downCount: 0,
    startX: 0,
    startY: 0,
    distance: 0,
    velocity: 0,
    vLast: 0,
    vLastT: 0,
  };
}

export interface AxisGestureSpec<Down, Cmd> {
  axis: GestureAxis;
  slop: number;
  axisRatio: number;
  // Whether a pointer landing here may start the gesture at all.
  canStart(down: { x: number; y: number } & Down): boolean;
  // What the host draws for a given raw travel.
  moveCommand(distance: number): Cmd;
  // What a release means. `cancelled` is a pointercancel or a second finger,
  // and always settles back.
  endCommand(distance: number, velocity: number, cancelled: boolean): Cmd;
}

// --- pure decision helpers --------------------------------------------------

// Whether a touch has moved enough, and clearly enough along the axis, to be
// taken from the browser on the raw touch channel. Deliberately the same axis
// ratio the gesture itself uses, so a claim and a commit disagree as rarely as
// possible — a claimed gesture that then resolves to a scroll cannot hand the
// scroll back.
export function shouldClaimAxisTouch(
  main: number,
  cross: number,
  claimPx: number,
  ratio: number,
): boolean {
  return main >= claimPx && main > Math.abs(cross) * ratio;
}

// What a move past the slop means: "go" once it runs along the axis in the
// gesture's direction and dominates the other axis, "abandon" once the other
// axis dominates or the direction is wrong, "wait" while it is still small or
// too diagonal to call.
export function classifyAxisMove(
  main: number,
  cross: number,
  slop: number,
  ratio: number,
): "wait" | "go" | "abandon" {
  const am = Math.abs(main);
  const ac = Math.abs(cross);
  if (am < slop && ac < slop) return "wait";
  if (ac >= am * ratio) return "abandon"; // the page is being scrolled
  if (am >= ac * ratio) return main > 0 ? "go" : "abandon";
  return "wait"; // diagonal: let the move resolve
}

// --- the machine ------------------------------------------------------------

function along(axis: GestureAxis, x: number, y: number): number {
  return axis === "x" ? x : y;
}

function across(axis: GestureAxis, x: number, y: number): number {
  return axis === "x" ? y : x;
}

function updateVelocity(s: AxisGestureState, main: number, t: number): void {
  s.velocity = velocityStep(s.velocity, main, t, s.vLast, s.vLastT);
  s.vLast = main;
  s.vLastT = t;
}

// Fold one input in. The input state is treated as immutable; a shallow clone
// is mutated and returned.
export function stepAxisGesture<Down, Cmd>(
  prev: AxisGestureState,
  input: AxisGestureInput<Down>,
  spec: AxisGestureSpec<Down, Cmd>,
): { state: AxisGestureState; commands: (CaptureCommand | Cmd)[] } {
  const s: AxisGestureState = { ...prev };
  const cmds: (CaptureCommand | Cmd)[] = [];

  switch (input.type) {
    case "pointerdown": {
      s.downCount += 1;
      if (s.downCount > 1) {
        // A second finger is a pinch or a two-finger scroll, never this.
        if (s.phase === "drag") cmds.push(spec.endCommand(s.distance, s.velocity, true));
        s.phase = "off";
        s.pointerId = null;
        break;
      }
      s.pointerId = input.id;
      s.startX = input.x;
      s.startY = input.y;
      s.distance = 0;
      s.velocity = 0;
      s.vLast = along(spec.axis, input.x, input.y);
      s.vLastT = input.t;
      s.phase = spec.canStart(input) ? "pending" : "off";
      break;
    }

    case "pointermove": {
      if (input.id !== s.pointerId) break;
      const main = along(spec.axis, input.x, input.y);
      updateVelocity(s, main, input.t);
      const travelled = main - along(spec.axis, s.startX, s.startY);

      if (s.phase === "pending") {
        const verdict = classifyAxisMove(
          travelled,
          across(spec.axis, input.x, input.y) - across(spec.axis, s.startX, s.startY),
          spec.slop,
          spec.axisRatio,
        );
        if (verdict === "abandon") {
          s.phase = "off";
          break;
        }
        if (verdict === "wait") break;
        s.phase = "drag";
        s.distance = Math.max(0, travelled);
        cmds.push({ type: "capture", id: input.id });
        cmds.push(spec.moveCommand(s.distance));
        break;
      }

      if (s.phase === "drag") {
        // Clamped at rest: dragging back past the start must not push the
        // surface off the other side, it must only undo the drag.
        s.distance = Math.max(0, travelled);
        cmds.push(spec.moveCommand(s.distance));
      }
      break;
    }

    case "pointerup":
    case "pointercancel": {
      const mine = input.id === s.pointerId;
      s.downCount = Math.max(0, s.downCount - 1);
      if (mine && s.phase === "drag") {
        if (input.type === "pointerup") {
          updateVelocity(s, along(spec.axis, input.x, input.y), input.t);
        }
        cmds.push(spec.endCommand(s.distance, s.velocity, input.type === "pointercancel"));
      }
      if (mine) s.pointerId = null;
      // Only a clear screen returns the machine to idle: a finger left over
      // from an abandoned gesture must not start a new one mid-way.
      if (s.downCount === 0) return { state: initAxisGestureState(), commands: cmds };
      s.phase = "off";
      break;
    }
  }

  return { state: s, commands: cmds };
}
