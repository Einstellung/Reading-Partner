// Per-device settings (src/platform/app/device.ts): the role a machine has and
// the one-time migration that moved two settings out of the account's file
// (docs/36). Both are pure; the file access around them is not tested here.
// Run: bun test.

import { expect, test } from "bun:test";
import {
  DEFAULT_DEVICE_SETTINGS,
  createDeviceStore,
  deviceRoleFor,
  initialDeviceSettings,
  type DeviceIo,
  type DeviceSettings,
} from "../src/platform/app/device";

test("a phone or tablet is a reader whatever the file says", () => {
  expect(deviceRoleFor(undefined, true)).toBe("reader");
  expect(deviceRoleFor("reader", true)).toBe("reader");
  // The stored value is not obeyed on mobile: collecting one article body needs
  // tens of seconds of live webview and iOS gives a backgrounded app seconds.
  expect(deviceRoleFor("collector", true)).toBe("reader");
});

test("a desktop collects unless it was told otherwise", () => {
  expect(deviceRoleFor(undefined, false)).toBe("collector");
  expect(deviceRoleFor("collector", false)).toBe("collector");
  expect(deviceRoleFor("reader", false)).toBe("reader");
});

test("a machine with no file gets an identity and the migrated defaults", () => {
  const { settings, changed } = initialDeviceSettings({}, {}, () => "id-1");
  expect(changed).toBe(true);
  expect(settings.deviceId).toBe("id-1");
  expect(settings.role).toBe(DEFAULT_DEVICE_SETTINGS.role);
  expect(settings.backgroundCollect).toBe(true);
  expect(settings.fingerDraw).toBe(false);
  expect(settings.chatScale).toBe(DEFAULT_DEVICE_SETTINGS.chatScale);
});

// Everything added to the file since is defaulted the same way, with no clause
// of its own: a field the first run dropped would come back as 1x on a machine
// whose reader had already sized the type.
test("a field with no migration behind it still survives the first run", () => {
  const { settings } = initialDeviceSettings({ deviceId: "id-1", chatScale: 1.4 }, {}, () => "unused");
  expect(settings.chatScale).toBe(1.4);
});

// The migration reads settings.json once. What was on the account's file is the
// initial value here, so a machine that had collection turned off does not
// silently start collecting on the first run of the new build.
test("the account's old values are taken over on the first run", () => {
  const { settings, changed } = initialDeviceSettings(
    { deviceId: "id-1" },
    { backgroundCollect: false, fingerDraw: true },
    () => "unused",
  );
  expect(changed).toBe(true);
  expect(settings.backgroundCollect).toBe(false);
  expect(settings.fingerDraw).toBe(true);
});

test("a device that already answered keeps its answer and is not rewritten", () => {
  const stored: DeviceSettings = {
    deviceId: "id-9",
    role: "reader",
    autostart: true,
    backgroundCollect: false,
    fingerDraw: true,
    chatScale: 1.4,
  };
  const { settings, changed } = initialDeviceSettings(
    stored,
    // A stale account-level copy must not win over this device's own answer.
    { backgroundCollect: true, fingerDraw: false },
    () => "new-id",
  );
  expect(changed).toBe(false);
  expect(settings).toEqual(stored);
});

test("an identity survives across runs", () => {
  const first = initialDeviceSettings({}, {}, () => "id-1").settings;
  const second = initialDeviceSettings(first, {}, () => "id-2").settings;
  expect(second.deviceId).toBe("id-1");
});

// --- the in-memory copy belongs to a store, not to the module ---------------

// It was a module-level `let`, so every test file sharing the worker shared one
// machine's answer. A file that loaded a device file left its identity behind,
// and currentDeviceId() then named that machine for every file after it — which
// is the name a collector writes its published files under. The patch below is
// the same leak doing damage: a patch merges onto the live copy, so the wrong
// live copy writes another machine's settings into this one's file.

// A store over one file's bytes, with nothing shared but what is passed in.
function storeOver(stored: Partial<DeviceSettings> | null): {
  store: ReturnType<typeof createDeviceStore>;
  written: () => Partial<DeviceSettings> | null;
} {
  let text = stored === null ? null : JSON.stringify(stored);
  const io: DeviceIo = {
    read: async () =>
      text === null
        ? { status: "missing" }
        : { status: "ok", value: JSON.parse(text) as Partial<DeviceSettings> },
    write: async (contents: string) => {
      text = contents;
    },
    legacy: async () => ({}),
    newId: () => "generated",
    isMobile: () => false,
  };
  return {
    store: createDeviceStore(io),
    written: () => (text === null ? null : (JSON.parse(text) as Partial<DeviceSettings>)),
  };
}

test("a second store does not answer with the first store's identity", async () => {
  const first = storeOver({ deviceId: "id-9", role: "reader" });
  await first.store.load();
  expect(first.store.id()).toBe("id-9");

  // A machine that has not read its file yet knows nothing about itself.
  const second = storeOver(null);
  expect(second.store.id()).toBe("");
});

test("a second store patches onto its own file, not the first store's copy", async () => {
  const first = storeOver({ deviceId: "id-9", autostart: true, chatScale: 1.4 });
  await first.store.load();

  const second = storeOver(null);
  await second.store.patch({ fingerDraw: true });

  const out = second.written()!;
  expect(out.fingerDraw).toBe(true);
  // Neither of the other machine's answers came along.
  expect(out.deviceId).toBe(DEFAULT_DEVICE_SETTINGS.deviceId);
  expect(out.autostart).toBe(false);
  expect(out.chatScale).toBe(DEFAULT_DEVICE_SETTINGS.chatScale);
});
