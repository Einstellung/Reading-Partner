// Where the item pool lives on disk (docs/35). Two of its three parts are
// derived and rebuildable — losing them costs one round of polling, never a
// briefing — so they stay out of sync range, like the day's briefing and article
// cache. The marks are the exception, and the reason the reads below are not all
// the same.
//
// Three shapes, because the three parts of a pool change at different rates and
// a single file would make every write cost the size of the whole thing:
//
//   info-pool-<date>.json  one day's discovered items, rewritten when a poll
//                          adds to today's and deleted whole when the day ages
//                          out. This is the heavy part (a feed-field source
//                          ships its article body with its headline), so it is
//                          the one that must never be rewritten for a reason
//                          that has nothing to do with it.
//   info-pool-marks.json   what runs have decided about items. Small, and
//                          written only at a run's checkpoints — twice a day on
//                          a normal day, not once per poll. In the sync range
//                          (platform/sync/syncFs.ts): a poll can find an item
//                          again, but nothing can work out that it was already
//                          briefed, so an empty marks file pushes the same item
//                          at the reader a second time on both devices.
//   info-pool-polled.json  when each source was last polled. Tiny, written every
//                          cycle, which is exactly why it is not in with the
//                          marks.

import { appData } from "../../platform/app/appdata";
import { readJson, writeTextAtomic } from "../../platform/app/atomic-fs";
import { emptyPool, POOL_VERSION, type Pool, type PoolMark } from "./item-pool";
import type { InfoItem } from "../sources/item";

const MARKS_FILE = "info-pool-marks.json";
const POLLED_FILE = "info-pool-polled.json";

// Matched exactly, so info-pool-marks.json and info-pool-polled.json are never
// mistaken for a day (their tails are not dates).
const DAY_FILE = /^info-pool-(\d{4}-\d{2}-\d{2})\.json$/;

export function poolDayFile(date: string): string {
  return `info-pool-${date}.json`;
}

// Read the whole pool. A missing or unreadable part reads as empty rather than
// throwing: the pool is a saving, not a source of truth, and a run that finds it
// blank simply collects the way it did before the pool existed. Empty marks are
// that same answer to a run and a different one to the writer — readMarks draws
// the line, savePoolMarks is where it holds.
export async function loadPool(): Promise<Pool> {
  const pool = emptyPool();
  let names: string[] = [];
  try {
    const entries = await appData.readDir("");
    names = entries.filter((e) => e.isFile).map((e) => e.name);
  } catch {
    return pool;
  }
  for (const name of names) {
    const m = DAY_FILE.exec(name);
    if (!m) continue;
    const items = await readJson<InfoItem[]>(name);
    if (Array.isArray(items)) pool.days[m[1]] = items.filter((it) => it && typeof it.id === "string");
  }
  const marks = await readMarks();
  if (marks.marks) pool.marks = marks.marks;
  pool.marksWritable = marks.writable;
  const polled = await readJson<{ version?: number; lastPolled?: Record<string, number> }>(POLLED_FILE);
  if (polled && polled.version === POOL_VERSION && polled.lastPolled) pool.lastPolled = polled.lastPolled;
  return pool;
}

// The marks, and whether they may be written back. Read apart from the rest of
// the pool because "no marks" is the answer to two different questions: a
// reader who has never been briefed, and a file that is sitting there and will
// not open. The second one must not be saved — the collector folds a run into
// the marks and saves the whole table at every checkpoint, so an empty read
// becomes an empty file at the next one.
//
// Bytes that will not parse, and a version this build does not know, stay
// writable: they hold no marks this build can act on, and refusing the write
// would leave the collector with nowhere to put marks for good.
async function readMarks(): Promise<{
  marks: Record<string, PoolMark> | null;
  writable: boolean;
}> {
  let text: string;
  try {
    if (!(await appData.exists(MARKS_FILE))) return { marks: null, writable: true };
    text = await appData.readText(MARKS_FILE);
  } catch (e) {
    console.warn(`failed to read ${MARKS_FILE}`, e);
    return { marks: null, writable: false };
  }
  try {
    const raw = JSON.parse(text) as { version?: number; marks?: Record<string, PoolMark> };
    if (raw && raw.version === POOL_VERSION && raw.marks) return { marks: raw.marks, writable: true };
    console.warn(`unexpected shape in ${MARKS_FILE}`);
  } catch (e) {
    console.warn(`failed to parse ${MARKS_FILE}`, e);
  }
  return { marks: null, writable: true };
}

export async function savePoolDay(date: string, items: InfoItem[]): Promise<void> {
  await writeTextAtomic(poolDayFile(date), JSON.stringify(items));
}

// Refused for a pool whose marks were never read off disk (Pool.marksWritable).
// Quietly: the pool is a saving, the marks stay in memory for the rest of the
// session, and a later start reads the file again. Raising here would take the
// poll schedule down with it — sweep writes both in one go.
export async function savePoolMarks(pool: Pool): Promise<void> {
  if (!pool.marksWritable) {
    console.warn(`${MARKS_FILE} was not read; not writing over it`);
    return;
  }
  await writeTextAtomic(MARKS_FILE, JSON.stringify({ version: POOL_VERSION, marks: pool.marks }));
}

export async function savePoolPolled(pool: Pool): Promise<void> {
  await writeTextAtomic(POLLED_FILE, JSON.stringify({ version: POOL_VERSION, lastPolled: pool.lastPolled }));
}

// Everything the pool leaves on disk except the marks: the day files and the
// poll schedule. For a device that has stopped collecting (docs/36) — a phone
// that ran an older build has a pool nobody will ever draw from, and nobody left
// to evict it either.
//
// The marks are deliberately kept: they are in the sync range, and they are the
// collector's record of what it has already put in a briefing.
export async function removeCollectedPoolFiles(): Promise<void> {
  let names: string[] = [];
  try {
    const entries = await appData.readDir("");
    names = entries.filter((e) => e.isFile).map((e) => e.name);
  } catch {
    return;
  }
  const doomed = names.filter((n) => DAY_FILE.test(n) || n === POLLED_FILE);
  for (const name of doomed) {
    try {
      await appData.remove(name);
    } catch {
      // Locked or already gone; keep going through the rest.
    }
  }
}

// Best effort: a day file that will not go away costs disk, not correctness —
// the pool in memory has already dropped it, so nothing reads it again.
export async function removePoolDays(dates: string[]): Promise<void> {
  for (const date of dates) {
    try {
      if (await appData.exists(poolDayFile(date))) {
        await appData.remove(poolDayFile(date));
      }
    } catch {
      // Keep going through the rest.
    }
  }
}
