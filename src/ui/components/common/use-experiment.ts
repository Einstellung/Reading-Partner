// One experiment's switch on this device (platform/experiments), kept current:
// a flip in Settings redraws every screen that asked.

import { useMemo, useSyncExternalStore } from "react";
import type { ExperimentId } from "../../../platform/experiments/registry";
import { experimentOn, subscribeExperiments } from "../../../platform/experiments/state";
import type { ExperimentGates } from "../base/experiment-gates";

export function useExperiment(id: ExperimentId): boolean {
  return useSyncExternalStore(
    subscribeExperiments,
    () => experimentOn(id),
    () => experimentOn(id),
  );
}

/** All three, for the shells, which hand them down as plain booleans. */
export function useExperimentGates(): ExperimentGates {
  const meals = useExperiment("meals");
  const intel = useExperiment("intel");
  const companion = useExperiment("companion");
  return useMemo(() => ({ meals, intel, companion }), [meals, intel, companion]);
}
