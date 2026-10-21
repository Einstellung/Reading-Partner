// Whether the companion is on this device's screen, as one value every switch for it
// shows and changes: the wordmark, the phone's title, the reader's More menu,
// the phone reader's Display sheet and Settings (docs/68). The value lives in
// localStorage (corner-pref.ts); this module only lets a change made in one
// place reach the others while they are mounted.

import { useSyncExternalStore } from "react";
import { browserPrefStore } from "../base/pref-store";
import { readCompanionCornerShown, writeCompanionCornerShown } from "./corner-pref";

let shown = true;
let hydrated = false;
const listeners = new Set<() => void>();

function store() {
  return typeof window === "undefined" ? null : browserPrefStore(window);
}

// Read on demand, not at import: a test file with no window imports this too.
export function currentCompanionShown(): boolean {
  if (!hydrated) {
    hydrated = true;
    shown = readCompanionCornerShown(store());
  }
  return shown;
}

export function subscribeCompanionShown(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useCompanionShown(): boolean {
  return useSyncExternalStore(subscribeCompanionShown, currentCompanionShown, currentCompanionShown);
}

export function setCompanionShown(next: boolean): void {
  hydrated = true;
  writeCompanionCornerShown(store(), next);
  if (next === shown) return;
  shown = next;
  for (const listener of listeners) listener();
}

export function toggleCompanionShown(): void {
  setCompanionShown(!currentCompanionShown());
}

// Tests only: forget the cached value so the next read goes back to storage.
export function resetCompanionShownForTest(): void {
  hydrated = false;
  shown = true;
}
