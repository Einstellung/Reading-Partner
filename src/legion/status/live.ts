// background_status on this device: the runner's runs (synced and local), the
// claim files, this device's id and sync, and the registered describers.

import type { AgentTool } from "../durable/contract";
import { appClaims, capabilitiesFor } from "../claim";
import { appRunner } from "../runner/runner";
import { currentDeviceId } from "../../platform/app/device";
import { subscribeSyncStatus } from "../../platform/sync";
import { describerFor } from "./registry";
import { buildBackgroundStatusTool } from "./tool";

function syncNow(): { lastSyncAt: number | null; syncing: boolean } {
  let out = { lastSyncAt: null as number | null, syncing: false };
  // The listener is called with the current status on subscribing.
  const stop = subscribeSyncStatus((s) => {
    out = { lastSyncAt: s.lastSyncAt, syncing: s.engineStarted };
  });
  stop();
  return out;
}

export function liveBackgroundStatusTool(): AgentTool {
  return buildBackgroundStatusTool({
    runs: () => appRunner().list(),
    claims: () => appClaims().readAll(),
    deviceId: currentDeviceId,
    now: () => Date.now(),
    sync: syncNow,
    describer: describerFor,
    requires: capabilitiesFor,
  });
}
