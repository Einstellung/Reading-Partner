// Wires the left-edge back swipe (edge-back-gesture.ts) to a DOM element: the
// pointer listeners, the pointer capture, the transform, and the rAF that
// finishes the movement the finger started. The decisions all live in the pure
// machine; this file only owns the element and the clock. The listener set, the
// raw touch claim and the rAF itself are shared with the pull-to-ask gesture and
// live in gesture-dom.ts, including the two-channel and every-move rules the
// claim encodes (docs/pitfall/38, 70).
//
// Two rules borrowed from the reader's rubber band (docs/pitfall/41): the offset
// is written straight to `transform` and animated on rAF, never with a CSS
// transition, and at rest the property is cleared to "" rather than set to an
// identity transform — a live transform makes the element a containing block for
// every fixed descendant, and Settings is one.

import { useCallback, useEffect, useRef, type MutableRefObject } from "react";
import { bindGesture, createAnimator, type Animator } from "./gesture-dom";
import {
  EDGE_ZONE,
  inEdgeZone,
  initEdgeBackState,
  shouldClaimTouch,
  stepEdgeBack,
  type EdgeBackCommand,
  type EdgeBackInput,
} from "./edge-back-gesture";

// Finishing the movement after the finger leaves: out to the right when the
// drag committed, back to rest when it did not.
const EXIT_MS = 200;
const CANCEL_MS = 180;
// The screen underneath arrives from a short offset rather than appearing in
// place, so a committed back reads as one movement instead of a cut.
const ENTER_MS = 170;
const ENTER_OFFSET_FRACTION = 0.22;
const ENTER_OFFSET_MAX = 90;

// Cast along the leading edge while the screen is off its rest position, so the
// page reads as lifted off the backdrop behind it.
const EDGE_SHADOW = "-10px 0 26px rgba(0, 0, 0, 0.16)";

function paint(el: HTMLElement | null, dx: number): void {
  if (!el) return;
  if (dx === 0) {
    el.style.transform = "";
    el.style.boxShadow = "";
    return;
  }
  el.style.transform = `translate3d(${dx}px, 0, 0)`;
  el.style.boxShadow = dx > 0 ? EDGE_SHADOW : "";
}

export interface EdgeBackOptions {
  // False at the bottom of the stack: home has nothing behind it, so the
  // gesture must not engage at all rather than engage and spring back.
  enabled: boolean;
  onBack: () => void;
}

// Returns the ref for the element that slides. Everything the shell draws
// belongs inside it, and its parent carries the backdrop the slide reveals and
// clips what leaves the screen.
export function useEdgeBack(options: EdgeBackOptions): MutableRefObject<HTMLDivElement | null> {
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const elRef = useRef<HTMLDivElement | null>(null);
  const gestureRef = useRef(initEdgeBackState());
  const widthRef = useRef(0);
  const leftRef = useRef(0);
  const offsetRef = useRef(0);

  const draw = useCallback((dx: number) => {
    offsetRef.current = dx;
    paint(elRef.current, dx);
  }, []);

  const animatorRef = useRef<Animator | null>(null);
  const animator: Animator = (animatorRef.current ??= createAnimator(draw));

  // The finger is gone: either finish leaving and pop, or settle back.
  const settle = useCallback(
    (goBack: boolean) => {
      const width = widthRef.current || elRef.current?.offsetWidth || 0;
      const from = offsetRef.current;
      if (!goBack) {
        animator.run(from, 0, CANCEL_MS);
        return;
      }
      animator.run(from, width, EXIT_MS, () => {
        optionsRef.current.onBack();
        // The pop is a React state update made from a rAF callback, so it is
        // flushed in the microtask before the next frame: by then the screen
        // underneath is the one in the DOM, and it is the one that slides in.
        requestAnimationFrame(() => {
          const offset = -Math.min(width * ENTER_OFFSET_FRACTION, ENTER_OFFSET_MAX);
          draw(offset);
          animator.run(offset, 0, ENTER_MS);
        });
      });
    },
    [animator, draw],
  );

  const run = useCallback(
    (cmds: EdgeBackCommand[], event: PointerEvent) => {
      for (const c of cmds) {
        if (c.type === "capture") {
          // From here the pointer is ours: capture keeps the samples coming if
          // the finger leaves the element, and keeps whatever sits under it from
          // reading the release as a tap.
          try {
            elRef.current?.setPointerCapture(c.id);
          } catch {
            // The pointer was already released; the drag ends on its own.
          }
          event.preventDefault();
        } else if (c.type === "dragMove") {
          draw(c.dx);
        } else {
          settle(c.back);
        }
      }
    },
    [draw, settle],
  );

  const feed = useCallback(
    (input: EdgeBackInput, event: PointerEvent) => {
      const { state, commands } = stepEdgeBack(gestureRef.current, input, {
        width: widthRef.current,
      });
      gestureRef.current = state;
      if (commands.length > 0) run(commands, event);
    },
    [run],
  );

  useEffect(() => {
    const el = elRef.current;
    if (!el) return;

    const unbind = bindGesture(el, {
      pointerTarget: el,
      enabled: () => optionsRef.current.enabled && !animator.animating,
      claim: {
        // A touch that starts outside the band is left alone and scrolls the
        // page, the same test the pointer channel starts from.
        starts: (_e, t) => inEdgeZone(t.clientX - el.getBoundingClientRect().left, EDGE_ZONE),
        reached: shouldClaimTouch,
      },
      // y is only ever used as a difference, so the viewport coordinate is fine;
      // x has to be relative to the surface, whose left edge is where the band
      // is.
      onPointer: (phase, e) => {
        if (phase === "pointercancel") {
          feed({ type: phase, id: e.pointerId }, e);
          return;
        }
        if (phase === "pointerdown") {
          const rect = el.getBoundingClientRect();
          widthRef.current = rect.width;
          leftRef.current = rect.left;
          feed(
            {
              type: phase,
              id: e.pointerId,
              x: e.clientX - rect.left,
              y: e.clientY - rect.top,
              t: e.timeStamp,
            },
            e,
          );
          return;
        }
        feed(
          {
            type: phase,
            id: e.pointerId,
            x: e.clientX - leftRef.current,
            y: e.clientY,
            t: e.timeStamp,
          },
          e,
        );
      },
    });

    return () => {
      unbind();
      animator.stop();
    };
  }, [animator, feed]);

  return elRef;
}
