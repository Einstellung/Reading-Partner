// The binding half of hold-toggle.ts: pointer events in, one custom property
// out, and the toggle fired at the moment the body reaches full light.
//
// Nothing here re-renders. The charge changes on every frame of the hold and is
// written straight onto the element as `--lumen-charge`, which the pool and the
// halo compose into their own opacity (Lumen.tsx) — the body's own rAF loop owns
// `--lumen-pool` and `--lumen-glow` and would overwrite anything written there.
// The loop runs exactly while something is moving and stops itself otherwise.
//
// The pointer is captured on the way down, so a finger that slides off the body
// still reports its move and its release here rather than to whatever it landed
// on; sliding far enough cancels the hold anyway.

import { useCallback, useEffect, useRef, type PointerEvent, type MouseEvent } from "react";

import {
  HOLD_REST,
  holdCharge,
  holdMoving,
  holdStep,
  type HoldInput,
  type HoldState,
} from "./hold-toggle";

export interface HoldBinding {
  /** Goes on the element the charge is written to: the body's own button. */
  ref: (el: HTMLButtonElement | null) => void;
  handlers: {
    onPointerDown: (event: PointerEvent<HTMLButtonElement>) => void;
    onPointerMove: (event: PointerEvent<HTMLButtonElement>) => void;
    onPointerUp: (event: PointerEvent<HTMLButtonElement>) => void;
    onPointerCancel: (event: PointerEvent<HTMLButtonElement>) => void;
    onContextMenu: (event: MouseEvent<HTMLButtonElement>) => void;
  };
}

/**
 * `enabled` is whether a hold means anything here at all. When it does not the
 * body never charges, which is the whole legibility of the gesture: Lumen only
 * lights up where it can talk.
 */
export function useHoldToggle(enabled: boolean, fire: () => void): HoldBinding {
  const element = useRef<HTMLButtonElement | null>(null);
  const state = useRef<HoldState>(HOLD_REST);
  const frame = useRef(0);
  const fireRef = useRef(fire);
  fireRef.current = fire;
  const feedRef = useRef<(input: HoldInput) => void>(() => {});

  const paint = useCallback((at: number) => {
    element.current?.style.setProperty("--lumen-charge", holdCharge(state.current, at).toFixed(4));
  }, []);

  const tick = useCallback(() => {
    frame.current = 0;
    feedRef.current({ kind: "tick", at: performance.now() });
  }, []);

  const feed = useCallback(
    (input: HoldInput) => {
      const step = holdStep(state.current, input);
      state.current = step.state;
      paint(input.at);
      if (step.fired) fireRef.current();
      if (frame.current === 0 && holdMoving(state.current, input.at)) {
        frame.current = requestAnimationFrame(tick);
      }
    },
    [paint, tick],
  );
  feedRef.current = feed;

  // A body that stops being able to talk under a finger that is still down:
  // the press dies with it rather than firing into nothing later.
  useEffect(() => {
    if (enabled) return;
    state.current = HOLD_REST;
    paint(performance.now());
    if (frame.current !== 0) {
      cancelAnimationFrame(frame.current);
      frame.current = 0;
    }
  }, [enabled, paint]);

  useEffect(
    () => () => {
      if (frame.current !== 0) cancelAnimationFrame(frame.current);
    },
    [],
  );

  const ref = useCallback((el: HTMLButtonElement | null) => {
    element.current = el;
  }, []);

  const onPointerDown = useCallback(
    (event: PointerEvent<HTMLButtonElement>) => {
      if (!enabled) return;
      // Keep the rest of the gesture, wherever the finger goes.
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // A host without pointer capture still gets the events on the body.
      }
      feed({ kind: "down", x: event.clientX, y: event.clientY, at: performance.now() });
    },
    [enabled, feed],
  );

  const onPointerMove = useCallback(
    (event: PointerEvent<HTMLButtonElement>) => {
      feed({ kind: "move", x: event.clientX, y: event.clientY, at: performance.now() });
    },
    [feed],
  );

  const onPointerUp = useCallback(
    () => feed({ kind: "up", at: performance.now() }),
    [feed],
  );

  const onPointerCancel = useCallback(
    () => feed({ kind: "cancel", at: performance.now() }),
    [feed],
  );

  // iOS raises the callout and the selection on a long press over anything it
  // can find text or an image in (docs/pitfall/49, docs/pitfall/262). The CSS
  // half is on the body's own classes; this is the half CSS cannot do.
  const onContextMenu = useCallback((event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
  }, []);

  return {
    ref,
    handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onContextMenu },
  };
}
