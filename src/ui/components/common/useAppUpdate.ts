// The self-update state for the shell to draw (docs/76): "none" until a new
// desktop version has been downloaded, then the version waiting for a restart.
// The schedule and the host calls are in platform/app; this only subscribes.

import { useSyncExternalStore } from "react";
import { appUpdate } from "../../../platform/app/updater";
import type { UpdateState } from "../../../platform/app/update-policy";

export function useAppUpdate(): UpdateState {
  return useSyncExternalStore(appUpdate.subscribe, appUpdate.snapshot, appUpdate.snapshot);
}

export function applyAppUpdate(): void {
  void appUpdate.applyNow();
}
