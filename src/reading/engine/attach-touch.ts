// The reader's touch router, everything of it that touches the DOM. Attached to
// the scroll container the EmbedPDF viewport mounted; the component next door in
// EmbedPdfView.tsx does nothing but wait for that element to appear and call
// this, so the whole of the routing lives in one place a test can reach.
//
// None of the physics is here. touch-routing.ts holds the pen/finger table,
// vertical-gesture.ts the follow-scroll with its inertia and its bounce,
// paged-gesture.ts the page flip, rubber-band.ts the spring — all pure, all
// tested on their own. This file is the wiring: which element, which listener
// with which flags, which rAF, and which command becomes which write.

import type { MutableRefObject } from "react";

import {
  initGestureState,
  stepGesture,
  type GestureCommand,
  type GestureInput,
  type GestureState,
} from "./paged-gesture";
import {
  planFinger,
  planPointer,
  pointerKindOf,
  routesAsContact,
  toolKindOf,
  pagedGestureTool,
  touchGestureMode,
  multiTouchLatch,
  pinchHandsOff,
  fingerLockAfterPen,
  fingerVerdict,
  centroidOf,
  shouldClearGestureSelection,
  shouldHandEngineTheUp,
  type PointerPlan,
} from "./touch-routing";
import {
  initVerticalState,
  stepVertical,
  verticalNeedsFrames,
  type VerticalCommand,
  type VerticalInput,
  type VerticalState,
} from "./vertical-gesture";
import {
  BAND_REST,
  bandAtRest,
  bandTransform,
  stepBandSpring,
  type BandOffset,
} from "./rubber-band";
import { INDICATOR_FADE_AFTER_MS, thumbMetrics } from "./scroll-indicator";
import { isTouchDebugEnabled, publishTouchDebug, type TouchDebugContact } from "./touch-debug";
import type { PagedGestureCtx } from "./types";

// Long press (ms) before a stationary finger in paged mode is handed to native
// text selection instead of being watched for a page swipe.
const PAGED_LONG_PRESS_MS = 450;

// Pointer events on the scroll container are routed by device type and finger
// count — decisions CSS touch-action cannot make (it cannot tell pen from
// finger, or one finger from two).
//
// Which pointers this router drives as its own contacts is routesAsContact's call:
// fingers always, the stylus only while the navigation lock is on (there it is
// a finger in every respect), the mouse never — so the desktop is untouched.
// Everything else falls straight through to the engine's drawing / selection
// paths.
//
// Contact count decides the gesture (touch-routing.ts holds the table):
//   1  the single-pointer machines below (scroll / draw / page flip);
//   2  pinch — zoom is the engine's own ZoomGestureWrapper, which drives itself
//      off raw touch events and never consults the interaction manager, so it
//      keeps working while every finger pointer event is eaten here; the pan
//      that goes with it follows the two-finger centroid;
//   3+ swallowed whole, reserved for a future gesture.
// A gesture that ever had two fingers stays locked until the last finger lifts,
// so 2 -> 3 -> 2 is one gesture and the leftover finger never becomes a scroll.
//
// Blocking is per pointer (stopPropagation in the capture phase), not the
// interaction manager's global pause: pause would also stop a pen mid-stroke,
// and the resting hand has to go dead while the pen keeps drawing (the pen lock
// above does that). Invariant: a finger whose pointerdown reached the engine
// always gets its pointerup too, or the engine's per-page selection handler
// keeps a stale text anchor.
//
// There is no palm rejection: iPadOS withholds touch from the page while the
// Pencil is down and reports no usable contact geometry, so palm suppression is
// neither possible nor needed here (docs/pitfall/39).
//
// Both layouts get the single pointer's job from the same planPointer call, so
// the two branches cannot drift apart on the routing policy or on when the
// engine is shut off (an annotation tool pauses it at pointerdown, before the
// stroke's lead-in can leave ink; with no drawing tool active the pause waits
// for the commit so a stationary tap still reaches the engine).
//
// Vertical (continuous) mode — the main path: a finger planned as "scroll" runs
// the pure vertical machine (vertical-gesture.ts), which captures the pointer,
// follows the finger by setting scrollTop/scrollLeft and coasts on release.
// Because the page divs carry touch-action:none in every mode, native scroll is
// impossible over a page, so the scroll is driven in JS. A finger planned as
// "draw" (annotation tool, no stylus seen) is left alone and reaches the
// annotation layer.
//
// Paged (horizontal flip) mode: runs the pure gesture machine (paged-gesture.ts)
// on finger pointers — follow-finger drags set scrollLeft, a committed turn goes
// through turnToPage (centre the page, re-lock fit-page), a magnified page pans,
// and a swipe with nowhere to go rubber-bands instead of freezing.
export function attachTouchRouter(
  el: HTMLDivElement,
  { documentId, ctx }: { documentId: string; ctx: MutableRefObject<PagedGestureCtx> },
): () => void {
  // --- contact bookkeeping (shared by both layout machines) -----------
  // Live contacts this router drives, in arrival order (fingers always, and
  // the stylus under the navigation lock). Its size is the finger count the
  // gesture rules run on. Each carries the plan it landed with, so a tool
  // change mid-gesture can never split one pointer's lifetime across two
  // policies.
  const fingers = new Map<number, { x: number; y: number; plan: PointerPlan }>();
  // Fingers whose pointerdown the engine saw, so their pointerup is let
  // through even if the gesture has since been taken over — and, when the
  // router takes the gesture over instead, so the engine can be handed that
  // up itself. The element is the one the down was dispatched on, which is
  // where the synthetic up has to go.
  const engineSaw = new Map<
    number,
    { target: EventTarget; type: string; x: number; y: number }
  >();
  // True only while the synthetic pointerup below is being dispatched: it
  // travels through this router's own listeners on the way to the page.
  let synthesizing = false;
  // Every live contact (pen included), for the on-device probe only.
  const contacts = new Map<number, TouchDebugContact>();
  // Latched once a second finger lands, cleared when the glass is empty.
  let multiTouch = false;
  // Latched when a pen lands on top of resting fingers: they are dead until
  // they all lift.
  let penLock = false;
  // Whether a text selection was already on screen when this gesture began
  // (a pen selection with its AI menu open must survive a finger scroll).
  let hadSelectionAtStart = false;
  // Centroid the two-finger pan measures from.
  let panBase: { x: number; y: number } | null = null;

  // --- paged (horizontal flip) gesture machine state ------------------
  let state: GestureState = initGestureState();
  let captured = false;
  let capturedId: number | null = null;
  let enginePaused = false;
  let dragStartScrollLeft = 0;
  let dragStartPage = 1;
  let lpTimer = 0;
  // Rubber band: a CSS translate on the scroll content, sprung back by rAF.
  let band: BandOffset = BAND_REST;
  let bandRaf = 0;

  // --- vertical follow-finger scroll state ----------------------------
  // The machine holds the phase, the follow origin, the velocity, the
  // inertia and the overscroll; this side owns only the rAF that drives
  // them forward and the two elements they are painted on.
  let vState: VerticalState = initVerticalState();
  let flingRaf = 0;
  let flingLast = 0;
  // Fingers whose gesture this router took over mid-flight (the survivor of
  // a pinch): the engine never saw their pointerdown, so it must not see
  // their pointerup either.
  const orphaned = new Set<number>();

  const clearLp = () => {
    if (lpTimer) {
      window.clearTimeout(lpTimer);
      lpTimer = 0;
    }
  };
  // The engine's pointer pipeline is paused only for the single-finger
  // paths that need it (an annotation tool must not start a stroke under a
  // scrolling finger). Everything multi-touch blocks per pointer instead.
  const pauseEngine = () => {
    if (!enginePaused) {
      ctx.current.interaction?.pause();
      enginePaused = true;
    }
  };
  const resumeEngine = () => {
    if (enginePaused) {
      ctx.current.interaction?.resume();
      enginePaused = false;
    }
  };
  const releaseCapture = () => {
    captured = false;
    if (capturedId !== null) {
      try {
        el.releasePointerCapture(capturedId);
      } catch {
        // The pointer may already be gone; ignore.
      }
      capturedId = null;
    }
  };
  // --- paged rubber band ------------------------------------------------
  // Offset and spring physics live in rubber-band.ts; this side owns the
  // element and the rAF.
  const bandTarget = (): HTMLElement | null => el.firstElementChild as HTMLElement | null;
  const paintBand = () => {
    const t = bandTarget();
    if (!t) return;
    t.style.transform = bandTransform(band);
  };
  const cancelBandSpring = () => {
    if (bandRaf) {
      cancelAnimationFrame(bandRaf);
      bandRaf = 0;
    }
  };
  const setBand = (x: number, y: number) => {
    cancelBandSpring();
    band = { x, y };
    paintBand();
  };
  const clearBand = () => {
    cancelBandSpring();
    if (bandAtRest(band)) return;
    band = BAND_REST;
    paintBand();
  };
  const springBand = () => {
    cancelBandSpring();
    let last = performance.now();
    const step = (now: number) => {
      const dt = now - last;
      last = now;
      band = stepBandSpring(band, dt);
      paintBand();
      if (bandAtRest(band)) {
        bandRaf = 0;
        return;
      }
      bandRaf = requestAnimationFrame(step);
    };
    bandRaf = requestAnimationFrame(step);
  };

  // --- vertical rubber band --------------------------------------------
  // Paged bands the scroll CONTENT; vertical cannot (docs/pitfall/45): a
  // translate on the content changes the container's scrollable overflow,
  // and at the end of a scrollable document the browser's own re-clamp of
  // scrollTop cancels the offset exactly. The scroll container itself is
  // moved instead — its geometry is unaffected by its own transform — and
  // the wrapper around it clips the gap that opens up.
  let vBandY = 0;
  let vBandX = 0;
  const setViewportBand = (x: number, y: number) => {
    if (x === vBandX && y === vBandY) return;
    vBandX = x;
    vBandY = y;
    // Same rule as the paged band: a plain style write, never a CSS
    // transition (docs/pitfall/41), and cleared to "" at rest.
    el.style.transform = bandTransform({ x, y });
  };
  const clearViewportBand = () => setViewportBand(0, 0);

  // --- scroll indicator -------------------------------------------------
  // Fades in on movement and out again when it stops. Driven off the
  // container's own scroll event, so it follows a page jump and the
  // engine's smooth scrolls as well as a finger.
  let indicatorTimer = 0;
  const hideIndicator = () => {
    indicatorTimer = 0;
    const bar = ctx.current.indicator;
    if (bar) bar.style.opacity = "0";
  };
  const paintIndicator = () => {
    const bar = ctx.current.indicator;
    if (!bar) return;
    const m = thumbMetrics(el.scrollTop, el.clientHeight, el.scrollHeight);
    if (!m) {
      bar.style.opacity = "0";
      return;
    }
    bar.style.height = `${m.size}px`;
    bar.style.transform = `translateY(${m.offset}px)`;
    bar.style.opacity = "1";
    if (indicatorTimer) window.clearTimeout(indicatorTimer);
    indicatorTimer = window.setTimeout(hideIndicator, INDICATOR_FADE_AFTER_MS);
  };

  const setTouchLock = (locked: boolean) => {
    el.style.touchAction = locked ? "none" : "";
    // Switching layout mid-gesture must not leave a band offset behind.
    clearBand();
    clearViewportBand();
  };
  ctx.current.setTouchLock = setTouchLock;
  ctx.current.viewport = el;
  setTouchLock(ctx.current.paged);

  // --- selection hygiene ----------------------------------------------
  const hasSelection = (): boolean => {
    try {
      return (ctx.current.selection?.getBoundingRects(documentId).length ?? 0) > 0;
    } catch {
      return false;
    }
  };
  // Drop a selection this finger gesture caused on its way in: the engine
  // can start a text drag inside the few px before the gesture is taken
  // over. A selection that was already there is left alone.
  const dropGestureSelection = () => {
    if (shouldClearGestureSelection(hadSelectionAtStart, hasSelection())) {
      ctx.current.selection?.clear(documentId);
    }
  };
  // Hand the engine the pointerup it is owed for a pointer this router is
  // taking over. Without it the engine's per-page text handler keeps the
  // anchor it armed at pointerdown — the capture retargets every later event
  // to the viewport, so its own up never comes — and the next move it does
  // see selects everything between that stale anchor and the pointer
  // (docs/pitfall/38). Dropping the selection does not do this: that clears
  // the plugin, not the handler holding the anchor.
  const handEngineTheUp = (id: number) => {
    const seen = engineSaw.get(id);
    if (!seen || !shouldHandEngineTheUp(seen !== undefined, enginePaused)) return;
    engineSaw.delete(id);
    synthesizing = true;
    try {
      seen.target.dispatchEvent(
        new PointerEvent("pointerup", {
          pointerId: id,
          pointerType: seen.type,
          bubbles: true,
          cancelable: true,
          clientX: seen.x,
          clientY: seen.y,
        }),
      );
    } finally {
      synthesizing = false;
    }
  };

  // --- paged apply / feed ---------------------------------------------
  const apply = (cmds: GestureCommand[]) => {
    const scroll = ctx.current.scroll;
    for (const c of cmds) {
      if (c.type === "capture") {
        captured = true;
        capturedId = c.id;
        // Before the pause and the capture, both of which cut the engine off
        // from this pointer for good.
        handEngineTheUp(c.id);
        try {
          el.setPointerCapture(c.id);
        } catch {
          // Best effort — the pause below is the real selection guard.
        }
        pauseEngine();
        dropGestureSelection();
        dragStartScrollLeft = el.scrollLeft;
        dragStartPage = scroll?.getCurrentPage() ?? 1;
      } else if (c.type === "dragMove") {
        el.scrollLeft = dragStartScrollLeft - c.dx;
      } else if (c.type === "panMove") {
        el.scrollLeft -= c.dx;
        el.scrollTop -= c.dy;
      } else if (c.type === "bandMove") {
        setBand(c.dx, c.dy);
      } else if (c.type === "bandEnd") {
        springBand();
      } else if (c.type === "dragEnd") {
        const total = scroll?.getTotalPages() ?? 1;
        const target = Math.min(Math.max(dragStartPage + c.turn, 1), total);
        // Always through turnToPage: it centres the page and re-locks
        // fit-page, so a turn out of a temporary magnification lands on one
        // whole page again.
        ctx.current.turnToPage?.(target);
        captured = false;
      }
    }
  };

  const feed = (input: GestureInput, e?: Event) => {
    const scroll = ctx.current.scroll;
    const page = scroll?.getCurrentPage() ?? 1;
    const total = scroll?.getTotalPages() ?? 1;
    const r = stepGesture(state, input, {
      tool: pagedGestureTool(toolKindOf(ctx.current.tool), ctx.current.fingerDraw),
      zoomedIn: ctx.current.zoomedIn,
      width: el.clientWidth || window.innerWidth,
      canTurnPrev: page > 1,
      canTurnNext: page < total,
      canPanLeft: el.scrollLeft > 1,
      canPanRight: el.scrollLeft < maxScrollLeft() - 1,
    });
    state = r.state;
    if (r.commands.some((c) => c.type === "capture")) clearLp();
    apply(r.commands);
    if (captured && e && e.cancelable) e.preventDefault();
    if (state.phase === "idle" || state.phase === "off") {
      resumeEngine();
      releaseCapture();
    }
  };

  // --- vertical scroll helpers ----------------------------------------
  const maxScrollTop = () => Math.max(0, el.scrollHeight - el.clientHeight);
  const clampTop = (v: number) => Math.min(Math.max(v, 0), maxScrollTop());
  const maxScrollLeft = () => Math.max(0, el.scrollWidth - el.clientWidth);
  const clampLeft = (v: number) => Math.min(Math.max(v, 0), maxScrollLeft());
  const cancelFlingRaf = () => {
    if (flingRaf) {
      cancelAnimationFrame(flingRaf);
      flingRaf = 0;
    }
  };

  // --- vertical apply / feed -------------------------------------------
  // The live scroll geometry the machine measures the follow against and
  // clamps both the follow and the coast to.
  const verticalGeometry = () => ({
    scrollTop: el.scrollTop,
    scrollLeft: el.scrollLeft,
    maxScrollTop: maxScrollTop(),
    maxScrollLeft: maxScrollLeft(),
  });
  const applyVertical = (cmds: VerticalCommand[], e?: PointerEvent) => {
    for (const c of cmds) {
      if (c.type === "pause") {
        pauseEngine();
      } else if (c.type === "resume") {
        resumeEngine();
      } else if (c.type === "releaseEnginePointer") {
        handEngineTheUp(c.id);
      } else if (c.type === "dropSelection") {
        dropGestureSelection();
      } else if (c.type === "capture") {
        try {
          el.setPointerCapture(c.id);
        } catch {
          // Best effort — the pause is the real draw guard.
        }
      } else if (c.type === "releaseCapture") {
        if (c.id !== null) {
          try {
            el.releasePointerCapture(c.id);
          } catch {
            // The pointer may already be gone; ignore.
          }
        }
      } else if (c.type === "scrollTo") {
        el.scrollTop = c.top;
        el.scrollLeft = c.left;
      } else if (c.type === "band") {
        setViewportBand(c.x, c.y);
      } else if (c.type === "preventDefault") {
        if (e?.cancelable) e.preventDefault();
      } else if (c.type === "startFling") {
        cancelFlingRaf();
        flingLast = performance.now();
        flingRaf = requestAnimationFrame(flingFrame);
      } else if (c.type === "stopFling") {
        cancelFlingRaf();
      }
    }
  };
  const feedVertical = (input: VerticalInput, e?: PointerEvent) => {
    const r = stepVertical(vState, input, verticalGeometry());
    vState = r.state;
    applyVertical(r.commands, e);
  };
  // One frame of whatever outlives the finger — the inertia, the rubber
  // band springing home, or the inertia being absorbed by it. The machine
  // decides when there is nothing left to do; this side only keeps asking
  // for frames while there is (hoisted so applyVertical can schedule it).
  function flingFrame(now: number): void {
    flingRaf = 0;
    const dt = now - flingLast;
    flingLast = now;
    feedVertical({ type: "flingFrame", dt });
    if (verticalNeedsFrames(vState)) flingRaf = requestAnimationFrame(flingFrame);
  }
  // Everything the two one-finger machines hold: inertia, the long-press
  // timer, the paged machine's phase, the rubber band, the pointer capture
  // and the engine pause. Dropped as one unit, unconditionally — a caller
  // that reset half of it (or reset the paged machine only while paged was
  // still the live layout) would leave a phase behind that the next gesture
  // inherits.
  const resetGestures = () => {
    clearLp();
    state = initGestureState();
    captured = false;
    // A band in flight is dropped outright: leaving a transform on the
    // element the pinch preview also writes would offset the zoom anchor.
    clearBand();
    releaseCapture();
    orphaned.clear();
    feedVertical({ type: "reset" });
    clearViewportBand();
  };
  ctx.current.resetGestures = resetGestures;

  // The one-finger gesture loses the glass (a second finger, a pen). Both
  // machines go idle and the engine gets its pipeline back
  // — from here on the fingers are blocked one pointer at a time, which
  // leaves a pen free to keep drawing.
  const suspendFingerGesture = () => {
    clearLp();
    if (
      ctx.current.paged &&
      state.primary !== null &&
      (state.phase === "drag" || state.phase === "pan" || state.phase === "band")
    ) {
      // Spring the drag back before dropping it, so the page does not stay
      // parked half-turned.
      feed({ type: "pointercancel", id: state.primary });
    }
    resetGestures();
  };
  // The pinch is down to its last finger. That finger keeps moving the page
  // as a one-finger pan, from where it is — no jump, and no waiting for the
  // glass to empty. The gesture is synthesized, not replayed: the machine
  // gets a pointerdown at the finger's live position with `takeover`, which
  // skips the slop and starts following on the next move.
  const handOffToOneFinger = () => {
    const id = [...fingers.keys()][0];
    const f = fingers.get(id);
    if (f === undefined) return;
    const plan = f.plan;
    // With "draw with your finger" on, a lone finger marks the page; it has
    // no page-moving gesture to inherit, and the engine never saw its down,
    // so it stays out of the way until it lifts.
    if (plan.action !== "scroll") return;
    // The pinch already dropped whatever the fingers selected on the way in;
    // whatever is on screen now predates this gesture and must survive it.
    hadSelectionAtStart = hasSelection();
    // The engine never saw this pointer's down (the pinch swallowed it), so
    // it must not see its up either.
    orphaned.add(id);
    const t = performance.now();
    if (ctx.current.paged) {
      feed({ type: "pointerdown", id, x: f.x, y: f.y, t, takeover: true });
    } else {
      feedVertical({
        type: "pointerdown",
        id,
        x: f.x,
        y: f.y,
        t,
        plan,
        takeover: true,
      });
    }
  };
  // Two-finger pan: the content follows the centroid of the two fingers.
  // Zoom is the engine's wrapper; this only moves the scroll container, and
  // the wrapper resolves its zoom anchor against the live scroll position
  // when the pinch commits, so the two compose.
  const resetPanBase = () => {
    panBase = null;
  };
  const panStep = () => {
    const c = centroidOf([...fingers.values()]);
    if (!c) return;
    if (panBase) {
      el.scrollTop = clampTop(el.scrollTop - (c.y - panBase.y));
      el.scrollLeft = clampLeft(el.scrollLeft - (c.x - panBase.x));
    }
    panBase = c;
  };
  // --- probe -----------------------------------------------------------
  const publishDebug = () => {
    if (!isTouchDebugEnabled()) return;
    publishTouchDebug({
      contacts: [...contacts.values()],
      fingers: fingers.size,
      mode: touchGestureMode(fingers.size),
      multi: multiTouch,
      penLock,
      fingerDraw: ctx.current.fingerDraw,
      // What the next finger to land will do, from the same routing table
      // the router itself uses — the one number that says whether a dead
      // swipe is a routing verdict or something further down.
      fingerPlan: planFinger(toolKindOf(ctx.current.tool), ctx.current.fingerDraw).action,
      navLock: toolKindOf(ctx.current.tool) === "navlock",
    });
  };
  const trackContact = (e: PointerEvent) => {
    contacts.set(e.pointerId, {
      id: e.pointerId,
      type: e.pointerType,
      width: e.width,
      height: e.height,
    });
  };

  // --- shared dispatch ------------------------------------------------
  // Eat the event here: the engine's page providers sit below this capture
  // listener, so stopping propagation is a per-contact block (unlike the
  // interaction manager's pause, which is global and would freeze the pen).
  const swallow = (e: PointerEvent) => {
    e.stopPropagation();
  };

  // A stylus the router does not drive outranks every finger on the glass:
  // the finger scroll and its fling stop dead, and the fingers already down
  // go inert until they lift, so the hand a user writes with cannot
  // interrupt the stroke. Under the navigation lock the stylus is a contact
  // like any other and never gets here.
  const onPenDown = (e: PointerEvent) => {
    trackContact(e);
    feedVertical({ type: "cancelFling" });
    if (fingers.size > 0) suspendFingerGesture();
    penLock = fingerLockAfterPen(penLock, true, fingers.size);
    resetPanBase();
    publishDebug();
  };

  const onDown = (e: PointerEvent) => {
    if (synthesizing) return;
    const kind = pointerKindOf(e.pointerType);
    const tool = toolKindOf(ctx.current.tool);
    // Whether this pointer becomes one of our contacts is latched here, by
    // the `fingers` map: toggling the navigation lock mid-gesture can never
    // split one pointer's lifetime across the two code paths.
    // One plan for both layouts and both devices: what this pointer is for,
    // whether the engine has to be shut off before it can mark the page, and
    // whether the engine may watch it move at all.
    const plan = planPointer(tool, kind, ctx.current.fingerDraw);
    if (!routesAsContact(tool, kind)) {
      if (kind === "pen") onPenDown(e);
      return;
    }
    fingers.set(e.pointerId, { x: e.clientX, y: e.clientY, plan });
    trackContact(e);
    const wasMulti = multiTouch;
    multiTouch = multiTouchLatch(multiTouch, fingers.size);
    publishDebug();
    if (fingerVerdict(touchGestureMode(fingers.size), multiTouch, penLock) === "swallow") {
      swallow(e);
      if (!wasMulti) {
        // The one-finger machine hands the gesture over. Entering a pinch
        // also drops whatever that finger selected on the way in; a finger
        // landing under a working pen must not touch the selection.
        suspendFingerGesture();
        if (multiTouch) dropGestureSelection();
      }
      resetPanBase();
      return;
    }
    hadSelectionAtStart = hasSelection();
    if (ctx.current.paged) {
      if (plan.pauseAtDown) pauseEngine();
      feed({ type: "pointerdown", id: e.pointerId, x: e.clientX, y: e.clientY, t: e.timeStamp });
      clearLp();
      // The long press hands off to native text selection: only with no tool
      // selected, at fit-page (an annotation tool's engine pipeline is
      // already shut off, the navigation lock selects nothing, a zoomed page
      // is panning).
      if (plan.longPressSelect && !ctx.current.zoomedIn) {
        const id = e.pointerId;
        lpTimer = window.setTimeout(() => feed({ type: "longpress", id }), PAGED_LONG_PRESS_MS);
      }
    } else {
      // The vertical machine takes the plan with the pointer: a "draw" plan
      // never enters it, an annotation tool's plan pauses the engine there.
      feedVertical({
        type: "pointerdown",
        id: e.pointerId,
        x: e.clientX,
        y: e.clientY,
        t: e.timeStamp,
        plan,
      });
    }
    // Only a down the engine actually received owes it an up.
    if (!enginePaused && e.target) {
      engineSaw.set(e.pointerId, {
        target: e.target,
        type: e.pointerType,
        x: e.clientX,
        y: e.clientY,
      });
    }
  };

  const onMove = (e: PointerEvent) => {
    if (synthesizing) return;
    const f = fingers.get(e.pointerId);
    // Not a contact this router drives: a mouse, a stylus outside the
    // navigation lock, or a finger that landed before this listener existed.
    if (!f) return;
    f.x = e.clientX;
    f.y = e.clientY;
    trackContact(e);
    publishDebug();
    const mode = touchGestureMode(fingers.size);
    if (fingerVerdict(mode, multiTouch, penLock) === "swallow") {
      swallow(e);
      if (mode === "pinch" && !penLock) panStep();
      return;
    }
    // Under the navigation lock the engine never sees the drag, so it cannot
    // pull a text selection along behind the scroll. Its pointerdown and
    // pointerup still go through, so a tap under the lock still works.
    if (!f.plan.engineMayDrag) swallow(e);
    if (ctx.current.paged) {
      feed({ type: "pointermove", id: e.pointerId, x: e.clientX, y: e.clientY, t: e.timeStamp }, e);
    } else {
      feedVertical(
        { type: "pointermove", id: e.pointerId, x: e.clientX, y: e.clientY, t: e.timeStamp },
        e,
      );
    }
  };

  const onEnd = (e: PointerEvent, cancelled: boolean) => {
    if (synthesizing) return;
    const wasContact = contacts.delete(e.pointerId);
    const leaving = fingers.get(e.pointerId);
    const known = fingers.delete(e.pointerId);
    if (!known && pointerKindOf(e.pointerType) !== "touch") {
      // A pointer this router never drove (a mouse, or a stylus outside the
      // navigation lock): the engine owns its whole lifetime.
      if (wasContact) publishDebug();
      return;
    }
    resetPanBase();
    const owedToEngine = engineSaw.delete(e.pointerId);
    // A pinch coming down to one finger hands that finger the gesture right
    // here: from the next event on it is an ordinary one-finger contact.
    // The finger that just lifted is still judged as part of the pinch
    // (wasMulti), so the engine does not get its bare pointerup.
    const wasMulti = multiTouch;
    if (pinchHandsOff(multiTouch, fingers.size, penLock)) {
      multiTouch = false;
      handOffToOneFinger();
    }
    // A pointer this router took over mid-gesture: the engine has no
    // matching down for it, so it must not see the up either.
    if (orphaned.delete(e.pointerId)) swallow(e);
    if (!known) {
      swallow(e);
    } else if (penLock) {
      // A pen is working: nothing from the resting hand reaches the engine.
      // Its handlers track no pointerId, so even a bare pointerup would end
      // the stroke the pen is in the middle of.
      swallow(e);
    } else if (wasMulti) {
      // Taken over mid-gesture: the engine only gets this up if it saw the
      // matching down, so its selection handler cannot keep a stale anchor.
      if (!owedToEngine) swallow(e);
    } else if (ctx.current.paged) {
      clearLp();
      feed(
        cancelled
          ? { type: "pointercancel", id: e.pointerId }
          : { type: "pointerup", id: e.pointerId, x: e.clientX, y: e.clientY, t: e.timeStamp },
        e,
      );
    } else {
      feedVertical(
        cancelled
          ? { type: "pointercancel", id: e.pointerId }
          : // The release position matters: the last few px between the
            // final pointermove and the lift are part of the throw.
            { type: "pointerup", id: e.pointerId, x: e.clientX, y: e.clientY, t: e.timeStamp },
      );
    }
    // Belt to the navigation lock's braces: the engine saw this pointer's
    // down even though it never saw it move, and a bare down can still leave
    // a caret behind. A selection that predates the gesture is kept.
    if (leaving && !leaving.plan.engineMayDrag) dropGestureSelection();
    multiTouch = multiTouchLatch(multiTouch, fingers.size);
    penLock = fingerLockAfterPen(penLock, false, fingers.size);
    if (fingers.size === 0) engineSaw.clear();
    publishDebug();
  };
  const onUp = (e: PointerEvent) => onEnd(e, false);
  const onCancel = (e: PointerEvent) => onEnd(e, true);
  // The synthetic up is meant for the page below and is stopped here on its
  // way back out, so nothing outside the viewport takes it for a real lift
  // while the finger is still down.
  const containSynthetic = (e: PointerEvent) => {
    if (synthesizing) e.stopPropagation();
  };

  // Capture phase: see the pointer before the page's PagePointerProvider, and
  // keep receiving moves after it (the container is an ancestor of the page,
  // so events still travel through it even once a page captures the pointer).
  el.addEventListener("pointerdown", onDown, { capture: true });
  el.addEventListener("pointermove", onMove, { capture: true, passive: false });
  el.addEventListener("pointerup", onUp, { capture: true });
  el.addEventListener("pointercancel", onCancel, { capture: true });
  el.addEventListener("pointerup", containSynthetic);
  el.addEventListener("scroll", paintIndicator, { passive: true });
  return () => {
    clearLp();
    if (indicatorTimer) window.clearTimeout(indicatorTimer);
    hideIndicator();
    el.removeEventListener("scroll", paintIndicator);
    clearBand();
    releaseCapture();
    feedVertical({ type: "reset" });
    clearViewportBand();
    ctx.current.setTouchLock = null;
    ctx.current.resetGestures = null;
    ctx.current.viewport = null;
    el.style.touchAction = "";
    el.style.transform = "";
    // A settle may have been holding the page area back when the router let
    // go of the element (docs/pitfall/63). Nothing else would clear it.
    el.style.visibility = "";
    el.removeEventListener("pointerdown", onDown, { capture: true });
    el.removeEventListener("pointermove", onMove, { capture: true });
    el.removeEventListener("pointerup", onUp, { capture: true });
    el.removeEventListener("pointercancel", onCancel, { capture: true });
    el.removeEventListener("pointerup", containSynthetic);
  };
}
