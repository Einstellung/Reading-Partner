// One experiment on this device (platform/experiments), kept current: a flip in
// Settings redraws every screen that asked.

import { useMemo, useSyncExternalStore } from "react";
import type { ExperimentId } from "../../../platform/experiments/registry";
import { experimentOn, subscribeExperiments } from "../../../platform/experiments/state";
import type { ExperimentGates } from "../base/experiment-gates";

/** Whether the feature is shown: its switch on. */
export function useExperiment(id: ExperimentId): boolean {
  return useSyncExternalStore(
    subscribeExperiments,
    () => experimentOn(id),
    () => experimentOn(id),
  );
}

/** Both, for the shells, which hand them down as plain booleans. */
export function useExperimentGates(): ExperimentGates {
  const meals = useExperiment("meals");
  const companion = useExperiment("companion");
  return useMemo(() => ({ meals, companion }), [meals, companion]);
}
