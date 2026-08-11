// Where the item pool lives on disk (docs/35). Derived and rebuildable — a lost
// pool costs one round of polling, never a briefing — so it stays out of sync
// range, like the day's briefing and article cache.
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
//                          a normal day, not once per poll.
//   info-pool-polled.json  when each source was last polled. Tiny, written every
//                          cycle, which is exactly why it is not in with the
//                          marks.

import { BaseDirectory, exists, readDir, readTextFile, remove } from "@tauri-apps/plugin-fs";
import { writeTextAtomic } from "../../platform/app/atomic-fs";
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

async function readJson<T>(file: string): Promise<T | null> {
  try {
    if (!(await exists(file, { baseDir: BaseDirectory.AppData }))) return null;
    return JSON.parse(await readTextFile(file, { baseDir: BaseDirectory.AppData })) as T;
  } catch {
    return null;
  }
}

// Read the whole pool. A missing or unreadable part reads as empty rather than
// throwing: the pool is a saving, not a source of truth, and a run that finds it
// blank simply collects the way it did before the pool existed.
export async function loadPool(): Promise<Pool> {
  const pool = emptyPool();
  let names: string[] = [];
  try {
    const entries = await readDir("", { baseDir: BaseDirectory.AppData });
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
  const marks = await readJson<{ version?: number; marks?: Record<string, PoolMark> }>(MARKS_FILE);
  if (marks && marks.version === POOL_VERSION && marks.marks) pool.marks = marks.marks;
  const polled = await readJson<{ version?: number; lastPolled?: Record<string, number> }>(POLLED_FILE);
  if (polled && polled.version === POOL_VERSION && polled.lastPolled) pool.lastPolled = polled.lastPolled;
  return pool;
}

export async function savePoolDay(date: string, items: InfoItem[]): Promise<void> {
  await writeTextAtomic(poolDayFile(date), JSON.stringify(items));
}

export async function savePoolMarks(pool: Pool): Promise<void> {
  await writeTextAtomic(MARKS_FILE, JSON.stringify({ version: POOL_VERSION, marks: pool.marks }));
}

export async function savePoolPolled(pool: Pool): Promise<void> {
  await writeTextAtomic(POLLED_FILE, JSON.stringify({ version: POOL_VERSION, lastPolled: pool.lastPolled }));
}

// Best effort: a day file that will not go away costs disk, not correctness —
// the pool in memory has already dropped it, so nothing reads it again.
export async function removePoolDays(dates: string[]): Promise<void> {
  for (const date of dates) {
    try {
      if (await exists(poolDayFile(date), { baseDir: BaseDirectory.AppData })) {
        await remove(poolDayFile(date), { baseDir: BaseDirectory.AppData });
      }
    } catch {
      // Keep going through the rest.
    }
  }
}
