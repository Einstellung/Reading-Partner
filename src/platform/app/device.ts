// Per-device settings (docs/36). settings.json is the account's and syncs;
// this file is the machine's and does not.
//
// The distinction is not a filing convenience. One machine starting with the
// computer says nothing about another, the same way one machine's role as the
// collector says nothing about another's. A synced value would carry a laptop's
// answer onto a desktop it is wrong for, and there is no merge that fixes that —
// the two devices genuinely disagree.
//
// device.json is out of the sync range by omission (platform/sync/syncFs.ts):
// the range is a whitelist, and nothing here is on it. There is a test.
//
// docs/36 also moves backgroundCollect and fingerDraw here. That migration is
// not done; this file starts with the one setting that never had a home in
// settings.json to begin with.

import { readGuardedJson, writeTextAtomic } from "./atomic-fs";

const DEVICE_FILE = "device.json";

export interface DeviceSettings {
  // Start the app when the machine starts. Off unless the user says otherwise:
  // a program that installs itself into the login sequence uninvited is a
  // program people uninstall.
  autostart: boolean;
}

export const DEFAULT_DEVICE_SETTINGS: DeviceSettings = {
  autostart: false,
};

// Missing is the normal first-run case and means the defaults. Unreadable is
// treated the same way here, and deliberately: a device file holds preferences a
// user can set again in a second, not data the app cannot rebuild, so the read
// guard's quarantine is enough and nothing has to be blocked from writing.
export async function loadDeviceSettings(): Promise<DeviceSettings> {
  const read = await readGuardedJson<Partial<DeviceSettings>>(DEVICE_FILE, (raw) =>
    raw && typeof raw === "object" ? (raw as Partial<DeviceSettings>) : null,
  );
  if (read.status === "ok") return { ...DEFAULT_DEVICE_SETTINGS, ...read.value };
  return { ...DEFAULT_DEVICE_SETTINGS };
}

// Written straight through, not debounced: these change when a user flips a
// switch, which is rare enough that a write per flip costs nothing.
export function saveDeviceSettings(settings: DeviceSettings): Promise<void> {
  return writeTextAtomic(DEVICE_FILE, JSON.stringify(settings, null, 2));
}
