// The settings store's write path (src/platform/app/settings.ts): the 500ms
// debounce, the flush on the way out, the refusal to write over a file that
// could not be read, and the reason a sync pull has to be read back — a shell
// holds settings.json whole in memory and the next save serialises all of it,
// so a field another device merged in is undone unless the copy is refreshed.
// Fake clock + fake window, so the exit listener is a function the test calls.
// Run: bun test.

import { afterEach, beforeEach, expect, mock, test } from "bun:test";

const files = new Map<string, string>();
const writes: string[] = [];
let readFails = false;

// The store reads and writes through atomic-fs and nothing else, so that is the
// seam: an in-memory file plus the two failure modes loadSettings distinguishes
// (a missing file, and one that could not be read at all).
mock.module("../../src/platform/app/atomic-fs", () => ({
  writeTextAtomic: async (path: string, contents: string) => {
    writes.push(path);
    files.set(path, contents);
  },
  quarantineFile: async () => null,
  onCorruptFile: () => {},
  readGuardedJson: async (file: string, validate: (raw: unknown) => unknown) => {
    if (readFails) return { status: "corrupt", savedAs: null };
    const text = files.get(file);
    if (text === undefined) return { status: "missing" };
    const value = validate(JSON.parse(text) as unknown);
    return value === null ? { status: "corrupt", savedAs: null } : { status: "ok", value };
  },
}));

// A fake window: the store schedules through window.setTimeout and binds its
// exit flush through window's listeners, and nothing else here needs a DOM.
interface Task {
  id: number;
  at: number;
  fn: () => void;
}
let clock = 0;
let nextTimerId = 1;
let tasks: Task[] = [];
const exitListeners = new Set<() => void>();
const fakeWindow = {
  setTimeout(fn: () => void, ms: number): number {
    const id = nextTimerId++;
    tasks.push({ id, at: clock + ms, fn });
    return id;
  },
  clearTimeout(id: number): void {
    tasks = tasks.filter((t) => t.id !== id);
  },
  addEventListener(type: string, fn: () => void): void {
    if (type === "pagehide") exitListeners.add(fn);
  },
  removeEventListener(type: string, fn: () => void): void {
    if (type === "pagehide") exitListeners.delete(fn);
  },
};

// Installed per test and taken away again. globalThis is shared with every other
// test file in the worker, so a fake window left standing decides for unrelated
// code whether it thinks it is in a browser.
const hadWindow = "window" in globalThis;
const realWindow = (globalThis as { window?: unknown }).window;
function useFakeWindow(): void {
  (globalThis as { window?: unknown }).window = fakeWindow;
}
function restoreWindow(): void {
  if (hadWindow) (globalThis as { window?: unknown }).window = realWindow;
  else delete (globalThis as { window?: unknown }).window;
}

// Let the store's own promises settle (the write is async under the timer).
function settle(): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, 0));
}

async function advance(ms: number): Promise<void> {
  clock += ms;
  const due = tasks.filter((t) => t.at <= clock);
  tasks = tasks.filter((t) => t.at > clock);
  for (const t of due) t.fn();
  await settle();
}

async function exit(): Promise<void> {
  for (const fn of [...exitListeners]) fn();
  await settle();
}

const {
  DEFAULT_SETTINGS,
  loadSettings,
  onSettingsSaveError,
  saveSettings,
  SETTINGS_FILE,
  settingsPullAction,
} = await import("../../src/platform/app/settings");
const { mergeFile } = await import("../../src/platform/sync/merge");

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
const dec = (b: Uint8Array): string => new TextDecoder().decode(b);
const onDisk = (): Record<string, unknown> =>
  JSON.parse(files.get(SETTINGS_FILE) ?? "{}") as Record<string, unknown>;

beforeEach(() => {
  files.clear();
  writes.length = 0;
  tasks = [];
  readFails = false;
  useFakeWindow();
});

afterEach(restoreWindow);

test("repeated edits collapse into one write", async () => {
  saveSettings({ ...DEFAULT_SETTINGS, aiLanguage: "en" });
  saveSettings({ ...DEFAULT_SETTINGS, aiLanguage: "ja" });
  await advance(499);
  expect(writes).toEqual([]);
  await advance(1);
  expect(writes).toEqual([SETTINGS_FILE]);
  expect(onDisk().aiLanguage).toBe("ja");
});

// The clobber this store's pull backfill exists for, and the fix. Field-level
// merge lands another device's aiLanguage in the file; the shell is still
// holding the copy it loaded before the pull, and saveSettings writes that copy
// whole — so unless the file is read back first, the next save undoes the merge.
test("a pull that is read back keeps the merged field through the next save", async () => {
  files.set(SETTINGS_FILE, JSON.stringify(DEFAULT_SETTINGS, null, 2));
  await loadSettings();

  const base = enc(files.get(SETTINGS_FILE) as string);
  const merged = mergeFile({
    path: SETTINGS_FILE,
    base,
    local: base,
    remote: enc(JSON.stringify({ ...DEFAULT_SETTINGS, aiLanguage: "ja" }, null, 2)),
  });
  files.set(SETTINGS_FILE, dec(merged.merged));

  expect(settingsPullAction([SETTINGS_FILE], false)).toBe("adopt");
  const backfilled = await loadSettings();
  expect(backfilled.aiLanguage).toBe("ja");

  saveSettings({ ...backfilled, autoNotes: false });
  await advance(500);
  expect(onDisk().aiLanguage).toBe("ja");
  expect(onDisk().autoNotes).toBe(false);
});

test("a pull with the panel open is deferred, not dropped", () => {
  // Nothing to do: this pull did not touch settings.json.
  expect(settingsPullAction(["library.json"], false)).toBe("ignore");
  expect(settingsPullAction(["library.json"], true)).toBe("ignore");
  // The panel holds the values the user is editing right now, so the read waits
  // for it to close. "defer" and not "ignore" is the whole point: a dropped read
  // leaves the shell on its pre-pull copy, which is the clobber above.
  expect(settingsPullAction([SETTINGS_FILE], true)).toBe("defer");
  expect(settingsPullAction([SETTINGS_FILE], false)).toBe("adopt");
});

// Without this the last 500ms of settings changes are lost on the way out.
test("a pending save is flushed on the way out, exactly once", async () => {
  files.set(SETTINGS_FILE, JSON.stringify(DEFAULT_SETTINGS, null, 2));
  await loadSettings();

  saveSettings({ ...DEFAULT_SETTINGS, aiLanguage: "ko" });
  await advance(100);
  expect(writes).toEqual([]);

  await exit();
  expect(writes).toEqual([SETTINGS_FILE]);
  expect(onDisk().aiLanguage).toBe("ko");

  // pagehide can fire more than once, and the timer that was pending must not
  // write a second time either.
  await exit();
  await advance(500);
  expect(writes).toEqual([SETTINGS_FILE]);
});

test("nothing is written on the way out when nothing is pending", async () => {
  await exit();
  expect(writes).toEqual([]);
});

test("an unreadable file is not overwritten, and the failure is reported", async () => {
  files.set(SETTINGS_FILE, "{}");
  readFails = true;
  await loadSettings();
  const errors: unknown[] = [];
  onSettingsSaveError((e) => errors.push(e));

  saveSettings({ ...DEFAULT_SETTINGS, aiLanguage: "ja" });
  await advance(500);
  expect(writes).toEqual([]);
  expect(errors.length).toBe(1);

  // A later successful load clears the block.
  readFails = false;
  files.set(SETTINGS_FILE, JSON.stringify(DEFAULT_SETTINGS, null, 2));
  await loadSettings();
  saveSettings({ ...DEFAULT_SETTINGS, aiLanguage: "ja" });
  await advance(500);
  expect(writes).toEqual([SETTINGS_FILE]);
});
