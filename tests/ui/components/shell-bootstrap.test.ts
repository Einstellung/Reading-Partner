// The rules of the shared shell start-up (src/ui/components/common/
// useShellBootstrap.ts), which both shells now mount: a stored default model the
// catalog dropped is corrected and written back once, the deferred read of a
// sync pull waits for the pending save, a provider id the catalog no longer
// carries counts as unconfigured, and the sync-health toast is said once and
// then never again. The hook itself is four lines of wiring around these; they
// are what can be wrong.
//
// The two functions that touch the settings store take it as an argument, so the
// store here is a plain object. mock.module is deliberately not used: it swaps a
// module out for every other test file sharing the worker and is never put back
// (pitfall 117). Run: bun test.

import { expect, test } from "bun:test";
import type { SyncHealthReport } from "../../../src/platform/sync/health";
import type { ProviderInfo } from "../../../src/ai/providers";
import { DEFAULT_SETTINGS, type Settings } from "../../../src/platform/app/settings";
import { defaultModelFor } from "../../../src/ai/providers";
import {
  corruptFileMessage,
  healthToastMessage,
  isConfigured,
  loadShellSettings,
  pulledSettings,
  type SettingsAccess,
} from "../../../src/ui/components/common/useShellBootstrap";

const RETIRED = "claude-from-a-previous-build";

// A settings store that records what was written to it and hands back whatever
// is "on disk" at the time it is read.
function fakeStore(stored: Settings): SettingsAccess & { saved: Settings[]; flushes: number } {
  const saved: Settings[] = [];
  const store = {
    saved,
    flushes: 0,
    load: async () => ({ ...stored }),
    save: (settings: Settings) => {
      saved.push(settings);
    },
    flush: async () => {
      store.flushes++;
    },
  };
  return store;
}

test("a stored model the catalog dropped is corrected, told, and written back once", async () => {
  const store = fakeStore({
    ...DEFAULT_SETTINGS,
    defaultProviderId: "anthropic",
    defaultModelId: RETIRED,
  });

  const { settings, notice } = await loadShellSettings(store);
  expect(settings.defaultModelId).toBe(defaultModelFor("anthropic"));
  expect(notice).toContain(RETIRED);
  expect(store.saved).toEqual([settings]);
});

test("settings the catalog still agrees with are not written back at all", async () => {
  const store = fakeStore({
    ...DEFAULT_SETTINGS,
    defaultProviderId: "anthropic",
    defaultModelId: defaultModelFor("anthropic"),
  });

  const { notice } = await loadShellSettings(store);
  expect(notice).toBeNull();
  expect(store.saved).toEqual([]);
});

// The deferred read races the save debounce: the settings panel can be closed
// inside the 500ms saveSettings holds a change for, and the read would then
// return the file as it was before the edit — this shell would sit on a copy
// without it and its next save would take it back off disk. Without the flush
// the value below is the pre-edit one.
test("the deferred read flushes the pending save before it reads", async () => {
  const order: string[] = [];
  let onDisk: Settings = { ...DEFAULT_SETTINGS, aiLanguage: "ja" };
  const edited: Settings = { ...DEFAULT_SETTINGS, aiLanguage: "ko" };

  const adopted = await pulledSettings({
    flush: async () => {
      order.push("flush");
      onDisk = edited;
    },
    load: async () => {
      order.push("load");
      return onDisk;
    },
    save: () => {},
  });

  expect(order).toEqual(["flush", "load"]);
  expect(adopted.aiLanguage).toBe("ko");
});

const provider = (id: string, configured: boolean): ProviderInfo =>
  ({ id, name: id, authKind: "apiKey", configured }) as ProviderInfo;

const withProvider = (id: string | null, model: string | null): Settings => ({
  ...DEFAULT_SETTINGS,
  defaultProviderId: id,
  defaultModelId: model,
});

test("a provider id that is not in the list counts as unconfigured", () => {
  const list = [provider("anthropic", true)];
  expect(isConfigured(withProvider("anthropic", "m"), list)).toBe(true);
  // The id is gone from the catalog (an older build's settings, or one that
  // arrived over sync).
  expect(isConfigured(withProvider("some-retired-provider", "m"), list)).toBe(false);
  // Present but without credentials, and present without a model.
  expect(isConfigured(withProvider("anthropic", "m"), [provider("anthropic", false)])).toBe(false);
  expect(isConfigured(withProvider("anthropic", null), list)).toBe(false);
  expect(isConfigured(withProvider(null, null), list)).toBe(false);
});

const report = (alert: SyncHealthReport["alert"], message: string | null): SyncHealthReport =>
  ({ health: "unknown", alert, message }) as SyncHealthReport;

test("the sync-health toast is said on the alert and never again", () => {
  expect(healthToastMessage(report("none", null), false)).toBeNull();
  // A warning short of an alert keeps the dot and says nothing.
  expect(healthToastMessage(report("notice", "Last sync failed: EIO"), false)).toBeNull();

  expect(healthToastMessage(report("alert", "sync is not running"), false)).toBe(
    "sync is not running",
  );
  // The verdict is re-evaluated on a timer; the same alert is not repeated.
  expect(healthToastMessage(report("alert", "sync is not running"), true)).toBeNull();
});

test("a quarantined file and one that could not be read are told apart", () => {
  expect(corruptFileMessage({ file: "settings.json", savedAs: "settings.json.corrupt-1" })).toContain(
    "set aside as settings.json.corrupt-1",
  );
  expect(corruptFileMessage({ file: "settings.json", savedAs: null })).toContain(
    "won't be overwritten",
  );
});
