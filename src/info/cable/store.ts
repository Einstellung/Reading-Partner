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
// Not in collect/store.ts's daily prune, on purpose: that sweep keeps today and
// deletes every other day it can name, and cables are kept for thirty days
// because a picture's judgments cite ids in them. Whoever wires the housekeeping
// gives them their own rule.

import { appData } from "../../platform/app/appdata";
import {
  quarantineFile,
  readGuardedJson,
  writeTextAtomic,
  type CorruptFileReport,
  type GuardedRead,
} from "../../platform/app/atomic-fs";
import { reportStoreError } from "../../platform/app/store-errors";
import { parseCableDay } from "./cable";
import type { CableDay } from "./types";

const CABLES_PREFIX = "info-cables-";
const DATED_JSON = /^\d{4}-\d{2}-\d{2}\.json$/;

export function cablesFile(date: string): string {
  return `${CABLES_PREFIX}${date}.json`;
}

export interface CableIo {
  read(file: string, validate: (raw: unknown) => CableDay | null): Promise<GuardedRead<CableDay>>;
  write(file: string, contents: string): Promise<void>;
  quarantine(file: string): Promise<string | null>;
  reportCorrupt(report: CorruptFileReport): void;
  /** Every file name at the AppData root; the caller filters. */
  list(): Promise<string[]>;
}

export const cableIo: CableIo = {
  read: readGuardedJson,
  write: writeTextAtomic,
  quarantine: quarantineFile,
  reportCorrupt: (report) => reportStoreError("corrupt-file", report),
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
  const read = await io.read(file, (raw) => {
    const day = parseCableDay(raw);
    // A file under one date holding another's is not this day's; treat it the
    // way the briefing store does and refuse it.
    return day && day.date === date ? day : null;
  });
  if (read.status === "ok") return read.value;
  if (read.status === "missing") return null;
  if (read.savedAs === null) throw new Error(`${file} could not be read`);
  return null;
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
