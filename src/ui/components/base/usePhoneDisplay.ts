// The phone reader's display (reading/epub/flow/flow-display.ts) as one value
// two places can show and change: the reader's Aa sheet and Settings, which
// both carry the switch that shows or hides the marks (docs/82). The value is
// this device's and lives in localStorage; this module only lets a change made
// in one place reach the other while both are mounted.
//
// Read through on every snapshot and cached by the stored string, so whatever
// wrote the slot last — this module, a test, another screen — is what renders.

import { useSyncExternalStore } from "react";
import {
  FLOW_DISPLAY_DEFAULT,
  FLOW_DISPLAY_KEY,
  readFlowDisplay,
  writeFlowDisplay,
  type FlowDisplay,
} from "../../../reading/epub/flow/flow-display";
import { browserPrefStore } from "./pref-store";

const listeners = new Set<() => void>();
let lastRaw: string | null | undefined;
let lastValue: FlowDisplay = FLOW_DISPLAY_DEFAULT;
// What this session chose when storage would not keep it.
let unstored: FlowDisplay | null = null;

function store() {
  return typeof window === "undefined" ? null : browserPrefStore(window);
}

export function currentPhoneDisplay(): FlowDisplay {
  const s = store();
  let raw: string | null = null;
  try {
    raw = s?.getItem(FLOW_DISPLAY_KEY) ?? null;
  } catch {
    raw = null;
  }
  if (raw === null && unstored) return unstored;
  if (raw !== lastRaw) {
    lastRaw = raw;
    lastValue = readFlowDisplay(s);
  }
  return lastValue;
}

export function subscribePhoneDisplay(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function usePhoneDisplay(): FlowDisplay {
  return useSyncExternalStore(subscribePhoneDisplay, currentPhoneDisplay, currentPhoneDisplay);
}

export function setPhoneDisplay(next: FlowDisplay): void {
  const s = store();
  writeFlowDisplay(s, next);
  let kept = false;
  try {
    kept = s?.getItem(FLOW_DISPLAY_KEY) === JSON.stringify(next);
  } catch {
    kept = false;
  }
  unstored = kept ? null : next;
  for (const listener of listeners) listener();
}
