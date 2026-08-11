// The item pool (src/info/briefing/item-pool.ts): what keeps a briefing from
// only ever seeing whatever the feeds happen to be showing at generation time.
// Everything here is pure — the schedule, the dedupe, the cross-day bookkeeping,
// the eviction — so it is checked with a fake clock and no filesystem.
// Run: bun test.

import { expect, test } from "bun:test";
import {
  addDiscovered,
  daysBetween,
  drawForDay,
  dueSources,
  emptyPool,
  evict,
  markPolled,
  nextPollDelay,
  POOL_ITEM_DAYS,
  POOL_MARK_DAYS,
  poolSize,
  recordRun,
  unstockedSources,
  type Pool,
} from "../../src/info/briefing/item-pool";
import { DEFAULT_POLL_MINUTES, type SourceDescriptor } from "../../src/info/sources/descriptor";
import type { InfoItem } from "../../src/info/sources/item";
import type { ScreenVerdict } from "../../src/info/briefing/screen";

const MIN = 60_000;

function item(id: string, source = "s"): InfoItem {
  return { id, source, sourceName: source.toUpperCase(), title: id, url: `https://x/${id}`, publishedAt: "" };
}

function source(id: string, pollMinutes?: number): SourceDescriptor {
  return {
    id,
    name: id,
    line: "AI",
    enabled: true,
    discovery: { kind: "feed", url: `https://${id}/feed` },
    fulltext: { mode: "none" },
    ...(pollMinutes === undefined ? {} : { pollMinutes }),
  };
}

function verdict(id: string, keep: boolean, confidence = 2): ScreenVerdict {
  return { id, keep, why: "", confidence };
}

function verdicts(...vs: ScreenVerdict[]): Record<string, ScreenVerdict> {
  return Object.fromEntries(vs.map((v) => [v.id, v]));
}

// --- discovery --------------------------------------------------------------

test("the same article arriving in twenty polls is stored once, on the day it first appeared", () => {
  let pool = emptyPool();
  ({ pool } = addDiscovered(pool, [item("a"), item("b")], "2026-08-10"));
  for (let i = 0; i < 20; i++) {
    ({ pool } = addDiscovered(pool, [item("a"), item("b")], "2026-08-11"));
  }
  const { pool: next, added } = addDiscovered(pool, [item("b"), item("c")], "2026-08-11");
  expect(added.map((it) => it.id)).toEqual(["c"]);
  expect(next.days["2026-08-10"].map((it) => it.id)).toEqual(["a", "b"]);
  expect(next.days["2026-08-11"].map((it) => it.id)).toEqual(["c"]);
  expect(poolSize(next).items).toBe(3);
});

test("a poll that brings back nothing new leaves the pool object untouched", () => {
  const { pool } = addDiscovered(emptyPool(), [item("a")], "2026-08-11");
  const again = addDiscovered(pool, [item("a")], "2026-08-11");
  expect(again.pool).toBe(pool);
  expect(again.added).toEqual([]);
});

// --- the schedule -----------------------------------------------------------

test("a source is due on its own interval, not a global one", () => {
  const now = 10 * 60 * MIN;
  const fast = source("bloomberg", 30);
  const slow = source("economist", 1440);
  let pool = emptyPool();
  pool = markPolled(pool, ["bloomberg", "economist"], now - 60 * MIN);
  expect(dueSources([fast, slow], pool, now).map((d) => d.id)).toEqual(["bloomberg"]);
});

test("a source nobody has polled yet is due at once", () => {
  expect(dueSources([source("a")], emptyPool(), 1_000).map((d) => d.id)).toEqual(["a"]);
});

test("a source with no stated interval falls back to the default", () => {
  const now = 10_000 * MIN;
  const pool = markPolled(emptyPool(), ["a"], now - (DEFAULT_POLL_MINUTES - 1) * MIN);
  expect(dueSources([source("a")], pool, now)).toEqual([]);
  const later = markPolled(emptyPool(), ["a"], now - DEFAULT_POLL_MINUTES * MIN);
  expect(dueSources([source("a")], later, now).map((d) => d.id)).toEqual(["a"]);
});

test("a last-polled stamp from the future is treated as due, not as a source parked until the clock catches up", () => {
  const now = 1000 * MIN;
  const pool = markPolled(emptyPool(), ["a"], now + 500 * MIN);
  expect(dueSources([source("a")], pool, now).map((d) => d.id)).toEqual(["a"]);
});

test("the next wake is the soonest source's, held inside the bounds", () => {
  const now = 1000 * MIN;
  const bounds = { min: 1 * MIN, max: 30 * MIN };
  let pool = markPolled(emptyPool(), ["fast"], now - 20 * MIN);
  pool = markPolled(pool, ["slow"], now);
  // fast is 30m and was polled 20m ago -> 10m; slow is a day away.
  expect(nextPollDelay([source("fast", 30), source("slow", 1440)], pool, now, bounds)).toBe(10 * MIN);
  // Everything overdue clamps to the floor rather than spinning.
  expect(nextPollDelay([source("fast", 30)], emptyPool(), now, bounds)).toBe(bounds.min);
  // Nothing subscribed: the ceiling.
  expect(nextPollDelay([], emptyPool(), now, bounds)).toBe(bounds.max);
});

// --- eviction ---------------------------------------------------------------

test("days past the item window are dropped whole, and named so their files can go", () => {
  let pool = emptyPool();
  ({ pool } = addDiscovered(pool, [item("old")], "2026-08-01"));
  ({ pool } = addDiscovered(pool, [item("edge")], "2026-08-08"));
  ({ pool } = addDiscovered(pool, [item("new")], "2026-08-11"));
  const { pool: next, droppedDays } = evict(pool, "2026-08-11", ["s"]);
  expect(POOL_ITEM_DAYS).toBe(3);
  expect(droppedDays).toEqual(["2026-08-01"]);
  expect(Object.keys(next.days).sort()).toEqual(["2026-08-08", "2026-08-11"]);
});

test("a mark outlives its item, so a feed still offering a three-week-old piece cannot get it delivered twice", () => {
  let pool = emptyPool();
  ({ pool } = addDiscovered(pool, [item("a")], "2026-07-25"));
  pool = recordRun(pool, "2026-07-25", { verdicts: verdicts(verdict("a", true)), briefed: ["a"] });
  const { pool: swept } = evict(pool, "2026-08-11", ["s"]);
  expect(swept.days["2026-07-25"]).toBeUndefined();
  expect(swept.marks["a"].briefedOn).toBe("2026-07-25");

  // The Economist hands it back seventeen days later; the mark keeps it out.
  const { pool: refilled } = addDiscovered(swept, [item("a")], "2026-08-11");
  expect(refilled.days["2026-08-11"].map((it) => it.id)).toEqual(["a"]);
  expect(drawForDay(refilled, "2026-08-11").items).toEqual([]);
});

test("a mark past the mark window goes, and its age is the most recent thing that happened to it", () => {
  let pool = emptyPool();
  pool = recordRun(pool, "2026-06-01", { verdicts: verdicts(verdict("stale", false)) });
  pool = recordRun(pool, "2026-06-01", { verdicts: verdicts(verdict("live", true)) });
  pool = recordRun(pool, "2026-08-10", { briefed: ["live"] });
  const { pool: next } = evict(pool, "2026-08-11", []);
  expect(POOL_MARK_DAYS).toBe(30);
  expect(Object.keys(next.marks)).toEqual(["live"]);
});

test("eviction forgets the poll schedule of a source that is gone", () => {
  const pool = markPolled(emptyPool(), ["kept", "removed"], 1_000);
  const { pool: next } = evict(pool, "2026-08-11", ["kept"]);
  expect(Object.keys(next.lastPolled)).toEqual(["kept"]);
});

test("eviction with nothing to drop hands back the same pool", () => {
  let pool = emptyPool();
  ({ pool } = addDiscovered(pool, [item("a")], "2026-08-11"));
  pool = markPolled(pool, ["s"], 1);
  expect(evict(pool, "2026-08-11", ["s"]).pool).toBe(pool);
});

// --- the day's draw ---------------------------------------------------------

// A pool built the way a day of background collection builds one: yesterday's
// items, some judged and delivered, some judged and dropped, plus tonight's that
// nobody has looked at.
function dayPool(): Pool {
  let pool = emptyPool();
  ({ pool } = addDiscovered(pool, [item("briefed"), item("dropped"), item("capped")], "2026-08-10"));
  ({ pool } = addDiscovered(pool, [item("overnight")], "2026-08-10"));
  pool = recordRun(pool, "2026-08-10", {
    verdicts: verdicts(verdict("briefed", true), verdict("dropped", false), verdict("capped", true)),
    bodies: ["briefed"],
    briefed: ["briefed"],
  });
  return pool;
}

test("the day draws what nobody judged and what was judged worth keeping but never delivered", () => {
  const seed = drawForDay(dayPool(), "2026-08-11");
  // "briefed" went out yesterday and "dropped" was judged not worth fetching
  // yesterday; neither is re-decided. "capped" cleared the screen but the daily
  // ceiling cut it, so it gets another chance, and it keeps its verdict.
  expect(seed.items.map((it) => it.id)).toEqual(["capped", "overnight"]);
  expect(Object.keys(seed.verdicts)).toEqual(["capped"]);
  expect(seed.verdicts["capped"].keep).toBe(true);
  expect(seed.bodied).toEqual([]);
});

test("a second run the same day merges into it: today's items come back, with their bodies", () => {
  let pool = dayPool();
  ({ pool } = addDiscovered(pool, [item("fresh")], "2026-08-11"));
  pool = recordRun(pool, "2026-08-11", {
    verdicts: verdicts(verdict("capped", true), verdict("overnight", false), verdict("fresh", true)),
    bodies: ["capped", "fresh"],
    briefed: ["capped", "fresh"],
  });
  ({ pool } = addDiscovered(pool, [item("later")], "2026-08-11"));

  const seed = drawForDay(pool, "2026-08-11");
  // Everything today's briefing carries, plus what has come in since. Not a
  // second briefing: the same one, re-triaged over more material.
  expect(seed.items.map((it) => it.id)).toEqual(["capped", "overnight", "fresh", "later"]);
  // Judged today, so it stays visible to the day's tally, and it is not rejudged.
  expect(seed.verdicts["overnight"].keep).toBe(false);
  expect(seed.bodied.sort()).toEqual(["capped", "fresh"]);
  expect(seed.verdicts["later"]).toBeUndefined();
});

test("what an earlier day settled is named, so a run that rediscovered it can drop it", () => {
  // The reason it is read off the marks and not off the days: the item that
  // costs the most to rediscover is the one whose headline aged out weeks ago
  // while its source went on offering it.
  let pool = dayPool();
  pool = evict(pool, "2026-08-20").pool;
  expect(pool.days["2026-08-10"]).toBeUndefined();
  const seed = drawForDay(pool, "2026-08-20");
  expect(seed.items).toEqual([]);
  expect(seed.settled.sort()).toEqual(["briefed", "dropped"]);
});

test("nothing drawn is also called settled", () => {
  const seed = drawForDay(dayPool(), "2026-08-11");
  expect(seed.settled.sort()).toEqual(["briefed", "dropped"]);
  for (const it of seed.items) expect(seed.settled).not.toContain(it.id);
});

test("the draw is oldest first, so a run reads the day in the order it happened", () => {
  let pool = emptyPool();
  ({ pool } = addDiscovered(pool, [item("c")], "2026-08-11"));
  ({ pool } = addDiscovered(pool, [item("a")], "2026-08-09"));
  ({ pool } = addDiscovered(pool, [item("b")], "2026-08-10"));
  expect(drawForDay(pool, "2026-08-11").items.map((it) => it.id)).toEqual(["a", "b", "c"]);
});

// --- recording --------------------------------------------------------------

test("recording a run marks what it judged, fetched and delivered", () => {
  let pool = emptyPool();
  ({ pool } = addDiscovered(pool, [item("a"), item("b")], "2026-08-11"));
  pool = recordRun(pool, "2026-08-11", {
    verdicts: verdicts(verdict("a", true, 3), verdict("b", false, 1)),
    bodies: ["a"],
    briefed: ["a"],
  });
  expect(pool.marks["a"]).toEqual({
    keep: true,
    confidence: 3,
    screenedOn: "2026-08-11",
    bodyOn: "2026-08-11",
    briefedOn: "2026-08-11",
  });
  expect(pool.marks["b"]).toEqual({ keep: false, confidence: 1, screenedOn: "2026-08-11" });
});

test("a body or a delivery for an item nobody screened invents no mark", () => {
  const pool = recordRun(emptyPool(), "2026-08-11", { bodies: ["ghost"], briefed: ["ghost"] });
  expect(pool.marks).toEqual({});
});

// --- the pool as a saving, not a source of truth ------------------------------

test("a source the pool is holding nothing for is named, whatever its schedule says", () => {
  let pool = emptyPool();
  ({ pool } = addDiscovered(pool, [item("1", "stocked")], "2026-08-11"));
  pool = markPolled(pool, ["stocked", "lost"], 1);
  const named = unstockedSources([source("stocked"), source("lost")], pool);
  expect(named.map((d) => d.id)).toEqual(["lost"]);
});

test("daysBetween counts whole days and shrugs at nonsense", () => {
  expect(daysBetween("2026-08-08", "2026-08-11")).toBe(3);
  expect(daysBetween("2026-08-11", "2026-08-11")).toBe(0);
  expect(daysBetween("2026-08-12", "2026-08-11")).toBe(-1);
  expect(daysBetween("not-a-date", "2026-08-11")).toBe(0);
});
