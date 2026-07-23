// Reader profile persistence (src/info/profile.ts): there is no factory seed, so
// a first run (no file) returns an empty profile and writes nothing; an existing
// file is read verbatim. The Tauri fs plugin is mocked with an in-memory file.
// Run: bun test.

import { expect, mock, test } from "bun:test";

let fileContent: string | null = null;
let writes = 0;
// The mock is process-wide (bun mock.module); include every export the info fs
// modules import so a sibling test file that loads after this one still resolves.
mock.module("@tauri-apps/plugin-fs", () => ({
  BaseDirectory: { AppData: 1 },
  exists: async () => fileContent !== null,
  mkdir: async () => {},
  readDir: async () => [],
  readTextFile: async () => {
    if (fileContent === null) throw new Error("no file");
    return fileContent;
  },
  writeTextFile: async (_path: string, content: string) => {
    writes += 1;
    fileContent = content;
  },
}));

const { loadProfile, saveProfile } = await import("../../src/memory/profile");

test("loadProfile returns empty and writes nothing when no file exists", async () => {
  fileContent = null;
  writes = 0;
  const p = await loadProfile();
  expect(p).toBe("");
  expect(writes).toBe(0);
});

test("loadProfile reads an existing profile verbatim", async () => {
  fileContent = "I care about robotics.";
  const p = await loadProfile();
  expect(p).toBe("I care about robotics.");
});

test("saveProfile then loadProfile round-trips", async () => {
  fileContent = null;
  await saveProfile("Harsher on vendor PR.");
  expect(await loadProfile()).toBe("Harsher on vendor PR.");
});
