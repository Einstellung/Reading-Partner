// Live wiring of this device's presence (session.ts) and its daily round
// (daily.ts): the claim files, the device settings, the real clock, sync, the
// window's lifecycle, and memory's two passes.

import { hostname, platform } from "@tauri-apps/plugin-os";
import { appClaims, createClaimWriter, WEBVIEW_FETCH } from "../legion/claim";
import { realTimers } from "../legion/durable/observable-run";
import { runDreamIfDue } from "../memory/dream/live";
import { sweepProseConflictsNow } from "../memory/adjudicate/live";
import { currentDeviceId, currentDeviceRole, loadDeviceSettings } from "../platform/app/device";
import { observeAppExit, observeAppLifecycle } from "../platform/app/lifecycle";
import { hasWebviewFetch } from "../platform/app/platform";
import { subscribeSyncStatus } from "../platform/sync";
import { createDailyRound, DREAM_KIND } from "./daily";
import { createDevicePresence, type DevicePresence } from "./session";

// This machine's name, for a sentence a reader can act on. Asked once — it does
// not change while the app runs — and the platform stands in where the host will
// not say (an unsupported plugin call, a permission that is not granted).
let deviceName: string | null = null;
async function machineName(): Promise<string> {
  if (deviceName !== null) return deviceName;
  try {
    deviceName = (await hostname()) || platformName();
  } catch {
    deviceName = platformName();
  }
  return deviceName;
}

function platformName(): string {
  try {
    return platform();
  } catch {
    return "unknown";
  }
}

function livePresence(): DevicePresence {
  const writer = createClaimWriter<ReturnType<typeof setInterval>>({
    deviceId: currentDeviceId,
    describe: async () => ({
      deviceName: await machineName(),
      platform: platformName(),
      // What this machine can do, as capability tags (legion/claim). Rendering
      // a page in a hidden webview is the only one it has to say anything about.
      capabilities: hasWebviewFetch() ? [WEBVIEW_FETCH] : [],
    }),
    // The device's background switch (docs/36). Still stored under the name it
    // had when collecting the briefing was the work it switched.
    willing: async () => (await loadDeviceSettings()).backgroundCollect,
    readOwn: (id) => appClaims().readOwn(id),
    readAll: () => appClaims().readAll(),
    write: (claim) => appClaims().write(claim),
    now: Date.now,
    setInterval: (fn, ms) => setInterval(fn, ms),
    clearInterval: (handle) => clearInterval(handle),
    subscribeSyncStatus: (cb) =>
      subscribeSyncStatus((s) => cb({ engineStarted: s.engineStarted, lastSyncAt: s.lastSyncAt })),
    // The heartbeat hangs off the way out of the page and nothing else: a
    // desktop whose window is minimised or unfocused while its owner reads on a
    // phone is exactly the machine that has to go on saying it is alive.
    onExit: (cb) => observeAppExit(window, cb),
  });
  const round = createDailyRound({
    elected: () => writer.electedFor(DREAM_KIND),
    dream: () => runDreamIfDue(),
    sweep: () => sweepProseConflictsNow(),
    setTimer: realTimers.setTimer,
    onForeground: (cb) => {
      observeAppLifecycle(window, { onForeground: cb, onBackground: () => {} });
    },
    onExit: (cb) => observeAppExit(window, cb),
  });
  return createDevicePresence({ role: currentDeviceRole, writer, round });
}

let presence: DevicePresence | null = null;

/**
 * Apply what this machine does about background work, whenever the role or the
 * switch changes — and once when device.json first lands, which is how a
 * collector starts at all. A reader falls straight through to giving up its
 * claim. The desktop shell calls it; a phone is always a reader.
 */
export function refreshDevicePresence(): void {
  presence ??= livePresence();
  void presence.refresh().catch((e) => console.warn("failed to apply the background work settings", e));
}
