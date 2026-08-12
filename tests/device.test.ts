// Per-device settings (src/platform/app/device.ts): the role a machine has and
// the one-time migration that moved two settings out of the account's file
// (docs/36). Both are pure; the file access around them is not tested here.
// Run: bun test.

import { expect, test } from "bun:test";
import {
  DEFAULT_DEVICE_SETTINGS,
  deviceRoleFor,
  initialDeviceSettings,
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
