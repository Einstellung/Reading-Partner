// One experiment on this device (platform/experiments), kept current: a flip in
// Settings redraws every screen that asked.

import { useMemo, useSyncExternalStore } from "react";
import type { ExperimentId } from "../../../platform/experiments/registry";
import { experimentOn, experimentSwitch, subscribeExperiments } from "../../../platform/experiments/state";
import type { ExperimentGates } from "../base/experiment-gates";

/** Whether the feature is shown: its switch and its parent's both on. */
export function useExperiment(id: ExperimentId): boolean {
  return useSyncExternalStore(
    subscribeExperiments,
    () => experimentOn(id),
    () => experimentOn(id),
  );
}

/** The entry's own switch, for the settings panel. */
export function useExperimentSwitch(id: ExperimentId): boolean {
  return useSyncExternalStore(
    subscribeExperiments,
    () => experimentSwitch(id),
    () => experimentSwitch(id),
  );
}

/** All three, for the shells, which hand them down as plain booleans. */
export function useExperimentGates(): ExperimentGates {
  const meals = useExperiment("meals");
  const intel = useExperiment("intel");
  const companion = useExperiment("companion");
  return useMemo(() => ({ meals, intel, companion }), [meals, intel, companion]);
}
