// The settings store's write path (src/platform/app/settings.ts): the 500ms
// debounce, the flush on the way out, the refusal to write over a file that
// could not be read, and the reason a sync pull has to be read back — a shell
// holds settings.json whole in memory and the next save serialises all of it,
// so a field another device merged in is undone unless the copy is refreshed.
// Fake clock + fake window, so the exit listener is a function the test calls.
// Run: bun test.

import { beforeEach, expect, mock, test } from "bun:test";

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
(globalThis as { window?: unknown }).window = fakeWindow;

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
  settingsAfterPull,
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
});

test("repeated edits collapse into one write", async () => {
  saveSettings({ ...DEFAULT_SETTINGS, aiLanguage: "en" });
  saveSettings({ ...DEFAULT_SETTINGS, aiLanguage: "ja" });
  await advance(499);
  expect(writes).toEqual([]);
  await advance(1);
  expect(writes).toEqual([SETTINGS_FILE]);
  expect(onDisk().aiLanguage).toBe("ja");
});

// The clobber this store's pull backfill exists for. Field-level merge lands
// another device's aiLanguage in the file; the shell still holds the copy it
// loaded before the pull, and saveSettings writes that copy whole.
test("a shell that keeps its pre-pull copy overwrites what the merge landed", async () => {
  files.set(SETTINGS_FILE, JSON.stringify(DEFAULT_SETTINGS, null, 2));
  const inMemory = await loadSettings();

  const base = enc(files.get(SETTINGS_FILE) as string);
  const merged = mergeFile({
    path: SETTINGS_FILE,
    base,
    local: base,
    remote: enc(JSON.stringify({ ...DEFAULT_SETTINGS, aiLanguage: "ja" }, null, 2)),
  });
  files.set(SETTINGS_FILE, dec(merged.merged));
  expect(onDisk().aiLanguage).toBe("ja");

  saveSettings({ ...inMemory, autoNotes: false });
  await advance(500);
  expect(onDisk().autoNotes).toBe(false);
  expect(onDisk().aiLanguage).toBe("auto");
});

// The other half of the same clobber: read the file back after a pull and the
// merged field is still there when the shell next saves.
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

  const backfilled = await settingsAfterPull([SETTINGS_FILE], false);
  expect(backfilled?.aiLanguage).toBe("ja");

  saveSettings({ ...(backfilled as NonNullable<typeof backfilled>), autoNotes: false });
  await advance(500);
  expect(onDisk().aiLanguage).toBe("ja");
  expect(onDisk().autoNotes).toBe(false);
});

test("nothing is read back for an unrelated pull, or while the panel is open", async () => {
  files.set(SETTINGS_FILE, JSON.stringify(DEFAULT_SETTINGS, null, 2));
  expect(await settingsAfterPull(["library.json"], false)).toBeNull();
  // The panel holds the values the user is editing right now; a pull must not
  // type over them.
  expect(await settingsAfterPull([SETTINGS_FILE], true)).toBeNull();
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
