import { expect, test } from "bun:test";
import {
  GENERIC_MARKER,
  collectMarks,
  executeMarks,
  genericMarker,
  runHousekeeper,
  type GarbageMarker,
  type MarkedBy,
} from "../../src/housekeeper";
import { DAY, memDisk, row } from "./fixtures";

const NOW = new Date(2026, 8, 27, 4, 0).getTime();

const ROWS = [
  row("cache", "cache-", "local", { rule: "marker", marker: "caches" }),
  row("shared", "shared-", "data", { rule: "marker", marker: "caches" }),
  row("blob", "blob-", "books", { rule: "marker", marker: "caches" }),
  row("keep", "keep-", "data", { rule: "never" }),
  row("flowed", "flowed-", "local", {
    rule: "inline",
    flow: { file: "src/x.ts", symbol: "sweep" },
  }),
  row("published", "published-", "remote-only", { rule: "marker", marker: "caches" }),
  row("synclog", "synclog-", "data", { rule: "tail", lines: 1 }),
  row("locallog", "locallog-", "local", { rule: "tail", lines: 2 }),
];

function del(path: string, marker = "caches"): MarkedBy {
  return { path, action: "delete", reason: "test", marker };
}

test("a synced delete queues the remote purge before the local file goes", async () => {
  const d = memDisk({ "shared-1": { text: "x", mtimeMs: 1 }, "blob-1": { text: "x", mtimeMs: 1 } });
  const res = await executeMarks([del("shared-1"), del("blob-1")], d.exec, {
    now: NOW,
    remoteBudget: 10,
    rows: ROWS,
  });
  expect(d.calls).toEqual(["purge shared-1", "remove shared-1", "purge blob-1", "remove blob-1"]);
  expect(res).toMatchObject({ done: 2, purged: 2 });
});

test("a local delete purges nothing", async () => {
  const d = memDisk({ "cache-1": { text: "x", mtimeMs: 1 } });
  await executeMarks([del("cache-1")], d.exec, { now: NOW, remoteBudget: 0, rows: ROWS });
  expect(d.calls).toEqual(["remove cache-1"]);
  expect(d.log[0]).toMatchObject({ path: "cache-1", marker: "caches", rule: "marker", outcome: "done" });
});

test("a failed purge leaves the local file alone", async () => {
  const d = memDisk({ "shared-1": { text: "x", mtimeMs: 1 } });
  d.exec.purgeRemote = async () => {
    throw new Error("offline");
  };
  const res = await executeMarks([del("shared-1")], d.exec, { now: NOW, remoteBudget: 10, rows: ROWS });
  expect(d.calls).toEqual([]);
  expect(res.failed).toBe(1);
});

test("synced deletes past the budget wait, and the next night takes them", async () => {
  const files = Object.fromEntries(
    ["shared-1", "shared-2", "shared-3"].map((p) => [p, { text: "x", mtimeMs: 1 }]),
  );
  const d = memDisk({ ...files, "cache-1": { text: "x", mtimeMs: 1 } });
  // A marker that marks whatever is on disk, as a real one recomputes each night.
  const marker: GarbageMarker = {
    name: "caches",
    async mark({ io }) {
      return (await io.list("")).map((e) => ({ path: e.name, action: "delete" as const, reason: "test" }));
    },
  };
  const night = () =>
    runHousekeeper({ now: NOW, readIo: d.read, executeIo: d.exec, markers: [marker], rows: ROWS, remoteBudget: 2 });

  const first = await night();
  expect(first).toMatchObject({ done: 3, deferred: 1, purged: 2 });
  expect([...d.disk.keys()]).toEqual(["shared-3"]);
  expect(d.log.find((l) => l.outcome === "deferred")?.path).toBe("shared-3");

  const second = await night();
  expect(second).toMatchObject({ done: 1, deferred: 0, purged: 1 });
  expect([...d.disk.keys()]).toEqual([]);
});

test("a mark on a path its row does not hand to that marker is refused", async () => {
  const d = memDisk({
    "keep-1": { text: "x", mtimeMs: 1 },
    "flowed-1": { text: "x", mtimeMs: 1 },
    "cache-1": { text: "x", mtimeMs: 1 },
    "stray": { text: "x", mtimeMs: 1 },
    "published-1": { text: "x", mtimeMs: 1 },
  });
  const res = await executeMarks(
    [del("keep-1"), del("flowed-1"), del("cache-1", "someone-else"), del("stray"), del("published-1"), del("cache-1", GENERIC_MARKER)],
    d.exec,
    { now: NOW, remoteBudget: 10, rows: ROWS },
  );
  expect(res).toMatchObject({ done: 0, refused: 6 });
  expect(d.calls).toEqual([]);
  expect(d.log.map((l) => l.outcome)).toEqual(Array(6).fill("refused"));
});

test("truncate-tail rewrites a local file and refuses a synced one", async () => {
  const d = memDisk({
    "locallog-1": { text: "a\nb\nc\n", mtimeMs: 1 },
    "synclog-1": { text: "a\nb\n", mtimeMs: 1 },
  });
  const marks = await collectMarks([genericMarker(ROWS)], d.read, NOW);
  const res = await executeMarks(marks, d.exec, { now: NOW, remoteBudget: 10, rows: ROWS });
  expect(d.disk.get("locallog-1")?.text).toBe("b\nc\n");
  expect(d.disk.get("synclog-1")?.text).toBe("a\nb\n");
  expect(res).toMatchObject({ done: 1, refused: 1 });
  expect(d.log.find((l) => l.path === "synclog-1")?.detail).toContain("sync-safe");
});

test("demote-local is defined and not carried out", async () => {
  const d = memDisk({ "cache-1": { text: "x", mtimeMs: 1 } });
  const res = await executeMarks(
    [{ path: "cache-1", action: "demote-local", reason: "cold", marker: "caches" }],
    d.exec,
    { now: NOW, remoteBudget: 10, rows: ROWS },
  );
  expect(res.refused).toBe(1);
  expect(d.disk.has("cache-1")).toBe(true);
});

test("a marker that throws costs its own marks only", async () => {
  const d = memDisk({ "cache-1": { text: "x", mtimeMs: NOW - 2 * DAY } });
  const broken: GarbageMarker = {
    name: "broken",
    mark: async () => {
      throw new Error("bad");
    },
  };
  const fine: GarbageMarker = {
    name: "caches",
    mark: async () => [{ path: "cache-1", action: "delete", reason: "ok" }],
  };
  const marks = await collectMarks([broken, fine], d.read, NOW);
  expect(marks).toEqual([{ path: "cache-1", action: "delete", reason: "ok", marker: "caches" }]);
});
