// Standalone harness for the case being pulled out and put away (docs/68).
// Not part of the app: it is the one way to look at the path, since the corner
// only moves when something lands in the box.
//
// Two pages, both served by Vite in dev at /lumen-case-spike.html. The default
// is a contact sheet: the same corner at nine points along the path, each pose
// painted by casePose() and the lean by caseReach(), with a line of text behind
// it so "behind the body" can be told from "behind the page". `?live` is the
// real thing — useCaseMotion driving a real count, with `window.__case` on it
// for a browser to drive from outside.
//
// `?mirror` is the corner docked at the left edge: the same one transform on
// the box the two stand in that LumenCorner writes there, and the badge turning
// itself back over under it.

import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";

import "../styles.css";
import { cn } from "../ui/components/lib/utils";
import type { VoiceCallHandle } from "../ui/components/orb/orb";
import { Lumen, LumenCase } from "../ui/components/lumen/Lumen";
import {
  caseLeanDeg,
  caseLookGaze,
  caseReach,
  caseTriggerStyle,
} from "../ui/components/lumen/case-motion";
import { useCaseMotion } from "../ui/components/lumen/use-case-motion";

const SILENT: VoiceCallHandle = {
  phase: "idle",
  start: () => {},
  stop: () => {},
  error: null,
  subscribeLevel: () => () => {},
  subscribeEnvelope: () => () => {},
};

const MIRROR = window.location.search.includes("mirror");
const MIRRORED = MIRROR ? ({ transform: "scaleX(-1)" } as const) : undefined;

function Badge({ count }: { count: number }) {
  return (
    <span
      className="pointer-events-none absolute -left-2 -top-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent-line px-1 text-[10px] font-semibold leading-none text-background ring-2 ring-background"
      style={MIRRORED}
    >
      {count}
    </span>
  );
}

function Body() {
  return (
    <Lumen
      handle={SILENT}
      still
      label="Lumen"
      aria-hidden="true"
      tabIndex={-1}
      role="presentation"
      onActivate={() => {}}
      className="h-18 w-18"
    />
  );
}

/** One frame of the path, held still, with the body in the pose that goes with it. */
function Frame({ p }: { p: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current?.querySelector("[data-lumen]") as HTMLElement | null;
    if (!el) return;
    const w = caseReach(p);
    const gaze = caseLookGaze(w);
    el.style.setProperty("--lumen-tilt", `${caseLeanDeg(w).toFixed(3)}deg`);
    el.style.setProperty("--lumen-gx", gaze.x.toFixed(4));
    el.style.setProperty("--lumen-gy", gaze.y.toFixed(4));
  }, [p]);
  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative h-24 w-28 overflow-hidden rounded border border-border-soft bg-background">
        <p className="absolute left-1 top-3 m-0 text-[9px] leading-4 text-muted-foreground">
          page text page
          <br />
          text page text
          <br />
          page text page
          <br />
          text page text
        </p>
        <div ref={ref} className={cn("absolute bottom-1 h-18 w-18", MIRROR ? "left-1" : "right-1")}>
          <div className="relative isolate h-18 w-18" style={MIRRORED}>
            <Body />
            <button type="button" className="absolute box-content block" style={caseTriggerStyle(p)}>
              <span className="relative block h-full w-full">
                <LumenCase />
                {p === 1 && <Badge count={2} />}
              </span>
            </button>
          </div>
        </div>
      </div>
      <span className="text-[10px] text-foreground">{Math.round(p * 100)}%</span>
    </div>
  );
}

const STOPS = [0, 0.15, 0.3, 0.45, 0.6, 0.7, 0.8, 0.9, 1];

function Sheet() {
  return (
    <div className="flex flex-wrap gap-2 p-3">
      {STOPS.map((p) => (
        <Frame key={p} p={p} />
      ))}
    </div>
  );
}

/** The real loop, with the count on `window.__case`. */
function Live() {
  const [count, setCount] = useState(0);
  const box = useCaseMotion(count);
  useEffect(() => {
    (window as unknown as { __case: unknown }).__case = { set: setCount };
  }, []);
  return (
    <div className="relative h-32 w-40 overflow-hidden bg-background" data-live="">
      <p className="absolute left-2 top-4 m-0 text-[10px] leading-5 text-muted-foreground">
        page text page text
        <br />
        page text page text
        <br />
        page text page text
      </p>
      <div className={cn("absolute bottom-2 h-18 w-18", MIRROR ? "left-2" : "right-2")}>
        <div className="relative isolate h-18 w-18" style={MIRRORED}>
          <Lumen
            handle={SILENT}
            still
            reach={box.reach}
            reaching={box.moving}
            label="Lumen"
            aria-hidden="true"
            tabIndex={-1}
            role="presentation"
            onActivate={() => {}}
            className="h-18 w-18"
          />
          {box.drawn && (
            <button
              ref={box.caseRef}
              type="button"
              className="absolute box-content block"
              style={box.style}
            >
              <span className="relative block h-full w-full">
                <LumenCase />
                {box.atRest && <Badge count={count} />}
              </span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    window.location.search.includes("live") ? <Live /> : <Sheet />,
  );
}
