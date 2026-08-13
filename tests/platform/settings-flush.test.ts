// The settings store's write path (src/platform/app/settings.ts): the 500ms
// debounce, the flush on the way out and before a read-back, the refusal to
// write over a file that could not be read, and the reason a sync pull has to be
// read back — a shell holds settings.json whole in memory and the next save
// serialises all of it, so a field another device merged in is undone unless the
// copy is refreshed.
//
// The real store runs here, against an in-memory file and a fake clock handed to
// createSettingsStore. Nothing global is touched: mock.module would swap
// atomic-fs out for every other test file sharing the worker and never put it
// back (pitfall 119), and a fake `window` on globalThis decides for unrelated
// code whether it thinks it is in a browser. Run: bun test.

import { beforeEach, expect, test } from "bun:test";
import type { GuardedRead } from "../../src/platform/app/atomic-fs";
import {
  createSettingsStore,
  DEFAULT_SETTINGS,
  SETTINGS_FILE,
  settingsPullAction,
  type Settings,
  type SettingsIo,
  type SettingsStore,
} from "../../src/platform/app/settings";
import { mergeFile } from "../../src/platform/sync/merge";

let file: string | null = null;
let writes: string[] = [];
let readFails = false;
// Non-null while a write is being held open, so a test can look at the world
// mid-write. Writes complete on their own when it is null.
let heldWrite: Promise<void> | null = null;
let releaseWrite: () => void = () => {};
function holdTheWrite(): void {
  heldWrite = new Promise<void>((resolve) => {
    releaseWrite = () => {
      heldWrite = null;
      resolve();
    };
  });
}

interface Task {
  id: number;
  at: number;
  fn: () => void;
}
let clock = 0;
let nextTimerId = 1;
let tasks: Task[] = [];
let exitFlush: (() => void) | null = null;
let errors: unknown[] = [];

// The store's whole outside world. `read` returns what atomic-fs's guarded read
// returns, including the two failure modes loadSettings tells apart: a missing
// file, and one that could not be read at all.
const io: SettingsIo = {
  read: async (): Promise<GuardedRead<Partial<Settings>>> => {
    if (readFails) return { status: "corrupt", savedAs: null };
    if (file === null) return { status: "missing" };
    return { status: "ok", value: JSON.parse(file) as Partial<Settings> };
  },
  // A real write is writeTextAtomic -> invoke("write_text_file_atomic"), an IPC
  // round-trip: the file cannot change before the first await. Landing it
  // synchronously would let a flush that starts the write without waiting for it
  // pass the read-back tests below.
  write: async (contents: string) => {
    await Promise.resolve();
    if (heldWrite) await heldWrite;
    writes.push(SETTINGS_FILE);
    file = contents;
  },
  schedule: (fn: () => void, ms: number) => {
    const id = nextTimerId++;
    tasks.push({ id, at: clock + ms, fn });
    return id;
  },
  cancel: (id: number) => {
    tasks = tasks.filter((t) => t.id !== id);
  },
  bindExit: (flush: () => void) => {
    exitFlush = flush;
  },
  onError: (e: unknown) => {
    errors.push(e);
  },
};

let store: SettingsStore;

// Let the store's own promises settle (the write is async under the timer).
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function advance(ms: number): Promise<void> {
  clock += ms;
  const due = tasks.filter((t) => t.at <= clock);
  tasks = tasks.filter((t) => t.at > clock);
  for (const t of due) t.fn();
  await settle();
}

async function exit(): Promise<void> {
  exitFlush?.();
  await settle();
}

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
const dec = (b: Uint8Array): string => new TextDecoder().decode(b);
const onDisk = (): Record<string, unknown> =>
  JSON.parse(file ?? "{}") as Record<string, unknown>;

beforeEach(() => {
  file = null;
  writes = [];
  tasks = [];
  clock = 0;
  readFails = false;
  heldWrite = null;
  exitFlush = null;
  errors = [];
  store = createSettingsStore(io);
});

test("repeated edits collapse into one write", async () => {
  store.save({ ...DEFAULT_SETTINGS, aiLanguage: "en" });
  store.save({ ...DEFAULT_SETTINGS, aiLanguage: "ja" });
  await advance(499);
  expect(writes).toEqual([]);
  await advance(1);
  expect(writes).toEqual([SETTINGS_FILE]);
  expect(onDisk().aiLanguage).toBe("ja");
});

// The clobber this store's pull backfill exists for, and the fix. Field-level
// merge lands another device's aiLanguage in the file; the shell is still
// holding the copy it loaded before the pull, and save writes that copy whole —
// so unless the file is read back first, the next save undoes the merge.
test("a pull that is read back keeps the merged field through the next save", async () => {
  file = JSON.stringify(DEFAULT_SETTINGS, null, 2);
  await store.load();

  const base = enc(file);
  const merged = mergeFile({
    path: SETTINGS_FILE,
    base,
    local: base,
    remote: enc(JSON.stringify({ ...DEFAULT_SETTINGS, aiLanguage: "ja" }, null, 2)),
  });
  file = dec(merged.merged);

  expect(settingsPullAction([SETTINGS_FILE], false)).toBe("adopt");
  const backfilled = await store.load();
  expect(backfilled.aiLanguage).toBe("ja");

  store.save({ ...backfilled, autoNotes: false });
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

// The deferred read of a pull races the save debounce: the panel can close
// inside the 500ms, and reading settings.json then hands the shell the file as
// it was before the user's edit. The shell would sit on a copy without it and
// its next save would take it off disk again — the same clobber, reached by
// closing the panel quickly. Without the flush the read below returns the
// pre-edit file.
test("a read that flushes first sees the edit the debounce is still holding", async () => {
  file = JSON.stringify(DEFAULT_SETTINGS, null, 2);
  await store.load();

  // The user changes a field and closes the panel 100ms later.
  store.save({ ...DEFAULT_SETTINGS, aiLanguage: "ko" });
  await advance(100);
  expect(writes).toEqual([]);
  expect(onDisk().aiLanguage).toBe("auto");

  await store.flush();
  const adopted = await store.load();
  expect(adopted.aiLanguage).toBe("ko");
  expect(onDisk().aiLanguage).toBe("ko");
});

// Flushing has to mean the bytes are down, not that the write was started: the
// read is taken the moment flush resolves.
test("flush resolves only once the write it started has landed", async () => {
  store.save({ ...DEFAULT_SETTINGS, aiLanguage: "ko" });
  holdTheWrite();

  let flushed = false;
  const flushing = store.flush().then(() => {
    flushed = true;
  });
  await settle();
  // The write is in the middle of io.write and flush has not resolved.
  expect(writes).toEqual([]);
  expect(flushed).toBe(false);

  releaseWrite();
  await flushing;
  expect(flushed).toBe(true);
  expect(writes).toEqual([SETTINGS_FILE]);
});

// Without this the last 500ms of settings changes are lost on the way out.
test("a pending save is flushed on the way out, exactly once", async () => {
  file = JSON.stringify(DEFAULT_SETTINGS, null, 2);
  await store.load();

  store.save({ ...DEFAULT_SETTINGS, aiLanguage: "ko" });
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
  store.save({ ...DEFAULT_SETTINGS });
  await advance(500);
  writes = [];
  await exit();
  expect(writes).toEqual([]);
});

test("an unreadable file is not overwritten, and the failure is reported", async () => {
  file = "{}";
  readFails = true;
  await store.load();

  store.save({ ...DEFAULT_SETTINGS, aiLanguage: "ja" });
  await advance(500);
  expect(writes).toEqual([]);
  expect(errors.length).toBe(1);

  // A later successful load clears the block.
  readFails = false;
  file = JSON.stringify(DEFAULT_SETTINGS, null, 2);
  await store.load();
  store.save({ ...DEFAULT_SETTINGS, aiLanguage: "ja" });
  await advance(500);
  expect(writes).toEqual([SETTINGS_FILE]);
});
