// Per-device settings (docs/36). settings.json is the account's and syncs;
// this file is the machine's and does not.
//
// The distinction is not a filing convenience. One machine starting with the
// computer says nothing about another. A synced value would carry a laptop's
// answer onto a desktop it is wrong for, and there is no merge that fixes that —
// the two devices genuinely disagree.
//
// device.json is out of the sync range by omission (platform/sync/syncFs.ts):
// the range is a whitelist, and nothing here is on it. There is a test.

import { readGuardedJson, writeTextAtomic, type GuardedRead } from "./atomic-fs";

const DEVICE_FILE = "device.json";

export interface DeviceSettings {
  // This machine's identity, generated once on first run. It names the files a
  // device writes for the others to read (dream-runs/<id>.json, its holdings
  // tree), which is why it has to survive restarts and why two machines must
  // never end up sharing one.
  //
  // role and backgroundCollect used to be here: whether this machine collected
  // for the briefing, and later whether it stood for the nightly work. Intel is
  // gone and every device does that work now. An old file still carrying the
  // keys rides through load/save as unknown keys; nothing reads them.
  deviceId: string;
  // Start the app when the machine starts. Off unless the user says otherwise:
  // a program that installs itself into the login sequence uninvited is a
  // program people uninstall.
  autostart: boolean;
  // How large the maximized chat window sets its content, as a multiplier on the
  // body size (ui/components/base/chat-scale.ts). Per-device because a 4K
  // desktop and an iPad held at arm's length do not have the same answer, and a
  // synced one would carry the wrong answer onto the other.
  //
  // fingerDraw used to be here: a finger marks only by a hold now (docs/82), so
  // there is nothing left to switch. An old file still carrying the key rides
  // through load/save as an unknown key; nothing reads it.
  chatScale: number;
  // Whether this phone has already been told that a PDF here opens as a lesson
  // rather than as pages (docs/70). Per-device because the sentence is about
  // what a tap does on this machine: an iPad, which does draw the pages, has
  // nothing to learn from it, and a synced "seen" would swallow the one
  // explanation the phone owes a reader.
  lessonIntroSeen: boolean;
  // Which entries of Settings › Experiments are on (platform/experiments,
  // docs/reading/688). Absent or missing an id means off. Per-device: an
  // unfinished feature tried on one machine says nothing about another. An id
  // the registry no longer has stays in the file and is not read.
  experiments?: Record<string, boolean>;
  // The settings that only work with a credential that does not sync
  // (DEVICE_SETTING_KEYS in settings.ts): the provider and models a call goes
  // to, and the STT host and model. Owned by the settings store, which joins
  // them into the Settings object callers see; nothing here reads them.
  // Absent until this device has taken them over from settings.json — absence
  // is what tells the first start after the update to do that.
  defaultProviderId?: string | null;
  defaultModelId?: string | null;
  everydayModelId?: string | null;
  voiceFrontModelId?: string | null;
  voiceFrontThinking?: "off" | "low";
  sttApiBase?: string | null;
  sttModel?: string | null;
}

export const DEFAULT_DEVICE_SETTINGS: DeviceSettings = {
  deviceId: "",
  autostart: false,
  chatScale: 1,
  lessonIntroSeen: false,
};

// What a first run has to fill in: an identity. Everything else is defaulted,
// with no clause of its own.
//
// Pure, so it is testable; the id source is injected.
export function initialDeviceSettings(
  stored: Partial<DeviceSettings>,
  newId: () => string,
): { settings: DeviceSettings; changed: boolean } {
  const settings: DeviceSettings = {
    ...DEFAULT_DEVICE_SETTINGS,
    ...stored,
    deviceId: stored.deviceId || newId(),
  };
  return { settings, changed: settings.deviceId !== stored.deviceId };
}

function parseStored(raw: unknown): Partial<DeviceSettings> | null {
  return raw && typeof raw === "object" ? (raw as Partial<DeviceSettings>) : null;
}

// Everything the store reaches outside itself, passed in rather than imported,
// so a test can run the real store against its own file.
export interface DeviceIo {
  read: () => Promise<GuardedRead<Partial<DeviceSettings>>>;
  write: (contents: string) => Promise<void>;
  newId: () => string;
}

export interface DeviceStore {
  load: () => Promise<DeviceSettings>;
  init: () => Promise<DeviceSettings>;
  id: () => string;
  save: (settings: DeviceSettings) => Promise<void>;
  patch: (patch: Partial<DeviceSettings>) => Promise<void>;
  // The experiments map as last read or written, {} until init.
  experiments: () => Record<string, boolean>;
  // Told after every change to the in-memory copy: init, load, save.
  subscribe: (listener: () => void) => () => void;
}

export function createDeviceStore(io: DeviceIo): DeviceStore {
  // The one in-memory copy, so the id can be answered without a read on every
  // call. Filled by init and kept in step by save.
  let cached: DeviceSettings | null = null;
  const listeners = new Set<() => void>();
  function setCached(next: DeviceSettings): void {
    cached = next;
    for (const listener of [...listeners]) listener();
  }

  // Written straight through, not debounced: these change when a user flips a
  // switch, which is rare enough that a write per flip costs nothing.
  function save(settings: DeviceSettings): Promise<void> {
    setCached(settings);
    return io.write(JSON.stringify(settings, null, 2));
  }

  // Missing is the normal first-run case and means the defaults. Unreadable is
  // treated the same way here, and deliberately: a device file holds preferences
  // a user can set again in a second, not data the app cannot rebuild, so the
  // read guard's quarantine is enough and nothing has to be blocked from
  // writing.
  async function load(): Promise<DeviceSettings> {
    const read = await io.read();
    const stored = read.status === "ok" ? read.value : {};
    const settings = { ...DEFAULT_DEVICE_SETTINGS, ...stored };
    setCached(settings);
    return settings;
  }

  return {
    load,
    // The first read of the session: give a machine that has never had one an
    // identity. Called once at startup, before anything asks for the id.
    init: async () => {
      const read = await io.read();
      const stored = read.status === "ok" ? read.value : {};
      const { settings, changed } = initialDeviceSettings(stored, io.newId);
      setCached(settings);
      if (changed) await save(settings).catch(() => {});
      return settings;
    },
    id: () => cached?.deviceId ?? "",
    save,
    // One field, without the caller having to hold the rest of the file. A
    // whole-object save carries whatever copy the caller last read, so two
    // screens that each own a different setting undo each other; a patch merges
    // onto the live copy.
    patch: async (patch) => {
      const current = cached ?? (await load());
      await save({ ...current, ...patch });
    },
    experiments: () => cached?.experiments ?? {},
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

const store = createDeviceStore({
  read: () => readGuardedJson<Partial<DeviceSettings>>(DEVICE_FILE, parseStored),
  write: (contents) => writeTextAtomic(DEVICE_FILE, contents),
  newId: () => crypto.randomUUID(),
});

export function loadDeviceSettings(): Promise<DeviceSettings> {
  return store.load();
}

export function initDeviceSettings(): Promise<DeviceSettings> {
  return store.init();
}

export function currentDeviceId(): string {
  return store.id();
}

export function patchDeviceSettings(patch: Partial<DeviceSettings>): Promise<void> {
  return store.patch(patch);
}

export function currentDeviceExperiments(): Record<string, boolean> {
  return store.experiments();
}

export function subscribeDeviceSettings(listener: () => void): () => void {
  return store.subscribe(listener);
}
