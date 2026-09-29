// Whether Lumen is on this device's screen, as one value every switch for it
// shows and changes: the wordmark, the phone's title, the reader's More menu,
// the phone reader's Display sheet and Settings (docs/68). The value lives in
// localStorage (corner-pref.ts); this module only lets a change made in one
// place reach the others while they are mounted.

import { useSyncExternalStore } from "react";
import { browserPrefStore } from "../base/pref-store";
import { readLumenCornerShown, writeLumenCornerShown } from "./corner-pref";

let shown = true;
let hydrated = false;
const listeners = new Set<() => void>();

function store() {
  return typeof window === "undefined" ? null : browserPrefStore(window);
}

// Read on demand, not at import: a test file with no window imports this too.
export function currentLumenShown(): boolean {
  if (!hydrated) {
    hydrated = true;
    shown = readLumenCornerShown(store());
  }
  return shown;
}

export function subscribeLumenShown(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useLumenShown(): boolean {
  return useSyncExternalStore(subscribeLumenShown, currentLumenShown, currentLumenShown);
}

export function setLumenShown(next: boolean): void {
  hydrated = true;
  writeLumenCornerShown(store(), next);
  if (next === shown) return;
  shown = next;
  for (const listener of listeners) listener();
}

export function toggleLumenShown(): void {
  setLumenShown(!currentLumenShown());
}

// Tests only: forget the cached value so the next read goes back to storage.
export function resetLumenShownForTest(): void {
  hydrated = false;
  shown = true;
}
