// The AppData filesystem the live observation store runs on
// (src/memory/live/live.ts), over the fake disk. What it is here to hold: a
// read is one round trip through the IPC and not two, and a file that will not
// open is absent rather than a throw. Run: bun test.

import { beforeEach, expect, spyOn, test } from "bun:test";
import * as fs from "@tauri-apps/plugin-fs";
import { installAppData, type FakeDisk } from "../support/appdata-fake";
import { observationFs } from "../../src/memory/live/live";
import { ObservationFileStore } from "../../src/memory/observations/store";

const ENTRY_PATH = "memory-topic-1/m-1a2b3c4d.md";
const ENTRY_TEXT = [
  "---",
  "id: m-1a2b3c4d",
  "type: belief",
  "created: 2026-07-17",
  "updated: 2026-07-17",
  "summary: Thinks attention is just soft lookup",
  "---",
  "",
  "Said so twice.",
  "",
].join("\n");

let disk: FakeDisk;

beforeEach(() => {
  disk = installAppData();
});

function makeStore(): ObservationFileStore {
  return new ObservationFileStore("topic-1", observationFs);
}

// The exists() that used to precede every read doubled the cost of a listing:
// one list() over the owner's 106-entry topic was 2 + 2x106 = 214 crossings,
// and buildReadingTurn (reading/turn.ts) does one on every reading turn.
test("reading an observation costs one round trip, not two", async () => {
  disk.files.set(ENTRY_PATH, ENTRY_TEXT);

  const entry = await makeStore().get("m-1a2b3c4d");

  expect(entry?.summary).toBe("Thinks attention is just soft lookup");
  expect(disk.reads).toEqual([ENTRY_PATH]);
  expect(fs.exists).not.toHaveBeenCalled();
});

test("a file that is not there is absent through the whole store path", async () => {
  const store = makeStore();

  expect(await store.get("m-1a2b3c4d")).toBeNull();
  expect(await store.readIndexText()).toBe("");
  expect(await store.readIndex()).toEqual([]);
  expect(await store.getMeta()).toEqual({ lastDistilledAt: null, lastAnnotationDistillAt: null });
  expect(await store.delete("m-1a2b3c4d")).toBe(false);
  expect(await store.update("m-1a2b3c4d", { body: "b" })).toBeNull();
  expect(fs.exists).not.toHaveBeenCalled();
});

// A file the host will not open reads the same as one that is not there. The
// store has no third answer — it already takes null from a file whose bytes do
// not parse — and this is what the removed probe cost two round trips to keep
// apart, without ever being able to: the file can go between the two calls.
test("a file that will not open is absent too", async () => {
  disk.files.set(ENTRY_PATH, ENTRY_TEXT);
  disk.unreadable.add(ENTRY_PATH);

  expect(await makeStore().get("m-1a2b3c4d")).toBeNull();
});

test("listing a directory that is not there is empty, and does not probe first", async () => {
  spyOn(fs, "readDir").mockImplementation(async () => {
    throw new Error("ENOENT: memory-topic-1");
  });

  expect(await observationFs.listDir("memory-topic-1")).toEqual([]);
  expect(fs.exists).not.toHaveBeenCalled();
});

test("a listing keeps the files and drops everything else", async () => {
  spyOn(fs, "readDir").mockImplementation(async () => [
    { name: "m-1a2b3c4d.md", isFile: true, isDirectory: false, isSymlink: false },
    { name: "nested", isFile: false, isDirectory: true, isSymlink: false },
  ]);

  expect(await observationFs.listDir("memory-topic-1")).toEqual(["m-1a2b3c4d.md"]);
});
