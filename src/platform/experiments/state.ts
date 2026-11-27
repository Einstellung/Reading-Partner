// This device's experiment switches (registry.ts), read synchronously after
// initDeviceSettings, the same as currentDeviceId. Before that every one is
// off: a feature that is not shown until the file is read is the safe mistake.

import {
  currentDeviceExperiments,
  patchDeviceSettings,
  subscribeDeviceSettings,
} from "../app/device";
import { isOn, migrateExperiments, withExperiment, type ExperimentId } from "./registry";

/** Whether the feature is shown: what every caller outside the settings panel asks. */
export function experimentOn(id: ExperimentId): boolean {
  return isOn(currentDeviceExperiments(), id);
}

/** Rewrite a map from before Intel was removed (migrateExperiments), once, after initDeviceSettings. */
export async function migrateStoredExperiments(): Promise<void> {
  const migrated = migrateExperiments(currentDeviceExperiments());
  if (migrated) await patchDeviceSettings({ experiments: migrated });
}

/** Written through device.json's patch, so the other device fields are untouched. */
export function setExperiment(id: ExperimentId, on: boolean): Promise<void> {
  return patchDeviceSettings({ experiments: withExperiment(currentDeviceExperiments(), id, on) });
}

/** Told whenever device.json's in-memory copy changes, which covers every switch here. */
export function subscribeExperiments(listener: () => void): () => void {
  return subscribeDeviceSettings(listener);
}
