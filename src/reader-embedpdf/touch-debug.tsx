// On-device touch probe. iPad/WKWebView is the only place the reader's touch
// rules can actually be verified, and PointerEvent width/height (the palm
// rejection input) turned out to be nothing like the desktop guess there. This
// is a tiny store the touch router feeds, plus a corner overlay that shows the
// live contacts and the session peaks, so a fingertip, a palm or an elbow
// pressed against the glass can be read off the screen (or photographed).
//
// The numbers have to survive lifting the hand: you cannot read a value off the
// glass while your hand is on it. Every contact's last sample is kept, and so
// are the session's peak width and height, until the probe is switched off and
// on again.
//
// Off by default; switched on from the reader's More menu.

import { useEffect, useState, type ReactNode } from "react";

export interface TouchDebugContact {
  id: number;
  type: string; // pointerType as reported
  width: number;
  height: number;
  palm: boolean;
}

export interface TouchDebugSnapshot {
  contacts: TouchDebugContact[];
  fingers: number; // contacts counted as fingers (palms excluded)
  palms: number;
  mode: string; // single / pinch / reserved
  multi: boolean; // multi-touch latch held
  penLock: boolean; // fingers dead until they all lift (pen won)
  penSeen: boolean;
  // The last non-empty contact set, kept after every finger lifts so the
  // measurement can be read (and photographed) with the hand off the glass.
  lastContacts: TouchDebugContact[];
  // Session peaks, kept so a single press can be read after the fact.
  peakWidth: number;
  peakHeight: number;
  peakType: string | null;
  peakFingers: number;
}

const EMPTY: TouchDebugSnapshot = {
  contacts: [],
  fingers: 0,
  palms: 0,
  mode: "single",
  multi: false,
  penLock: false,
  penSeen: false,
  lastContacts: [],
  peakWidth: 0,
  peakHeight: 0,
  peakType: null,
  peakFingers: 0,
};

let enabled = false;
let snapshot: TouchDebugSnapshot = EMPTY;
const listeners = new Set<(s: TouchDebugSnapshot) => void>();

function emit(): void {
  for (const fn of listeners) fn(snapshot);
}

export function isTouchDebugEnabled(): boolean {
  return enabled;
}

// Turning it on clears the peaks, so each measurement run starts fresh.
export function setTouchDebugEnabled(on: boolean): void {
  enabled = on;
  snapshot = { ...EMPTY };
  emit();
}

export function subscribeTouchDebug(fn: (s: TouchDebugSnapshot) => void): () => void {
  listeners.add(fn);
  fn(snapshot);
  return () => {
    listeners.delete(fn);
  };
}

type TouchDebugInput = Omit<
  TouchDebugSnapshot,
  "lastContacts" | "peakWidth" | "peakHeight" | "peakType" | "peakFingers"
>;

// Fed by the touch router on every pointer event while the probe is on.
export function publishTouchDebug(next: TouchDebugInput): void {
  if (!enabled) return;
  let { peakWidth, peakHeight, peakType } = snapshot;
  for (const c of next.contacts) {
    if (c.width > peakWidth || c.height > peakHeight) peakType = c.type;
    peakWidth = Math.max(peakWidth, c.width);
    peakHeight = Math.max(peakHeight, c.height);
  }
  snapshot = {
    ...next,
    lastContacts: next.contacts.length > 0 ? next.contacts : snapshot.lastContacts,
    peakWidth,
    peakHeight,
    peakType,
    peakFingers: Math.max(snapshot.peakFingers, next.fingers),
  };
  emit();
}

function num(n: number): string {
  return Number.isFinite(n) ? (Math.round(n * 10) / 10).toFixed(1) : "?";
}

// Corner readout. Non-interactive and fixed, so it never takes a touch itself.
export function TouchDebugOverlay(): ReactNode {
  const [on, setOn] = useState(enabled);
  const [s, setS] = useState(snapshot);
  useEffect(
    () =>
      subscribeTouchDebug((next) => {
        setOn(isTouchDebugEnabled());
        setS(next);
      }),
    [],
  );
  if (!on) return null;
  const live = s.contacts.length > 0;
  const rows = live ? s.contacts : s.lastContacts;
  return (
    <div className="pointer-events-none fixed bottom-2 left-2 z-50 max-w-[85vw] rounded-lg bg-black/80 px-3 py-2 font-mono text-white">
      <div className="text-[14px] leading-[20px]">
        fingers {s.fingers} · palms {s.palms} · {s.mode}
        {s.multi ? " · multi" : ""}
        {s.penLock ? " · penLock" : ""}
        {s.penSeen ? " · penSeen" : ""}
      </div>
      {rows.length === 0 ? (
        <div className="text-[16px] leading-[24px] opacity-60">no contact yet</div>
      ) : (
        rows.map((c) => (
          <div key={c.id} className={"text-[17px] leading-[25px] " + (live ? "" : "opacity-70")}>
            #{c.id} {c.type} {num(c.width)} × {num(c.height)}
            {c.palm ? " PALM" : ""}
            {live ? "" : " (lifted)"}
          </div>
        ))
      )}
      <div className="text-[15px] leading-[22px] text-amber-200">
        peak {num(s.peakWidth)} × {num(s.peakHeight)}
        {s.peakType ? ` (${s.peakType})` : ""} · max fingers {s.peakFingers}
      </div>
    </div>
  );
}
