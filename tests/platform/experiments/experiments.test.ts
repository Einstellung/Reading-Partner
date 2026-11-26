// Settings › Experiments (platform/experiments): the registry, its catalog
// keys, the platform filter, and the switches' round trip through device.json.

import { expect, test } from "bun:test";
import en from "../../../src/i18n/messages/settings/en";
import {
  EXPERIMENTS,
  experimentsFor,
  isOn,
  migrateExperiments,
  withExperiment,
} from "../../../src/platform/experiments/registry";
import { createDeviceStore, type DeviceIo, type DeviceSettings } from "../../../src/platform/app/device";

test("ids are unique", () => {
  const ids = EXPERIMENTS.map((e) => e.id);
  expect(new Set(ids).size).toBe(ids.length);
  expect(ids).toEqual(["meals", "companion"]);
});

test("every name and summary key has English copy", () => {
  const catalog = en as unknown as Record<string, unknown>;
  for (const e of EXPERIMENTS) {
    for (const key of [e.name, e.summary]) {
      expect(key.startsWith("settings.")).toBe(true);
      expect(typeof catalog[key.slice("settings.".length)]).toBe("string");
    }
  }
});

test("both entries are offered on every platform", () => {
  for (const platform of ["ios", "android", "macos", "windows", "linux", "unknown"]) {
    expect(experimentsFor(platform).map((e) => e.id)).toEqual(["meals", "companion"]);
  }
});

test("absent means off, and only true is on", () => {
  expect(isOn(undefined, "meals")).toBe(false);
  expect(isOn({}, "meals")).toBe(false);
  expect(isOn({ meals: false }, "meals")).toBe(false);
  expect(isOn({ meals: true }, "meals")).toBe(true);
  expect(isOn({ meals: "yes" } as unknown as Record<string, boolean>, "meals")).toBe(false);
});

// Meals sat under Intel until Intel was removed (2026-11): it showed only with both on.
test("a map from before Intel was removed keeps Meals only where both were on", () => {
  expect(migrateExperiments({ intel: true, meals: true })).toEqual({ meals: true });
  expect(migrateExperiments({ intel: true, meals: false })).toEqual({ meals: false });
  expect(migrateExperiments({ intel: false, meals: true })).toEqual({ meals: false });
  expect(migrateExperiments({ intel: false, meals: false })).toEqual({ meals: false });
});

test("a missing field is off, and the other keys ride through", () => {
  expect(migrateExperiments({ intel: true })).toEqual({ meals: false });
  expect(migrateExperiments({ intel: true, meals: true, companion: true, "read-aloud": false })).toEqual({
    meals: true,
    companion: true,
    "read-aloud": false,
  });
});

test("a map with no Intel key is already migrated and is left alone", () => {
  expect(migrateExperiments(undefined)).toBeNull();
  expect(migrateExperiments({})).toBeNull();
  expect(migrateExperiments({ meals: true, companion: true })).toBeNull();
  expect(migrateExperiments({ meals: false })).toBeNull();
});

test("setting one id keeps every other key, unknown ones included", () => {
  expect(withExperiment({ "read-aloud": true, companion: true }, "meals", true)).toEqual({
    "read-aloud": true,
    companion: true,
    meals: true,
  });
  expect(withExperiment(undefined, "companion", false)).toEqual({ companion: false });
});

function storeOver(stored: Partial<DeviceSettings> | null) {
  let text = stored === null ? null : JSON.stringify(stored);
  const io: DeviceIo = {
    read: async () =>
      text === null ? { status: "missing" } : { status: "ok", value: JSON.parse(text) as Partial<DeviceSettings> },
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

test("an existing device file without the field reads as all off, and init does not add it", async () => {
  const { store, written } = storeOver({ deviceId: "id-1", autostart: true });
  await store.init();
  expect(store.experiments()).toEqual({});
  expect(written()?.experiments).toBeUndefined();
});

test("a patch writes the switch, keeps an unknown id on disk, and tells subscribers", async () => {
  const { store, written } = storeOver({ deviceId: "id-1", experiments: { "read-aloud": true } });
  await store.init();
  let told = 0;
  const stop = store.subscribe(() => {
    told += 1;
  });
  await store.patch({ experiments: withExperiment(store.experiments(), "companion", true) });
  expect(told).toBe(1);
  expect(written()?.experiments).toEqual({ "read-aloud": true, companion: true });
  expect(isOn(store.experiments(), "companion")).toBe(true);
  expect(isOn(store.experiments(), "meals")).toBe(false);
  stop();
  await store.patch({ autostart: false });
  expect(told).toBe(1);
  // A patch of another field leaves the switches as they were.
  expect(written()?.experiments).toEqual({ "read-aloud": true, companion: true });
});

test("before the file is read every experiment is off", () => {
  const { store } = storeOver({ experiments: { meals: true } });
  expect(isOn(store.experiments(), "meals")).toBe(false);
});
