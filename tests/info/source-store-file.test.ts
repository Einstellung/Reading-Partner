// What the source list is allowed to lose (src/info/sources/source-store.ts).
//
// loadSources used to answer a failed read with `[]`, and addSource /
// removeSource / updateSource are all load-modify-save: turning one source off
// in Settings after a read that failed wrote that empty list over every
// subscription the reader had. The same shape as the emptied conversation file
// in docs/13, and no race is needed for it.
//
// The read raises now, which refuses the write and stops the empty list reaching
// a screen in the first place: `[]` is what puts a subscribed reader back in
// onboarding.
//
// The real store runs here against an in-memory AppData handed in as its io
// (tests/support/guarded-appdata.ts), which answers with the same GuardedRead
// contract readGuardedJson does.
// Run: bun test.

import { beforeEach, expect, test } from "bun:test";
import { CORRUPT_SUFFIX, createFakeAppData, type FakeAppData } from "../support/guarded-appdata";
import { BUILTIN_SOURCES } from "../../src/info/sources/builtins";
import type { SourceDescriptor } from "../../src/info/sources/descriptor";
import {
  SOURCES_FILE,
  addSource,
  hasSources,
  loadSources,
  removeSource,
  setSourceEnabled,
} from "../../src/info/sources/source-store";

const FILE = SOURCES_FILE;
const ASIDE = `${FILE}${CORRUPT_SUFFIX}`;

let io: FakeAppData;
const [A, B, C] = BUILTIN_SOURCES as SourceDescriptor[];
const SUBSCRIBED = [A, B, C].map((s) => ({ ...s, enabled: true }));

function idsOnDisk(path = FILE): string[] {
  return (io.json(path) as { id: string }[]).map((s) => s.id);
}

beforeEach(() => {
  io = createFakeAppData();
});

// --- the read that fails ----------------------------------------------------

// "No subscriptions" is the answer onboarding is built on, so it has to mean a
// reader who really has none. A file that is there and will not open is a
// different thing, and both readers say so.
test("a read off an unreadable file raises rather than answering with no subscriptions", async () => {
  io.files.set(FILE, JSON.stringify(SUBSCRIBED));
  io.readFails = true;

  await expect(loadSources(io)).rejects.toThrow(/could not be read/);
  await expect(hasSources(io)).rejects.toThrow(/could not be read/);
});

test("turning one source off after a failed read is refused, and the file is untouched", async () => {
  const bytes = JSON.stringify(SUBSCRIBED);
  io.files.set(FILE, bytes);
  io.readFails = true;

  await expect(setSourceEnabled(B.id, false, io)).rejects.toThrow(/could not be read/);

  // Nothing written, nothing moved aside: the bytes are fine, this process is
  // the one that could not read them.
  expect(io.files.get(FILE)).toBe(bytes);
  expect(io.files.has(ASIDE)).toBe(false);
});

test("removing a source after a failed read writes nothing", async () => {
  const bytes = JSON.stringify(SUBSCRIBED);
  io.files.set(FILE, bytes);
  io.readFails = true;

  await expect(removeSource(B.id, io)).rejects.toThrow(/could not be read/);
  expect(io.files.get(FILE)).toBe(bytes);
});

test("adding a source after a failed read does not replace the list with it", async () => {
  const bytes = JSON.stringify(SUBSCRIBED);
  io.files.set(FILE, bytes);
  io.readFails = true;

  await expect(addSource({ ...A, id: "new-one" }, io)).rejects.toThrow(/could not be read/);

  expect(io.files.get(FILE)).toBe(bytes);
});

// --- the bytes that will not parse ------------------------------------------

test("an unparseable list is kept beside the fresh one, not blanked", async () => {
  const bytes = JSON.stringify(SUBSCRIBED).slice(0, 40);
  io.files.set(FILE, bytes);

  await setSourceEnabled(B.id, false, io);

  expect(io.files.get(ASIDE)).toBe(bytes);
  expect(io.json(FILE)).toEqual([]);
});

test("a file that is not an array is moved aside before anything replaces it", async () => {
  const bytes = JSON.stringify({ sources: SUBSCRIBED });
  io.files.set(FILE, bytes);

  await addSource(A, io);

  expect(io.files.get(ASIDE)).toBe(bytes);
  expect(idsOnDisk()).toEqual([A.id]);
});

// --- the entries inside the file --------------------------------------------

test("a descriptor this build cannot validate survives a toggle of another one", async () => {
  // What a newer build on the other device writes looks like this here: an id
  // this one knows nothing else about. Dropping it would delete the reader's
  // subscription on that device at the next sync.
  io.files.set(FILE, JSON.stringify([A, { id: "from-the-future", kind: "something-new" }, B]));

  await setSourceEnabled(B.id, false, io);

  expect(idsOnDisk()).toEqual([A.id, B.id, "from-the-future"]);
  expect(io.files.has(ASIDE)).toBe(false);
  // It is not offered to the UI, only carried.
  expect((await loadSources(io)).map((s) => s.id)).toEqual([A.id, B.id]);
});

test("re-adding a source replaces the copy this build could not read", async () => {
  io.files.set(FILE, JSON.stringify([A, { id: B.id, discovery: "nonsense" }]));

  await addSource(B, io);

  // One record per id, or the sync merge turns the whole file down.
  expect(idsOnDisk()).toEqual([A.id, B.id]);
  expect((await loadSources(io)).map((s) => s.id)).toEqual([A.id, B.id]);
});

test("an entry with no identity is set aside before the write that drops it", async () => {
  const bytes = JSON.stringify([A, { name: "no id at all" }, B]);
  io.files.set(FILE, bytes);

  await removeSource(B.id, io);

  expect(io.files.get(ASIDE)).toBe(bytes);
  expect(idsOnDisk()).toEqual([A.id]);
});

test("a repair that cannot be set aside is refused rather than written", async () => {
  const bytes = JSON.stringify([A, null, B]);
  io.files.set(FILE, bytes);
  io.quarantineFails = true;

  await removeSource(B.id, io);

  expect(io.files.get(FILE)).toBe(bytes);
  expect(io.files.has(ASIDE)).toBe(false);
});

// --- the ordinary path still works ------------------------------------------

test("add, toggle and remove against a readable file do what they say", async () => {
  expect(await hasSources(io)).toBe(false);

  await addSource(A, io);
  await addSource(B, io);
  expect(idsOnDisk()).toEqual([A.id, B.id]);
  expect(await hasSources(io)).toBe(true);

  await setSourceEnabled(A.id, false, io);
  expect((await loadSources(io)).find((s) => s.id === A.id)?.enabled).toBe(false);

  await removeSource(A.id, io);
  expect(idsOnDisk()).toEqual([B.id]);
  expect(io.files.has(ASIDE)).toBe(false);
});
