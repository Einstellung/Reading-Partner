// On-device touch probe. iPad/WKWebView is the only place the reader's touch
// rules can actually be verified, and PointerEvent width/height (the palm
// rejection input) may or may not carry a real contact patch there. This is a
// tiny store the touch router feeds, plus a corner overlay that shows the live
// contacts and the session peaks, so a palm or an elbow pressed against the
// glass can be read off the screen (or photographed).
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
  // Session peaks, kept so a single press can be read after the fact.
  peakContact: { type: string; width: number; height: number } | null;
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
  peakContact: null,
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

// Fed by the touch router on every pointer event while the probe is on.
export function publishTouchDebug(next: Omit<TouchDebugSnapshot, "peakContact" | "peakFingers">): void {
  if (!enabled) return;
  let peakContact = snapshot.peakContact;
  for (const c of next.contacts) {
    const area = c.width * c.height;
    if (!peakContact || area > peakContact.width * peakContact.height) {
      peakContact = { type: c.type, width: c.width, height: c.height };
    }
  }
  snapshot = {
    ...next,
    peakContact,
    peakFingers: Math.max(snapshot.peakFingers, next.fingers),
  };
  emit();
}

function round(n: number): string {
  return Number.isFinite(n) ? (Math.round(n * 10) / 10).toString() : "?";
}

// Corner readout. Non-interactive and fixed, so it never takes a touch itself.
export function TouchDebugOverlay(): ReactNode {
  const [on, setOn] = useState(enabled);
  const [s, setS] = useState(snapshot);
  useEffect(() => subscribeTouchDebug((next) => {
    setOn(isTouchDebugEnabled());
    setS(next);
  }), []);
  if (!on) return null;
  return (
    <div className="pointer-events-none fixed bottom-2 left-2 z-50 max-w-[70vw] rounded-md bg-black/75 px-2 py-1.5 font-mono text-[11px] leading-[15px] text-white">
      <div>
        fingers {s.fingers} palms {s.palms} · {s.mode}
        {s.multi ? " · multi" : ""}
        {s.penLock ? " · penLock" : ""}
        {s.penSeen ? " · penSeen" : ""}
      </div>
      {s.contacts.length === 0 ? (
        <div className="opacity-60">no contact</div>
      ) : (
        s.contacts.map((c) => (
          <div key={c.id}>
            #{c.id} {c.type} {round(c.width)}x{round(c.height)}
            {c.palm ? " PALM" : ""}
          </div>
        ))
      )}
      <div className="opacity-70">
        peak {s.peakContact ? `${s.peakContact.type} ${round(s.peakContact.width)}x${round(s.peakContact.height)}` : "-"} ·
        max fingers {s.peakFingers}
      </div>
    </div>
  );
}
