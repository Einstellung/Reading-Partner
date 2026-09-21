// The binding half of corner-drag.ts: the pointer's timeline on Lumen's body,
// the window it is being dragged in, and the one slot that remembers where it
// was left (docs/68).
//
// The drag itself never re-renders the corner. The offset is written straight
// onto the corner's own box as a transform, the way the case's loop writes the
// case's box, and only the drop is a render — one, when the spot is committed.
//
// Which is also why the snap is a CSS transition and not a loop: the transform
// is already the thing being animated, the destination is known the moment the
// finger lifts, and the committed layout is laid out exactly where the
// transition ends, so clearing the transform in the same commit is invisible.
// Under reduced motion there is no transition and the spot is committed at
// once.

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";

import { NO_SAFE_AREA, measureSafeAreaInsets, sameInsets } from "../base/safe-area";
import { browserPrefStore } from "../base/pref-store";
import {
  CORNER_SPOT_DEFAULT,
  NO_DRAG,
  SNAP_MS,
  cornerBottomPx,
  dockX,
  dragOffset,
  dragTransform,
  dropSpot,
  liftPxOf,
  passedSlop,
  snapOffset,
  type CornerFrame,
  type CornerSide,
  type CornerSpot,
  type DragAnchor,
  type DragOffset,
} from "./corner-drag";
import { readLumenCornerSpot, writeLumenCornerSpot } from "./corner-pref";

export interface CornerDrag {
  /** Which edge the corner is docked at. */
  side: CornerSide;
  /** How far above the bottom edge it is drawn, the composer's lift included. */
  bottomPx: number;
  /** Goes on the corner's outer box: the element a drag moves. */
  frameRef: (el: HTMLElement | null) => void;
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  /** Answers whether the press has become a drag, which is the hold's cue to let go. */
  onPointerMove: (event: ReactPointerEvent<HTMLElement>) => boolean;
  onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => void;
}

interface Press {
  x: number;
  y: number;
  from: DragAnchor;
  frame: CornerFrame;
  composerLiftPx: number;
  dragging: boolean;
}

function windowFrame(insets: CornerFrame["insets"]): CornerFrame {
  return { width: window.innerWidth, height: window.innerHeight, insets };
}

function reduced(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * `composerLiftPx` is the corner's other lift (corner-placement.ts), which the
 * dragged one only overrides when it is higher.
 */
export function useCornerDrag(composerLiftPx: number): CornerDrag {
  const [spot, setSpot] = useState<CornerSpot>(() =>
    typeof window === "undefined"
      ? CORNER_SPOT_DEFAULT
      : readLumenCornerSpot(browserPrefStore(window)),
  );
  const [frame, setFrame] = useState<CornerFrame>(() =>
    typeof window === "undefined"
      ? { width: 0, height: 0, insets: NO_SAFE_AREA }
      : windowFrame(NO_SAFE_AREA),
  );

  const elRef = useRef<HTMLElement | null>(null);
  const pressRef = useRef<Press | null>(null);
  const offsetRef = useRef<DragOffset>(NO_DRAG);
  const timerRef = useRef(0);
  // The spot that has been decided, which is ahead of the rendered one for the
  // length of the snap.
  const spotRef = useRef(spot);
  const liveFrame = useRef(frame);
  liveFrame.current = frame;
  const composerRef = useRef(composerLiftPx);
  composerRef.current = composerLiftPx;

  // The window the corner is being dragged in. A rotation changes both the
  // travel and which edge carries an inset, so the two are read together.
  useEffect(() => {
    const read = () =>
      setFrame((was) => {
        const next = windowFrame(measureSafeAreaInsets());
        return was.width === next.width &&
          was.height === next.height &&
          sameInsets(was.insets, next.insets)
          ? was
          : next;
      });
    read();
    window.addEventListener("resize", read);
    window.addEventListener("orientationchange", read);
    return () => {
      window.removeEventListener("resize", read);
      window.removeEventListener("orientationchange", read);
    };
  }, []);

  // The committed layout is where the snap ended, so the transform comes off in
  // the same commit that lays it out there. A passive effect would paint one
  // frame of the corner back at the spot it left.
  useLayoutEffect(() => {
    const el = elRef.current;
    if (!el) return;
    el.style.transition = "";
    el.style.transform = "";
  }, [spot]);

  useEffect(
    () => () => {
      if (timerRef.current !== 0) window.clearTimeout(timerRef.current);
    },
    [],
  );

  const paint = useCallback((offset: DragOffset) => {
    offsetRef.current = offset;
    const el = elRef.current;
    if (el) el.style.transform = dragTransform(offset);
  }, []);

  // Everything a pending snap was going to do, done now: the next press has to
  // start from a corner that is standing still.
  const settle = useCallback(() => {
    if (timerRef.current === 0) return;
    window.clearTimeout(timerRef.current);
    timerRef.current = 0;
    const el = elRef.current;
    if (el) {
      el.style.transition = "";
      el.style.transform = "";
    }
    offsetRef.current = NO_DRAG;
    setSpot(spotRef.current);
  }, []);

  const commit = useCallback((next: CornerSpot) => {
    spotRef.current = next;
    setSpot(next);
    writeLumenCornerSpot(browserPrefStore(window), next);
  }, []);

  const frameRef = useCallback((el: HTMLElement | null) => {
    elRef.current = el;
  }, []);

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      settle();
      const here = liveFrame.current;
      const current = spotRef.current;
      pressRef.current = {
        x: event.clientX,
        y: event.clientY,
        from: {
          x: dockX(current.side, here),
          lift: cornerBottomPx(liftPxOf(current, here), composerRef.current),
        },
        frame: here,
        composerLiftPx: composerRef.current,
        dragging: false,
      };
      offsetRef.current = NO_DRAG;
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // A host without pointer capture still reports the rest of the gesture
        // to the body, which is where the finger started.
      }
    },
    [settle],
  );

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const press = pressRef.current;
      if (!press) return false;
      const dx = event.clientX - press.x;
      const dy = event.clientY - press.y;
      if (!press.dragging) {
        if (!passedSlop(dx, dy)) return false;
        press.dragging = true;
      }
      paint(dragOffset({ dx, dy }, press.from, press.frame));
      return true;
    },
    [paint],
  );

  const drop = useCallback(() => {
    const press = pressRef.current;
    pressRef.current = null;
    if (!press || !press.dragging) return;
    const next = dropSpot(offsetRef.current, press.from, press.frame);
    const target = snapOffset(next, press.from, press.frame, press.composerLiftPx);
    spotRef.current = next;
    const el = elRef.current;
    if (!el || reduced()) {
      paint(NO_DRAG);
      commit(next);
      return;
    }
    el.style.transition = `transform ${SNAP_MS}ms ease-out`;
    paint(target);
    timerRef.current = window.setTimeout(() => {
      timerRef.current = 0;
      commit(next);
    }, SNAP_MS);
  }, [commit, paint]);

  return {
    side: spot.side,
    bottomPx: cornerBottomPx(liftPxOf(spot, frame), composerLiftPx),
    frameRef,
    onPointerDown,
    onPointerMove,
    onPointerUp: drop,
    onPointerCancel: drop,
  };
}
