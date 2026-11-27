// Per-device settings (src/platform/app/device.ts): the identity a first run
// gives a machine, and the store's in-memory copy. Pure; the file access around
// them is not tested here.
// Run: bun test.

import { expect, test } from "bun:test";
import {
  DEFAULT_DEVICE_SETTINGS,
  createDeviceStore,
  initialDeviceSettings,
  type DeviceIo,
  type DeviceSettings,
} from "../src/platform/app/device";

test("a machine with no file gets an identity and the defaults", () => {
  const { settings, changed } = initialDeviceSettings({}, () => "id-1");
  expect(changed).toBe(true);
  expect(settings.deviceId).toBe("id-1");
  expect(settings.chatScale).toBe(DEFAULT_DEVICE_SETTINGS.chatScale);
});

// Everything added to the file since is defaulted the same way, with no clause
// of its own: a field the first run dropped would come back as 1x on a machine
// whose reader had already sized the type.
test("a field with no migration behind it still survives the first run", () => {
  const { settings } = initialDeviceSettings({ deviceId: "id-1", chatScale: 1.4 }, () => "unused");
  expect(settings.chatScale).toBe(1.4);
});

// fingerDraw, role and backgroundCollect were device settings once. A file that
// still has them opens, and the keys are carried, not read.
test("an old file's retired keys are harmless", () => {
  const stored = {
    deviceId: "id-1",
    role: "reader",
    backgroundCollect: false,
    fingerDraw: true,
  } as Partial<DeviceSettings>;
  const { settings, changed } = initialDeviceSettings(stored, () => "unused");
  expect(changed).toBe(false);
  expect(settings.deviceId).toBe("id-1");
});

test("a device that already answered keeps its answer and is not rewritten", () => {
  const stored: DeviceSettings = {
    deviceId: "id-9",
    autostart: true,
    chatScale: 1.4,
    lessonIntroSeen: true,
  };
  const { settings, changed } = initialDeviceSettings(stored, () => "new-id");
  expect(changed).toBe(false);
  expect(settings).toEqual(stored);
});

test("an identity survives across runs", () => {
  const first = initialDeviceSettings({}, () => "id-1").settings;
  const second = initialDeviceSettings(first, () => "id-2").settings;
  expect(second.deviceId).toBe("id-1");
});

// --- the in-memory copy belongs to a store, not to the module ---------------

// It was a module-level `let`, so every test file sharing the worker shared one
// machine's answer. A file that loaded a device file left its identity behind,
// and currentDeviceId() then named that machine for every file after it — which
// is the name a device files its own records under. The patch below is
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
    newId: () => "generated",
  };
  return {
    store: createDeviceStore(io),
    written: () => (text === null ? null : (JSON.parse(text) as Partial<DeviceSettings>)),
  };
}

test("a second store does not answer with the first store's identity", async () => {
  const first = storeOver({ deviceId: "id-9", autostart: true });
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
  await second.store.patch({ lessonIntroSeen: true });

  const out = second.written()!;
  expect(out.lessonIntroSeen).toBe(true);
  // Neither of the other machine's answers came along.
  expect(out.deviceId).toBe(DEFAULT_DEVICE_SETTINGS.deviceId);
  expect(out.autostart).toBe(false);
  expect(out.chatScale).toBe(DEFAULT_DEVICE_SETTINGS.chatScale);
});
