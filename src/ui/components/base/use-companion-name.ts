// The desk companion's name as one value every screen reads: the corner's
// labels, the door chat, the sidebar logo, Settings (docs/companion/90).
//
// The setting is `companionName` in settings.json (platform/app/settings.ts).
// This is a module-level store in the shape i18n/locale.ts has, fed by the
// shell from the same settings state it already holds (useShellBootstrap), so
// there is no second copy of the settings file: a component deep in the tree
// can read the name without the settings being threaded to it, and a change in
// Settings redraws every label at once.

import { useSyncExternalStore } from "react";
import { companionNameOf, DEFAULT_COMPANION_NAME, type Settings } from "../../../platform/app/settings";

let current = DEFAULT_COMPANION_NAME;
const listeners = new Set<() => void>();

export function currentCompanionName(): string {
  return current;
}

export function subscribeCompanionName(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// What the shell calls whenever the settings are read or changed.
export function applyCompanionNameSetting(settings: Pick<Settings, "companionName">): void {
  const next = companionNameOf(settings);
  if (next === current) return;
  current = next;
  for (const listener of listeners) listener();
}

export function useCompanionName(): string {
  return useSyncExternalStore(subscribeCompanionName, currentCompanionName, currentCompanionName);
}

// Tests only: back to the default.
export function resetCompanionNameForTest(): void {
  current = DEFAULT_COMPANION_NAME;
}
