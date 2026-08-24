// What a sync write leaves behind when the write is interrupted.
//
// Sync is the second writer of every data file: the app writes them through the
// Rust atomic writer, and a pass writes them again with whatever came down from
// Drive. A truncate-in-place write killed halfway leaves a file that still opens
// and still parses partway — half of the other device's library.json — and the
// loaders that used to guard against exactly that are gone, so the property has
// to hold here instead.
//
// The disk below tears on purpose: every underlying write puts down the first
// half of the bytes and then throws, the way a process death mid-write does.
// The first test is the control — it shows the tear really does land on the
// destination when the write is a plain one, which is what makes the rest of
// the file say something.
// Run: bun test.

import { beforeEach, expect, test, spyOn } from "bun:test";
import * as core from "@tauri-apps/api/core";
import * as fs from "@tauri-apps/plugin-fs";
import { appData } from "../../../src/platform/app/appdata";
import { tauriBaseStore } from "../../../src/platform/sync/localStore";
import { tauriSyncFs } from "../../../src/platform/sync/syncFs";
import { installAppData, type FakeDisk } from "../../support/appdata-fake";

const OLD = JSON.stringify({ books: { a: { title: "the one already here" } } });
const NEW_TEXT = JSON.stringify({ books: { a: { title: "x" }, b: { title: "y" } } });
const NEW_BYTES = new TextEncoder().encode(NEW_TEXT);

// The temp name this file's own tearing writer puts the half bytes in, shaped
// like the Rust writer's (same directory, dot-prefixed, .tmp suffix) minus the
// pid and sequence it adds. Nothing in src knows this name; it is only how the
// tests below get at the tear to show it happened.
const tempFor = (path: string): string => {
  const slash = path.lastIndexOf("/");
  return slash < 0 ? `.${path}.tmp` : `${path.slice(0, slash)}/.${path.slice(slash + 1)}.tmp`;
};

const half = (s: string): string => s.slice(0, Math.floor(s.length / 2));

let disk: FakeDisk;

// Re-spies the two writers installAppData put down, so both stop halfway and
// throw. The atomic one tears its temp file, which is the whole difference: the
// rename it would have finished with never runs, so the target is untouched.
function tearEveryWrite(): void {
  spyOn(fs, "writeFile").mockImplementation((async (path: string, bytes: Uint8Array) => {
    disk.writes.push(path);
    disk.blobs.set(path, bytes.slice(0, Math.floor(bytes.length / 2)));
    throw new Error(`interrupted: ${path}`);
  }) as typeof fs.writeFile);

  spyOn(core, "invoke").mockImplementation((async (
    command: string,
    args?: { path?: string; contents?: string },
  ) => {
    if (command !== "write_text_file_atomic") throw new Error(`unexpected command ${command}`);
    const path = args?.path ?? "";
    disk.writes.push(path);
    disk.files.set(tempFor(path), half(args?.contents ?? ""));
    throw new Error(`interrupted: ${path}`);
  }) as typeof core.invoke);
}

beforeEach(() => {
  disk = installAppData();
});

test("the control: an interrupted plain write does truncate the file it targets", async () => {
  disk.blobs.set("library.json", new TextEncoder().encode(OLD));
  tearEveryWrite();

  await expect(appData.writeBytes("library.json", NEW_BYTES)).rejects.toThrow("interrupted");

  const left = new TextDecoder().decode(disk.blobs.get("library.json"));
  expect(left).not.toBe(OLD);
  expect(left).toBe(NEW_TEXT.slice(0, Math.floor(NEW_BYTES.length / 2)));
  // Still opens, still looks like the start of the file it should be: this is
  // the failure the four loader guards used to sit downstream of.
  expect(NEW_TEXT.startsWith(left)).toBe(true);
});

test("an interrupted pull leaves the file it was replacing exactly as it was", async () => {
  disk.files.set("library.json", OLD);
  tearEveryWrite();

  await expect(tauriSyncFs.write("library.json", NEW_BYTES)).rejects.toThrow("interrupted");

  expect(disk.files.get("library.json")).toBe(OLD);
  expect(disk.blobs.has("library.json")).toBe(false);
  // The tear happened; it landed in the temp file the rename never got to.
  expect(disk.files.get(tempFor("library.json"))).toBe(half(NEW_TEXT));
});

test("an interrupted pull of a nested prep file leaves that file as it was", async () => {
  disk.files.set("prep-abc/state.json", OLD);
  tearEveryWrite();

  await expect(tauriSyncFs.write("prep-abc/state.json", NEW_BYTES)).rejects.toThrow("interrupted");

  expect(disk.files.get("prep-abc/state.json")).toBe(OLD);
  expect(disk.files.get(tempFor("prep-abc/state.json"))).toBe(half(NEW_TEXT));
});

test("an interrupted base write leaves the merge base as it was", async () => {
  disk.files.set("sync-base/library.json", OLD);
  tearEveryWrite();

  await expect(tauriBaseStore.write("library.json", NEW_BYTES)).rejects.toThrow("interrupted");

  expect(disk.files.get("sync-base/library.json")).toBe(OLD);
  expect(disk.blobs.has("sync-base/library.json")).toBe(false);
});

// The three above only mean something while the text branch is the one taken.
// These two pin which branch each kind of payload gets, on a disk that works.

test("text bytes reach disk through the atomic writer and never through writeFile", async () => {
  const plain = spyOn(fs, "writeFile");
  await tauriSyncFs.write("topics.json", NEW_BYTES);
  await tauriBaseStore.write("topics.json", NEW_BYTES);

  expect(disk.files.get("topics.json")).toBe(NEW_TEXT);
  expect(disk.files.get("sync-base/topics.json")).toBe(NEW_TEXT);
  expect(plain).not.toHaveBeenCalled();
});

// Bytes that are not valid UTF-8 are not something this app wrote, so they are
// kept verbatim rather than decoded through a lossy round trip.
test("bytes that are not text are written plainly, unchanged", async () => {
  const bytes = new Uint8Array([0xff, 0xfe, 0x00, 0x41]);
  await tauriSyncFs.write("annotations-x.json", bytes);

  expect(disk.blobs.get("annotations-x.json")).toEqual(bytes);
  expect(disk.files.has("annotations-x.json")).toBe(false);
});
