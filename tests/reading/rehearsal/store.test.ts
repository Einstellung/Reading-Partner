// The rehearsal log on disk (src/reading/rehearsal/store.ts): the round
// trip, the ordinal the store hands out, and what a file that will not parse
// does — which is the point of the file, because the shape it must not repeat
// (docs/29) is a loader that returns empty and a writer that then commits the
// empty version over the top. Run: bun test.

import { beforeEach, expect, mock, test } from "bun:test";
import { makeAppData } from "../../support/appdata";
import type { RehearsalRun } from "../../../src/reading/rehearsal/types";

const app = makeAppData();
// rename is not part of the shared fake: only this store moves a file aside by
// name, so the move lives here with the test that asserts it.
const renamed: string[] = [];
mock.module("@tauri-apps/plugin-fs", () => ({
  ...app.pluginFs,
  rename: async (from: string, to: string) => {
    const body = app.files.get(from);
    if (body === undefined) throw new Error(`no file: ${from}`);
    app.files.set(to, body);
    app.files.delete(from);
    renamed.push(`${from} -> ${to}`);
  },
}));
mock.module("@tauri-apps/api/core", () => app.core);
mock.module("../../../src/platform/app/atomic-fs", () => app.atomicFs);

const { appendRun, deleteRehearsals, loadRehearsals, rehearsalFile } = await import(
  "../../../src/reading/rehearsal/store"
);

const TALK = "1754400000000";

function aRun(id: string, over: Partial<RehearsalRun> = {}): RehearsalRun {
  return {
    id,
    ordinal: 1,
    talkId: TALK,
    deckFile: "slides/1754400000000-my-talk.html",
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

beforeEach(() => {
  app.reset();
  renamed.length = 0;
});

test("a talk that has never been given reads as an empty log, not an error", async () => {
  const log = await loadRehearsals(TALK);
  expect(log.runs).toEqual([]);
  expect(log.talkId).toBe(TALK);
  expect(app.files.has(rehearsalFile(TALK))).toBe(false);
});

test("a run written comes back the way it went in", async () => {
  await appendRun(aRun("r1"));
  const log = await loadRehearsals(TALK);
  expect(log.runs).toHaveLength(1);
  expect(log.runs[0].pages[0].transcript).toBe("Good evening.");
  expect(log.runs[0].deckFile).toBe("slides/1754400000000-my-talk.html");
});

test("the store numbers the runs, oldest first", async () => {
  expect((await appendRun(aRun("r1"))).ordinal).toBe(1);
  expect((await appendRun(aRun("r2"))).ordinal).toBe(2);
  // A caller working from a stale count cannot hand out a number twice.
  expect((await appendRun(aRun("r3", { ordinal: 1 }))).ordinal).toBe(3);
  const log = await loadRehearsals(TALK);
  expect(log.runs.map((r) => r.id)).toEqual(["r1", "r2", "r3"]);
  expect(log.runs.map((r) => r.ordinal)).toEqual([1, 2, 3]);
});

test("one talk's runs are not another's", async () => {
  await appendRun(aRun("r1"));
  await appendRun(aRun("other", { talkId: "talk-2" }));
  expect((await loadRehearsals(TALK)).runs.map((r) => r.id)).toEqual(["r1"]);
  expect((await loadRehearsals("talk-2")).runs.map((r) => r.id)).toEqual(["other"]);
});

// docs/29: the loss that has already happened once, on slides/talks.json.
test("a file that will not parse is moved aside before the empty log is handed back", async () => {
  app.files.set(rehearsalFile(TALK), "{not json");
  const log = await loadRehearsals(TALK);
  expect(log.runs).toEqual([]);
  expect(renamed).toEqual([`${rehearsalFile(TALK)} -> ${rehearsalFile(TALK)}.bad`]);
  expect(app.files.get(`${rehearsalFile(TALK)}.bad`)).toBe("{not json");
  expect(app.files.has(rehearsalFile(TALK))).toBe(false);
});

test("a write after a bad file lands on the file, not on top of the bad bytes", async () => {
  app.files.set(rehearsalFile(TALK), "{not json");
  await appendRun(aRun("r1"));
  expect(app.files.get(`${rehearsalFile(TALK)}.bad`)).toBe("{not json");
  expect((await loadRehearsals(TALK)).runs.map((r) => r.id)).toEqual(["r1"]);
});

test("a version this build does not know is set aside, not read as empty in place", async () => {
  app.files.set(rehearsalFile(TALK), JSON.stringify({ version: 99, talkId: TALK, runs: [] }));
  expect((await loadRehearsals(TALK)).runs).toEqual([]);
  expect(renamed).toHaveLength(1);
});

// A read that failed for IO reasons says nothing about the bytes, so they stay
// where they are and nothing is moved.
test("a file that would not open is left alone", async () => {
  app.files.set(rehearsalFile(TALK), JSON.stringify({ version: 1, talkId: TALK, runs: [] }));
  app.unreadable.add(rehearsalFile(TALK));
  expect((await loadRehearsals(TALK)).runs).toEqual([]);
  expect(renamed).toEqual([]);
  expect(app.files.has(rehearsalFile(TALK))).toBe(true);
});

// One unusable run inside a usable file is dropped: a lost run is one talk
// given again, a lost log is every run there ever was.
test("a run the file cannot use is dropped and the rest of the log survives", async () => {
  app.files.set(
    rehearsalFile(TALK),
    JSON.stringify({
      version: 1,
      talkId: TALK,
      runs: [
        { id: "r1", ordinal: 1, talkId: TALK, deckFile: null, startedAt: 1, endedAt: 2, pages: [] },
        { ordinal: 2, startedAt: 3, pages: [] },
        {
          id: "r3",
          ordinal: 3,
          talkId: TALK,
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
  const log = await loadRehearsals(TALK);
  expect(log.runs.map((r) => r.id)).toEqual(["r1", "r3"]);
  expect(log.runs[1].pages.map((p) => p.index)).toEqual([1]);
  expect(renamed).toEqual([]);
});

test("deleting takes the log and its rescue copy with it", async () => {
  await appendRun(aRun("r1"));
  app.files.set(`${rehearsalFile(TALK)}.bad`, "{not json");
  await deleteRehearsals(TALK);
  expect(app.files.has(rehearsalFile(TALK))).toBe(false);
  expect(app.files.has(`${rehearsalFile(TALK)}.bad`)).toBe(false);
});

test("deleting a talk that was never given is not an error", async () => {
  await deleteRehearsals("never");
  expect(app.files.size).toBe(0);
});
