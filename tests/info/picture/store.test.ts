// The picture file (src/info/picture/store.ts) against the in-memory AppData.
//
// A picture cannot be rebuilt: the cables its judgments were made against are
// pruned after thirty days. So an unreadable file raises instead of answering
// with an empty picture, which the run that followed would save over it.
// Run: scripts/t.sh tests/info/picture

import { beforeEach, expect, test } from "bun:test";
import { CORRUPT_SUFFIX, createFakeAppData, type FakeAppData } from "../../support/guarded-appdata";
import { loadPicture, pictureFile, savePicture } from "../../../src/info/picture/store";
import { emptyPicture } from "../../../src/info/picture/picture";
import type { Picture } from "../../../src/info/picture/types";

const FILE = pictureFile("lab-1");

let io: FakeAppData;

const PICTURE: Picture = {
  ...emptyPicture("lab-1"),
  baseline: "Two fabs, one buyer.",
  observables: [{ id: "o-1", text: "Filings", addedOn: "2026-09-01" }],
  updatedAt: 7,
};

beforeEach(() => {
  io = createFakeAppData();
});

test("a room that has never run gets the empty picture and no file is written", async () => {
  expect(await loadPicture("lab-1", io)).toEqual(emptyPicture("lab-1"));
  expect(io.files.size).toBe(0);
});

test("a saved picture comes back as it went in", async () => {
  await savePicture(PICTURE, io);
  expect(io.files.has(FILE)).toBe(true);
  expect(await loadPicture("lab-1", io)).toEqual(PICTURE);
});

test("each room has its own file", async () => {
  await savePicture(PICTURE, io);
  await savePicture({ ...emptyPicture("lab-2"), baseline: "Elsewhere." }, io);
  expect([...io.files.keys()].sort()).toEqual([pictureFile("lab-1"), pictureFile("lab-2")]);
  expect((await loadPicture("lab-2", io)).baseline).toBe("Elsewhere.");
});

test("an unreadable picture raises rather than starting the room over", async () => {
  io.files.set(FILE, JSON.stringify(PICTURE));
  io.readFails = true;
  await expect(loadPicture("lab-1", io)).rejects.toThrow("could not be read");
});

test("bytes that are not a picture are moved aside and the room starts over", async () => {
  io.files.set(FILE, "half a file");
  expect(await loadPicture("lab-1", io)).toEqual(emptyPicture("lab-1"));
  expect(io.files.get(`${FILE}${CORRUPT_SUFFIX}`)).toBe("half a file");
  expect(io.reports.map((r) => r.file)).toEqual([FILE]);
});

test("a picture from a version this build does not know is not read as one", async () => {
  io.files.set(FILE, JSON.stringify({ ...PICTURE, version: 99 }));
  expect(await loadPicture("lab-1", io)).toEqual(emptyPicture("lab-1"));
  expect(io.reports.map((r) => r.file)).toEqual([FILE]);
});
