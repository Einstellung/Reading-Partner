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

// The licence this app ships under, shown beside the version. One string, so the
// UI and package.json cannot drift into naming two different licences.
export const LICENSE_NAME = "PolyForm Noncommercial 1.0.0";
