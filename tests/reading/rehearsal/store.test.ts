// The rehearsal on disk (src/reading/rehearsal/store.ts): the object, the log of
// its passes, one transcript file per pass, the ordinal the store hands out, and
// what a file that will not parse does — which is the point of the log, because
// the shape it must not repeat (docs/29) is a loader that returns empty and a
// writer that then commits the empty version over the top. Run: bun test.

import { beforeEach, expect, test } from "bun:test";
import {
  appendRun,
  deleteRehearsal,
  deleteRehearsalsForRetell,
  listRehearsalsForTopic,
  loadRehearsal,
  loadRehearsalRun,
  loadRehearsalRuns,
  loadRunPages,
  rehearsalFile,
  rehearsalForRetell,
  rehearsalIdOf,
  rehearsalRunsFile,
  renameRehearsal,
  runPagesFile,
  splitRehearsalRunPages,
  splitRehearsalRunPagesEverywhere,
  startRehearsal,
} from "../../../src/reading/rehearsal/store";
import type { BuiltRun } from "../../../src/reading/rehearsal/types";
import { loadTalkOutline } from "../../../src/reading/talk/store";
import { installAppData, type FakeDisk } from "../../support/appdata-fake";

let disk: FakeDisk;

beforeEach(() => {
  disk = installAppData();
});

const ID = "1754400000000";
const RUNS = rehearsalRunsFile(ID);

function aRun(id: string, over: Partial<BuiltRun> = {}): BuiltRun {
  return {
    id,
    ordinal: 1,
    rehearsalId: ID,
    startedAt: 1_000,
    endedAt: 601_000,
    pages: [
      {
        index: 0,
        kind: "seg-open",
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
    outlineId: "o-1",
    now: 1,
  });
  const read = await loadRehearsal(made.id);
  expect(read?.name).toBe("A Brief History of Intelligence");
  expect(read?.outlineId).toBe("o-1");
  expect(read?.retellId).toBeNull();
  expect((await listRehearsalsForTopic("topic-1")).map((r) => r.id)).toEqual([made.id]);
  expect(await listRehearsalsForTopic("topic-2")).toEqual([]);
});

test("the runs file is not seen by the listing", async () => {
  const made = await startRehearsal({
    topicId: "topic-1",
    name: "Deck",
    outlineId: "o-1",
    now: 5,
  });
  await appendRun(aRun("r1", { rehearsalId: made.id }));
  expect((await listRehearsalsForTopic("topic-1")).map((r) => r.id)).toEqual([made.id]);
  expect(rehearsalIdOf(rehearsalRunsFile(made.id))).toBeNull();
  expect(rehearsalIdOf(rehearsalFile(made.id))).toBe(made.id);
});

// docs/43: the Rehearse button on a retell and the topic's Rehearsal section are
// two doors into one object.
test("both doors into a retell's talk reach the same rehearsal", async () => {
  const input = {
    topicId: "topic-1",
    retellId: "900",
    name: "Eye and Brain",
  };
  const first = await rehearsalForRetell({ ...input, now: 10 });
  const second = await rehearsalForRetell({ ...input, now: 20 });
  expect(second.id).toBe(first.id);
  expect((await listRehearsalsForTopic("topic-1")).map((r) => r.id)).toEqual([first.id]);
  expect(first.retellId).toBe("900");
});

// The name follows the retell, and one retell keeps one outline however often
// it is renamed.
test("a retell that was renamed updates its rehearsal in place", async () => {
  const first = await rehearsalForRetell({
    topicId: "topic-1",
    retellId: "900",
    name: "Eye and Brain",
    now: 10,
  });
  const second = await rehearsalForRetell({
    topicId: "topic-1",
    retellId: "900",
    name: "Seeing",
    now: 20,
  });
  expect(second.id).toBe(first.id);
  expect(second.name).toBe("Seeing");
  expect(second.outlineId).toBe(first.outlineId);
  expect((await loadRehearsal(first.id))?.name).toBe("Seeing");
});

test("renaming keeps the runs", async () => {
  const made = await startRehearsal({
    topicId: "topic-1",
    name: "Deck",
    outlineId: "o-1",
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
    outlineId: "o-x",
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
  expect(log.runs[0].startedAt).toBe(1_000);
  expect((await loadRehearsalRun(log.runs[0])).pages[0].transcript).toBe("Good evening.");
});

// The whole point of the split: what a list shows is in the log, and the words
// are not. A log entry that carried them would be re-uploaded on every pass.
test("the log holds what a row shows and no transcript", async () => {
  await appendRun(aRun("r1"));
  const entry = (await loadRehearsalRuns(ID)).runs[0];
  expect(entry.pages).toBeUndefined();
  expect(entry.segmentIds).toEqual(["seg-open"]);
  expect(entry.spokenSegmentIds).toEqual(["seg-open"]);
  expect(entry.wordsSpoken).toBe(2);
  expect(entry.lastMomentAt).toBe(601_000);
  expect(disk.files.get(RUNS)).not.toContain("Good evening.");
  expect(disk.files.get(runPagesFile(ID, "r1")!)).toContain("Good evening.");
});

// Ten passes of a forty-minute talk are twenty or thirty KB of text each. The
// tenth must not rewrite the nine before it — that is the sync bill this split
// is here to stop paying.
test("recording a pass does not rewrite the passes before it", async () => {
  await appendRun(aRun("r1"));
  await appendRun(aRun("r2"));
  const beforeThird = disk.files.get(runPagesFile(ID, "r1")!);
  const writesBefore = disk.writes.length;

  await appendRun(aRun("r3"));

  expect(disk.files.get(runPagesFile(ID, "r1")!)).toBe(beforeThird);
  // Two files touched, whatever the history behind them: this pass's transcript
  // and the log.
  expect(disk.writes.slice(writesBefore)).toEqual([runPagesFile(ID, "r3")!, RUNS]);
  expect((await loadRehearsalRuns(ID)).runs.map((r) => r.id)).toEqual(["r1", "r2", "r3"]);
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
  expect((await loadRunPages(log.runs[1])).map((p) => p.index)).toEqual([1]);
  expect(disk.renames).toEqual([]);
});

// One level down from the test above, and the same trade. A pass whose
// transcript will not open is still a pass that happened: it keeps its row, its
// counts and its place in the numbering, and the passes either side of it are
// untouched. The alternative — an unreadable file taking the whole history with
// it — is docs/29 again, one directory lower.
test("a transcript that will not open costs its own words and nothing else", async () => {
  await appendRun(aRun("r1"));
  await appendRun(aRun("r2"));
  await appendRun(aRun("r3"));
  disk.files.set(runPagesFile(ID, "r2")!, "{not json");

  const log = await loadRehearsalRuns(ID);
  expect(log.runs.map((r) => r.id)).toEqual(["r1", "r2", "r3"]);
  expect(log.runs[1].wordsSpoken).toBe(2);
  expect(await loadRunPages(log.runs[1])).toEqual([]);
  expect((await loadRunPages(log.runs[0]))[0].transcript).toBe("Good evening.");
  expect((await loadRunPages(log.runs[2]))[0].transcript).toBe("Good evening.");
  // Nothing is moved aside: the file is written once and the other device still
  // holds a copy, so there is no write about to land on top of these bytes.
  expect(disk.renames).toEqual([]);
  expect(disk.files.get(runPagesFile(ID, "r2")!)).toBe("{not json");
});

// The name in a log entry is what becomes a path, and the log is synced. Nothing
// that is not a plain file name gets one built from it.
test("a run id that is not a plain name never becomes a path", async () => {
  expect(runPagesFile(ID, "../../secrets")).toBeNull();
  expect(runPagesFile(ID, "a/b")).toBeNull();
  expect(runPagesFile(ID, ".")).toBeNull();
  expect(runPagesFile(ID, "")).toBeNull();
  expect(runPagesFile("../..", "r1")).toBeNull();
  expect(runPagesFile(ID, "r1")).toBe(`runs/${ID}/r1.json`);

  // And a log holding one reads as a pass with nothing under it, not as a read
  // of whatever that name would have pointed at.
  disk.files.set(
    RUNS,
    JSON.stringify({
      version: 1,
      rehearsalId: ID,
      runs: [{ id: "../../secrets", ordinal: 1, rehearsalId: ID, startedAt: 1 }],
    }),
  );
  disk.files.set("secrets", "not yours");
  const log = await loadRehearsalRuns(ID);
  expect(await loadRunPages(log.runs[0])).toEqual([]);
  expect(disk.reads).not.toContain("secrets");
});

// --- the split ---------------------------------------------------------------

// A log written before the transcripts had files of their own.
function inlinedLog(rehearsalId: string, ids: string[]): string {
  return JSON.stringify(
    {
      version: 1,
      rehearsalId,
      runs: ids.map((id, i) => ({
        id,
        ordinal: i + 1,
        rehearsalId,
        deckFile: "slides/x.html",
        startedAt: 1_000,
        endedAt: 601_000,
        pages: [
          {
            index: 0,
            kind: "seg-open",
            title: "Eye and Brain",
            enteredAt: 1_000,
            leftAt: 61_000,
            transcript: "Good evening.",
          },
        ],
      })),
    },
    null,
    2,
  );
}

test("the split lifts every transcript out and leaves the rows behind", async () => {
  disk.files.set(RUNS, inlinedLog(ID, ["r1", "r2"]));

  expect(await splitRehearsalRunPages(ID)).toBe(2);

  const log = await loadRehearsalRuns(ID);
  expect(log.runs.map((r) => r.id)).toEqual(["r1", "r2"]);
  expect(log.runs.map((r) => r.ordinal)).toEqual([1, 2]);
  expect(log.runs.every((r) => r.pages === undefined)).toBe(true);
  // The counts the rows were drawn from are written down now, so drawing them
  // never opens a transcript again.
  // The deckFile an older build wrote is read past and not carried forward.
  expect("deckFile" in log.runs[0]).toBe(false);
  expect(log.runs[0].segmentIds).toEqual(["seg-open"]);
  expect(log.runs[0].wordsSpoken).toBe(2);
  expect(log.runs[0].lastMomentAt).toBe(601_000);
  expect(disk.files.get(RUNS)).not.toContain("Good evening.");
  for (const id of ["r1", "r2"]) {
    expect(await loadRunPages(log.runs.find((r) => r.id === id)!)).toHaveLength(1);
  }
});

// Idempotent by shape, not by a marker: an entry it has already been through has
// no `pages` key, so a second pass finds nothing and writes nothing at all — not
// the same bytes again, nothing. Rewriting with identical bytes would cost a
// local write on every start-up and a merge on the device that pulled it.
test("a second split writes nothing at all", async () => {
  disk.files.set(RUNS, inlinedLog(ID, ["r1", "r2"]));
  await splitRehearsalRunPages(ID);
  const after = new Map(disk.files);
  disk.writes.length = 0;

  expect(await splitRehearsalRunPages(ID)).toBe(0);

  expect(disk.writes).toEqual([]);
  expect([...disk.files.entries()]).toEqual([...after.entries()]);
});

// Two devices reach the same bytes without talking to each other: same entries
// in, same counts out, same file name — so the merge is handed two identical
// entries rather than a conflict.
test("two devices that each run the split land on the same files", async () => {
  disk.files.set(RUNS, inlinedLog(ID, ["r1", "r2"]));
  await splitRehearsalRunPages(ID);
  const first = new Map(disk.files);

  // The other device, starting from the same log it synced.
  disk = installAppData();
  disk.files.set(RUNS, inlinedLog(ID, ["r1", "r2"]));
  await splitRehearsalRunPages(ID);

  expect([...disk.files.entries()].sort()).toEqual([...first.entries()].sort());
});

// A build that does not know about the split writes `pages: []` back on every
// append. Re-splitting that must not put an empty transcript over a real one.
test("an empty inlined transcript drops its key and writes no file", async () => {
  await appendRun(aRun("r1"));
  const real = disk.files.get(runPagesFile(ID, "r1")!);
  const log = await loadRehearsalRuns(ID);
  disk.files.set(
    RUNS,
    JSON.stringify({ ...log, runs: log.runs.map((r) => ({ ...r, pages: [] })) }, null, 2),
  );

  expect(await splitRehearsalRunPages(ID)).toBe(1);

  const after = await loadRehearsalRuns(ID);
  expect(after.runs[0].pages).toBeUndefined();
  expect(after.runs[0].wordsSpoken).toBe(2);
  expect(disk.files.get(runPagesFile(ID, "r1")!)).toBe(real);
});

test("the split covers every rehearsal on the device, and one bad log is its own", async () => {
  const a = await startRehearsal({ topicId: "t", name: "A", outlineId: "o-a", now: 1 });
  const b = await startRehearsal({ topicId: "t", name: "B", outlineId: "o-b", now: 2 });
  disk.files.set(rehearsalRunsFile(a.id), inlinedLog(a.id, ["r1"]));
  disk.files.set(rehearsalRunsFile(b.id), inlinedLog(b.id, ["r2"]));
  disk.unreadable.add(rehearsalRunsFile(a.id));

  expect(await splitRehearsalRunPagesEverywhere()).toBe(1);

  expect(disk.files.has(runPagesFile(b.id, "r2")!)).toBe(true);
  expect(disk.files.get(rehearsalRunsFile(a.id))).toContain("Good evening.");
});

test("deleting takes the object, the runs and the rescue copy", async () => {
  const made = await startRehearsal({
    topicId: "topic-1",
    name: "A talk",
    outlineId: "o-7",
    now: 7,
  });
  await appendRun(aRun("r1", { rehearsalId: made.id }));
  disk.files.set(`${rehearsalRunsFile(made.id)}.bad`, "{not json");
  await deleteRehearsal(made.id);
  expect(disk.files.has(rehearsalFile(made.id))).toBe(false);
  expect(disk.files.has(rehearsalRunsFile(made.id))).toBe(false);
  expect(disk.files.has(`${rehearsalRunsFile(made.id)}.bad`)).toBe(false);
  // The transcripts go as a directory: once the log is gone there is no list of
  // them left to walk.
  expect(disk.files.has(runPagesFile(made.id, "r1")!)).toBe(false);
});

// Not the outline: a talk outlives the history of one set of passes over it.
test("deleting a rehearsal leaves the talk it was given against", async () => {
  const made = await rehearsalForRetell({
    topicId: "topic-1",
    retellId: "900",
    name: "Eye and Brain",
    now: 10,
  });
  await deleteRehearsal(made.id);
  expect(await loadTalkOutline(made.outlineId)).not.toBeNull();
});

test("deleting a retell takes the rehearsal of its talk and nobody else's", async () => {
  const mine = await rehearsalForRetell({
    topicId: "topic-1",
    retellId: "900",
    name: "Mine",
    now: 10,
  });
  const other = await startRehearsal({
    topicId: "topic-1",
    name: "Brought in",
    outlineId: "o-11",
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
