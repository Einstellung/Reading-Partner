// Retells on disk: retell-<retellId>.json under AppData, one file per retell.
//
// Not a derived cache — nothing can rebuild it, because it is the record of what
// the reader and the AI agreed the retell will contain and in what order. So it is
// a root-level file in the sync range (platform/sync/syncFs.ts), like marks and
// threads, and unlike the decks an older build made from it (slides/**).
//
// The list is the directory rather than a registry file: two devices starting a
// retell each would otherwise write the same registry and one of them would lose.
// A file per retell means the only thing two devices can collide on is one retell.
//
// This object used to be called a talk, and the names on disk followed: files
// written before the rename are talk-<id>.json, with threads-talk-<id>.json
// beside them, a talkId key inside rehearsal-<id>.json, and slides/talks.json
// for the deck registry. None of those are read any more and nothing migrates
// them: the old files stay where they are and this build behaves as if they were
// not there. The events in platform/app/events.ts keep the old names, because
// they are history already written into events-<topicId>.jsonl.

import { recordDeletion } from "../../platform/app/deleted-books";
import { createRecordStore, removeRecordFiles } from "../../platform/app/record-store";
import { dropThreadCache, threadFileName } from "../../platform/app/threads";
import { deleteRehearsalsForRetell } from "../rehearsal/store";
import {
  newRetell,
  newRetellId,
  normalizeRetell,
  type Retell,
  type RetellDecision,
  type RetellMaterial,
} from "./types";
import { upsertDecision } from "./outline";

// A corrupt or stale-version file reads as null rather than throwing: the list
// must still draw, and one unreadable retell must not take the topic's whole
// sidebar with it. Nothing is quarantined, because the listing walks the whole
// directory and a build that moved every file it did not recognize would turn
// one rename into a pile of .bad files.
const records = createRecordStore<Retell>({
  prefix: "retell-",
  parse: (raw) => normalizeRetell(raw as Retell),
  newest: (retell) => retell.createdAt,
  newId: newRetellId,
  read: { kind: "warn", message: "failed to read a retell" },
});

export const retellFile = records.file;

// A retell id out of a file name, or null for anything else in the directory.
// threads-retell-<id>.json is the retell's conversation and does not match: it
// is prefixed, and the prefix is checked at the start of the name. Neither does
// rehearsal-<id>.json, nor a talk-<id>.json left by a build before the rename.
export const retellIdOf = records.idOf;

/** The retell, or null when there is none this build can use. Missing is normal. */
export const loadRetell = records.load;

export const saveRetell = records.save;

/** Every retell on disk, newest first. Unreadable files are skipped. */
export const listAllRetells = records.listAll;

export async function listRetellsForTopic(topicId: string): Promise<Retell[]> {
  return (await listAllRetells()).filter((t) => t.topicId === topicId);
}

export interface StartRetellInput {
  topicId: string;
  materials: RetellMaterial[];
  name?: string;
  now?: number;
}

// Start a retell and write it. The id is the creation time; if a retell already has
// that id (two presses inside one millisecond, or a clock that went backwards)
// the next free millisecond is taken, because the id is also the deck's
// directory name and two retells cannot share one.
export async function startRetell(input: StartRetellInput): Promise<Retell> {
  const { id, at } = await records.reserveId(input.now ?? Date.now());
  const retell = newRetell({
    id,
    topicId: input.topicId,
    materials: input.materials,
    name: input.name,
    now: at,
  });
  await saveRetell(retell);
  return retell;
}

// Read-modify-write one retell. Serialized by the caller being a single agent loop
// or a single reader; two devices editing at once is the sync engine's problem.
// Returns the new retell, or null when the retell is gone (deleted while a turn was
// still running — the decision is dropped rather than resurrecting the file).
export async function updateRetell(
  retellId: string,
  patch: (retell: Retell) => Retell,
  now = Date.now(),
): Promise<Retell | null> {
  const existing = await loadRetell(retellId);
  if (!existing) return null;
  const next = { ...patch(existing), updatedAt: now };
  await saveRetell(next);
  return next;
}

export function recordRetellDecision(
  retellId: string,
  decision: RetellDecision,
): Promise<Retell | null> {
  return updateRetell(
    retellId,
    (retell) => ({ ...retell, decisions: upsertDecision(retell.decisions, decision) }),
    decision.updatedAt,
  );
}

// Delete a retell: its record, its conversation, and the record of every time
// it was given. Any deck an older build wrote under slides/<retellId>/ is left
// where it is; an orphan of it is inert. The rehearsals are not — they are a
// list of runs of a retell that no longer exists, and nothing will ever open
// them again. The talk outline the retell produced is the caller's
// (reading/delete/delete-retell.ts), because the outline's store cannot reach
// the rehearsals of its own outline without a cycle.
//
// retell-<id>.json is in sync range, and a sync propagates no file deletion of
// its own: deleted here alone it is downloaded back on the next pass, and the
// other devices keep their copies (docs/13, pitfall 208). So the deletion is
// logged first (platform/app/deleted-books.ts): every device reads the log and
// drops the retell's files (platform/sync/dead-paths.ts), this one included on
// its next pass, which is what takes the remote copy out. A log that cannot be
// written is a deletion that would not travel, so it throws before anything is
// removed.
export async function deleteRetell(retellId: string): Promise<void> {
  await recordDeletion("retell", retellId, Date.now());
  await removeRecordFiles([retellFile(retellId), threadFileName(retellThreadKey(retellId))]);
  dropThreadCache(retellThreadKey(retellId));
  await deleteRehearsalsForRetell(retellId);
}

// The retell's conversation lives in its own thread file, keyed like every other
// thread file (platform/app/threads.ts writes threads-<key>.json). The key is
// prefixed so it can never collide with a book's content hash.
export function retellThreadKey(retellId: string): string {
  return `retell-${retellId}`;
}
