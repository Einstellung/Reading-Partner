// The measuring half of corner-placement.ts: what the composer's box is now,
// and whether a finger is down on it. The rule that turns the two into a
// placement is next door and has no DOM in it.

import { useCallback, useEffect, useState } from "react";

import { isHolding, subscribeHolding } from "../../../ai/voice";
import { cornerPlacement, type CornerPlacement, type ComposerBox } from "./corner-placement";

/** Whether a hold-to-talk press is in progress, as a render. */
export function useHolding(): boolean {
  const [holding, setHoldingState] = useState(isHolding);
  useEffect(() => subscribeHolding(() => setHoldingState(isHolding())), []);
  return holding;
}

/**
 * Where Lumen stands right now. The ref goes on the element that wraps the
 * composer; it is re-measured when that element resizes (the bar grows with the
 * text in it) and when the window does (rotation, the soft keyboard).
 *
 * Handing back a callback ref rather than an object one: the wrapper comes and
 * goes with the view, and this has to measure the moment it arrives.
 */
export function useCornerLift(shown: boolean, chatMain: boolean): {
  composerRef: (el: HTMLElement | null) => void;
  placement: CornerPlacement;
} {
  const [composer, setComposer] = useState<ComposerBox | null>(null);
  const [element, setElement] = useState<HTMLElement | null>(null);
  const [viewportHeight, setViewportHeight] = useState(() =>
    typeof window === "undefined" ? 0 : window.innerHeight,
  );
  const holding = useHolding();

  const composerRef = useCallback((el: HTMLElement | null) => setElement(el), []);

  useEffect(() => {
    if (!element) {
      setComposer(null);
      return;
    }
    const measure = () => {
      const box = element.getBoundingClientRect();
      setViewportHeight(window.innerHeight);
      setComposer((was) =>
        was && was.top === box.top && was.bottom === box.bottom
          ? was
          : { top: box.top, bottom: box.bottom },
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [element]);

  return {
    composerRef,
    placement: cornerPlacement({ shown, chatMain, holding, viewportHeight, composer }),
  };
}
