// Self-update of the desktop app from GitHub Releases (docs/72): the host half.
// The schedule and the state are in update-policy.ts; this file binds them to
// the updater and process plugins and holds the one runner the app uses.
//
// Both plugins exist only in a desktop build (src-tauri/Cargo.toml), so off the
// desktop — a phone, a browser, a unit test — nothing here is started and the
// state stays "none". A dev build is left out too: it runs from target/, not
// from an installed bundle, and there is nothing for an update to replace.

import { relaunch } from "@tauri-apps/plugin-process";
import { check } from "@tauri-apps/plugin-updater";
import { platform } from "@tauri-apps/plugin-os";
import { createUpdateRunner, type UpdateHost, type UpdateRunner } from "./update-policy";

const UPDATER_PLATFORMS = new Set(["linux", "macos", "windows"]);

export function hasUpdater(): boolean {
  if (import.meta.env.DEV === true) return false;
  try {
    return UPDATER_PLATFORMS.has(platform());
  } catch {
    // Not running under Tauri (unit tests, plain-browser dev).
    return false;
  }
}

const tauriHost: UpdateHost = {
  async check() {
    const update = await check();
    if (!update) return null;
    return {
      version: update.version,
      download: () => update.download(),
      install: () => update.install(),
      close: () => update.close(),
    };
  },
  relaunch,
};

export const appUpdate: UpdateRunner = createUpdateRunner(tauriHost, {
  every(fn, ms) {
    const id = setInterval(fn, ms);
    return () => clearInterval(id);
  },
});

// Called once at startup. A no-op where there is nothing to update.
export function startUpdateChecks(): void {
  if (hasUpdater()) appUpdate.start();
}
