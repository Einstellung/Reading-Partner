// The item pool (docs/35): what the sources have published lately, kept between
// briefings instead of gathered from scratch at generation time.
//
// Why it has to exist: a feed is a window, not an archive. Measured, a Bloomberg
// section feed holds 20 items covering somewhere between 6 and 22 hours, so a
// reader who generates one briefing a day loses most of the day and is never
// told. The Economist's returns 300 items covering three weeks, where one poll a
// day misses nothing. There is no single collection rhythm that serves both, so
// each source carries its own (`pollMinutes`, docs/17) and the pool is where the
// polls accumulate.
//
// Two kinds of state live here, and they are kept apart because they age at
// different rates:
//
//   items — the headlines a poll brought back, filed under the local date they
//           were first seen. Heavy (a feed-field source ships its article body
//           with the headline, and re-fetching it later would be a request the
//           funnel exists to avoid), so they are kept for days, not weeks.
//   marks — what a briefing run has already decided about an item: judged and
//           how, body fetched, delivered. Tiny, and it has to outlive the item:
//           The Economist will still be offering a three-week-old piece long
//           after its headline was evicted, and without the mark it would be
//           screened and delivered a second time.
//
// Everything here is pure. The files are pool-store.ts's business, the polling
// is collector.ts's.

import { pollIntervalMs, type SourceDescriptor } from "../sources/descriptor";
import type { InfoItem } from "../sources/item";
import type { ScreenVerdict } from "./screen";

export const POOL_VERSION = 1 as const;

// How long a day's discovered headlines are kept. Three days covers a briefing
// missed over a weekend without letting the bodies a feed shipped for free pile
// up into the multi-megabyte article cache the daily prune exists to kill.
export const POOL_ITEM_DAYS = 3;
// How long an item's mark outlives its headline. Longer than the longest feed
// window measured (three weeks), so a source that keeps offering an old item
// cannot get it delivered twice.
export const POOL_MARK_DAYS = 30;

// What a briefing run has already spent on one item. Created when screening
// judges it — an item nobody has judged has no mark, which is exactly what makes
// "not screened yet" cheap to ask.
export interface PoolMark {
  keep: boolean;
  confidence: number;
  // Local date of the run that judged it. Also the mark's age for eviction.
  screenedOn: string;
  // Local date whose article cache holds its body, so a second run the same day
  // (the merge a refresh does) reads it instead of fetching it again.
  bodyOn?: string;
  // Local date of the briefing it was delivered in. Set for every item the
  // briefing carried, filtered ones included — they were shown, and showing them
  // again tomorrow is the bug this field prevents.
  briefedOn?: string;
}

export interface Pool {
  version: typeof POOL_VERSION;
  // Items by the local date they were first discovered on. A day is one file.
  days: Record<string, InfoItem[]>;
  marks: Record<string, PoolMark>;
  // Per source, when it was last polled (ms). Wall clock, not a timer tick: a
  // phone suspends a backgrounded webview and its timers with it, so whether a
  // source is due has to be answerable from what is on disk.
  lastPolled: Record<string, number>;
  // Whether `marks` is what the marks file holds, and so whether that file may
  // be written from this pool. A read that succeeded grants it (pool-store.ts)
  // and nothing else does: an empty `marks` is also what a file that would not
  // open looks like, and saving that says nothing has ever been briefed.
  marksWritable: boolean;
}

// Unwritable, because nothing has read the file yet. The one pool that is ever
// saved comes from loadPool, which grants it there.
export function emptyPool(): Pool {
  return { version: POOL_VERSION, days: {}, marks: {}, lastPolled: {}, marksWritable: false };
}

// --- dates ------------------------------------------------------------------

// Whole days from `from` to `to`, both local "YYYY-MM-DD". Parsed as UTC so the
// arithmetic is not a DST question; the strings were made from local time and
// only their difference is used.
export function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.round((b - a) / 86_400_000);
}

// --- discovery --------------------------------------------------------------

// File what a poll brought back under today, keeping only what the pool has not
// seen. The id is a content-addressed hash of source + key (extract/id), so the
// same article arriving in twenty consecutive polls is stored once, and the day
// it is filed under stays the day it first appeared.
//
// First write wins: an item already in the pool is left exactly as it was, which
// is what keeps a day's file append-only in practice and its rewrites cheap.
export function addDiscovered(
  pool: Pool,
  items: InfoItem[],
  today: string,
): { pool: Pool; added: InfoItem[] } {
  const known = new Set<string>();
  for (const day of Object.values(pool.days)) for (const it of day) known.add(it.id);
  const added: InfoItem[] = [];
  for (const it of items) {
    if (!it.id || known.has(it.id)) continue;
    known.add(it.id);
    added.push(it);
  }
  if (added.length === 0) return { pool, added };
  return {
    pool: {
      ...pool,
      days: { ...pool.days, [today]: [...(pool.days[today] ?? []), ...added] },
    },
    added,
  };
}

// --- polling schedule -------------------------------------------------------

// The sources due for a poll, in list order. A source never polled is due at
// once — subscribing to something and waiting two hours for its first headline
// is not a schedule, it is a bug.
export function dueSources(
  descriptors: SourceDescriptor[],
  pool: Pool,
  now: number,
): SourceDescriptor[] {
  return descriptors.filter((d) => {
    const last = pool.lastPolled[d.id];
    if (typeof last !== "number") return true;
    // A clock that went backwards (timezone change, NTP correction) leaves a
    // future timestamp; treat it as due rather than parking the source until the
    // clock catches up.
    if (last > now) return true;
    return now - last >= pollIntervalMs(d);
  });
}

// When the next source comes due, in ms from now. Only a hint: the timer that
// waits it out may never fire (a suspended webview), which is why due-ness is
// recomputed from the clock every time rather than counted in ticks.
export function nextPollDelay(
  descriptors: SourceDescriptor[],
  pool: Pool,
  now: number,
  bounds: { min: number; max: number },
): number {
  let soonest = Infinity;
  for (const d of descriptors) {
    const last = pool.lastPolled[d.id];
    const due = typeof last === "number" && last <= now ? last + pollIntervalMs(d) : now;
    soonest = Math.min(soonest, due - now);
  }
  if (!Number.isFinite(soonest)) return bounds.max;
  return Math.min(bounds.max, Math.max(bounds.min, soonest));
}

// The sources the pool is holding nothing for. A run polls these whatever the
// schedule says: the pool is a saving, not a source of truth, so a day file that
// went missing, or a source subscribed to while collection was off, costs a
// request and never the day's briefing.
export function unstockedSources(
  descriptors: SourceDescriptor[],
  pool: Pool,
): SourceDescriptor[] {
  const stocked = new Set<string>();
  for (const day of Object.values(pool.days)) for (const it of day) stocked.add(it.source);
  return descriptors.filter((d) => !stocked.has(d.id));
}

// When any source was last polled, or null when none ever was. The pool is the
// only durable record of that, so this is also what a fresh process knows about
// what the previous one collected.
export function lastPolledAt(pool: Pool): number | null {
  let latest: number | null = null;
  for (const at of Object.values(pool.lastPolled)) {
    if (latest === null || at > latest) latest = at;
  }
  return latest;
}

export function markPolled(pool: Pool, sourceIds: string[], now: number): Pool {
  if (sourceIds.length === 0) return pool;
  const lastPolled = { ...pool.lastPolled };
  for (const id of sourceIds) lastPolled[id] = now;
  return { ...pool, lastPolled };
}

// --- eviction ---------------------------------------------------------------

// Drop what has aged out: whole days of headlines past the item window, marks
// past the (much longer) mark window, and poll timestamps for sources that are
// gone. Returns the days whose files the caller should delete — the pool is
// sharded by day precisely so that expiring one is a delete, not a rewrite.
export function evict(
  pool: Pool,
  today: string,
  known: Iterable<string> = Object.keys(pool.lastPolled),
): { pool: Pool; droppedDays: string[] } {
  const droppedDays: string[] = [];
  const days: Record<string, InfoItem[]> = {};
  for (const [date, items] of Object.entries(pool.days)) {
    // A day from the future (the clock moved) is kept: it is not aged out, and
    // deleting today's items because of a timezone hop would cost a whole poll.
    if (daysBetween(date, today) > POOL_ITEM_DAYS) droppedDays.push(date);
    else days[date] = items;
  }
  const marks: Record<string, PoolMark> = {};
  for (const [id, mark] of Object.entries(pool.marks)) {
    if (daysBetween(markDate(mark), today) <= POOL_MARK_DAYS) marks[id] = mark;
  }
  const live = new Set(known);
  const lastPolled: Record<string, number> = {};
  for (const [id, at] of Object.entries(pool.lastPolled)) {
    if (live.has(id)) lastPolled[id] = at;
  }
  if (droppedDays.length === 0 && sameSize(marks, pool.marks) && sameSize(lastPolled, pool.lastPolled)) {
    return { pool, droppedDays };
  }
  return { pool: { ...pool, days, marks, lastPolled }, droppedDays };
}

// The most recent thing that happened to an item, which is what its mark's age
// is measured from: an item delivered today has a mark worth keeping even if it
// was first judged a week ago.
function markDate(mark: PoolMark): string {
  let latest = mark.screenedOn;
  if (mark.bodyOn && mark.bodyOn > latest) latest = mark.bodyOn;
  if (mark.briefedOn && mark.briefedOn > latest) latest = mark.briefedOn;
  return latest;
}

function sameSize(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  return Object.keys(a).length === Object.keys(b).length;
}

// --- the day's draw ---------------------------------------------------------

// What a run for `today` should consider, and what it must not pay for twice.
export interface PoolSeed {
  items: InfoItem[];
  // The verdicts the pool already holds, by item id. A run seeded with these
  // sends only the rest to the screen.
  verdicts: Record<string, ScreenVerdict>;
  // Items whose body was already fetched today; the caller fills in the text
  // from that day's article cache before handing the seed over.
  bodied: string[];
  // Ids an earlier day already settled: delivered, or judged not worth fetching.
  // Not drawn — and a run that rediscovered one itself drops it. A feed holds
  // days or weeks, so a source offering yesterday's article again is the normal
  // case, and it is only a mark that keeps it from being judged and delivered a
  // second time.
  settled: string[];
}

const CARRIED = "carried over from an earlier screening";

// The pool's candidates for one day's briefing, oldest first.
//
// In: anything nobody has judged (the overnight items a once-a-day collection
// used to lose), anything judged worth keeping but never delivered (a run that
// died after screening, or a keep the daily ceiling cut), and everything already
// in today's briefing — that last one is what makes a refresh merge into the
// day's one briefing instead of starting a second.
//
// Out: whatever an earlier day already settled. Delivered then, or judged not
// worth fetching then; either way, re-deciding it is spending on a question that
// has an answer.
export function drawForDay(pool: Pool, today: string): PoolSeed {
  const items: InfoItem[] = [];
  const verdicts: Record<string, ScreenVerdict> = {};
  const bodied: string[] = [];
  for (const date of Object.keys(pool.days).sort()) {
    for (const it of pool.days[date]) {
      const mark = pool.marks[it.id];
      if (mark && !drawable(mark, today)) continue;
      items.push(it);
      if (mark) {
        verdicts[it.id] = { id: it.id, keep: mark.keep, why: CARRIED, confidence: mark.confidence };
        if (mark.bodyOn === today) bodied.push(it.id);
      }
    }
  }
  // Read off the marks rather than off the days: the item whose rediscovery
  // costs the most is exactly the one whose headline aged out of the pool weeks
  // ago while its source went on offering it.
  const settled: string[] = [];
  for (const [id, mark] of Object.entries(pool.marks)) {
    if (!drawable(mark, today)) settled.push(id);
  }
  return { items, verdicts, bodied, settled };
}

function drawable(mark: PoolMark, today: string): boolean {
  if (mark.briefedOn) return mark.briefedOn === today;
  return mark.keep || mark.screenedOn === today;
}

// --- what a run learned -----------------------------------------------------

export interface PoolRecord {
  // Every verdict the run holds, its own and the ones it was seeded with.
  verdicts?: Record<string, ScreenVerdict>;
  // Item ids whose body the run fetched (and saved to the day's article cache).
  bodies?: string[];
  // Item ids the briefing carried.
  briefed?: string[];
}

// Fold a run's outcome into the pool, so the next run — later today or tomorrow
// morning — does not pay for any of it again.
export function recordRun(pool: Pool, date: string, record: PoolRecord): Pool {
  const marks = { ...pool.marks };
  for (const v of Object.values(record.verdicts ?? {})) {
    marks[v.id] = { ...marks[v.id], keep: v.keep, confidence: v.confidence, screenedOn: date };
  }
  for (const id of record.bodies ?? []) {
    // A body without a verdict cannot happen (only the selection is fetched),
    // but a mark invented here would claim the item was screened when it was
    // not, so the guard stays.
    if (marks[id]) marks[id] = { ...marks[id], bodyOn: date };
  }
  for (const id of record.briefed ?? []) {
    if (marks[id]) marks[id] = { ...marks[id], briefedOn: date };
  }
  return { ...pool, marks };
}

// How much the pool is holding, for the log line a poll writes.
export function poolSize(pool: Pool): { items: number; days: number; marks: number } {
  let items = 0;
  for (const day of Object.values(pool.days)) items += day.length;
  return { items, days: Object.keys(pool.days).length, marks: Object.keys(pool.marks).length };
}
