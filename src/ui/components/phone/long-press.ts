// A finger held still on one spot (docs/74). The phone lesson's one way into an
// aside: hold a paragraph of the reply and the "Ask about this" control appears
// over it.
//
// Same split as the other two phone gestures: the decision is a pure machine
// with no DOM in it, and the wiring underneath it is a binder that feeds the
// machine events and calls back when it fires. Unlike the swipe and the pull
// there is no axis and no distance here — the whole gesture is "nothing
// happened for long enough" — so the machine is a state and four events rather
// than the axis kit.
//
// What cancels it: a second finger, movement past the slop, the finger coming
// off early, a scroll under it, and the browser taking the pointer away. The
// first two are why this cannot be a bare `setTimeout` on pointerdown — a
// two-finger pinch and the start of a scroll both begin as one finger resting.

// How long the finger has to stay down. The platform convention on both phones,
// and long enough that a tap on a citation is never mistaken for a hold.
export const LONG_PRESS_MS = 500;

// How far it may drift in the meantime, CSS px. The same 10 the edge swipe and
// the pull commit at: past that the reader is moving, not holding.
export const LONG_PRESS_SLOP = 10;

// The finger being watched. Null when nothing is.
export interface LongPressState {
  pointerId: number;
  x: number;
  y: number;
}

export type LongPressEvent =
  | { type: "down"; pointerId: number; x: number; y: number }
  | { type: "move"; pointerId: number; x: number; y: number }
  | { type: "up"; pointerId: number }
  // A scroll, a pointercancel, or anything else that ends the watch without a
  // pointer of its own.
  | { type: "cancel" }
  // The clock ran out. Raised by whoever owns the timer, so the machine itself
  // needs no notion of time.
  | { type: "elapsed" };

// What the host does about it. "arm" starts the timer, "disarm" clears it, and
// "fire" is the gesture.
export type LongPressAction = "arm" | "disarm" | "fire" | "none";

export interface LongPressStep {
  state: LongPressState | null;
  action: LongPressAction;
}

const NOTHING: LongPressStep = { state: null, action: "none" };

/**
 * One event against the watch. Pure: the caller keeps the state it returns and
 * does what the action says.
 *
 * A second finger disarms rather than being ignored. A pinch and a two-finger
 * scroll both start as one finger resting on the words, and a gesture that
 * fired through them would open a side conversation the reader was in the
 * middle of scrolling past.
 */
export function stepLongPress(
  state: LongPressState | null,
  event: LongPressEvent,
  slop: number = LONG_PRESS_SLOP,
): LongPressStep {
  switch (event.type) {
    case "down":
      // Down while one is already being watched is a second finger.
      if (state) return { state: null, action: "disarm" };
      return { state: { pointerId: event.pointerId, x: event.x, y: event.y }, action: "arm" };
    case "move": {
      if (!state) return NOTHING;
      // A move from another pointer means there is another pointer.
      if (event.pointerId !== state.pointerId) return { state: null, action: "disarm" };
      return Math.hypot(event.x - state.x, event.y - state.y) > slop
        ? { state: null, action: "disarm" }
        : { state, action: "none" };
    }
    case "up":
      if (!state) return NOTHING;
      if (event.pointerId !== state.pointerId) return { state: null, action: "disarm" };
      return { state: null, action: "disarm" };
    case "cancel":
      return state ? { state: null, action: "disarm" } : NOTHING;
    case "elapsed":
      // Fires once: the watch is over the moment it lands, so a stray second
      // tick cannot open two.
      return state ? { state: null, action: "fire" } : NOTHING;
  }
}

/** Where the finger was when the hold landed, and what it was resting on. */
export interface LongPress {
  target: EventTarget | null;
  x: number;
  y: number;
}

export interface LongPressOptions {
  onLongPress: (press: LongPress) => void;
  // Whether this pointerdown is on something worth watching. A press that is
  // not is never armed at all, so the timer never runs over the rest of the
  // screen.
  accepts?: (target: EventTarget | null) => boolean;
  // Felt rather than seen: the control appears under the reader's own finger,
  // which is the one place they are not looking.
  feedback?: () => void;
  ms?: number;
  slop?: number;
}

/**
 * Watch one element's subtree for a hold. Returns the unbind.
 *
 * The move, up and cancel listeners go on the document, not on the host: a
 * gesture elsewhere on the screen may call setPointerCapture and retarget the
 * rest of the sequence, and a host-bound listener would then never see the
 * finger come off (gesture-dom.ts says the same about the pull).
 *
 * Nothing here is preventDefault-ed and no touch is claimed. A hold is not a
 * movement, so it never competes with the scroller for the sequence — the
 * scroll listener below is the whole of the relationship: once the page under
 * the finger moves, the hold is off.
 */
export function bindLongPress(host: HTMLElement, opts: LongPressOptions): () => void {
  const ms = opts.ms ?? LONG_PRESS_MS;
  const slop = opts.slop ?? LONG_PRESS_SLOP;
  const doc = host.ownerDocument;
  let state: LongPressState | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let press: LongPress | null = null;

  const apply = (step: LongPressStep) => {
    state = step.state;
    if (step.action === "arm") {
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        apply(stepLongPress(state, { type: "elapsed" }, slop));
      }, ms);
      return;
    }
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    if (step.action !== "fire" || !press) return;
    opts.feedback?.();
    opts.onLongPress(press);
  };

  const onDown = (e: PointerEvent) => {
    if (state === null && opts.accepts && !opts.accepts(e.target)) return;
    press = { target: e.target, x: e.clientX, y: e.clientY };
    apply(stepLongPress(state, { type: "down", pointerId: e.pointerId, x: e.clientX, y: e.clientY }, slop));
  };
  const onMove = (e: PointerEvent) => {
    apply(stepLongPress(state, { type: "move", pointerId: e.pointerId, x: e.clientX, y: e.clientY }, slop));
  };
  const onUp = (e: PointerEvent) => {
    apply(stepLongPress(state, { type: "up", pointerId: e.pointerId }, slop));
  };
  const onCancel = () => apply(stepLongPress(state, { type: "cancel" }, slop));

  host.addEventListener("pointerdown", onDown, { capture: true });
  doc.addEventListener("pointermove", onMove, { capture: true });
  doc.addEventListener("pointerup", onUp, { capture: true });
  doc.addEventListener("pointercancel", onCancel, { capture: true });
  // Capture, because a scroll event does not bubble past the element that
  // scrolled: the conversation's own scroller is somewhere under the host.
  doc.addEventListener("scroll", onCancel, { capture: true });

  return () => {
    host.removeEventListener("pointerdown", onDown, { capture: true });
    doc.removeEventListener("pointermove", onMove, { capture: true });
    doc.removeEventListener("pointerup", onUp, { capture: true });
    doc.removeEventListener("pointercancel", onCancel, { capture: true });
    doc.removeEventListener("scroll", onCancel, { capture: true });
    if (timer !== null) clearTimeout(timer);
  };
}
