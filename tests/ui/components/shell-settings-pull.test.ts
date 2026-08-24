// The wiring in src/ui/components/common/useShellBootstrap.ts that decides when
// the settings read-back runs: the pull route the hook registers, and the effect
// that takes a deferred read once the settings panel is out of the way.
//
// settingsPullAction and pulledSettings are already pinned as units (tests/
// platform/settings-flush.test.ts, tests/ui/components/shell-bootstrap.test.ts).
// What no unit can see is whether the hook calls them, with what, and when: the
// route's matcher, the branch that adopts, the branch that remembers, the flag
// that stops it happening twice, and the unregister on unmount. Deleting any of
// those leaves both unit files green, so the hook is rendered here for real.
//
// The store is the real one — the singleton src/platform/app/settings.ts builds
// at import, debounce and all — with only its two file calls replaced, so the
// last test can state the property the whole fix exists for: a field another
// device merged into settings.json survives this shell's next whole-object save.
// atomic-fs is reached with spyOn rather than mock.module: a spy is one property
// and tests/support/preload.ts puts it back between cases (pitfall 122), where
// mock.module rewrites the registry for every file that runs after this one
// (pitfall 119). The spies go in beforeEach for the same reason: that restore
// would take a module-scope spy down before the first case.
//
// Both file calls land a turn late on purpose. A real read is a Tauri IPC
// round-trip and a real write is writeTextAtomic -> invoke, so nothing can be
// on disk before the promise resolves; a fake that assigns before its first
// await would let a read-back that never waits for the flush pass. Run: bun test.

import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import * as atomicFs from "../../../src/platform/app/atomic-fs";
import type { GuardedRead } from "../../../src/platform/app/atomic-fs";
import {
  DEFAULT_SETTINGS,
  SETTINGS_FILE,
  type Settings,
} from "../../../src/platform/app/settings";
import { mergeFile } from "../../../src/platform/sync/merge";
import { dispatchPull } from "../../../src/platform/sync/pull-routes";
import {
  useShellBootstrap,
  type ShellBootstrap,
} from "../../../src/ui/components/common/useShellBootstrap";
import { useDom } from "../../support/dom";

const { act, cleanup, renderHook } = await useDom();
afterEach(cleanup);

// AppData, as far as this file is concerned. The hook's start-up reads
// device.json and credentials.json through the same two calls, so they are held
// here too rather than special-cased.
const files = new Map<string, string>();
// Reads of settings.json only. The flag that stops a deferred read from being
// taken twice has nothing else to show for itself: a second read hands back the
// same bytes and sets the same state.
let settingsReads = 0;

async function fakeRead<T>(
  file: string,
  validate: (raw: unknown) => T | null,
): Promise<GuardedRead<T>> {
  await Promise.resolve();
  if (file === SETTINGS_FILE) settingsReads++;
  const text = files.get(file);
  if (text === undefined) return { status: "missing" };
  const value = validate(JSON.parse(text) as unknown);
  return value === null ? { status: "corrupt", savedAs: null } : { status: "ok", value };
}

async function fakeWrite(file: string, contents: string): Promise<void> {
  await Promise.resolve();
  files.set(file, contents);
}

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
const dec = (b: Uint8Array): string => new TextDecoder().decode(b);

const settingsFile = (settings: Settings): string => JSON.stringify(settings, null, 2);
const onDisk = (): Record<string, unknown> =>
  JSON.parse(files.get(SETTINGS_FILE) ?? "{}") as Record<string, unknown>;

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

// Stable, the way both shells pass it (useToasts memoises push). The start-up
// effect depends on it, so a new function every render would re-run the effect
// on every render for the life of the hook.
const NOTHING = (): void => {};

interface View {
  current: () => ShellBootstrap;
  setPanel: (open: boolean) => Promise<void>;
  unmount: () => void;
}

// The hook, mounted and settled, with the mount's own reads discounted: start-up
// reads settings.json twice (loadShellSettings, and the one-time device.json
// migration behind it) and neither is what any of this is about.
async function mountShell(settingsOpen = false): Promise<View> {
  const view = renderHook(
    ({ open }: { open: boolean }) => useShellBootstrap({ settingsOpen: open, pushToast: NOTHING }),
    { initialProps: { open: settingsOpen } },
  );
  await act(async () => {
    await settle();
  });
  settingsReads = 0;
  return {
    current: () => view.result.current,
    setPanel: async (open: boolean) => {
      await act(async () => {
        view.rerender({ open });
        await settle();
      });
    },
    unmount: view.unmount,
  };
}

// A pull, as platform/sync/index.ts announces one when it has finished writing.
async function pull(paths: string[]): Promise<void> {
  await act(async () => {
    dispatchPull(paths);
    await settle();
  });
}

// Another device's change, landing in the file the way sync lands it: field by
// field, over the copy this shell already loaded.
function landRemote(next: Partial<Settings>): void {
  const base = enc(files.get(SETTINGS_FILE) ?? settingsFile(DEFAULT_SETTINGS));
  const merged = mergeFile({
    path: SETTINGS_FILE,
    base,
    local: base,
    remote: enc(settingsFile({ ...DEFAULT_SETTINGS, ...next })),
  });
  files.set(SETTINGS_FILE, dec(merged.merged));
}

beforeEach(() => {
  files.clear();
  files.set(SETTINGS_FILE, settingsFile(DEFAULT_SETTINGS));
  settingsReads = 0;
  spyOn(atomicFs, "readGuardedJson").mockImplementation(fakeRead);
  spyOn(atomicFs, "writeTextAtomic").mockImplementation(fakeWrite);
});

test("a pull that names settings.json with the panel closed is read back at once", async () => {
  const shell = await mountShell(false);
  expect(shell.current().settings.aiLanguage).toBe("auto");

  landRemote({ aiLanguage: "ja" });
  await pull([SETTINGS_FILE]);

  // Not "the route was called": the settings the shell hands its panel and every
  // AI call are the ones on disk now.
  expect(shell.current().settings.aiLanguage).toBe("ja");
  expect(settingsReads).toBe(1);
});

// The two halves that keep another file's pull off this shell together: the
// route's matcher does not claim the path, and the handler asks
// settingsPullAction about the paths it was actually given rather than assuming
// its own file is among them. Breaking either one alone is caught elsewhere —
// a widened matcher by tests/platform/sync/pull-coverage.test.ts, a handler that
// ignores its argument by settingsPullAction's own tests — and breaking both is
// what this sees: nothing else notices that a library.json pull just re-read
// settings.json.
test("a pull that names something else does nothing", async () => {
  const shell = await mountShell(false);

  // On disk, but not in the paths the pull announced: nothing may read it.
  landRemote({ aiLanguage: "ja" });
  await pull(["library.json", "threads-book-1.json"]);

  expect(settingsReads).toBe(0);
  expect(shell.current().settings.aiLanguage).toBe("auto");
});

test("a pull with the panel open waits for it to close instead of being dropped", async () => {
  const shell = await mountShell(true);

  landRemote({ aiLanguage: "ja" });
  await pull([SETTINGS_FILE]);

  // The panel holds the values under the user's hands; nothing is read yet.
  expect(settingsReads).toBe(0);
  expect(shell.current().settings.aiLanguage).toBe("auto");

  // Closing it is what the read was waiting for. Dropping the pull instead would
  // leave this shell on the pre-pull copy, which is the clobber the fix exists
  // to close.
  await shell.setPanel(false);
  expect(settingsReads).toBe(1);
  expect(shell.current().settings.aiLanguage).toBe("ja");
});

test("the deferred read is taken once, not on every close after it", async () => {
  const shell = await mountShell(true);
  landRemote({ aiLanguage: "ja" });
  await pull([SETTINGS_FILE]);
  await shell.setPanel(false);
  expect(settingsReads).toBe(1);

  // The user opens the panel again and closes it, with no pull in between.
  settingsReads = 0;
  await shell.setPanel(true);
  await shell.setPanel(false);
  expect(settingsReads).toBe(0);
  expect(shell.current().settings.aiLanguage).toBe("ja");
});

test("the route goes away with the hook", async () => {
  const shell = await mountShell(false);
  shell.unmount();

  landRemote({ aiLanguage: "ja" });
  await pull([SETTINGS_FILE]);

  // A route left registered reads settings.json on behalf of a hook that is gone
  // and sets state on an unmounted tree.
  expect(settingsReads).toBe(0);
});

// The property all of the above is for, through the real store: another device
// changed aiLanguage, it merged into settings.json field by field, and this
// shell then saves an unrelated setting. Both shells serialise the whole
// settings object on every save, so without the read-back that save carries this
// shell's pre-pull aiLanguage and takes the merged one off disk — silently, and
// the user's own setting is what is lost.
test("a pulled field survives this shell's next save", async () => {
  const shell = await mountShell(false);

  landRemote({ aiLanguage: "ja" });
  expect(onDisk().aiLanguage).toBe("ja");
  await pull([SETTINGS_FILE]);

  // The Settings panel changing one field: it hands back the whole object it was
  // given, with that one field replaced.
  await act(async () => {
    shell.current().applySettings({ ...shell.current().settings, sttModel: "sense" });
    await settle();
  });

  // The real 500ms debounce, waited out rather than flushed: the write under
  // test is the one the app makes on its own.
  await act(async () => {
    await waitFor(() => onDisk().sttModel === "sense");
  });
  expect(onDisk().aiLanguage).toBe("ja");
});

// Up to two seconds, checked on the same real timer the store's debounce runs
// on. Fails loudly rather than letting an assertion pass on a file that was
// never written.
async function waitFor(done: () => boolean): Promise<void> {
  const deadline = Date.now() + 2000;
  while (!done()) {
    if (Date.now() > deadline) throw new Error("the debounced write never landed");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
