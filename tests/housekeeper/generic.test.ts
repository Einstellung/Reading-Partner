import { expect, test } from "bun:test";
import { genericMarker } from "../../src/housekeeper";
import { DAY, memDisk, row } from "./fixtures";

const NOW = new Date(2026, 8, 27, 4, 0).getTime();

test("age by mtime marks what is past the window and leaves the rest and the undated", async () => {
  const { read } = memDisk({
    "stamps/old-a": { text: "", mtimeMs: NOW - 31 * DAY },
    "stamps/old-b": { text: "", mtimeMs: NOW - 29 * DAY },
    "stamps/old-c": { text: "", mtimeMs: 0 },
    "stamps/other": { text: "", mtimeMs: NOW - 90 * DAY },
  });
  const marker = genericMarker([row("stamp", "stamps/old-", "local", { rule: "age", days: 30, from: "mtime" })]);
  const marks = await marker.mark({ io: read, now: NOW });
  expect(marks.map((m) => [m.path, m.action])).toEqual([["stamps/old-a", "delete"]]);
});

test("age by the date in the name counts local days", async () => {
  const { read } = memDisk({
    "day-2026-09-20.json": { text: "", mtimeMs: NOW },
    "day-2026-09-19.json": { text: "", mtimeMs: NOW },
    "day-2026-09-27.json": { text: "", mtimeMs: NOW },
  });
  const marker = genericMarker([
    row("day", "day-", "local", { rule: "age", days: 7, from: "name-date" }, { dated: true }),
  ]);
  const marks = await marker.mark({ io: read, now: NOW });
  expect(marks.map((m) => m.path)).toEqual(["day-2026-09-19.json"]);
});

test("keep-last keeps the newest per directory", async () => {
  const { read } = memDisk({
    "snap/s-1": { text: "", mtimeMs: 1 },
    "snap/s-2": { text: "", mtimeMs: 2 },
    "snap/s-3": { text: "", mtimeMs: 3 },
  });
  const byMtime = genericMarker([row("snap", "snap/s-", "local", { rule: "keep-last", count: 2, by: "mtime" })]);
  expect((await byMtime.mark({ io: read, now: NOW })).map((m) => m.path)).toEqual(["snap/s-1"]);
  const byName = genericMarker([row("snap", "snap/s-", "local", { rule: "keep-last", count: 1, by: "name" })]);
  expect((await byName.mark({ io: read, now: NOW })).map((m) => m.path).sort()).toEqual(["snap/s-1", "snap/s-2"]);
});

test("tail marks a file longer than its keep with the line count", async () => {
  const { read } = memDisk({
    "log-a": { text: "1\n2\n3\n4\n", mtimeMs: NOW },
    "log-b": { text: "1\n2\n", mtimeMs: NOW },
  });
  const marker = genericMarker([row("log", "log-", "local", { rule: "tail", lines: 3 })]);
  const marks = await marker.mark({ io: read, now: NOW });
  expect(marks).toEqual([
    { path: "log-a", action: "truncate-tail", keepLines: 3, reason: "4 lines, keeps the last 3" },
  ]);
});

test("rows whose retention is not a generic rule are not the generic marker's", async () => {
  const { read } = memDisk({ "x-1": { text: "", mtimeMs: 1 } });
  const marker = genericMarker([row("x", "x-", "local", { rule: "marker", marker: "someone" })]);
  expect(await marker.mark({ io: read, now: NOW })).toEqual([]);
});

test("the marker never writes: it gets a read-only io and the disk is unchanged", async () => {
  const { read, disk } = memDisk({ "log-a": { text: "1\n2\n3\n", mtimeMs: 1 } });
  const before = JSON.stringify([...disk]);
  await genericMarker([row("log", "log-", "local", { rule: "tail", lines: 1 })]).mark({ io: read, now: NOW });
  expect(JSON.stringify([...disk])).toBe(before);
});
