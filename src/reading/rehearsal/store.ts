// Rehearsals on disk: rehearsal-<retellId>.json under AppData, beside the
// talk-<retellId>.json they belong to. One file per retell, all of that retell's runs
// inside it, oldest first — the runs of one retell are only ever read together
// (this pass against the last one), and one file per run would make listing them
// a directory scan for no gain.
//
// In the sync range (platform/sync/syncFs.ts): a rehearsal is a trace the
// reader left and nothing can rebuild it — not the deck, not the book. The deck
// it was given against stays out (slides/** is a build output).
//
// A file that will not parse is moved to rehearsal-<retellId>.json.bad before the
// empty log is handed back, so the next append cannot make the loss permanent.
// That is the shape docs/29 recorded on slides/talks.json: parse fails, the
// loader returns empty, the next write commits the empty version over the top,
// and every entry is gone with no error anywhere.

import { appData } from "../../platform/app/appdata";
import { writeTextAtomic } from "../../platform/app/atomic-fs";
import { emptyLog, normalizeLog, type RehearsalLog, type RehearsalRun } from "./types";

const PREFIX = "rehearsal-";

export function rehearsalFile(retellId: string): string {
  return `${PREFIX}${retellId}.json`;
}

// Where a file that would not parse is kept. Out of the sync range, so a
// device that could not read the file does not push its rescue copy at the
// others.
function badFile(retellId: string): string {
  return `${rehearsalFile(retellId)}.bad`;
}

/**
 * This retell's runs, oldest first. A retell that has never been given reads as an
 * empty log, and so does one whose file this build cannot use — but in that
 * case the bytes are moved aside first, so the empty log the caller gets is
 * never the only copy left.
 */
export async function loadRehearsals(retellId: string): Promise<RehearsalLog> {
  const file = rehearsalFile(retellId);
  let text: string;
  try {
    if (!(await appData.exists(file))) return emptyLog(retellId);
    text = await appData.readText(file);
  } catch (e) {
    // An IO error says nothing is wrong with the file itself. Nothing is moved
    // and nothing is written over it — appendRun goes through here, so a read
    // that failed cannot turn into an overwrite.
    console.warn("failed to read the rehearsals of", retellId, e);
    return emptyLog(retellId);
  }
  let log: RehearsalLog | null = null;
  try {
    log = normalizeLog(JSON.parse(text) as unknown);
  } catch (e) {
    console.warn("failed to parse the rehearsals of", retellId, e);
  }
  if (log) return log;
  await setAside(retellId);
  return emptyLog(retellId);
}

async function setAside(retellId: string): Promise<void> {
  const file = rehearsalFile(retellId);
  try {
    await appData.rename(file, badFile(retellId));
    console.warn(`${file} could not be read; kept as ${badFile(retellId)} and started over`);
  } catch (e) {
    console.warn(`${file} could not be read and could not be moved aside`, e);
  }
}

/**
 * Add one run to its retell's log and write it. The ordinal is assigned here —
 * one past the highest already on disk — because it is a property of the log
 * and not of the run: a caller counting for itself would give two runs the same
 * number the first time one is recorded from a stale list. Returns the run as
 * it was stored, ordinal included.
 */
export async function appendRun(run: RehearsalRun): Promise<RehearsalRun> {
  const log = await loadRehearsals(run.talkId);
  const ordinal = log.runs.reduce((max, r) => Math.max(max, r.ordinal), 0) + 1;
  const stored: RehearsalRun = { ...run, ordinal };
  const next: RehearsalLog = { ...log, runs: [...log.runs, stored] };
  await writeTextAtomic(rehearsalFile(run.talkId), JSON.stringify(next, null, 2));
  return stored;
}

/** Drop a retell's rehearsals, and the rescue copy if there is one. */
export async function deleteRehearsals(retellId: string): Promise<void> {
  for (const file of [rehearsalFile(retellId), badFile(retellId)]) {
    try {
      if (await appData.exists(file)) await appData.remove(file);
    } catch (e) {
      console.warn("failed to delete", file, e);
    }
  }
}
