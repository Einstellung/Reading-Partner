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
import { writeTextAtomic } from "../../platform/app/atomic-fs";
import { mergeInlinedHtml } from "../extract/inline-images";
import type { Briefing, InfoItem } from "./types";

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

function briefingFile(date: string): string {
  return `briefing-${date}.json`;
}

function articlesFile(date: string): string {
  return `info-articles-${date}.json`;
}

function itemsFile(date: string): string {
  return `info-items-${date}.json`;
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

// --- pruning the past days -------------------------------------------------
// These three per-day files are derived and only ever read for today, so older
// days are dead weight (one article cache measured 4.3MB). Matching is by exact
// prefix plus a strict date suffix and nothing else: a name we cannot parse is
// left alone, because everything else under AppData is either the user's own
// data or inside sync range, where a local delete would just be re-downloaded.
const DAILY_PREFIXES = ["briefing-", "info-articles-", "info-items-"];
const DATED_JSON = /^\d{4}-\d{2}-\d{2}\.json$/;

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

// Persist image-inlined article HTML back into the day's cache, preserving the
// item's textContent, so later opens are instant and offline. A no-op if the
// item is not in the cache (e.g. the day's briefing was regenerated meanwhile).
export async function saveInlinedArticleHtml(
  date: string,
  itemId: string,
  contentHtml: string,
): Promise<void> {
  const all = await loadArticles(date);
  const merged = mergeInlinedHtml(all, itemId, contentHtml);
  if (merged === all) return;
  await saveArticles(date, merged);
}
