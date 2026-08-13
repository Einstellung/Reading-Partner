// Wires the pull-down-to-ask gesture (pull-to-ask-gesture.ts) to the DOM: which
// element scrolls, which one moves, the pointer capture, and the rAF that
// settles the surface after the finger leaves. Every decision lives in the pure
// machine; this file owns the elements and the clock. The listener set, the raw
// touch claim and the rAF itself are shared with the edge back swipe and live in
// gesture-dom.ts, including the two-channel and every-move rules the claim
// encodes (docs/pitfall/38, 70).
//
// Vertically the claim matters more than it does sideways — down is the axis the
// scroll container itself wants — so it happens within a few pixels, long before
// the machine has decided anything.
//
// The offset is written straight to `transform` and animated on rAF, never with
// a CSS transition, and cleared to "" at rest rather than left as an identity
// transform: a live transform makes the element a containing block for every
// fixed descendant (docs/pitfall/41).
//
// The pointer listeners after the first one sit on the document, not on the
// host. The shell's edge back swipe may call setPointerCapture on the surface
// above us, which retargets the rest of that sequence to the surface; a listener
// on the host would then never see the pointerup and this machine would keep a
// finger down forever. The document is on the path either way.

import { useCallback, useEffect, useLayoutEffect, useRef, type MutableRefObject } from "react";
import { bindGesture, createAnimator, type Animator } from "./gesture-dom";
import {
  initPullToAskState,
  isAtTop,
  shouldClaimTouch,
  stepPullToAsk,
  COMMIT_DISTANCE,
  type PullToAskCommand,
  type PullToAskInput,
} from "./pull-to-ask-gesture";

// Settling after the finger leaves. The cancel matches the edge back swipe's;
// the committed one is shorter because the chat is already on its way in over
// the top of it.
const CANCEL_MS = 180;
const ASK_MS = 140;

// Whether an element inside the page can scroll vertically right now. The
// overflow test alone is not enough: a block that only scrolls sideways (a wide
// table, a code block) computes `overflow-y: auto` as well, because a scrollable
// axis forces the other one off `visible` (docs/pitfall/68). Only something with
// room to scroll counts.
function canScrollY(el: Element): boolean {
  if (el.scrollHeight <= el.clientHeight + 1) return false;
  const oy = getComputedStyle(el).overflowY;
  return oy === "auto" || oy === "scroll" || oy === "overlay";
}

export interface PullToAskOptions {
  // Opens the chat about this screen. Called once, on release, past the commit
  // distance. There is no enabled flag: mounting the host is the switch, and
  // the chat that opens covers the screen, so nothing underneath is reachable
  // while it is up.
  onAsk: () => void;
}

export interface PullToAskRefs {
  // The clipping host. Its last element child is the screen, and that child is
  // the scroll container this gesture reads and moves.
  hostRef: MutableRefObject<HTMLDivElement | null>;
  // The affordance revealed above the screen. Its height follows the finger and
  // its `data-armed` says whether a release will open the chat.
  stripRef: MutableRefObject<HTMLDivElement | null>;
}

export function usePullToAsk(options: PullToAskOptions): PullToAskRefs {
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const hostRef = useRef<HTMLDivElement | null>(null);
  const stripRef = useRef<HTMLDivElement | null>(null);
  const gestureRef = useRef(initPullToAskState());
  const offsetRef = useRef(0);
  // The screen element being read and moved, once adopted.
  const scrollerRef = useRef<HTMLElement | null>(null);

  // The screen inside the host, adopted the first time it is seen. Its own
  // overscroll is turned off along the way: the pull is this screen's answer to
  // being dragged past the top, and a native rubber band underneath it would be
  // a second, contradictory one (iOS bounces, Chromium does not).
  const scroller = useCallback((): HTMLElement | null => {
    const host = hostRef.current;
    const next = (host?.lastElementChild as HTMLElement | null) ?? null;
    const prev = scrollerRef.current;
    if (next === prev) return prev;
    if (prev) {
      prev.style.transform = "";
      prev.style.overscrollBehaviorY = "";
    }
    if (next) next.style.overscrollBehaviorY = "none";
    scrollerRef.current = next;
    return next;
  }, []);

  // `armed` comes from the machine while a finger is down; the settle animation
  // has no machine behind it and reads the threshold off the offset, which is
  // the same thing (the follow is the identity up to the commit distance).
  const paint = useCallback((offset: number, armed = offset >= COMMIT_DISTANCE) => {
    offsetRef.current = offset;
    const el = scrollerRef.current;
    if (el) el.style.transform = offset === 0 ? "" : `translate3d(0, ${offset}px, 0)`;
    const strip = stripRef.current;
    if (!strip) return;
    strip.style.height = offset === 0 ? "" : `${offset}px`;
    strip.dataset.armed = armed ? "true" : "false";
  }, []);

  const animatorRef = useRef<Animator | null>(null);
  const animator: Animator = (animatorRef.current ??= createAnimator(paint));

  // Whether a touch landing on `target` may start a pull: the screen has to be
  // at its top, and nothing scrollable of its own may sit under the finger — a
  // wide table or a code block inside an article is the page's, not ours.
  const startsAtTop = useCallback(
    (target: EventTarget | null): boolean => {
      const el = scroller();
      if (!el) return false;
      let node = target instanceof Element ? target : null;
      while (node && node !== el) {
        if (canScrollY(node)) return false;
        node = node.parentElement;
      }
      return isAtTop(el.scrollTop);
    },
    [scroller],
  );

  const run = useCallback(
    (cmds: PullToAskCommand[], event: PointerEvent) => {
      for (const c of cmds) {
        if (c.type === "capture") {
          // From here the pointer is ours: capture keeps the samples coming if
          // the finger leaves the element, and keeps whatever sits under it from
          // reading the release as a tap.
          try {
            hostRef.current?.setPointerCapture(c.id);
          } catch {
            // The pointer was already released; the pull ends on its own.
          }
          event.preventDefault();
        } else if (c.type === "pullMove") {
          paint(c.offset, c.armed);
        } else {
          // The chat is opened first and the surface settles under it, so a
          // release that committed shows the chat at once.
          if (c.ask) optionsRef.current.onAsk();
          animator.run(offsetRef.current, 0, c.ask ? ASK_MS : CANCEL_MS);
        }
      }
    },
    [animator, paint],
  );

  const feed = useCallback(
    (input: PullToAskInput, event: PointerEvent) => {
      const { state, commands } = stepPullToAsk(gestureRef.current, input);
      gestureRef.current = state;
      if (commands.length > 0) run(commands, event);
    },
    [run],
  );

  // After every render, not only on mount: a host whose screen is replaced must
  // adopt the new one before the first finger lands, not one gesture later.
  useLayoutEffect(() => {
    scroller();
  });

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const unbind = bindGesture(host, {
      pointerTarget: document,
      enabled: () => !animator.animating,
      claim: {
        // A touch may start a pull only where a pointer may: at the top of the
        // screen, with nothing scrollable of its own under the finger.
        starts: (e) => startsAtTop(e.target),
        reached: shouldClaimTouch,
      },
      // Viewport coordinates throughout: both axes are only ever used as
      // differences from where the finger landed.
      onPointer: (phase, e) => {
        if (phase === "pointercancel") {
          feed({ type: phase, id: e.pointerId }, e);
          return;
        }
        const id = e.pointerId;
        const x = e.clientX;
        const y = e.clientY;
        const t = e.timeStamp;
        if (phase === "pointerdown") {
          feed({ type: phase, id, x, y, t, atTop: startsAtTop(e.target) }, e);
          return;
        }
        feed({ type: phase, id, x, y, t }, e);
      },
    });

    return () => {
      unbind();
      animator.stop();
      // Leave nothing behind: an unmount mid-gesture (the chat opening over a
      // screen that then navigates) must not strand a transform or a half-open
      // machine.
      const el = scrollerRef.current;
      if (el) {
        el.style.transform = "";
        el.style.overscrollBehaviorY = "";
      }
      scrollerRef.current = null;
      gestureRef.current = initPullToAskState();
      offsetRef.current = 0;
    };
  }, [animator, feed, scroller, startsAtTop]);

  return { hostRef, stripRef };
}
