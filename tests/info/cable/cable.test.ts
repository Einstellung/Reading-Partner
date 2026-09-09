// Cables: the pure reading (src/info/cable/cable.ts) and the day files
// (src/info/cable/store.ts), the latter against the in-memory AppData with a
// directory listing bolted on for listCableDates.
// Run: scripts/t.sh tests/info/cable

import { beforeEach, expect, test } from "bun:test";
import { createFakeAppData, CORRUPT_SUFFIX, type FakeAppData } from "../../support/guarded-appdata";
import { cablesForLab, parseCableDay } from "../../../src/info/cable/cable";
import {
  cableDates,
  cablesFile,
  listCableDates,
  loadCableDay,
  saveCableDay,
  type CableIo,
} from "../../../src/info/cable/store";
import { CABLES_VERSION, type Cable, type CableDay } from "../../../src/info/cable/types";

function cable(id: string, hits: Cable["hits"], over: Partial<Cable> = {}): Cable {
  return {
    id,
    date: "2026-09-09",
    title: `Title ${id}`,
    url: `https://example.com/${id}`,
    source: "src-a",
    sourceName: "Source A",
    publishedAt: "2026-09-09T00:00:00Z",
    hits,
    ...over,
  };
}

const DAY: CableDay = {
  version: CABLES_VERSION,
  date: "2026-09-09",
  cables: [
    cable("i1", [{ labId: "lab-1", observables: ["o-1"] }]),
    cable("i2", [{ labId: "lab-2", observables: [] }]),
    cable("i3", [
      { labId: "lab-1", observables: [] },
      { labId: "lab-2", observables: ["o-9"] },
    ]),
    cable("i4", [], { outside: "nobody follows this, but it moves the ground" }),
  ],
};

let io: FakeAppData;
let cableIo: CableIo;

beforeEach(() => {
  io = createFakeAppData();
  cableIo = { ...io, list: async () => [...io.files.keys()] } as unknown as CableIo;
});

test("a room's cables come back in the order the run filed them", () => {
  expect(cablesForLab(DAY, "lab-1").map((c) => c.id)).toEqual(["i1", "i3"]);
  expect(cablesForLab(DAY, "lab-2").map((c) => c.id)).toEqual(["i2", "i3"]);
  expect(cablesForLab(DAY, "lab-9")).toEqual([]);
});

test("a cable that hit nothing belongs to no room", () => {
  expect(cablesForLab(DAY, "lab-1").some((c) => c.id === "i4")).toBe(false);
});

test("a day round-trips through JSON", () => {
  expect(parseCableDay(JSON.parse(JSON.stringify(DAY)))).toEqual(DAY);
});

test("bytes that are not a day read as null", () => {
  expect(parseCableDay(null)).toBeNull();
  expect(parseCableDay({ version: 1, date: "2026-09-09" })).toBeNull();
  expect(parseCableDay({ ...DAY, version: 99 })).toBeNull();
  expect(parseCableDay({ ...DAY, date: "" })).toBeNull();
});

test("a cable missing a field this build reads is dropped, the day survives", () => {
  const read = parseCableDay({
    ...DAY,
    cables: [cable("i1", []), { id: "i2", title: "no url" }, null],
  });
  expect(read?.cables.map((c) => c.id)).toEqual(["i1"]);
});

test("a hit with no lab, or observables that are not strings, is cleaned up", () => {
  const read = parseCableDay({
    ...DAY,
    cables: [
      { ...cable("i1", []), hits: [{ labId: "lab-1", observables: ["o-1", 7] }, { observables: [] }] },
    ],
  });
  expect(read?.cables[0]?.hits).toEqual([{ labId: "lab-1", observables: ["o-1"] }]);
});

test("a saved day comes back as it went in", async () => {
  await saveCableDay(DAY, cableIo);
  expect(io.files.has(cablesFile("2026-09-09"))).toBe(true);
  expect(await loadCableDay("2026-09-09", cableIo)).toEqual(DAY);
});

test("a day this device never collected is null", async () => {
  expect(await loadCableDay("2026-09-08", cableIo)).toBeNull();
});

test("a day file holding another day's cables is refused", async () => {
  io.files.set(cablesFile("2026-09-08"), JSON.stringify(DAY));
  expect(await loadCableDay("2026-09-08", cableIo)).toBeNull();
  expect(io.reports.map((r) => r.file)).toEqual([cablesFile("2026-09-08")]);
  expect(io.files.has(`${cablesFile("2026-09-08")}${CORRUPT_SUFFIX}`)).toBe(true);
});

test("an unreadable day raises rather than reading as a day with no cables", async () => {
  io.files.set(cablesFile("2026-09-09"), JSON.stringify(DAY));
  io.readFails = true;
  await expect(loadCableDay("2026-09-09", cableIo)).rejects.toThrow("could not be read");
});

test("the dates are the ones with a parseable name, newest first", () => {
  expect(
    cableDates([
      "info-cables-2026-09-08.json",
      "info-cables-2026-09-10.json",
      "info-cables-2026-09-09.json",
      "info-cables-latest.json",
      "info-cables-2026-09-09.json.corrupt-1",
      "briefing-2026-09-09.json",
    ]),
  ).toEqual(["2026-09-10", "2026-09-09", "2026-09-08"]);
});

test("listCableDates reads the days off the disk", async () => {
  await saveCableDay(DAY, cableIo);
  await saveCableDay({ ...DAY, date: "2026-09-10" }, cableIo);
  expect(await listCableDates(cableIo)).toEqual(["2026-09-10", "2026-09-09"]);
});

test("a listing that fails is no days rather than a throw", async () => {
  const failing: CableIo = {
    ...cableIo,
    list: async () => {
      throw new Error("EIO");
    },
  };
  expect(await listCableDates(failing)).toEqual([]);
});
