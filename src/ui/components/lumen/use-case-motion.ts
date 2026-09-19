// The running half of case-motion.ts: one rAF loop that walks progress toward
// its target and writes the case's box straight onto the element.
//
// Three things re-render the corner — the case appearing, the case setting
// down, and the case starting to leave — and nothing else does. The frames in
// between are style writes, the way Lumen's own loop paints its properties, so
// a pull-out is not sixty renders of a popover.
//
// The body's half of the act leaves through `reach`: one mutable number the
// corner hands to Lumen, which reads it on its own frames. A prop would be a
// render per frame, which is the thing this is avoiding.

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";

import {
  CASE_START,
  aimCase,
  caseAtRest,
  caseDrawn,
  caseReach,
  caseSettled,
  caseTriggerStyle,
  stepCase,
  type CaseMotion,
  type CaseReach,
} from "./case-motion";

export type { CaseReach };

export interface CornerCase {
  /** Goes on the case's button. */
  caseRef: (el: HTMLElement | null) => void;
  /** Whether the case is in the DOM at all. */
  drawn: boolean;
  /** Standing in its place: a button, in the tab order, wearing the badge. */
  atRest: boolean;
  /** On its way out or on its way back. */
  moving: boolean;
  /** The box at the moment of the last render; the loop owns it after that. */
  style: CSSProperties;
  reach: CaseReach;
}

function reduced(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function paint(el: HTMLElement, progress: number) {
  const box = caseTriggerStyle(progress);
  el.style.left = String(box.left);
  el.style.bottom = String(box.bottom);
  el.style.width = String(box.width);
  el.style.height = String(box.height);
  el.style.zIndex = box.zIndex === undefined ? "" : String(box.zIndex);
}

function viewOf(state: CaseMotion) {
  return {
    drawn: caseDrawn(state),
    atRest: caseAtRest(state),
    moving: !caseSettled(state),
    style: caseTriggerStyle(state.p),
  };
}

/**
 * The case's whole life, from a count. The count's first reading is not an act
 * (case-motion.ts), so the corner does not pull a case out of Lumen's back the
 * moment the app opens on a box that was already full.
 */
export function useCaseMotion(count: number): CornerCase {
  const reach = useRef<CaseReach>({ w: 0 }).current;
  const stateRef = useRef<CaseMotion>(CASE_START);
  const elRef = useRef<HTMLElement | null>(null);
  const frameRef = useRef(0);
  const lastRef = useRef(0);
  const [view, setView] = useState(() => viewOf(CASE_START));

  const publish = useCallback(() => {
    setView(viewOf(stateRef.current));
  }, []);

  const run = useCallback(() => {
    if (frameRef.current !== 0) return;
    const step = (now: number) => {
      const dt = lastRef.current === 0 ? 0 : now - lastRef.current;
      lastRef.current = now;
      const next = stepCase(stateRef.current, dt);
      stateRef.current = next;
      reach.w = caseReach(next.p);
      const el = elRef.current;
      if (el) paint(el, next.p);
      if (caseSettled(next)) {
        frameRef.current = 0;
        reach.w = 0;
        publish();
        return;
      }
      frameRef.current = requestAnimationFrame(step);
    };
    lastRef.current = 0;
    frameRef.current = requestAnimationFrame(step);
  }, [publish, reach]);

  // The case is painted the moment it attaches: it mounts at the start of a
  // pull-out, one render before the loop's first frame.
  const caseRef = useCallback((el: HTMLElement | null) => {
    elRef.current = el;
    if (el) paint(el, stateRef.current.p);
  }, []);

  useEffect(() => {
    const next = aimCase(stateRef.current, count, reduced());
    if (next === stateRef.current) return;
    stateRef.current = next;
    reach.w = caseReach(next.p);
    publish();
    if (caseSettled(next)) {
      const el = elRef.current;
      if (el) paint(el, next.p);
      return;
    }
    run();
  }, [count, publish, reach, run]);

  useEffect(
    () => () => {
      if (frameRef.current !== 0) cancelAnimationFrame(frameRef.current);
      frameRef.current = 0;
    },
    [],
  );

  return { caseRef, reach, ...view };
}
