// The rehearsal log on disk (src/reading/rehearsal/store.ts): the round
// trip, the ordinal the store hands out, and what a file that will not parse
// does — which is the point of the file, because the shape it must not repeat
// (docs/29) is a loader that returns empty and a writer that then commits the
// empty version over the top. Run: bun test.

import { beforeEach, expect, test } from "bun:test";
import {
  appendRun,
  deleteRehearsals,
  loadRehearsals,
  rehearsalFile,
} from "../../../src/reading/rehearsal/store";
import type { RehearsalRun } from "../../../src/reading/rehearsal/types";
import { installAppData, type FakeDisk } from "../../support/appdata-fake";

let disk: FakeDisk;

beforeEach(() => {
  disk = installAppData();
});

const RETELL = "1754400000000";

function aRun(id: string, over: Partial<RehearsalRun> = {}): RehearsalRun {
  return {
    id,
    ordinal: 1,
    retellId: RETELL,
    deckFile: "slides/1754400000000-my-retell.html",
    startedAt: 1_000,
    endedAt: 601_000,
    pages: [
      {
        index: 0,
        kind: "title",
        title: "Eye and Brain",
        enteredAt: 1_000,
        leftAt: 61_000,
        transcript: "Good evening.",
      },
    ],
    ...over,
  };
}

test("a retell that has never been given reads as an empty log, not an error", async () => {
  const log = await loadRehearsals(RETELL);
  expect(log.runs).toEqual([]);
  expect(log.retellId).toBe(RETELL);
  expect(disk.files.has(rehearsalFile(RETELL))).toBe(false);
});

test("a run written comes back the way it went in", async () => {
  await appendRun(aRun("r1"));
  const log = await loadRehearsals(RETELL);
  expect(log.runs).toHaveLength(1);
  expect(log.runs[0].pages[0].transcript).toBe("Good evening.");
  expect(log.runs[0].deckFile).toBe("slides/1754400000000-my-retell.html");
});

test("the store numbers the runs, oldest first", async () => {
  expect((await appendRun(aRun("r1"))).ordinal).toBe(1);
  expect((await appendRun(aRun("r2"))).ordinal).toBe(2);
  // A caller working from a stale count cannot hand out a number twice.
  expect((await appendRun(aRun("r3", { ordinal: 1 }))).ordinal).toBe(3);
  const log = await loadRehearsals(RETELL);
  expect(log.runs.map((r) => r.id)).toEqual(["r1", "r2", "r3"]);
  expect(log.runs.map((r) => r.ordinal)).toEqual([1, 2, 3]);
});

test("one retell's runs are not another's", async () => {
  await appendRun(aRun("r1"));
  await appendRun(aRun("other", { retellId: "1754400000001" }));
  expect((await loadRehearsals(RETELL)).runs.map((r) => r.id)).toEqual(["r1"]);
  expect((await loadRehearsals("1754400000001")).runs.map((r) => r.id)).toEqual(["other"]);
});

// docs/29: the loss that has already happened once, on slides/retells.json.
test("a file that will not parse is moved aside before the empty log is handed back", async () => {
  disk.files.set(rehearsalFile(RETELL), "{not json");
  const log = await loadRehearsals(RETELL);
  expect(log.runs).toEqual([]);
  expect(disk.renames).toEqual([`${rehearsalFile(RETELL)} -> ${rehearsalFile(RETELL)}.bad`]);
  expect(disk.files.get(`${rehearsalFile(RETELL)}.bad`)).toBe("{not json");
  expect(disk.files.has(rehearsalFile(RETELL))).toBe(false);
});

test("a write after a bad file lands on the file, not on top of the bad bytes", async () => {
  disk.files.set(rehearsalFile(RETELL), "{not json");
  await appendRun(aRun("r1"));
  expect(disk.files.get(`${rehearsalFile(RETELL)}.bad`)).toBe("{not json");
  expect((await loadRehearsals(RETELL)).runs.map((r) => r.id)).toEqual(["r1"]);
});

test("a version this build does not know is set aside, not read as empty in place", async () => {
  disk.files.set(rehearsalFile(RETELL), JSON.stringify({ version: 99, retellId: RETELL, runs: [] }));
  expect((await loadRehearsals(RETELL)).runs).toEqual([]);
  expect(disk.renames).toHaveLength(1);
});

// A read that failed for IO reasons says nothing about the bytes, so they stay
// where they are and nothing is moved.
test("a file that would not open is left alone", async () => {
  disk.files.set(rehearsalFile(RETELL), JSON.stringify({ version: 1, retellId: RETELL, runs: [] }));
  disk.unreadable.add(rehearsalFile(RETELL));
  expect((await loadRehearsals(RETELL)).runs).toEqual([]);
  expect(disk.renames).toEqual([]);
  expect(disk.files.has(rehearsalFile(RETELL))).toBe(true);
});

// One unusable run inside a usable file is dropped: a lost run is one retell
// given again, a lost log is every run there ever was.
test("a run the file cannot use is dropped and the rest of the log survives", async () => {
  disk.files.set(
    rehearsalFile(RETELL),
    JSON.stringify({
      version: 1,
      retellId: RETELL,
      runs: [
        { id: "r1", ordinal: 1, retellId: RETELL, deckFile: null, startedAt: 1, endedAt: 2, pages: [] },
        { ordinal: 2, startedAt: 3, pages: [] },
        {
          id: "r3",
          ordinal: 3,
          retellId: RETELL,
          deckFile: null,
          startedAt: 5,
          endedAt: null,
          pages: [
            { index: 1, kind: "content", title: "Two", enteredAt: 5, leftAt: null, transcript: "" },
            { index: "nope", kind: "content", title: "x", enteredAt: 6, transcript: "" },
          ],
        },
      ],
    }),
  );
  const log = await loadRehearsals(RETELL);
  expect(log.runs.map((r) => r.id)).toEqual(["r1", "r3"]);
  expect(log.runs[1].pages.map((p) => p.index)).toEqual([1]);
  expect(disk.renames).toEqual([]);
});

test("deleting takes the log and its rescue copy with it", async () => {
  await appendRun(aRun("r1"));
  disk.files.set(`${rehearsalFile(RETELL)}.bad`, "{not json");
  await deleteRehearsals(RETELL);
  expect(disk.files.has(rehearsalFile(RETELL))).toBe(false);
  expect(disk.files.has(`${rehearsalFile(RETELL)}.bad`)).toBe(false);
});

test("deleting a retell that was never given is not an error", async () => {
  await deleteRehearsals("never");
  expect(disk.files.size).toBe(0);
});
