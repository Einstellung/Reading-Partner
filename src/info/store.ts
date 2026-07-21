// Briefing + article-cache persistence (docs/16). Derived and rebuildable, so
// out of sync range: one briefing JSON per day and one article-cache JSON per
// day, both keyed by the local date. Only today's briefing is ever shown;
// regenerate overwrites. Persisted under AppData.

import {
  BaseDirectory,
  exists,
  mkdir,
  readTextFile,
  writeTextFile,
} from "@tauri-apps/plugin-fs";
import type { Briefing } from "./types";

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

async function ensureDir(): Promise<void> {
  try {
    if (!(await exists("", { baseDir: BaseDirectory.AppData }))) {
      await mkdir("", { baseDir: BaseDirectory.AppData, recursive: true });
    }
  } catch {
    // A real problem resurfaces on the write below.
  }
}

export async function saveBriefing(briefing: Briefing): Promise<void> {
  await ensureDir();
  await writeTextFile(briefingFile(briefing.date), JSON.stringify(briefing, null, 2), {
    baseDir: BaseDirectory.AppData,
  });
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
  await ensureDir();
  await writeTextFile(articlesFile(date), JSON.stringify(articles), {
    baseDir: BaseDirectory.AppData,
  });
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
