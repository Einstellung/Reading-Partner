// This device's experiment switches (registry.ts), read synchronously after
// initDeviceSettings, the same as currentDeviceRole. Before that every one is
// off: a feature that is not shown until the file is read is the safe mistake.

import {
  currentDeviceExperiments,
  patchDeviceSettings,
  subscribeDeviceSettings,
} from "../app/device";
import { isOn, withExperiment, type ExperimentId } from "./registry";

export function experimentOn(id: ExperimentId): boolean {
  return isOn(currentDeviceExperiments(), id);
}

/** Written through device.json's patch, so the other device fields are untouched. */
export function setExperiment(id: ExperimentId, on: boolean): Promise<void> {
  return patchDeviceSettings({ experiments: withExperiment(currentDeviceExperiments(), id, on) });
}

/** Told whenever device.json's in-memory copy changes, which covers every switch here. */
export function subscribeExperiments(listener: () => void): () => void {
  return subscribeDeviceSettings(listener);
}
