// The rules of the shared shell start-up (src/ui/components/common/
// useShellBootstrap.ts), which both shells now mount: a stored default model the
// catalog dropped is corrected and written back once, a provider id the catalog
// no longer carries counts as unconfigured, and the sync-health toast is said
// once and then never again. The hook itself is four lines of wiring around
// these; they are what can be wrong. Run: bun test.

import { beforeEach, expect, mock, test } from "bun:test";
import type { SyncHealthReport } from "../../../src/platform/sync/health";
import type { ProviderInfo } from "../../../src/ai/providers";
import type { Settings } from "../../../src/platform/app/settings";

const files = new Map<string, string>();
const writes: string[] = [];

// The settings store's only seam (see tests/platform/settings-flush.test.ts):
// an in-memory file, so the real store runs and its debounced write is counted.
mock.module("../../../src/platform/app/atomic-fs", () => ({
  writeTextAtomic: async (path: string, contents: string) => {
    writes.push(path);
    files.set(path, contents);
  },
  quarantineFile: async () => null,
  onCorruptFile: () => {},
  readGuardedJson: async (file: string, validate: (raw: unknown) => unknown) => {
    const text = files.get(file);
    if (text === undefined) return { status: "missing" };
    const value = validate(JSON.parse(text) as unknown);
    return value === null ? { status: "corrupt", savedAs: null } : { status: "ok", value };
  },
}));

// The debounced write schedules through window; nothing else here needs a DOM.
interface Task {
  id: number;
  at: number;
  fn: () => void;
}
let clock = 0;
let nextTimerId = 1;
let tasks: Task[] = [];
const fakeWindow = {
  setTimeout(fn: () => void, ms: number): number {
    const id = nextTimerId++;
    tasks.push({ id, at: clock + ms, fn });
    return id;
  },
  clearTimeout(id: number): void {
    tasks = tasks.filter((t) => t.id !== id);
  },
  addEventListener(): void {},
  removeEventListener(): void {},
};

// Only the two tests that make the store write need it, and it goes away again
// afterwards: globalThis is shared with every other test file in the worker, and
// a fake window left standing decides for unrelated code whether it thinks it is
// running in a browser.
async function withFakeWindow(run: () => Promise<void>): Promise<void> {
  const had = "window" in globalThis;
  const real = (globalThis as { window?: unknown }).window;
  (globalThis as { window?: unknown }).window = fakeWindow;
  try {
    await run();
  } finally {
    if (had) (globalThis as { window?: unknown }).window = real;
    else delete (globalThis as { window?: unknown }).window;
  }
}

async function advance(ms: number): Promise<void> {
  clock += ms;
  const due = tasks.filter((t) => t.at <= clock);
  tasks = tasks.filter((t) => t.at > clock);
  for (const t of due) t.fn();
  await new Promise((resolve) => globalThis.setTimeout(resolve, 0));
}

const { corruptFileMessage, healthToastMessage, isConfigured, loadShellSettings } = await import(
  "../../../src/ui/components/common/useShellBootstrap"
);
const { DEFAULT_SETTINGS } = await import("../../../src/platform/app/settings");
const { defaultModelFor } = await import("../../../src/ai/providers");

const RETIRED = "claude-from-a-previous-build";

beforeEach(() => {
  files.clear();
  writes.length = 0;
  tasks = [];
});

test("a stored model the catalog dropped is corrected, told, and written back once", async () => {
  await withFakeWindow(async () => {
    files.set(
      "settings.json",
      JSON.stringify({
        ...DEFAULT_SETTINGS,
        defaultProviderId: "anthropic",
        defaultModelId: RETIRED,
      }),
    );

    const { settings, notice } = await loadShellSettings();
    expect(settings.defaultModelId).toBe(defaultModelFor("anthropic"));
    expect(notice).toContain(RETIRED);

    await advance(500);
    expect(writes).toEqual(["settings.json"]);
    expect((JSON.parse(files.get("settings.json") as string) as Settings).defaultModelId).toBe(
      defaultModelFor("anthropic"),
    );
  });
});

test("settings the catalog still agrees with are not written back at all", async () => {
  await withFakeWindow(async () => {
    files.set(
      "settings.json",
      JSON.stringify({
        ...DEFAULT_SETTINGS,
        defaultProviderId: "anthropic",
        defaultModelId: defaultModelFor("anthropic"),
      }),
    );

    const { notice } = await loadShellSettings();
    expect(notice).toBeNull();
    await advance(500);
    expect(writes).toEqual([]);
  });
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
