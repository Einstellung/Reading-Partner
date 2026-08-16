// User profile persistence + one-time rename migration (src/observation/profile/profile.ts).
// There is no factory seed, so a first run (no file) returns an empty profile and
// writes nothing; an existing file is read verbatim. When only the old
// info-profile.md exists, loadProfile promotes it to user-profile.md once and
// leaves the old file in place. The Tauri fs plugin is mocked with a per-path
// in-memory map. Run: bun test.

import { beforeEach, expect, mock, test } from "bun:test";

const files = new Map<string, string>();
// Paths that are on disk but whose read fails: a locked file, a bad sector, a
// sync folder that went away mid-read. The bytes are still there.
const unreadable = new Set<string>();
let writes = 0;

// The mock is process-wide (bun mock.module); include every export the fs modules
// import so a sibling test file that loads after this one still resolves.
mock.module("@tauri-apps/plugin-fs", () => ({
  BaseDirectory: { AppData: 1 },
  exists: async (path: string) => path === "" || files.has(path),
  mkdir: async () => {},
  readDir: async () => [],
  readTextFile: async (path: string) => {
    if (unreadable.has(path)) throw new Error(`EIO: ${path}`);
    const v = files.get(path);
    if (v === undefined) throw new Error(`no file: ${path}`);
    return v;
  },
  // The event log's appender. Nothing here asserts on events; it exists so the
  // modules that log one import cleanly.
  writeTextFile: async () => {},
  remove: async (path: string) => {
    files.delete(path);
  },
}));

// Stores write through the atomic writer (a Rust command), which has no
// standalone JS implementation to fall back on in a headless test. Only the
// write is replaced: the guarded read is the thing under test here, and it runs
// against the fs mock above.
const atomicFs = await import("../../src/platform/app/atomic-fs");
mock.module("../../src/platform/app/atomic-fs", () => ({
  ...atomicFs,
  writeTextAtomic: async (path: string, content: string) => {
    writes += 1;
    files.set(path, content);
  },
}));

const { loadProfile, loadProfileForWrite, loadProfileGuarded, saveProfile, PROFILE_FILE, LEGACY_PROFILE_FILE } =
  await import("../../src/observation/profile/profile");
// The live Apply path, over the real store rather than an injected one: what the
// wiring does with a failed read is the whole question here.
const { applyProfileUpdate } = await import("../../src/info/companion/card-actions");

beforeEach(() => {
  files.clear();
  unreadable.clear();
  writes = 0;
});

test("loadProfile returns empty and writes nothing when no file exists", async () => {
  expect(await loadProfile()).toBe("");
  expect(writes).toBe(0);
});

test("loadProfile reads an existing profile verbatim", async () => {
  files.set(PROFILE_FILE, "I care about robotics.");
  expect(await loadProfile()).toBe("I care about robotics.");
  expect(writes).toBe(0);
});

test("saveProfile then loadProfile round-trips through the new file", async () => {
  await saveProfile("Harsher on vendor PR.");
  expect(files.has(PROFILE_FILE)).toBe(true);
  expect(await loadProfile()).toBe("Harsher on vendor PR.");
});

test("loadProfile migrates the legacy info-profile.md once, leaving the old file", async () => {
  files.set(LEGACY_PROFILE_FILE, "legacy taste");
  const got = await loadProfile();
  expect(got).toBe("legacy taste");
  // Promoted to the new name, old file untouched.
  expect(files.get(PROFILE_FILE)).toBe("legacy taste");
  expect(files.get(LEGACY_PROFILE_FILE)).toBe("legacy taste");
  expect(writes).toBe(1);
});

test("the new file wins over a stale legacy file and no migration write happens", async () => {
  files.set(PROFILE_FILE, "current");
  files.set(LEGACY_PROFILE_FILE, "old");
  expect(await loadProfile()).toBe("current");
  expect(writes).toBe(0);
});

// --- unreadable is not empty ------------------------------------------------
//
// A read that failed used to come back as "" — the same answer as "no profile
// yet". Every writer then splices onto nothing and saves, and one failed read
// costs the reader the document. The two answers have to be different ones.

const WRITTEN = "Interests: robotics.\nBackground: builds them for a living.\n";

test("a profile that cannot be read is not writable, and its bytes stay where they are", async () => {
  files.set(PROFILE_FILE, WRITTEN);
  unreadable.add(PROFILE_FILE);

  expect(await loadProfileGuarded()).toEqual({ text: "", writable: false });
  expect(loadProfileForWrite()).rejects.toThrow();
  // Nothing wrote, and the document is still on disk exactly as it was.
  expect(writes).toBe(0);
  expect(files.get(PROFILE_FILE)).toBe(WRITTEN);
});

test("readers carry on with an empty profile while writers are held off", async () => {
  files.set(PROFILE_FILE, WRITTEN);
  unreadable.add(PROFILE_FILE);
  // A briefing must not fail because the identity document would not open.
  expect(await loadProfile()).toBe("");
  expect(writes).toBe(0);
});

test("a legacy file that cannot be read holds the migration rather than retiring it", async () => {
  files.set(LEGACY_PROFILE_FILE, "legacy taste");
  unreadable.add(LEGACY_PROFILE_FILE);

  expect(await loadProfileGuarded()).toEqual({ text: "", writable: false });
  // Had a write been allowed, user-profile.md would exist and the promotion
  // would never run again — the old build's profile orphaned by one bad read.
  expect(files.has(PROFILE_FILE)).toBe(false);
  expect(files.get(LEGACY_PROFILE_FILE)).toBe("legacy taste");
  expect(writes).toBe(0);
});

test("no file at all is still the first run: empty and writable", async () => {
  expect(await loadProfileGuarded()).toEqual({ text: "", writable: true });
  expect(await loadProfileForWrite()).toBe("");
});

test("Apply over an unreadable profile writes nothing at all", async () => {
  const onDisk = [
    "Interests: robotics, macro.",
    "Background: builds them for a living.",
    "",
    "<!-- ai-guess:begin -->",
    "- picks books about the era, not the method | basis: three margin notes | since: 2026-07-01",
    "<!-- ai-guess:end -->",
    "",
  ].join("\n");
  files.set(PROFILE_FILE, onDisk);
  unreadable.add(PROFILE_FILE);

  // The card that drafted this was shown the same failed read, so its declared
  // half is a profile written as if the reader had none.
  const out = await applyProfileUpdate("Interests: robotics.", { collecting: true, hasBriefing: true });

  expect(out).toEqual({ ok: false, canRetriage: false });
  expect(writes).toBe(0);
  expect(files.get(PROFILE_FILE)).toBe(onDisk);
});
