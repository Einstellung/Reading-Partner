// The rehearsal on disk (src/reading/rehearsal/store.ts): the object, the runs
// beside it, the ordinal the store hands out, and what a file that will not
// parse does — which is the point of the runs file, because the shape it must
// not repeat (docs/29) is a loader that returns empty and a writer that then
// commits the empty version over the top. Run: bun test.

import { beforeEach, expect, test } from "bun:test";
import {
  appendRun,
  deleteRehearsal,
  deleteRehearsalsForRetell,
  listRehearsalsForTopic,
  loadRehearsal,
  loadRehearsalRuns,
  rehearsalFile,
  rehearsalForRetell,
  rehearsalIdOf,
  rehearsalRunsFile,
  renameRehearsal,
  startRehearsal,
} from "../../../src/reading/rehearsal/store";
import type { RehearsalRun } from "../../../src/reading/rehearsal/types";
import { installAppData, type FakeDisk } from "../../support/appdata-fake";

let disk: FakeDisk;

beforeEach(() => {
  disk = installAppData();
});

const ID = "1754400000000";
const RUNS = rehearsalRunsFile(ID);

function aRun(id: string, over: Partial<RehearsalRun> = {}): RehearsalRun {
  return {
    id,
    ordinal: 1,
    rehearsalId: ID,
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

test("a rehearsal written comes back the way it went in", async () => {
  const made = await startRehearsal({
    topicId: "topic-1",
    name: "A Brief History of Intelligence",
    deckFile: "rehearsals/1.html",
    now: 1,
  });
  const read = await loadRehearsal(made.id);
  expect(read?.name).toBe("A Brief History of Intelligence");
  expect(read?.deckFile).toBe("rehearsals/1.html");
  expect(read?.retellId).toBeNull();
  expect((await listRehearsalsForTopic("topic-1")).map((r) => r.id)).toEqual([made.id]);
  expect(await listRehearsalsForTopic("topic-2")).toEqual([]);
});

test("the runs file is not seen by the listing", async () => {
  const made = await startRehearsal({
    topicId: "topic-1",
    name: "Deck",
    deckFile: "rehearsals/1.html",
    now: 5,
  });
  await appendRun(aRun("r1", { rehearsalId: made.id }));
  expect((await listRehearsalsForTopic("topic-1")).map((r) => r.id)).toEqual([made.id]);
  expect(rehearsalIdOf(rehearsalRunsFile(made.id))).toBeNull();
  expect(rehearsalIdOf(rehearsalFile(made.id))).toBe(made.id);
});

// docs/43: the Rehearse button on a retell and the topic's Rehearsal section are
// two doors into one object.
test("both doors into a retell's deck reach the same rehearsal", async () => {
  const input = {
    topicId: "topic-1",
    retellId: "900",
    name: "Eye and Brain",
    deckFile: "slides/900-eye-and-brain.html",
  };
  const first = await rehearsalForRetell({ ...input, now: 10 });
  const second = await rehearsalForRetell({ ...input, now: 20 });
  expect(second.id).toBe(first.id);
  expect((await listRehearsalsForTopic("topic-1")).map((r) => r.id)).toEqual([first.id]);
  expect(first.retellId).toBe("900");
});

// The deck's file name carries the retell's slug, so renaming the retell and
// rebuilding moves the file the last pass was given against.
test("a retell that was renamed and rebuilt updates its rehearsal in place", async () => {
  const first = await rehearsalForRetell({
    topicId: "topic-1",
    retellId: "900",
    name: "Eye and Brain",
    deckFile: "slides/900-eye-and-brain.html",
    now: 10,
  });
  const second = await rehearsalForRetell({
    topicId: "topic-1",
    retellId: "900",
    name: "Seeing",
    deckFile: "slides/900-seeing.html",
    now: 20,
  });
  expect(second.id).toBe(first.id);
  expect(second.name).toBe("Seeing");
  expect(second.deckFile).toBe("slides/900-seeing.html");
  expect((await loadRehearsal(first.id))?.deckFile).toBe("slides/900-seeing.html");
});

test("renaming keeps the runs", async () => {
  const made = await startRehearsal({
    topicId: "topic-1",
    name: "Deck",
    deckFile: "rehearsals/1.html",
    now: 3,
  });
  await appendRun(aRun("r1", { rehearsalId: made.id }));
  await renameRehearsal(made.id, "The one about brains", 40);
  expect((await loadRehearsal(made.id))?.name).toBe("The one about brains");
  expect((await loadRehearsalRuns(made.id)).runs.map((r) => r.id)).toEqual(["r1"]);
});

// The files an earlier build wrote under this name were run logs keyed by a
// retell id. They are not read back and not migrated, and — the point of this
// test — the listing does not move them anywhere either: a scan that set aside
// every file it did not recognize would turn one rename into a pile of .bad
// files. Same posture as the talk-<id>.json files in reading/retell.
test("a rehearsal-<retellId>.json left by an earlier build is skipped and left alone", async () => {
  const stale = JSON.stringify({
    version: 1,
    retellId: "1700000000000",
    runs: [{ id: "old", ordinal: 1, retellId: "1700000000000", startedAt: 1, pages: [] }],
  });
  disk.files.set("rehearsal-1700000000000.json", stale);
  expect(await listRehearsalsForTopic("topic-1")).toEqual([]);
  expect(await loadRehearsal("1700000000000")).toBeNull();
  expect(disk.renames).toEqual([]);
  expect(disk.files.get("rehearsal-1700000000000.json")).toBe(stale);
});

// And a new rehearsal never lands on top of one of them: the id is a moment,
// and a taken name moves to the next free millisecond.
test("a new rehearsal steps over a file left under the id it wanted", async () => {
  disk.files.set(rehearsalFile("5"), "{not json");
  const made = await startRehearsal({
    topicId: "topic-1",
    name: "Deck",
    deckFile: "rehearsals/x.html",
    now: 5,
  });
  expect(made.id).toBe("6");
  expect(disk.files.get(rehearsalFile("5"))).toBe("{not json");
});

test("a deck that has never been given reads as an empty log, not an error", async () => {
  const log = await loadRehearsalRuns(ID);
  expect(log.runs).toEqual([]);
  expect(log.rehearsalId).toBe(ID);
  expect(disk.files.has(RUNS)).toBe(false);
});

test("a run written comes back the way it went in", async () => {
  await appendRun(aRun("r1"));
  const log = await loadRehearsalRuns(ID);
  expect(log.runs).toHaveLength(1);
  expect(log.runs[0].pages[0].transcript).toBe("Good evening.");
  expect(log.runs[0].deckFile).toBe("slides/1754400000000-my-retell.html");
});

test("the store numbers the runs, oldest first", async () => {
  expect((await appendRun(aRun("r1"))).ordinal).toBe(1);
  expect((await appendRun(aRun("r2"))).ordinal).toBe(2);
  // A caller working from a stale count cannot hand out a number twice.
  expect((await appendRun(aRun("r3", { ordinal: 1 }))).ordinal).toBe(3);
  const log = await loadRehearsalRuns(ID);
  expect(log.runs.map((r) => r.id)).toEqual(["r1", "r2", "r3"]);
  expect(log.runs.map((r) => r.ordinal)).toEqual([1, 2, 3]);
});

test("one rehearsal's runs are not another's", async () => {
  await appendRun(aRun("r1"));
  await appendRun(aRun("other", { rehearsalId: "1754400000001" }));
  expect((await loadRehearsalRuns(ID)).runs.map((r) => r.id)).toEqual(["r1"]);
  expect((await loadRehearsalRuns("1754400000001")).runs.map((r) => r.id)).toEqual(["other"]);
});

// docs/29: the loss that has already happened once, on slides/retells.json.
test("a runs file that will not parse is moved aside before the empty log is handed back", async () => {
  disk.files.set(RUNS, "{not json");
  const log = await loadRehearsalRuns(ID);
  expect(log.runs).toEqual([]);
  expect(disk.renames).toEqual([`${RUNS} -> ${RUNS}.bad`]);
  expect(disk.files.get(`${RUNS}.bad`)).toBe("{not json");
  expect(disk.files.has(RUNS)).toBe(false);
});

test("a write after a bad file lands on the file, not on top of the bad bytes", async () => {
  disk.files.set(RUNS, "{not json");
  await appendRun(aRun("r1"));
  expect(disk.files.get(`${RUNS}.bad`)).toBe("{not json");
  expect((await loadRehearsalRuns(ID)).runs.map((r) => r.id)).toEqual(["r1"]);
});

test("a version this build does not know is set aside, not read as empty in place", async () => {
  disk.files.set(RUNS, JSON.stringify({ version: 99, rehearsalId: ID, runs: [] }));
  expect((await loadRehearsalRuns(ID)).runs).toEqual([]);
  expect(disk.renames).toHaveLength(1);
});

// A read that failed for IO reasons says nothing about the bytes, so they stay
// where they are and nothing is moved.
test("a file that would not open is left alone", async () => {
  disk.files.set(RUNS, JSON.stringify({ version: 1, rehearsalId: ID, runs: [] }));
  disk.unreadable.add(RUNS);
  await expect(loadRehearsalRuns(ID)).rejects.toThrow(/could not be read/);
  expect(disk.renames).toEqual([]);
  expect(disk.files.has(RUNS)).toBe(true);
});

// docs/29 on the other branch. appendRun reads through the loader before it
// writes, so an empty log handed back for a read that failed is not a fallback
// the caller displays — it is the whole history replaced by the one run being
// recorded, on a file the other device syncs.
test("a run recorded after a failed read does not replace the history", async () => {
  await appendRun(aRun("r1"));
  await appendRun(aRun("r2"));
  const onDisk = disk.files.get(RUNS);
  disk.unreadable.add(RUNS);

  await expect(appendRun(aRun("r3"))).rejects.toThrow(/could not be read/);

  expect(disk.files.get(RUNS)).toBe(onDisk);
  disk.unreadable.delete(RUNS);
  expect((await loadRehearsalRuns(ID)).runs.map((r) => r.id)).toEqual(["r1", "r2"]);
});

// One unusable run inside a usable file is dropped: a lost run is one pass given
// again, a lost log is every pass there ever was.
test("a run the file cannot use is dropped and the rest of the log survives", async () => {
  disk.files.set(
    RUNS,
    JSON.stringify({
      version: 1,
      rehearsalId: ID,
      runs: [
        {
          id: "r1",
          ordinal: 1,
          rehearsalId: ID,
          deckFile: null,
          startedAt: 1,
          endedAt: 2,
          pages: [],
        },
        { ordinal: 2, startedAt: 3, pages: [] },
        {
          id: "r3",
          ordinal: 3,
          rehearsalId: ID,
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
  const log = await loadRehearsalRuns(ID);
  expect(log.runs.map((r) => r.id)).toEqual(["r1", "r3"]);
  expect(log.runs[1].pages.map((p) => p.index)).toEqual([1]);
  expect(disk.renames).toEqual([]);
});

test("deleting takes the object, the runs, the rescue copy and an imported deck", async () => {
  const made = await startRehearsal({
    topicId: "topic-1",
    name: "Deck",
    deckFile: "rehearsals/7.html",
    now: 7,
  });
  disk.files.set("rehearsals/7.html", "<html></html>");
  await appendRun(aRun("r1", { rehearsalId: made.id }));
  disk.files.set(`${rehearsalRunsFile(made.id)}.bad`, "{not json");
  await deleteRehearsal(made.id);
  expect(disk.files.has(rehearsalFile(made.id))).toBe(false);
  expect(disk.files.has(rehearsalRunsFile(made.id))).toBe(false);
  expect(disk.files.has(`${rehearsalRunsFile(made.id)}.bad`)).toBe(false);
  expect(disk.files.has("rehearsals/7.html")).toBe(false);
});

// A deck the slides pipeline built belongs to its retell, not to the rehearsal.
test("deleting a rehearsal leaves a built deck where it is", async () => {
  const made = await rehearsalForRetell({
    topicId: "topic-1",
    retellId: "900",
    name: "Eye and Brain",
    deckFile: "slides/900-eye-and-brain.html",
    now: 10,
  });
  disk.files.set("slides/900-eye-and-brain.html", "<html></html>");
  await deleteRehearsal(made.id);
  expect(disk.files.has("slides/900-eye-and-brain.html")).toBe(true);
});

test("deleting a retell takes the rehearsal of its deck and nobody else's", async () => {
  const mine = await rehearsalForRetell({
    topicId: "topic-1",
    retellId: "900",
    name: "Mine",
    deckFile: "slides/900-mine.html",
    now: 10,
  });
  const other = await startRehearsal({
    topicId: "topic-1",
    name: "Brought in",
    deckFile: "rehearsals/11.html",
    now: 11,
  });
  await deleteRehearsalsForRetell("900");
  expect(disk.files.has(rehearsalFile(mine.id))).toBe(false);
  expect(disk.files.has(rehearsalFile(other.id))).toBe(true);
});

test("deleting a rehearsal that was never there is not an error", async () => {
  await deleteRehearsal("never");
  await deleteRehearsalsForRetell("never");
  expect(disk.files.size).toBe(0);
});
