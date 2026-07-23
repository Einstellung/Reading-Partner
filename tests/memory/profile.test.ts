// User profile persistence + one-time rename migration (src/memory/profile.ts).
// There is no factory seed, so a first run (no file) returns an empty profile and
// writes nothing; an existing file is read verbatim. When only the old
// info-profile.md exists, loadProfile promotes it to user-profile.md once and
// leaves the old file in place. The Tauri fs plugin is mocked with a per-path
// in-memory map. Run: bun test.

import { beforeEach, expect, mock, test } from "bun:test";

const files = new Map<string, string>();
let writes = 0;

// The mock is process-wide (bun mock.module); include every export the fs modules
// import so a sibling test file that loads after this one still resolves.
mock.module("@tauri-apps/plugin-fs", () => ({
  BaseDirectory: { AppData: 1 },
  exists: async (path: string) => path === "" || files.has(path),
  mkdir: async () => {},
  readDir: async () => [],
  readTextFile: async (path: string) => {
    const v = files.get(path);
    if (v === undefined) throw new Error(`no file: ${path}`);
    return v;
  },
  writeTextFile: async (path: string, content: string) => {
    writes += 1;
    files.set(path, content);
  },
}));

const { loadProfile, saveProfile, PROFILE_FILE, LEGACY_PROFILE_FILE } = await import(
  "../../src/memory/profile"
);

beforeEach(() => {
  files.clear();
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
