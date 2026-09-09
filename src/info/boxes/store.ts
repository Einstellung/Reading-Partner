// The day's briefing on disk (docs/16). Derived and rebuildable, so out of sync
// range: one JSON per day, keyed by the local date, pruned with the rest of the
// day's files (collect/store.ts). Only today's is ever shown; a regenerate
// overwrites it.
//
// Here rather than in collect/store.ts because a briefing is what the day is
// boxed into, and the type lives up here with it — collect is the funnel that
// feeds this, and it may not import what it feeds.

import { appData } from "../../platform/app/appdata";
import { writeTextAtomic } from "../../platform/app/atomic-fs";
import { briefingFile, newestBriefingDate, todayLocal } from "../collect/store";
import { parseBriefing } from "./briefing";
import type { Briefing } from "./types";

export async function saveBriefing(briefing: Briefing): Promise<void> {
  await writeTextAtomic(briefingFile(briefing.date), JSON.stringify(briefing, null, 2));
}

// Load a day's briefing (default: today). Missing/corrupt reads as null so the
// vestibule shows the "generate" state instead of crashing; a briefing written
// by the triage build is read through parseBriefing like any other, so what
// comes back is always the current shape.
export async function loadBriefing(date: string = todayLocal()): Promise<Briefing | null> {
  try {
    if (!(await appData.exists(briefingFile(date)))) return null;
    const parsed = parseBriefing(JSON.parse(await appData.readText(briefingFile(date))));
    return parsed && parsed.date === date ? parsed : null;
  } catch {
    return null;
  }
}

// The latest briefing this machine holds, whatever day it is for: today's on a
// machine that has already collected, yesterday's on one that has not yet, since
// the day's files are pruned by a run and not by the clock.
export async function loadLatestBriefing(): Promise<Briefing | null> {
  let names: string[];
  try {
    const entries = await appData.readDir("");
    names = entries.filter((e) => e.isFile).map((e) => e.name);
  } catch {
    return null;
  }
  const date = newestBriefingDate(names);
  return date === null ? null : await loadBriefing(date);
}
