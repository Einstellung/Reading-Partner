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

/** The two heights the placement rule asks for (corner-placement.ts). */
interface Frame {
  height: number;
  visibleBottom: number;
}

// The shorter of the two heights is the bottom of what the reader can see, in
// the client coordinates a bounding box comes back in. Not `offsetTop + height`,
// which is what the spec's visual viewport says: WebKit hands back the page
// scroll in `offsetTop` rather than the visual viewport's offset inside the
// layout one, and with the keyboard up and the page scrolled 403px that reads
// as a visible area ending half a screen below the window. Whichever viewport
// is short, is the one covering the bottom.
function readFrame(): Frame {
  if (typeof window === "undefined") return { height: 0, visibleBottom: 0 };
  const height = window.innerHeight;
  const vv = window.visualViewport;
  return { height, visibleBottom: vv ? Math.min(height, vv.height) : height };
}

/**
 * Where Lumen stands right now. The ref goes on the element that wraps the
 * composer; it is re-measured when that element resizes (the bar grows with the
 * text in it) and when the window does (rotation, the soft keyboard).
 *
 * The soft keyboard is two different events depending on what the webview did
 * about it. Shrink the webview and `window` resizes; leave it full height and
 * only the visual viewport does, and nothing on `window` fires at all — which
 * is the state an iPad comes back in after the reader switches away and
 * returns (docs/pitfall/392). Both are subscribed to, and both are read, or the
 * corner keeps standing where a keyboard-less window put it.
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
  const [frame, setFrame] = useState<Frame>(readFrame);
  const holding = useHolding();

  const composerRef = useCallback((el: HTMLElement | null) => setElement(el), []);

  useEffect(() => {
    if (!element) {
      setComposer(null);
      return;
    }
    // The composer moves in two steps when the keyboard opens without the
    // webview being resized: the viewport event fires, and only the render it
    // causes pads the column and lifts the bar. A box read on the event alone is
    // the one from before the padding, so every measurement is taken twice —
    // now, and on the next frame, once that render has landed. Both reads hand
    // back the same object when nothing moved, so the second one is free.
    let pending = 0;
    const read = () => {
      const box = element.getBoundingClientRect();
      // Same numbers, same object, on both of these: a keyboard-induced scroll
      // that moves nothing must not re-run the placement (useViewportSize.ts).
      setFrame((was) => {
        const next = readFrame();
        return was.height === next.height && was.visibleBottom === next.visibleBottom
          ? was
          : next;
      });
      setComposer((was) =>
        was && was.top === box.top && was.bottom === box.bottom
          ? was
          : { top: box.top, bottom: box.bottom },
      );
    };
    const measure = () => {
      read();
      cancelAnimationFrame(pending);
      pending = requestAnimationFrame(read);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    window.addEventListener("resize", measure);
    const vv = window.visualViewport;
    // iOS pairs the keyboard's resize with a scroll, and a pinch-zoomed viewport
    // only ever scrolls.
    vv?.addEventListener("resize", measure);
    vv?.addEventListener("scroll", measure);
    return () => {
      cancelAnimationFrame(pending);
      observer.disconnect();
      window.removeEventListener("resize", measure);
      vv?.removeEventListener("resize", measure);
      vv?.removeEventListener("scroll", measure);
    };
  }, [element]);

  return {
    composerRef,
    placement: cornerPlacement({
      shown,
      chatMain,
      holding,
      viewportHeight: frame.height,
      visibleBottom: frame.visibleBottom,
      composer,
    }),
  };
}
