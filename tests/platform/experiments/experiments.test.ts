// Settings › Experiments (platform/experiments): the registry, its catalog
// keys, the platform filter, and the switches' round trip through device.json.

import { expect, test } from "bun:test";
import en from "../../../src/i18n/messages/settings/en";
import {
  childrenOf,
  EXPERIMENTS,
  experimentsFor,
  isEffective,
  isOn,
  withExperiment,
} from "../../../src/platform/experiments/registry";
import { createDeviceStore, type DeviceIo, type DeviceSettings } from "../../../src/platform/app/device";

test("ids are unique", () => {
  const ids = EXPERIMENTS.map((e) => e.id);
  expect(new Set(ids).size).toBe(ids.length);
  expect(ids).toEqual(["intel", "meals", "companion"]);
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

test("the three entries are offered on every platform", () => {
  for (const platform of ["ios", "android", "macos", "windows", "linux", "unknown"]) {
    expect(experimentsFor(platform).map((e) => e.id)).toEqual(["intel", "meals", "companion"]);
  }
});

test("absent means off, and only true is on", () => {
  expect(isOn(undefined, "meals")).toBe(false);
  expect(isOn({}, "meals")).toBe(false);
  expect(isOn({ meals: false }, "meals")).toBe(false);
  expect(isOn({ meals: true }, "meals")).toBe(true);
  expect(isOn({ meals: "yes" } as unknown as Record<string, boolean>, "meals")).toBe(false);
});

test("Meals sits under Intel: shown only with both on, and its own switch survives Intel going off", () => {
  expect(childrenOf(EXPERIMENTS, "intel").map((e) => e.id)).toEqual(["meals"]);
  expect(childrenOf(EXPERIMENTS, "companion")).toEqual([]);
  expect(isEffective({ meals: true }, "meals")).toBe(false);
  expect(isEffective({ intel: true }, "meals")).toBe(false);
  expect(isEffective({ intel: true, meals: true }, "meals")).toBe(true);
  expect(isEffective({ intel: true }, "intel")).toBe(true);
  expect(isEffective({ companion: true }, "companion")).toBe(true);
  // Intel off and on again: Meals's own value was never touched.
  const off = withExperiment({ intel: true, meals: true }, "intel", false);
  expect(isOn(off, "meals")).toBe(true);
  expect(isEffective(off, "meals")).toBe(false);
  expect(isEffective(withExperiment(off, "intel", true), "meals")).toBe(true);
});

test("the needs-parent line has copy", () => {
  expect(typeof (en as unknown as Record<string, unknown>)["experiments.needsParent"]).toBe("string");
});

test("setting one id keeps every other key, unknown ones included", () => {
  expect(withExperiment({ "read-aloud": true, intel: true }, "meals", true)).toEqual({
    "read-aloud": true,
    intel: true,
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
  await store.patch({ experiments: withExperiment(store.experiments(), "intel", true) });
  expect(told).toBe(1);
  expect(written()?.experiments).toEqual({ "read-aloud": true, intel: true });
  expect(isOn(store.experiments(), "intel")).toBe(true);
  expect(isOn(store.experiments(), "meals")).toBe(false);
  stop();
  await store.patch({ autostart: false });
  expect(told).toBe(1);
  // A patch of another field leaves the switches as they were.
  expect(written()?.experiments).toEqual({ "read-aloud": true, intel: true });
});

test("before the file is read every experiment is off", () => {
  const { store } = storeOver({ experiments: { meals: true } });
  expect(isOn(store.experiments(), "meals")).toBe(false);
});
