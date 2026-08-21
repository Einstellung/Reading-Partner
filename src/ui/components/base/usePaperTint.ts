// The tint as one value the settings switch can render and change. The state
// that matters lives on <html> and in localStorage (paper-tint.ts); this module
// only mirrors it so a checkbox has something to be checked from.
//
// Module state rather than a component's: the switch is drawn in one dialog
// today, but the value it shows is the app's, and two copies of it could
// disagree about a palette that is by definition global.

import { useSyncExternalStore } from "react";
import {
  applyPaperTint,
  browserTintStore,
  readPaperTint,
  writePaperTint,
} from "./paper-tint";

let enabled = false;
let hydrated = false;
const listeners = new Set<() => void>();

function browserWindow(): Window | null {
  return typeof window === "undefined" ? null : window;
}

// Read on demand rather than at import: this module is pulled in by the settings
// panel, and a module-level read of localStorage would run in every environment
// that so much as imports it, including a test file that has no window.
//
// Synchronous, unlike the chat scale's hydrate — localStorage answers now, so
// the first render already has the real value and the checkbox never draws
// itself unchecked and then corrects.
export function currentPaperTint(): boolean {
  if (!hydrated) {
    hydrated = true;
    const win = browserWindow();
    enabled = win ? readPaperTint(browserTintStore(win)) : false;
  }
  return enabled;
}

export function subscribePaperTint(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function usePaperTint(): boolean {
  return useSyncExternalStore(subscribePaperTint, currentPaperTint, currentPaperTint);
}

// Written and applied together: the attribute is what repaints the app and the
// storage is what survives a relaunch, and a switch that did one without the
// other is a preference that comes back wrong.
export function setPaperTint(on: boolean): void {
  hydrated = true;
  const win = browserWindow();
  if (win) {
    writePaperTint(browserTintStore(win), on);
    applyPaperTint(win.document?.documentElement ?? null, on);
  }
  if (on === enabled) return;
  enabled = on;
  for (const listener of listeners) listener();
}

// Tests only: all of this is module state and outlives a single case.
export function resetPaperTint(): void {
  enabled = false;
  hydrated = false;
  listeners.clear();
}
