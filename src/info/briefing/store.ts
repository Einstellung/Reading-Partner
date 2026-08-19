// Briefing + article-cache persistence (docs/16). Derived and rebuildable, so
// out of sync range: one briefing JSON per day and one article-cache JSON per
// day, both keyed by the local date. Only today's briefing is ever shown;
// regenerate overwrites. Persisted under AppData.

import {
  BaseDirectory,
  exists,
  readDir,
  readTextFile,
  remove,
} from "@tauri-apps/plugin-fs";
import { readJson, writeTextAtomic } from "../../platform/app/atomic-fs";
import { INFO_RUN_VERSION, type InfoRunState } from "./run-state";
import type { Briefing } from "./types";
import type { InfoItem } from "../sources/item";

// The full article body kept per item, split out of the briefing so the briefing
// file stays small and the article view / chat load bodies on demand.
export interface CachedArticle {
  contentHtml?: string;
  textContent?: string;
}

// Local "YYYY-MM-DD" (not UTC): the briefing is a daily ritual in the reader's
// own timezone, so day boundaries are local. Pure, unit-tested.
export function localDateString(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function todayLocal(now: Date = new Date()): string {
  return localDateString(now);
}

const BRIEFING_PREFIX = "briefing-";

// The tail of a dated daily file. Up here because two things parse a name this
// same strict way: the newest-briefing lookup below and the pruning at the end.
const DATED_JSON = /^\d{4}-\d{2}-\d{2}\.json$/;

function briefingFile(date: string): string {
  return `${BRIEFING_PREFIX}${date}.json`;
}

function articlesFile(date: string): string {
  return `info-articles-${date}.json`;
}

function itemsFile(date: string): string {
  return `info-items-${date}.json`;
}

function runFile(date: string): string {
  return `info-run-${date}.json`;
}

export async function saveBriefing(briefing: Briefing): Promise<void> {
  await writeTextAtomic(briefingFile(briefing.date), JSON.stringify(briefing, null, 2));
}

// Load a day's briefing (default: today). Missing/corrupt reads as null so the
// vestibule shows the "generate" state instead of crashing.
export async function loadBriefing(date: string = todayLocal()): Promise<Briefing | null> {
  try {
    if (!(await exists(briefingFile(date), { baseDir: BaseDirectory.AppData }))) return null;
    const parsed = JSON.parse(
      await readTextFile(briefingFile(date), { baseDir: BaseDirectory.AppData }),
    ) as Briefing;
    return parsed && parsed.date === date ? parsed : null;
  } catch {
    return null;
  }
}

// The newest day a briefing file on disk is for, out of a directory listing.
// Pure, unit-tested. Comparing the names as strings is comparing the dates —
// they are zero-padded ISO days.
export function newestBriefingDate(names: string[]): string | null {
  let best: string | null = null;
  for (const name of names) {
    if (!name.startsWith(BRIEFING_PREFIX)) continue;
    const tail = name.slice(BRIEFING_PREFIX.length);
    if (!DATED_JSON.test(tail)) continue;
    const date = tail.slice(0, -".json".length);
    if (best === null || date > best) best = date;
  }
  return best;
}

// The latest briefing this machine holds, whatever day it is for: today's on a
// machine that has already collected, yesterday's on one that has not yet, since
// the day's files are pruned by a run and not by the clock.
export async function loadLatestBriefing(): Promise<Briefing | null> {
  let names: string[];
  try {
    const entries = await readDir("", { baseDir: BaseDirectory.AppData });
    names = entries.filter((e) => e.isFile).map((e) => e.name);
  } catch {
    return null;
  }
  const date = newestBriefingDate(names);
  return date === null ? null : await loadBriefing(date);
}

export async function saveArticles(
  date: string,
  articles: Record<string, CachedArticle>,
): Promise<void> {
  await writeTextAtomic(articlesFile(date), JSON.stringify(articles));
}

export async function loadArticles(date: string): Promise<Record<string, CachedArticle>> {
  try {
    if (!(await exists(articlesFile(date), { baseDir: BaseDirectory.AppData }))) return {};
    return JSON.parse(
      await readTextFile(articlesFile(date), { baseDir: BaseDirectory.AppData }),
    ) as Record<string, CachedArticle>;
  } catch {
    return {};
  }
}

export async function loadArticle(date: string, itemId: string): Promise<CachedArticle | null> {
  const all = await loadArticles(date);
  return all[itemId] ?? null;
}

// --- day's item snapshot (for re-triage) -----------------------------------
// The full triage inputs for the day, so a profile change can re-triage the
// cached items without re-collecting. Heavy article HTML is dropped (triage
// reads textContent/summary, and the article view keeps HTML in the article
// cache) so the snapshot stays lean. Pure, unit-tested.
export function leanItems(items: InfoItem[]): InfoItem[] {
  return items.map((it) => {
    const { contentHtml: _drop, ...rest } = it;
    return rest;
  });
}

export async function saveItems(date: string, items: InfoItem[]): Promise<void> {
  await writeTextAtomic(itemsFile(date), JSON.stringify(leanItems(items)));
}

export async function loadItems(date: string): Promise<InfoItem[]> {
  try {
    if (!(await exists(itemsFile(date), { baseDir: BaseDirectory.AppData }))) return [];
    const parsed = JSON.parse(
      await readTextFile(itemsFile(date), { baseDir: BaseDirectory.AppData }),
    );
    return Array.isArray(parsed) ? (parsed as InfoItem[]) : [];
  } catch {
    return [];
  }
}

// --- the run checkpoint ----------------------------------------------------
// The resume point of an unfinished generation (run-state.ts), one file per day.
// Written at every checkpoint and deleted the moment the briefing lands, so on a
// healthy device it exists only while a run is in flight. A run abandoned for
// good still dies with the daily prune below.

// Rewritten whole at every checkpoint, article bodies and all: a source that
// settles costs one write of everything collected so far. That is the price of
// the checkpoint being a single self-contained file, and it is the right way
// round — the writes are local and take milliseconds, the fetching they save is
// minutes of a phone's radio.
export async function saveRun(state: InfoRunState): Promise<void> {
  await writeTextAtomic(runFile(state.date), JSON.stringify(state));
}

// A missing file is the normal case (no run in flight). A corrupt or
// wrong-version one reads as null so the day starts over rather than crashing;
// the cost of getting this wrong is a refetch, not a lost briefing.
export async function loadRun(date: string): Promise<InfoRunState | null> {
  try {
    if (!(await exists(runFile(date), { baseDir: BaseDirectory.AppData }))) return null;
    const parsed = JSON.parse(
      await readTextFile(runFile(date), { baseDir: BaseDirectory.AppData }),
    ) as InfoRunState;
    if (!parsed || parsed.version !== INFO_RUN_VERSION || parsed.date !== date) return null;
    return parsed;
  } catch {
    return null;
  }
}

// Best effort: a checkpoint that will not go away is stale, not fatal — the next
// generation overwrites it, and isResumable rejects it once the day turns.
export async function clearRun(date: string): Promise<void> {
  try {
    if (await exists(runFile(date), { baseDir: BaseDirectory.AppData })) {
      await remove(runFile(date), { baseDir: BaseDirectory.AppData });
    }
  } catch {
    // Leave it; it costs disk, not correctness.
  }
}

// --- the morning round's anchor --------------------------------------------
// Which anchor the 05:00 round has already been run for (daily.ts), as a local
// YYYY-MM-DD. Its own file because nothing else on disk answers the question: a
// briefing or a run for today says a briefing was made, not that the morning
// round was the one that made it, and the round has to fire even on a day the
// reader already generated one by hand.
//
// Out of sync range, and not in the collector claim it would otherwise fit in.
// The claim travels to the readers, who have no use for this, and it is
// per-device: a machine that takes the claim over from another one has to make
// its own first round of the day rather than inherit somebody else's answer to
// whether the morning has been dealt with.
const DAILY_FILE = "info-daily-round.json";

const LOCAL_DATE = /^\d{4}-\d{2}-\d{2}$/;

// Missing or unreadable reads as null, which daily.ts answers with "arm": a lost
// file costs at most one skipped morning, never a repeated one.
export async function loadDailyRunDate(): Promise<string | null> {
  const parsed = await readJson<{ date?: unknown }>(DAILY_FILE);
  const date = parsed?.date;
  return typeof date === "string" && LOCAL_DATE.test(date) ? date : null;
}

export async function saveDailyRunDate(date: string): Promise<void> {
  await writeTextAtomic(DAILY_FILE, JSON.stringify({ date }));
}

// --- pruning the past days -------------------------------------------------
// These per-day files are derived and only ever read for today, so older days
// are dead weight (one article cache measured 4.3MB). The run checkpoint is in
// the set for the same reason and one more: it is the heaviest of them (it holds
// the article bodies) and an abandoned run would otherwise keep a copy of a dead
// day forever. Matching is by exact prefix plus a strict date suffix and nothing
// else: a name we cannot parse is left alone, because everything else under
// AppData is either the user's own data or inside sync range, where a local
// delete would just be re-downloaded.
const DAILY_PREFIXES = [BRIEFING_PREFIX, "info-articles-", "info-items-", "info-run-"];

// The names to delete, given a directory listing and today's local date. Pure,
// unit-tested; the clock is the caller's business.
export function staleDailyFiles(names: string[], today: string): string[] {
  const out: string[] = [];
  for (const name of names) {
    const prefix = DAILY_PREFIXES.find((p) => name.startsWith(p));
    if (!prefix) continue;
    const tail = name.slice(prefix.length);
    if (!DATED_JSON.test(tail)) continue;
    if (tail.slice(0, -".json".length) !== today) out.push(name);
  }
  return out;
}

// Delete every past day's derived info file. Best effort: a listing failure or a
// file that will not go away is swallowed, since a briefing must still generate.
export async function pruneStaleDailyFiles(today: string): Promise<void> {
  let names: string[];
  try {
    const entries = await readDir("", { baseDir: BaseDirectory.AppData });
    names = entries.filter((e) => e.isFile).map((e) => e.name);
  } catch {
    return;
  }
  for (const name of staleDailyFiles(names, today)) {
    try {
      await remove(name, { baseDir: BaseDirectory.AppData });
    } catch {
      // Locked or already gone; keep going through the rest.
    }
  }
}
