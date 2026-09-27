// The DOM half the phone's two gestures share: the listener set, the raw touch
// claim, and the rAF that finishes a movement after the finger leaves. What each
// gesture decides stays in its own pure machine (`edge-back-gesture.ts`,
// `pull-to-ask-gesture.ts`) and what each one draws stays in its own hook; only
// the wiring is here.
//
// Two channels, and they are independent (docs/pitfall/38). The gesture itself
// runs on pointer events. The raw touch channel decides nothing about the
// gesture; it answers one question — may this touch be taken off the browser —
// and it is the only channel that can. preventDefault on a pointer event has no
// say in whether the browser scrolls, and the moment the browser decides to
// scroll it cancels the pointer and the gesture is over.
//
// A claimed sequence must preventDefault on EVERY move, not only the first
// (docs/pitfall/70). The claim is not settled once at the start: preventing the
// first move and letting the rest through still ends in `pointercancel`. That is
// why `bindGesture` keeps the claim on the touch's own bookkeeping and re-runs
// the preventDefault for the whole sequence. The distance at which a claim is
// taken belongs to each machine's `shouldClaimTouch` — pitfall 70's 3px was
// measured under Chromium touch emulation and is still unverified on iOS
// WKWebView, so it is deliberately left where it can be re-measured per gesture
// rather than folded in here.
//
// Touch listeners are non-passive, or the preventDefault is ignored and the
// browser scrolls anyway. Everything is on the capture phase, the way the reader
// routes touches (docs/pitfall/37): a child that stops propagation must not be
// able to hide the edge, or the top, from us.
//
// The pointer target is separate from the host because the two gestures need
// different ones. The pull-to-ask listeners after pointerdown sit on the
// document: the shell's edge back swipe may call setPointerCapture on the
// surface above, which retargets the rest of that sequence, and a listener on
// the host would then never see the pointerup and would keep a finger down
// forever.

export function easeOut(p: number): number {
  return 1 - Math.pow(1 - p, 3);
}

// Owns one value over time. Painting it is the caller's business — the offset
// goes straight to `transform`, never through a CSS transition, and is cleared
// at rest rather than left as an identity transform (docs/pitfall/41).
export interface Animator {
  // True while rAF owns the value. A pointer that lands mid-animation is
  // ignored: taking over would mean starting from wherever the surface happens
  // to be, and the settles are short enough that nobody waits.
  readonly animating: boolean;
  // Replaces whatever is running. `done` fires only when the run reaches its
  // end, never when it is cut short.
  run(from: number, to: number, ms: number, done?: () => void): void;
  stop(): void;
}

export function createAnimator(paint: (value: number) => void): Animator {
  let animating = false;
  // Self-clearing: once a run has ended, cancelling it again must not un-set an
  // `animating` that a newer run has since set.
  let cancel = () => {};
  return {
    get animating(): boolean {
      return animating;
    },
    stop(): void {
      cancel();
    },
    run(from: number, to: number, ms: number, done?: () => void): void {
      cancel();
      animating = true;
      const t0 = performance.now();
      let raf = 0;
      const frame = (now: number) => {
        const p = ms > 0 ? Math.min(1, (now - t0) / ms) : 1;
        paint(from + (to - from) * easeOut(p));
        if (p < 1) {
          raf = requestAnimationFrame(frame);
          return;
        }
        animating = false;
        cancel = () => {};
        done?.();
      };
      raf = requestAnimationFrame(frame);
      cancel = () => {
        cancelAnimationFrame(raf);
        animating = false;
        cancel = () => {};
      };
    },
  };
}

export type PointerPhase = "pointerdown" | "pointermove" | "pointerup" | "pointercancel";

// The raw touch channel's two questions, both answered by the gesture's own
// machine: may a touch landing here start at all, and has it moved far enough,
// and in the right direction, to be taken from the browser.
export interface TouchClaim {
  starts(event: TouchEvent, touch: Touch): boolean;
  reached(dx: number, dy: number): boolean;
}

export interface GestureBinding {
  // Where pointermove/up/cancel are heard. pointerdown and the whole touch
  // channel are always on the host.
  pointerTarget: EventTarget;
  onPointer(phase: PointerPhase, event: PointerEvent): void;
  claim: TouchClaim;
  // Asked before every pointerdown and every touchstart, never mid-sequence: a
  // gesture already under way finishes on its own terms.
  enabled(): boolean;
}

// Installs the listeners and returns the teardown that removes exactly them.
export function bindGesture(host: EventTarget, binding: GestureBinding): () => void {
  const { pointerTarget, onPointer, claim, enabled } = binding;

  const down = (e: Event) => {
    const pe = e as PointerEvent;
    if (!pe.isPrimary || !enabled()) return;
    onPointer("pointerdown", pe);
  };
  const move = (e: Event) => onPointer("pointermove", e as PointerEvent);
  const up = (e: Event) => onPointer("pointerup", e as PointerEvent);
  const cancel = (e: Event) => onPointer("pointercancel", e as PointerEvent);

  // The raw touch channel's own bookkeeping, kept apart from the gesture state:
  // the two are independent, and this one only answers "has this touch earned
  // the right to stop the browser scrolling".
  let touch: { id: number; x: number; y: number; claimed: boolean } | null = null;

  const touchStart = (e: Event) => {
    const te = e as TouchEvent;
    const t = te.touches[0];
    if (!t || te.touches.length !== 1 || !enabled()) {
      touch = null;
      return;
    }
    touch = claim.starts(te, t)
      ? { id: t.identifier, x: t.clientX, y: t.clientY, claimed: false }
      : null;
  };
  const touchMove = (e: Event) => {
    const te = e as TouchEvent;
    const s = touch;
    if (!s) return;
    const t = Array.prototype.find.call(te.touches, (c: Touch) => c.identifier === s.id) as
      | Touch
      | undefined;
    if (!t) return;
    // Once claimed, every remaining move is prevented without re-asking: a
    // single prevented move does not hold the sequence (docs/pitfall/70).
    if (!s.claimed && !claim.reached(t.clientX - s.x, t.clientY - s.y)) return;
    s.claimed = true;
    te.preventDefault();
  };
  const touchEnd = () => {
    touch = null;
  };

  const opts = { capture: true } as const;
  // Non-passive, or preventDefault is ignored and the browser scrolls anyway.
  const active = { capture: true, passive: false } as const;
  host.addEventListener("pointerdown", down, opts);
  pointerTarget.addEventListener("pointermove", move, opts);
  pointerTarget.addEventListener("pointerup", up, opts);
  pointerTarget.addEventListener("pointercancel", cancel, opts);
  host.addEventListener("touchstart", touchStart, active);
  host.addEventListener("touchmove", touchMove, active);
  host.addEventListener("touchend", touchEnd, opts);
  host.addEventListener("touchcancel", touchEnd, opts);
  return () => {
    host.removeEventListener("pointerdown", down, opts);
    pointerTarget.removeEventListener("pointermove", move, opts);
    pointerTarget.removeEventListener("pointerup", up, opts);
    pointerTarget.removeEventListener("pointercancel", cancel, opts);
    host.removeEventListener("touchstart", touchStart, active);
    host.removeEventListener("touchmove", touchMove, active);
    host.removeEventListener("touchend", touchEnd, opts);
    host.removeEventListener("touchcancel", touchEnd, opts);
    touch = null;
  };
}
