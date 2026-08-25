// A talk's outline on disk (src/reading/talk/store.ts): the file name, what a
// file that will not parse does, and what a read that failed must not let a
// write do. The shape this must never repeat is docs/29's: a loader that answers
// empty and a writer that then commits the empty version over the top.
// Run: bun test.

import { beforeEach, expect, test } from "bun:test";
import { putSegment, setSpine } from "../../../src/reading/talk/edit";
import {
  deleteTalkOutline,
  editTalkOutline,
  listTalkOutlinesForTopic,
  loadTalkOutline,
  startTalkOutline,
  talkOutlineFile,
  talkOutlineForRetell,
  talkOutlineIdOf,
} from "../../../src/reading/talk/store";
import { installAppData, QUARANTINE_SUFFIX, type FakeDisk } from "../../support/appdata-fake";

let disk: FakeDisk;

beforeEach(() => {
  disk = installAppData();
});

test("an outline written comes back the way it went in", async () => {
  const made = await startTalkOutline({ topicId: "topic-1", name: "智能简史", now: 1 });
  expect(made.id).toBe("1");
  expect(disk.files.has(talkOutlineFile("1"))).toBe(true);
  const read = await loadTalkOutline("1");
  expect(read?.name).toBe("智能简史");
  expect(read?.topicId).toBe("topic-1");
  expect((await listTalkOutlinesForTopic("topic-1")).map((o) => o.id)).toEqual(["1"]);
  expect(await listTalkOutlinesForTopic("topic-2")).toEqual([]);
});

// The name has to be one nothing else in the AppData root answers to. An earlier
// build wrote the retells as talk-<id>.json and those files are still there.
test("the listing sees outlines and nothing else in the directory", () => {
  expect(talkOutlineIdOf("outline-1754400000000.json")).toBe("1754400000000");
  expect(talkOutlineIdOf("talk-1754400000000.json")).toBeNull();
  expect(talkOutlineIdOf("retell-1754400000000.json")).toBeNull();
  expect(talkOutlineIdOf("outline-.json")).toBeNull();
  expect(talkOutlineIdOf("outline-1.json.bad")).toBeNull();
});

test("a taken name steps to the next free millisecond", async () => {
  disk.files.set(talkOutlineFile("5"), "{not json");
  const made = await startTalkOutline({ topicId: "t", now: 5 });
  expect(made.id).toBe("6");
  expect(disk.files.get(talkOutlineFile("5"))).toBe("{not json");
});

test("a file that will not parse is moved aside before anything is written over it", async () => {
  disk.files.set(talkOutlineFile("1"), "{not json");
  expect(await loadTalkOutline("1")).toBeNull();
  expect(disk.files.has(talkOutlineFile("1"))).toBe(false);
  expect(disk.files.has(`${talkOutlineFile("1")}${QUARANTINE_SUFFIX}`)).toBe(true);
});

// The one case where "there is no outline" would be a lie: the bytes are still
// there and were never read. Answering null would let the next write replace a
// whole talk with one segment.
test("a read that failed stops the edit rather than starting over", async () => {
  const made = await startTalkOutline({ topicId: "t", name: "Kept", now: 1 });
  const before = disk.files.get(talkOutlineFile(made.id));
  disk.unreadable.add(talkOutlineFile(made.id));
  await expect(
    editTalkOutline(made.id, (o) => putSegment(o, { title: "one" }, 2)),
  ).rejects.toThrow();
  expect(disk.files.get(talkOutlineFile(made.id))).toBe(before as string);
});

test("an edit writes, and an edit that changes nothing does not", async () => {
  const made = await startTalkOutline({ topicId: "t", now: 1 });
  await editTalkOutline(made.id, (o) => putSegment(o, { id: "a", title: "Opening" }, 2));
  const read = await loadTalkOutline(made.id);
  expect(read?.segments.map((s) => s.title)).toEqual(["Opening"]);

  const writes = disk.writes.length;
  await editTalkOutline(made.id, (o) => putSegment(o, { id: "a", title: "Opening" }, 3));
  expect(disk.writes.length).toBe(writes);
  await editTalkOutline(made.id, (o) => setSpine(o, { thesis: "the body is the point" }, 4));
  expect(disk.writes.length).toBe(writes + 1);
  expect((await loadTalkOutline(made.id))?.spine.thesis).toBe("the body is the point");
});

test("editing an outline that is not there answers null and writes nothing", async () => {
  expect(await editTalkOutline("nobody", (o) => o)).toBeNull();
  expect(disk.writes).toEqual([]);
});

// docs/44: the arrangement is what the last exchange of a retell produces, so a
// retell has one outline however many times it is asked for.
test("a retell gets one outline, made once", async () => {
  const first = await talkOutlineForRetell({ topicId: "t", retellId: "900", name: "A", now: 10 });
  const second = await talkOutlineForRetell({ topicId: "t", retellId: "900", name: "A", now: 20 });
  expect(second.id).toBe(first.id);
  expect(first.retellId).toBe("900");
  expect((await listTalkOutlinesForTopic("t")).map((o) => o.id)).toEqual([first.id]);
});

test("deleting takes the file and nothing else", async () => {
  const made = await startTalkOutline({ topicId: "t", now: 1 });
  const other = await startTalkOutline({ topicId: "t", now: 2 });
  await deleteTalkOutline(made.id);
  expect(disk.files.has(talkOutlineFile(made.id))).toBe(false);
  expect(disk.files.has(talkOutlineFile(other.id))).toBe(true);
  // Deleting one that was never there is not an error.
  await deleteTalkOutline("nobody");
});
