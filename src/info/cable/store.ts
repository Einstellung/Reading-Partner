// One cables file per day, in sync range so a reader device can resolve the
// cable ids a picture cites. Merged opaque: the collector writes the day whole,
// once, at the end of the funnel.
//
// The day is written in one shot rather than load-modify-save, so an unreadable
// file cannot be overwritten by a read that failed. It still raises instead of
// answering null: a run that reads no cables would file a day of judgments about
// nothing, and the caller's watchdog should hear about that rather than the
// picture.
//
// Pruned by collect/store.ts on their own rule, not the daily one: cables are
// kept for thirty days because a picture's judgments cite ids in them, and a
// pruned day is also purged from Drive.

import { appData } from "../../platform/app/appdata";
import { appGuardedFileIo, readGuardedFile, type GuardedFileIo } from "../../platform/app/guarded-file";
import { parseCableDay } from "./cable";
import type { CableDay } from "./types";

const CABLES_PREFIX = "info-cables-";
const DATED_JSON = /^\d{4}-\d{2}-\d{2}\.json$/;

export function cablesFile(date: string): string {
  return `${CABLES_PREFIX}${date}.json`;
}

export interface CableIo extends GuardedFileIo<CableDay> {
  /** Every file name at the AppData root; the caller filters. */
  list(): Promise<string[]>;
}

export const cableIo: CableIo = {
  ...appGuardedFileIo<CableDay>(),
  list: async () => {
    const entries = await appData.readDir("");
    return entries.filter((e) => e.isFile).map((e) => e.name);
  },
};

/** A day of cables, or null when that day was never collected on this device. */
export async function loadCableDay(
  date: string,
  io: CableIo = cableIo,
): Promise<CableDay | null> {
  const file = cablesFile(date);
  return readGuardedFile(io, file, (raw) => {
    const day = parseCableDay(raw);
    // A file under one date holding another's is not this day's; treat it the
    // way the briefing store does and refuse it.
    return day && day.date === date ? day : null;
  });
}

export async function saveCableDay(day: CableDay, io: CableIo = cableIo): Promise<void> {
  await io.write(cablesFile(day.date), JSON.stringify(day, null, 2));
}

/** The days this device holds cables for, newest first. */
export async function listCableDates(io: CableIo = cableIo): Promise<string[]> {
  let names: string[];
  try {
    names = await io.list();
  } catch {
    return [];
  }
  return cableDates(names);
}

/** The dates out of a directory listing, newest first. Pure, unit-tested. */
export function cableDates(names: readonly string[]): string[] {
  const out: string[] = [];
  for (const name of names) {
    if (!name.startsWith(CABLES_PREFIX)) continue;
    const tail = name.slice(CABLES_PREFIX.length);
    if (!DATED_JSON.test(tail)) continue;
    out.push(tail.slice(0, -".json".length));
  }
  // Zero-padded ISO days, so comparing the strings is comparing the dates.
  return out.sort((a, b) => b.localeCompare(a));
}
