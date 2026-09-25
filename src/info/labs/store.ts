// The lab list on disk (docs/63): one JSON file under AppData, in sync range,
// records-merged on the lab id so two devices that each opened a room end up
// with both.
//
// Read through readGuardedJson for the same reason info-sources.json is: a lab
// is authored by the reader in conversation and nothing can rebuild one, and
// every mutation here is load-modify-save — so a read that failed must not
// become the list that gets written (docs/13).

import {
  appGuardedFileIo,
  quarantineBeforeWrite,
  readGuardedFile,
  type GuardedFileIo,
} from "../../platform/app/guarded-file";
import { entryId, labsFileBody, parseLabsFile, type ParsedLabs } from "./labs";
import type { Lab } from "./types";

export { activeLabs, labsForSource, newLabId } from "./labs";

export const LABS_FILE = "info-labs.json";

// The file access this store needs, as a parameter (platform/app/guarded-file).
export type LabsIo = GuardedFileIo<ParsedLabs>;

export const labsIo: LabsIo = appGuardedFileIo();

// No file is an empty list: a device that has never opened a room has none, and
// the companion is then told to propose one. A file that is sitting there unread
// is not that — it raises, so the next addLab cannot write one room over the
// reader's four.
async function readLabs(io: LabsIo): Promise<ParsedLabs> {
  return (
    (await readGuardedFile(io, LABS_FILE, parseLabsFile)) ?? { labs: [], foreign: [], repaired: false }
  );
}

/** Every room in the file, open and archived alike. */
export async function loadLabs(io: LabsIo = labsIo): Promise<Lab[]> {
  return (await readLabs(io)).labs;
}

// Apply a change and write the file. Entries this build could not read are
// written back unchanged, except where the new list took their id.
//
// Returns the list now on disk: the changed one when it was written, the one
// read otherwise, so a caller that renders what it gets back shows the file
// rather than a change that did not land.
async function mutate(io: LabsIo, change: (labs: Lab[]) => Lab[]): Promise<Lab[]> {
  const file = await readLabs(io);
  const next = change(file.labs);
  const taken = new Set(next.map((l) => l.id));
  const foreign = file.foreign.filter((e) => !taken.has(entryId(e)));
  // An entry was left behind by the read: keep the bytes before replacing them,
  // and refuse the write when they could not be moved (they would then exist
  // nowhere).
  if (file.repaired && !(await quarantineBeforeWrite(io, LABS_FILE))) return file.labs;
  await io.write(LABS_FILE, labsFileBody(next, foreign));
  return next;
}

/** Open a room. An id already in the file is replaced, so this is also the edit. */
export async function addLab(lab: Lab, io: LabsIo = labsIo): Promise<Lab[]> {
  return mutate(io, (labs) => [...labs.filter((l) => l.id !== lab.id), lab]);
}

/**
 * Close a room. The record stays: its picture and the cables it filed still
 * name the id, and a reader who closed a room by mistake can be given it back.
 */
export async function archiveLab(id: string, now: number, io: LabsIo = labsIo): Promise<Lab[]> {
  return mutate(io, (labs) =>
    labs.map((l) => (l.id === id ? { ...l, status: "archived", archivedAt: now } : l)),
  );
}

/**
 * Hand sources to a room. Additive, because that is what claiming is: a room
 * that stops following a source is a later release's business, and a set-shaped
 * call here would let one conversation turn drop claims another one made.
 */
export async function claimSources(
  id: string,
  sourceIds: readonly string[],
  io: LabsIo = labsIo,
): Promise<Lab[]> {
  return mutate(io, (labs) =>
    labs.map((l) => (l.id === id ? { ...l, sources: [...new Set([...l.sources, ...sourceIds])] } : l)),
  );
}
