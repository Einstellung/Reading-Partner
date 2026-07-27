// Swipe-to-reveal for a list row: the drag that slides a row aside and uncovers
// the action hidden under it (the trace list's Delete). Pure and DOM-free, the
// same shape as reading/engine/touch-routing.ts — the row component binds the
// pointer events, hands the samples in, and executes the commands that come
// back. Nothing here knows about React or the DOM.
//
// The problem it exists to solve is the same one the reader's touch router
// solves, one layer up: two gestures share one surface. The trace list scrolls
// vertically (natively, it is an ordinary overflow-y container) and the row
// swipes horizontally, and a finger dragging across it means exactly one of the
// two. The axis decides, and it decides once — a gesture that has been given to
// the scroll never comes back as a swipe, and one classified as a swipe never
// falls through to the scroll.
//
// The reveal is not the delete. Uncovering the button is the first act and
// pressing it is the second, because a column of rows this easy to brush past
// would otherwise lose marks to a stray thumb. That two-step is the whole safety
// story: there is no undo behind it.

// Movement (CSS px) in either direction before the drag is classified. Below
// this the gesture is still a tap.
export const SWIPE_SLOP = 8;

// How far the row travels, i.e. how wide the revealed action is. Wide enough to
// press with a thumb without aiming.
export const SWIPE_ACTION_WIDTH = 88;

// The fraction of that width a release has to be past for the row to stay open.
// A drag that stops short snaps shut, so a half-hearted swipe leaves nothing
// armed behind it.
export const SWIPE_OPEN_RATIO = 0.5;

export interface SwipeConfig {
  width?: number;
  slop?: number;
  openRatio?: number;
}

type Cfg = Required<SwipeConfig>;

function resolve(config: SwipeConfig | undefined): Cfg {
  return {
    width: SWIPE_ACTION_WIDTH,
    slop: SWIPE_SLOP,
    openRatio: SWIPE_OPEN_RATIO,
    ...config,
  };
}

// --- pure helpers (exported for direct unit tests) --------------------------

// What a drag has turned out to be. "undecided" means it has not moved far
// enough to say yet.
export type SwipeAxis = "undecided" | "horizontal" | "vertical";

// Route by dominant axis. A tie goes to the list: the container scrolls
// natively, so an ambiguous drag is the browser's, and taking it would make the
// list feel like it sticks. The caller classifies once and holds the verdict for
// the rest of the gesture.
export function classifyDrag(dx: number, dy: number, slop: number = SWIPE_SLOP): SwipeAxis {
  if (Math.abs(dx) < slop && Math.abs(dy) < slop) return "undecided";
  return Math.abs(dx) > Math.abs(dy) ? "horizontal" : "vertical";
}

// The offset the row is allowed to sit at: fully closed (0) through fully open
// (-width). No rubber band past either end — a row that keeps giving under the
// finger reads as a drag that will do more than it does (a full-swipe delete,
// which this deliberately does not have).
export function clampOffset(raw: number, width: number = SWIPE_ACTION_WIDTH): number {
  return Math.min(0, Math.max(-width, raw));
}

// Where the row lands when the finger lifts: open or shut, never in between.
export function restingOffset(
  offset: number,
  width: number = SWIPE_ACTION_WIDTH,
  openRatio: number = SWIPE_OPEN_RATIO,
): number {
  return -offset >= width * openRatio ? -width : 0;
}

// What a click on the row body means. A row standing open swallows it to close
// itself: reaching past a revealed Delete to press the row means "not that", not
// "take me to this mark". A click that is the tail of a drag means nothing at
// all.
export function rowClickAction(open: boolean, dragged: boolean): "select" | "close" | "ignore" {
  if (dragged) return "ignore";
  return open ? "close" : "select";
}

// --- the machine ------------------------------------------------------------

// "closed"/"open" are the two resting states; "tracking" is a pointer down with
// the axis still undecided; "dragging" is a committed horizontal swipe following
// the pointer.
export type SwipePhase = "closed" | "tracking" | "dragging" | "open";

export interface SwipeState {
  phase: SwipePhase;
  pointerId: number | null;
  startX: number;
  startY: number;
  // The offset the row rested at when this gesture started, so a drag out of an
  // open row measures from where the row already is.
  baseOffset: number;
  offset: number;
}

export function initSwipeState(): SwipeState {
  return { phase: "closed", pointerId: null, startX: 0, startY: 0, baseOffset: 0, offset: 0 };
}

// Whether the action under the row is uncovered at all, i.e. whether to render
// it. True through the whole of an opening drag, not just at rest.
export function actionVisible(s: SwipeState): boolean {
  return s.offset < 0;
}

// The resting open-ness the list is tracking. Mid-gesture the row still counts
// as whatever it was when the pointer landed: that is the last thing the list
// was told, and a drag reports its verdict once, at the end.
export function trackedOpen(s: SwipeState): boolean {
  if (s.phase === "open") return true;
  if (s.phase === "closed") return false;
  return s.baseOffset < 0;
}

export type SwipeInput =
  | { type: "pointerdown"; id: number; x: number; y: number }
  | { type: "pointermove"; id: number; x: number; y: number }
  | { type: "pointerup"; id: number }
  | { type: "pointercancel"; id: number }
  // Open with no drag at all: the affordance a mouse gets, since dragging a list
  // row sideways is not something a desktop reader would ever think to try.
  | { type: "open" }
  // Shut it from outside: another row opened, the list scrolled away, the delete
  // fired, the drawer closed.
  | { type: "close" };

export type SwipeCommand =
  // Own the pointer for the rest of the gesture, so a finger that wanders off
  // the row keeps driving it.
  | { type: "capture"; id: number }
  | { type: "releaseCapture"; id: number }
  | { type: "preventDefault" }
  // The click this drag ends with is not a tap on the row; the host swallows the
  // next one.
  | { type: "suppressClick" }
  // The row came to rest open or shut. The list keeps at most one row open, so
  // it needs to hear about it.
  | { type: "openChanged"; open: boolean };

// Fold one input into the machine. The input state is treated as immutable.
export function stepSwipe(
  prev: SwipeState,
  input: SwipeInput,
  config?: SwipeConfig,
): { state: SwipeState; commands: SwipeCommand[] } {
  const cfg = resolve(config);
  const s: SwipeState = { ...prev };
  const cmds: SwipeCommand[] = [];
  const wasOpen = trackedOpen(prev);

  // Come to rest at the given offset, releasing whatever the gesture held and
  // announcing the resting state only when it actually changed.
  const settle = (offset: number) => {
    if (s.phase === "dragging" && s.pointerId !== null) {
      cmds.push({ type: "releaseCapture", id: s.pointerId });
    }
    s.offset = offset;
    s.phase = offset < 0 ? "open" : "closed";
    s.pointerId = null;
    s.baseOffset = offset;
    if ((s.phase === "open") !== wasOpen) cmds.push({ type: "openChanged", open: s.phase === "open" });
  };

  switch (input.type) {
    case "pointerdown": {
      // A second pointer landing mid-gesture is not a second swipe.
      if (s.phase === "tracking" || s.phase === "dragging") break;
      s.phase = "tracking";
      s.pointerId = input.id;
      s.startX = input.x;
      s.startY = input.y;
      s.baseOffset = s.offset;
      break;
    }

    case "pointermove": {
      if (s.pointerId !== input.id) break;
      if (s.phase === "tracking") {
        const axis = classifyDrag(input.x - s.startX, input.y - s.startY, cfg.slop);
        if (axis === "undecided") break;
        if (axis === "vertical") {
          // The list's own scroll. Nothing was captured, so the scroll the
          // browser has already begun simply continues; this row drops out of
          // the gesture and does not rejoin it however far it later travels
          // sideways.
          s.phase = s.baseOffset < 0 ? "open" : "closed";
          s.pointerId = null;
          break;
        }
        s.phase = "dragging";
        cmds.push({ type: "capture", id: input.id }, { type: "suppressClick" });
      }
      if (s.phase === "dragging") {
        s.offset = clampOffset(s.baseOffset + (input.x - s.startX), cfg.width);
        cmds.push({ type: "preventDefault" });
      }
      break;
    }

    case "pointerup": {
      if (s.pointerId !== input.id) break;
      // A tap that never committed leaves the row exactly as it found it.
      settle(s.phase === "dragging" ? restingOffset(s.offset, cfg.width, cfg.openRatio) : s.baseOffset);
      break;
    }

    case "pointercancel": {
      if (s.pointerId !== input.id) break;
      // A gesture taken away is not a gesture released: the row goes back to
      // where it started rather than committing to a half-finished swipe.
      settle(s.baseOffset);
      break;
    }

    case "open": {
      if (s.phase === "dragging" || s.phase === "tracking") break;
      settle(-cfg.width);
      break;
    }

    case "close": {
      settle(0);
      break;
    }
  }

  return { state: s, commands: cmds };
}
