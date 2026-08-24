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

import { readGuardedJson, writeTextAtomic, type GuardedRead } from "./atomic-fs";
import { isMobilePlatform } from "./platform";
import { loadSettings } from "./settings";

const DEVICE_FILE = "device.json";

// What this machine is for (docs/36). A collector runs the four phases against
// the subscribed sites all day and publishes the briefing; a reader consumes
// what a collector published and sends no request to a subscribed site.
export type DeviceRole = "collector" | "reader";

export interface DeviceSettings {
  // This machine's identity, generated once on first run. It names the files a
  // device writes for the others to read (info-collector-<id>.json,
  // info-ask-<id>.json), which is why it has to survive restarts and why two
  // machines must never end up sharing one.
  deviceId: string;
  role: DeviceRole;
  // Start the app when the machine starts. Off unless the user says otherwise:
  // a program that installs itself into the login sequence uninvited is a
  // program people uninstall.
  autostart: boolean;
  // Whether this collector is collecting at all: docs/35 for what collection is,
  // docs/36 for why the switch belongs to the machine. A reader never reads it.
  backgroundCollect: boolean;
  // Whether a finger may mark the page in the reader. Off means the stylus
  // writes and the finger only ever moves the page, which is what a device with
  // a stylus wants; a device without one turns this on to reach annotation at
  // all. The navigation lock still outranks it: while that is on, nothing draws.
  fingerDraw: boolean;
  // How large the maximized chat window sets its content, as a multiplier on the
  // body size (ui/components/base/chat-scale.ts). Per-device for the same reason
  // fingerDraw is: a 4K desktop and an iPad held at arm's length do not have the
  // same answer, and a synced one would carry the wrong answer onto the other.
  chatScale: number;
}

export const DEFAULT_DEVICE_SETTINGS: DeviceSettings = {
  deviceId: "",
  role: "collector",
  autostart: false,
  backgroundCollect: true,
  fingerDraw: false,
  chatScale: 1,
};

// The role this device actually has, whatever the file says. iOS and Android are
// readers and nothing else: collecting one article body takes tens of seconds of
// live webview and a backgrounded phone gets seconds of runtime (docs/36). The
// stored value is consulted only where there is a choice, and the settings
// screen offers the choice only there.
export function deviceRoleFor(stored: DeviceRole | undefined, mobile: boolean): DeviceRole {
  if (mobile) return "reader";
  return stored === "reader" ? "reader" : "collector";
}

// Whether this platform lets the user pick a role at all.
export function roleIsChoosable(): boolean {
  return !isMobilePlatform();
}

// What a first run on a new build has to fill in: an identity, and the two
// settings that used to live in settings.json. The old keys are copied once as
// the initial value and never read again — a device already on the new build has
// its own answer, and the account-level copy is one machine's opinion carried
// onto another's (docs/36). They are not deleted from settings.json: a device
// still on the old build reads its own copy from there, and a fields merge that
// saw one side drop a key would carry the deletion across.
//
// Pure, so the migration is testable; the id source is injected.
export function initialDeviceSettings(
  stored: Partial<DeviceSettings>,
  legacy: { backgroundCollect?: boolean; fingerDraw?: boolean },
  newId: () => string,
): { settings: DeviceSettings; changed: boolean } {
  const settings: DeviceSettings = {
    ...DEFAULT_DEVICE_SETTINGS,
    ...stored,
    deviceId: stored.deviceId || newId(),
    backgroundCollect:
      stored.backgroundCollect ??
      legacy.backgroundCollect ??
      DEFAULT_DEVICE_SETTINGS.backgroundCollect,
    fingerDraw: stored.fingerDraw ?? legacy.fingerDraw ?? DEFAULT_DEVICE_SETTINGS.fingerDraw,
  };
  const changed =
    settings.deviceId !== stored.deviceId ||
    settings.backgroundCollect !== stored.backgroundCollect ||
    settings.fingerDraw !== stored.fingerDraw;
  return { settings, changed };
}

function parseStored(raw: unknown): Partial<DeviceSettings> | null {
  return raw && typeof raw === "object" ? (raw as Partial<DeviceSettings>) : null;
}

// Everything the store reaches outside itself, passed in rather than imported,
// so a test can run the real store against its own file and its own answer to
// "is this a phone".
export interface DeviceIo {
  read: () => Promise<GuardedRead<Partial<DeviceSettings>>>;
  write: (contents: string) => Promise<void>;
  // The account's old file, read once by the migration below. Anything it
  // throws means there is nothing to inherit.
  legacy: () => Promise<unknown>;
  newId: () => string;
  isMobile: () => boolean;
}

export interface DeviceStore {
  load: () => Promise<DeviceSettings>;
  init: () => Promise<DeviceSettings>;
  role: () => DeviceRole;
  id: () => string;
  save: (settings: DeviceSettings) => Promise<void>;
  patch: (patch: Partial<DeviceSettings>) => Promise<void>;
}

export function createDeviceStore(io: DeviceIo): DeviceStore {
  // The one in-memory copy, so the role can be answered without a read on every
  // call. Filled by init and kept in step by save.
  let cached: DeviceSettings | null = null;

  function withRole(settings: DeviceSettings): DeviceSettings {
    return { ...settings, role: deviceRoleFor(settings.role, io.isMobile()) };
  }

  // Written straight through, not debounced: these change when a user flips a
  // switch, which is rare enough that a write per flip costs nothing.
  function save(settings: DeviceSettings): Promise<void> {
    cached = withRole(settings);
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
    const settings = withRole({ ...DEFAULT_DEVICE_SETTINGS, ...stored });
    cached = settings;
    return settings;
  }

  return {
    load,
    // The first read of the session: give a machine that has never had one an
    // identity, and take over the two settings that used to be the account's.
    // Called once at startup, before anything asks for the role.
    init: async () => {
      const read = await io.read();
      const stored = read.status === "ok" ? read.value : {};
      let legacy: { backgroundCollect?: boolean; fingerDraw?: boolean } = {};
      if (stored.backgroundCollect === undefined || stored.fingerDraw === undefined) {
        try {
          // The two keys are gone from the Settings type and still on disk,
          // which is exactly the shape a one-time migration reads.
          const old = (await io.legacy()) as {
            backgroundCollect?: unknown;
            fingerDraw?: unknown;
          };
          legacy = {
            backgroundCollect:
              typeof old.backgroundCollect === "boolean" ? old.backgroundCollect : undefined,
            fingerDraw: typeof old.fingerDraw === "boolean" ? old.fingerDraw : undefined,
          };
        } catch {
          // Nothing to inherit; the defaults stand.
        }
      }
      const { settings, changed } = initialDeviceSettings(stored, legacy, io.newId);
      cached = withRole(settings);
      if (changed) await save(settings).catch(() => {});
      return cached;
    },
    // The role, for callers that cannot wait for a read: the shells resolve it
    // once at startup and everything after reads this. "reader" until it is
    // known, so a collector's singletons are never constructed by accident on a
    // device that turns out to be a reader — that is the expensive mistake, not
    // its reverse.
    role: () => (cached ? cached.role : "reader"),
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
  };
}

const store = createDeviceStore({
  read: () => readGuardedJson<Partial<DeviceSettings>>(DEVICE_FILE, parseStored),
  write: (contents) => writeTextAtomic(DEVICE_FILE, contents),
  legacy: () => loadSettings(),
  newId: () => crypto.randomUUID(),
  isMobile: isMobilePlatform,
});

export function loadDeviceSettings(): Promise<DeviceSettings> {
  return store.load();
}

export function initDeviceSettings(): Promise<DeviceSettings> {
  return store.init();
}

export function currentDeviceRole(): DeviceRole {
  return store.role();
}

export function currentDeviceId(): string {
  return store.id();
}

export function saveDeviceSettings(settings: DeviceSettings): Promise<void> {
  return store.save(settings);
}

export function patchDeviceSettings(patch: Partial<DeviceSettings>): Promise<void> {
  return store.patch(patch);
}
