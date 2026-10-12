// The provider, models and STT endpoint are this device's (docs/36): the
// credentials that make them callable live in credentials.json, which does not
// sync. The real settings store runs here against two in-memory devices that
// share one synced settings.json, plus the one-time takeover the shell does on
// the first start after the update (loadShellSettings). Run: bun test.

import { expect, test } from "bun:test";
import type { GuardedRead } from "../../src/platform/app/atomic-fs";
import {
  createSettingsStore,
  DEFAULT_SETTINGS,
  DEVICE_SETTING_KEYS,
  type DeviceBoundSettings,
  type Settings,
  type SettingsStore,
} from "../../src/platform/app/settings";
import { defaultModelFor, deviceModelFromAccount } from "../../src/ai/providers";
import type { ProviderId } from "../../src/ai/auth/provider-ids";
import {
  loadShellSettings,
  type SettingsAccess,
} from "../../src/ui/components/common/useShellBootstrap";

interface Device {
  store: SettingsStore;
  device: Partial<DeviceBoundSettings>;
  settingsWrites: number;
}

// One account file, shared the way sync shares it: whatever a device last
// wrote is what the other reads after a pull.
function account(initial: Record<string, unknown> | null = null) {
  return { text: initial ? JSON.stringify(initial) : null } as { text: string | null };
}

function makeDevice(shared: { text: string | null }): Device {
  const d: Device = { store: null as unknown as SettingsStore, device: {}, settingsWrites: 0 };
  d.store = createSettingsStore({
    read: async (): Promise<GuardedRead<Partial<Settings>>> =>
      shared.text === null ? { status: "missing" } : { status: "ok", value: JSON.parse(shared.text) },
    write: async (contents) => {
      d.settingsWrites++;
      shared.text = contents;
    },
    readDevice: async () => ({ ...d.device }),
    writeDevice: async (values) => {
      d.device = { ...values };
    },
    schedule: () => 0,
    cancel: () => {},
    bindExit: () => {},
    onError: (e) => {
      throw e;
    },
  });
  return d;
}

const GPT = defaultModelFor("openai");
const CLAUDE = defaultModelFor("anthropic");

test("two devices signed in to different providers each keep their own through a pull", async () => {
  const shared = account(DEFAULT_SETTINGS as unknown as Record<string, unknown>);
  const a = makeDevice(shared);
  const b = makeDevice(shared);

  a.store.save({ ...(await a.store.load()), defaultProviderId: "openai", defaultModelId: GPT });
  await a.store.flush();
  b.store.save({
    ...(await b.store.load()),
    defaultProviderId: "anthropic",
    defaultModelId: CLAUDE,
    sttApiBase: "https://stt.b.test",
    aiLanguage: "ja",
  });
  await b.store.flush();

  // A pulls B's settings.json: the account's setting arrives, B's provider and
  // STT host do not.
  const onA = await a.store.load();
  expect(onA.aiLanguage).toBe("ja");
  expect(onA.defaultProviderId).toBe("openai");
  expect(onA.defaultModelId).toBe(GPT);
  expect(onA.sttApiBase).toBeNull();

  const onB = await b.store.load();
  expect(onB.defaultProviderId).toBe("anthropic");
  expect(onB.defaultModelId).toBe(CLAUDE);
  expect(onB.sttApiBase).toBe("https://stt.b.test");
});

test("a save leaves the old build's provider keys in settings.json as they were", async () => {
  const shared = account({ ...DEFAULT_SETTINGS, defaultProviderId: "deepseek", defaultModelId: "x" });
  const d = makeDevice(shared);
  d.store.save({ ...(await d.store.load()), defaultProviderId: "openai", defaultModelId: GPT, meals: true });
  await d.store.flush();
  const file = JSON.parse(shared.text ?? "{}") as Record<string, unknown>;
  expect(file.defaultProviderId).toBe("deepseek");
  expect(file.defaultModelId).toBe("x");
  expect(file.meals).toBe(true);
  expect(d.device.defaultProviderId).toBe("openai");
});

test("a file that never had the device keys does not grow them", async () => {
  const shared = account({ aiLanguage: "ko" });
  const d = makeDevice(shared);
  d.store.save({ ...(await d.store.load()), defaultProviderId: "openai" });
  await d.store.flush();
  const file = JSON.parse(shared.text ?? "{}") as Record<string, unknown>;
  for (const key of DEVICE_SETTING_KEYS) expect(key in file).toBe(false);
});

// The settings panel's write path: picking a provider or model hands the shell
// a whole Settings with that field changed, and the shell saves it.
test("changing only the provider or model writes device.json and not settings.json", async () => {
  const shared = account(DEFAULT_SETTINGS as unknown as Record<string, unknown>);
  const d = makeDevice(shared);
  const before = shared.text;
  d.store.save({ ...(await d.store.load()), defaultProviderId: "anthropic", defaultModelId: CLAUDE });
  await d.store.flush();
  expect(d.settingsWrites).toBe(0);
  expect(shared.text).toBe(before);
  expect(d.device).toMatchObject({ defaultProviderId: "anthropic", defaultModelId: CLAUDE });
  expect(await d.store.deviceOwned()).toBe(true);
});

test("before the takeover the device reads settings.json's values", async () => {
  const shared = account({ ...DEFAULT_SETTINGS, defaultProviderId: "openai", sttModel: "sense" });
  const d = makeDevice(shared);
  expect(await d.store.deviceOwned()).toBe(false);
  const s = await d.store.load();
  expect(s.defaultProviderId).toBe("openai");
  expect(s.sttModel).toBe("sense");
});

// -- the one-time takeover --------------------------------------------------

test("the account's choice stands when this device is signed in to that provider", () => {
  expect(
    deviceModelFromAccount(
      { defaultProviderId: "openai", defaultModelId: GPT, everydayModelId: "cheap" },
      "openai",
    ),
  ).toEqual({ defaultProviderId: "openai", defaultModelId: GPT, everydayModelId: "cheap" });
});

test("another device's choice gives way to this device's provider defaults", () => {
  expect(
    deviceModelFromAccount(
      { defaultProviderId: "openai", defaultModelId: GPT, everydayModelId: "cheap" },
      "anthropic",
    ),
  ).toEqual({ defaultProviderId: "anthropic", defaultModelId: CLAUDE, everydayModelId: null });
});

test("a device signed in to nothing keeps nothing", () => {
  expect(
    deviceModelFromAccount({ defaultProviderId: "openai", defaultModelId: GPT, everydayModelId: null }, null),
  ).toEqual({ defaultProviderId: null, defaultModelId: null, everydayModelId: null });
});

function shellOver(d: Device, signedIn: () => Promise<ProviderId | null>): SettingsAccess {
  return {
    load: d.store.load,
    save: d.store.save,
    flush: d.store.flush,
    deviceOwned: d.store.deviceOwned,
    signedIn,
  };
}

test("first start, same provider: the device takes the account's choice into device.json", async () => {
  const shared = account({ ...DEFAULT_SETTINGS, defaultProviderId: "openai", defaultModelId: GPT, sttModel: "sense" });
  const d = makeDevice(shared);
  const { settings } = await loadShellSettings(shellOver(d, async () => "openai"));
  await d.store.flush();
  expect(settings.defaultProviderId).toBe("openai");
  expect(d.device).toMatchObject({ defaultProviderId: "openai", defaultModelId: GPT, sttModel: "sense" });
});

test("first start, other provider: the device starts on its own provider's defaults", async () => {
  const shared = account({ ...DEFAULT_SETTINGS, defaultProviderId: "openai", defaultModelId: GPT });
  const d = makeDevice(shared);
  const { settings, notice } = await loadShellSettings(shellOver(d, async () => "anthropic"));
  await d.store.flush();
  expect(notice).toBeNull();
  expect(settings.defaultProviderId).toBe("anthropic");
  expect(settings.defaultModelId).toBe(CLAUDE);
  expect(d.device).toMatchObject({ defaultProviderId: "anthropic", defaultModelId: CLAUDE });
  // The old build's value stays for the old build.
  expect((JSON.parse(shared.text ?? "{}") as Settings).defaultProviderId).toBe("openai");
});

test("credentials that cannot be read leave the takeover for the next start", async () => {
  const shared = account({ ...DEFAULT_SETTINGS, defaultProviderId: "openai", defaultModelId: GPT });
  const d = makeDevice(shared);
  const { settings } = await loadShellSettings(
    shellOver(d, async () => {
      throw new Error("EIO");
    }),
  );
  await d.store.flush();
  expect(settings.defaultProviderId).toBe("openai");
  expect(await d.store.deviceOwned()).toBe(false);
});

test("a device that already took over is not asked again", async () => {
  const shared = account({ ...DEFAULT_SETTINGS, defaultProviderId: "openai", defaultModelId: GPT });
  const d = makeDevice(shared);
  d.device = { defaultProviderId: "anthropic", defaultModelId: CLAUDE, everydayModelId: null };
  let asked = false;
  const { settings } = await loadShellSettings(
    shellOver(d, async () => {
      asked = true;
      return "openai";
    }),
  );
  expect(asked).toBe(false);
  expect(settings.defaultProviderId).toBe("anthropic");
});
