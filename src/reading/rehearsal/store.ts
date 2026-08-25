// Rehearsals on disk, two files each:
//   rehearsal-<rehearsalId>.json       — the object (docs/43)
//   runs-rehearsal-<rehearsalId>.json  — every pass over its deck, oldest first
//
// Split because they are written at different rates and cost different things to
// lose. The object is a few fields, rewritten when the deck is rebuilt or the
// name changes; the runs are appended after every pass and are the only copy of
// what the reader actually said. The runs are one file rather than one per run:
// the passes of one deck are only ever read together (this one against the last
// one), and a file per pass would make listing them a directory scan for no gain.
//
// The runs file is named threads-style — prefixed, so the directory scan that
// finds rehearsals cannot see it. That also keeps the scan away from the
// rehearsal-<retellId>.json files an earlier build wrote, which were run logs
// under a retell's id: they do not parse as an object, so they are skipped, and
// nothing here moves them or migrates them (tests pin it). The set-aside below
// belongs to the runs file alone, for that reason.
//
// Both files are in the sync range (platform/sync/syncFs.ts): a rehearsal is a
// trace the reader left and nothing can rebuild it. The deck itself is not —
// slides/** is a build output, and an imported deck under rehearsals/ can be tens
// of megabytes, which does not belong in a per-file diff-and-merge engine. So a
// rehearsal recorded on the desktop shows on the iPad with its history intact and
// no deck to give: the deck is imported on the device it is rehearsed on. Known
// limitation, first version.

import { appData } from "../../platform/app/appdata";
import { writeTextAtomic } from "../../platform/app/atomic-fs";
import {
  emptyLog,
  newRehearsal,
  newRehearsalId,
  normalizeLog,
  normalizeRehearsal,
  type Rehearsal,
  type RehearsalLog,
  type RehearsalRun,
} from "./types";

const PREFIX = "rehearsal-";
const RUNS_PREFIX = "runs-";

export function rehearsalFile(rehearsalId: string): string {
  return `${PREFIX}${rehearsalId}.json`;
}

export function rehearsalRunsFile(rehearsalId: string): string {
  return `${RUNS_PREFIX}${rehearsalFile(rehearsalId)}`;
}

// A rehearsal id out of a file name, or null for anything else in the directory.
// runs-rehearsal-<id>.json does not match: it is prefixed, and the prefix is
// checked at the start of the name.
export function rehearsalIdOf(fileName: string): string | null {
  if (!fileName.startsWith(PREFIX) || !fileName.endsWith(".json")) return null;
  const id = fileName.slice(PREFIX.length, -".json".length);
  return id || null;
}

// Missing is normal. A file this build cannot use reads as null and is left
// exactly where it is — the listing walks the whole directory, and a build that
// moved every file it did not recognize would turn one rename into a pile of
// .bad files.
export async function loadRehearsal(rehearsalId: string): Promise<Rehearsal | null> {
  try {
    const file = rehearsalFile(rehearsalId);
    if (!(await appData.exists(file))) return null;
    return normalizeRehearsal(JSON.parse(await appData.readText(file)) as unknown);
  } catch (e) {
    console.warn("failed to read a rehearsal", rehearsalId, e);
    return null;
  }
}

export async function saveRehearsal(rehearsal: Rehearsal): Promise<void> {
  await writeTextAtomic(rehearsalFile(rehearsal.id), JSON.stringify(rehearsal, null, 2));
}

// Every rehearsal on disk, newest first. Unreadable files are skipped.
export async function listAllRehearsals(): Promise<Rehearsal[]> {
  let entries;
  try {
    entries = await appData.readDir(".");
  } catch {
    return [];
  }
  const out: Rehearsal[] = [];
  for (const e of entries) {
    if (!e.isFile || !e.name) continue;
    const id = rehearsalIdOf(e.name);
    if (!id) continue;
    const rehearsal = await loadRehearsal(id);
    if (rehearsal) out.push(rehearsal);
  }
  return out.sort((a, b) => b.createdAt - a.createdAt);
}

export async function listRehearsalsForTopic(topicId: string): Promise<Rehearsal[]> {
  return (await listAllRehearsals()).filter((r) => r.topicId === topicId);
}

export interface StartRehearsalInput {
  topicId: string;
  name: string;
  deckFile: string;
  retellId?: string | null;
  now?: number;
}

/**
 * An id nothing on disk is using, and the moment it stands for. The id is the
 * creation time; if the name is taken the next free millisecond is used, which
 * also steps over a rehearsal-<retellId>.json an earlier build left behind under
 * the same name.
 *
 * Separate from startRehearsal because an imported deck has to know where it is
 * going before it is copied: writing the object first would leave one pointing
 * at a file the copy never managed to produce.
 */
export async function reserveRehearsalId(now = Date.now()): Promise<{ id: string; at: number }> {
  let at = now;
  while (await appData.exists(rehearsalFile(newRehearsalId(at)))) at += 1;
  return { id: newRehearsalId(at), at };
}

// Create a rehearsal and write it.
export async function startRehearsal(input: StartRehearsalInput): Promise<Rehearsal> {
  const { id, at } = await reserveRehearsalId(input.now ?? Date.now());
  const rehearsal = newRehearsal({
    id,
    topicId: input.topicId,
    name: input.name,
    deckFile: input.deckFile,
    retellId: input.retellId ?? null,
    now: at,
  });
  await saveRehearsal(rehearsal);
  return rehearsal;
}

/**
 * The rehearsal of a retell's deck, made if this is the first time. Both doors
 * into a rehearsal end here (docs/43): the Rehearse button on the retell's
 * header and the topic's Rehearsal section are asking for the same object, and
 * pressing Rehearse twice must not leave two histories behind.
 *
 * The name and the deck are refreshed on the way through, because both follow
 * the retell: renaming it changes the deck's slug, and the file the last pass
 * was given against is then gone.
 */
export async function rehearsalForRetell(input: {
  topicId: string;
  retellId: string;
  name: string;
  deckFile: string;
  now?: number;
}): Promise<Rehearsal> {
  const now = input.now ?? Date.now();
  const existing = (await listAllRehearsals()).find((r) => r.retellId === input.retellId);
  if (!existing) {
    return startRehearsal({
      topicId: input.topicId,
      name: input.name,
      deckFile: input.deckFile,
      retellId: input.retellId,
      now,
    });
  }
  if (existing.name === input.name && existing.deckFile === input.deckFile) return existing;
  const next: Rehearsal = {
    ...existing,
    name: input.name,
    deckFile: input.deckFile,
    updatedAt: now,
  };
  await saveRehearsal(next);
  return next;
}

export async function renameRehearsal(
  rehearsalId: string,
  name: string,
  now = Date.now(),
): Promise<Rehearsal | null> {
  const existing = await loadRehearsal(rehearsalId);
  if (!existing) return null;
  const trimmed = name.trim();
  if (!trimmed) return existing;
  const next: Rehearsal = { ...existing, name: trimmed, updatedAt: now };
  await saveRehearsal(next);
  return next;
}

// Where a runs file that would not parse is kept. Out of the sync range, so a
// device that could not read the file does not push its rescue copy at the
// others.
function badFile(rehearsalId: string): string {
  return `${rehearsalRunsFile(rehearsalId)}.bad`;
}

/**
 * This rehearsal's runs, oldest first. A deck that has never been given reads as
 * an empty log, and so does one whose file this build cannot use — but in that
 * case the bytes are moved aside first, so the empty log the caller gets is
 * never the only copy left. That is the shape docs/29 recorded on
 * slides/retells.json: parse fails, the loader returns empty, the next write
 * commits the empty version over the top, and every entry is gone with no error
 * anywhere.
 */
export async function loadRehearsalRuns(rehearsalId: string): Promise<RehearsalLog> {
  const file = rehearsalRunsFile(rehearsalId);
  let text: string;
  try {
    if (!(await appData.exists(file))) return emptyLog(rehearsalId);
    text = await appData.readText(file);
  } catch (e) {
    // An IO error says nothing is wrong with the file itself. Nothing is moved
    // and nothing is written over it — appendRun goes through here, so a read
    // that failed cannot turn into an overwrite.
    console.warn("failed to read the runs of", rehearsalId, e);
    return emptyLog(rehearsalId);
  }
  let log: RehearsalLog | null = null;
  try {
    log = normalizeLog(JSON.parse(text) as unknown);
  } catch (e) {
    console.warn("failed to parse the runs of", rehearsalId, e);
  }
  if (log) return log;
  await setAside(rehearsalId);
  return emptyLog(rehearsalId);
}

async function setAside(rehearsalId: string): Promise<void> {
  const file = rehearsalRunsFile(rehearsalId);
  try {
    await appData.rename(file, badFile(rehearsalId));
    console.warn(`${file} could not be read; kept as ${badFile(rehearsalId)} and started over`);
  } catch (e) {
    console.warn(`${file} could not be read and could not be moved aside`, e);
  }
}

/**
 * Add one run to its rehearsal's log and write it. The ordinal is assigned here —
 * one past the highest already on disk — because it is a property of the log
 * and not of the run: a caller counting for itself would give two runs the same
 * number the first time one is recorded from a stale list. Returns the run as
 * it was stored, ordinal included.
 */
export async function appendRun(run: RehearsalRun): Promise<RehearsalRun> {
  const log = await loadRehearsalRuns(run.rehearsalId);
  const ordinal = log.runs.reduce((max, r) => Math.max(max, r.ordinal), 0) + 1;
  const stored: RehearsalRun = { ...run, ordinal };
  const next: RehearsalLog = { ...log, runs: [...log.runs, stored] };
  await writeTextAtomic(rehearsalRunsFile(run.rehearsalId), JSON.stringify(next, null, 2));
  return stored;
}

/**
 * Drop a rehearsal: the object, every run of it, the rescue copy if there is
 * one, and the deck when the deck is this rehearsal's own copy. A deck the
 * slides pipeline built stays where it is — the retell owns that one.
 */
export async function deleteRehearsal(rehearsalId: string): Promise<void> {
  const rehearsal = await loadRehearsal(rehearsalId);
  const files = [rehearsalFile(rehearsalId), rehearsalRunsFile(rehearsalId), badFile(rehearsalId)];
  if (rehearsal && isImportedDeck(rehearsal.deckFile)) files.push(rehearsal.deckFile);
  for (const file of files) {
    try {
      if (await appData.exists(file)) await appData.remove(file);
    } catch (e) {
      console.warn("failed to delete", file, e);
    }
  }
}

/**
 * Drop the rehearsal a retell's deck was given through, when the retell itself
 * is deleted. It is a history of passes over a deck nobody will ever open again.
 */
export async function deleteRehearsalsForRetell(retellId: string): Promise<void> {
  for (const r of await listAllRehearsals()) {
    if (r.retellId === retellId) await deleteRehearsal(r.id);
  }
}

// Decks brought in from outside live under this directory, one file per
// rehearsal. Not synced (see the head of this file), so it is never walked by
// the sync scan.
export const REHEARSAL_DECK_DIR = "rehearsals";

export function importedDeckFile(rehearsalId: string): string {
  return `${REHEARSAL_DECK_DIR}/${rehearsalId}.html`;
}

export function isImportedDeck(file: string): boolean {
  return file.startsWith(`${REHEARSAL_DECK_DIR}/`);
}

/** A deck's HTML, whichever kind of deck it is. Missing reads as null. */
export async function readRehearsalDeck(file: string): Promise<string | null> {
  try {
    if (!(await appData.exists(file))) return null;
    return await appData.readText(file);
  } catch (e) {
    console.warn("failed to read a deck", file, e);
    return null;
  }
}
