// Starting with the machine (docs/36). Optional, off by default, and a property
// of this device rather than of the account — the choice is stored in
// device.json and never synced.
//
// Two records of the same fact: device.json says what the user asked for, and
// the OS says what is actually registered (a login item on macOS, a registry
// run key on Windows, a .desktop file under ~/.config/autostart on Linux). The
// stored intent is the one that wins. Startup reconciles the OS to it, which is
// also what repairs a registration a system upgrade or a cleaner removed.

import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";
import { loadDeviceSettings } from "./device";
import { platform } from "@tauri-apps/plugin-os";

// Where there is a login sequence to join. Mobile has none — an iOS app does not
// choose to be running — so the setting does not appear there at all.
const AUTOSTART_PLATFORMS = new Set(["linux", "macos", "windows"]);

function hasLoginSequence(): boolean {
  try {
    return AUTOSTART_PLATFORMS.has(platform());
  } catch {
    // Not running under Tauri (unit tests, plain-browser dev).
    return false;
  }
}

// What a dev build would register is the binary it is running, and that binary
// loads the vite dev server (devUrl in tauri.conf.json). Started at login there
// is no server to load and the window comes up on a connection-refused page, so
// this build stays out of the login sequence whatever the platform can do.
function isDevBuild(): boolean {
  return import.meta.env.DEV === true;
}

// Whether the switch exists here at all. False hides the card in settings and
// makes setAutostart a no-op.
export function hasAutostart(): boolean {
  return hasLoginSequence() && !isDevBuild();
}

// What to do to the OS to make it agree with the stored intent, or null when it
// already does. Separated out because it is the whole decision, and the two
// calls it chooses between are not testable.
export function autostartAction(desired: boolean, registered: boolean): "enable" | "disable" | null {
  if (desired === registered) return null;
  return desired ? "enable" : "disable";
}

// The same decision at startup, where a dev build is its own case: it disables
// every time, which clears the registration an earlier dev run left behind. The
// stored intent is read and not acted on — the user asked for this machine to
// start the app, and that answer keeps waiting for a packaged build to honour.
export function startupAutostartAction(
  dev: boolean,
  desired: boolean,
  registered: boolean,
): "enable" | "disable" | null {
  if (dev) return "disable";
  return autostartAction(desired, registered);
}

// Make the OS agree with device.json. Called once at startup. Failures are
// logged and swallowed: an app that cannot register itself for login still runs.
export async function applyStoredAutostart(): Promise<void> {
  if (!hasLoginSequence()) return;
  try {
    const { autostart } = await loadDeviceSettings();
    const action = startupAutostartAction(isDevBuild(), autostart, await isEnabled());
    if (action === "enable") await enable();
    else if (action === "disable") await disable();
  } catch (e) {
    console.warn("failed to reconcile autostart", e);
  }
}

// The OS half of the switch. The stored intent is the caller's — it holds
// device.json already — and it records it first, so a failure to register leaves
// the stored answer as the user set it and the next startup tries again.
export async function setAutostart(on: boolean): Promise<void> {
  if (!hasAutostart()) return;
  if (on) await enable();
  else await disable();
}
