// The lab file on disk (src/info/labs/store.ts), against the in-memory AppData
// from tests/support/guarded-appdata.ts.
//
// The point of the guarded read here is the same as the source list's: every
// mutation is load-modify-save, so a read that failed must not become the file
// that gets written. A reader with four rooms who opens a fifth on a device
// whose file will not open would otherwise be left with one.
// Run: scripts/t.sh tests/info/labs

import { beforeEach, expect, test } from "bun:test";
import { CORRUPT_SUFFIX, createFakeAppData, type FakeAppData } from "../../support/guarded-appdata";
import {
  LABS_FILE,
  addLab,
  archiveLab,
  claimSources,
  loadLabs,
} from "../../../src/info/labs/store";
import { labsFileBody } from "../../../src/info/labs/labs";
import type { Lab } from "../../../src/info/labs/types";

const ASIDE = `${LABS_FILE}${CORRUPT_SUFFIX}`;

let io: FakeAppData;

function lab(id: string, over: Partial<Lab> = {}): Lab {
  return {
    id,
    name: id,
    kind: "lab",
    status: "active",
    charter: { scope: "s", questions: [], topicId: null },
    sources: [],
    createdAt: 1,
    ...over,
  };
}

function idsOnDisk(): string[] {
  return (io.json(LABS_FILE) as { labs: { id: string }[] }).labs.map((l) => l.id);
}

beforeEach(() => {
  io = createFakeAppData();
});

test("no file is no rooms, and nothing is written on the reader's behalf", async () => {
  expect(await loadLabs(io)).toEqual([]);
  expect(io.files.has(LABS_FILE)).toBe(false);
});

test("a room opened lands in the file with the version on it", async () => {
  await addLab(lab("lab-1"), io);
  expect(idsOnDisk()).toEqual(["lab-1"]);
  expect((io.json(LABS_FILE) as { version: number }).version).toBe(1);
  expect((await loadLabs(io)).map((l) => l.id)).toEqual(["lab-1"]);
});

test("adding under an id already there replaces it, so an edit is an add", async () => {
  await addLab(lab("lab-1", { name: "Chips" }), io);
  await addLab(lab("lab-1", { name: "Chips and tools" }), io);
  expect((await loadLabs(io)).map((l) => l.name)).toEqual(["Chips and tools"]);
});

test("archiving keeps the record and stamps when", async () => {
  await addLab(lab("lab-1"), io);
  await archiveLab("lab-1", 1234, io);
  const [l] = await loadLabs(io);
  expect(`${l?.status} ${l?.archivedAt}`).toBe("archived 1234");
});

test("claiming sources adds to what the room already claims and never repeats one", async () => {
  await addLab(lab("lab-1", { sources: ["src-a"] }), io);
  await claimSources("lab-1", ["src-b", "src-a"], io);
  expect((await loadLabs(io))[0]?.sources).toEqual(["src-a", "src-b"]);
});

test("a room a newer build wrote is carried through a write from here", async () => {
  io.files.set(
    LABS_FILE,
    JSON.stringify({ version: 1, labs: [lab("lab-1"), { id: "lab-future", kind: "bureau" }] }),
  );
  await addLab(lab("lab-2"), io);
  expect(idsOnDisk()).toEqual(["lab-1", "lab-2", "lab-future"]);
});

test("an unreadable file raises rather than reading as no rooms", async () => {
  io.files.set(LABS_FILE, labsFileBody([lab("lab-1")]));
  io.readFails = true;
  await expect(loadLabs(io)).rejects.toThrow("could not be read");
});

test("an unreadable file refuses the write that would replace it", async () => {
  io.files.set(LABS_FILE, labsFileBody([lab("lab-1"), lab("lab-2")]));
  io.readFails = true;
  await expect(addLab(lab("lab-3"), io)).rejects.toThrow("could not be read");
  expect(idsOnDisk()).toEqual(["lab-1", "lab-2"]);
});

test("bytes that are not a labs file are moved aside and the room starts the list", async () => {
  io.files.set(LABS_FILE, "{ not json");
  await addLab(lab("lab-1"), io);
  expect(idsOnDisk()).toEqual(["lab-1"]);
  expect(io.files.get(ASIDE)).toBe("{ not json");
  expect(io.reports.map((r) => r.file)).toEqual([LABS_FILE]);
});

test("an entry the read had to leave behind is quarantined before the write", async () => {
  io.files.set(LABS_FILE, JSON.stringify({ version: 1, labs: [lab("lab-1"), { name: "no id" }] }));
  await addLab(lab("lab-2"), io);
  expect(idsOnDisk()).toEqual(["lab-1", "lab-2"]);
  expect(io.files.has(ASIDE)).toBe(true);
});

test("a quarantine that fails refuses the write", async () => {
  io.files.set(LABS_FILE, JSON.stringify({ version: 1, labs: [lab("lab-1"), { name: "no id" }] }));
  io.quarantineFails = true;
  const after = await addLab(lab("lab-2"), io);
  expect(after.map((l) => l.id)).toEqual(["lab-1"]);
  expect(idsOnDisk()).toEqual(["lab-1"]);
});
