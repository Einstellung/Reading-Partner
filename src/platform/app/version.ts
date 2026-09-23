// The version the running app reports, for the line at the foot of Settings.
//
// Read from Tauri rather than from package.json: the number that matters to
// someone reporting a bug is the one in the bundle they installed
// (tauri.conf.json), and only the host can tell them apart. Outside Tauri —
// browser dev, unit tests — the invoke has no transport and throws, so the
// fallback is a label rather than a number that would be wrong anyway.

import { getVersion } from "@tauri-apps/api/app";

export const UNPACKAGED_VERSION = "dev";

export async function readAppVersion(): Promise<string> {
  try {
    return await getVersion();
  } catch {
    // Not running under Tauri: there is no bundle and so no version.
    return UNPACKAGED_VERSION;
  }
}

// A synchronous cache of the above, for callers that cannot await one — the
// sync engine fills a device's holdings (docs/59) mid-pass and has no room to
// suspend for an IPC round trip there. Kicked off once at import time rather
// than on first call: the read is fast and this module loads well before any
// pass runs, so by the time one asks, the real version is already in.
let cachedVersion: string = UNPACKAGED_VERSION;
void readAppVersion().then((v) => {
  cachedVersion = v;
});

export function currentAppVersion(): string {
  return cachedVersion;
}

// The licence this app ships under, shown beside the version. One string, so the
// UI and package.json cannot drift into naming two different licences.
export const LICENSE_NAME = "PolyForm Strict 1.0.0";
