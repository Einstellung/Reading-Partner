// Retells on disk: retell-<retellId>.json under AppData, one file per retell.
//
// Not a derived cache — nothing can rebuild it, because it is the record of what
// the reader and the AI agreed the retell will contain and in what order. So it is
// a root-level file in the sync range (platform/sync/syncFs.ts), like marks and
// threads, and unlike the deck it produces (slides/**, a build output).
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

import { appData } from "../../platform/app/appdata";
import { writeTextAtomic } from "../../platform/app/atomic-fs";
import { deleteRehearsals } from "../rehearsal/store";
import {
  newRetell,
  newRetellId,
  normalizeRetell,
  type Retell,
  type RetellDecision,
  type RetellMaterial,
} from "./types";
import { upsertDecision } from "./outline";

const PREFIX = "retell-";

export function retellFile(retellId: string): string {
  return `${PREFIX}${retellId}.json`;
}

// A retell id out of a file name, or null for anything else in the directory.
// threads-retell-<id>.json is the retell's conversation and does not match: it
// is prefixed, and the prefix is checked at the start of the name. Neither does
// rehearsal-<id>.json, nor a talk-<id>.json left by a build before the rename.
export function retellIdOf(fileName: string): string | null {
  if (!fileName.startsWith(PREFIX) || !fileName.endsWith(".json")) return null;
  const id = fileName.slice(PREFIX.length, -".json".length);
  return id || null;
}

// Missing is normal. A corrupt or stale-version file reads as null rather than
// throwing: the list must still draw, and one unreadable retell must not take the
// topic's whole sidebar with it.
export async function loadRetell(retellId: string): Promise<Retell | null> {
  try {
    const file = retellFile(retellId);
    if (!(await appData.exists(file))) return null;
    const parsed = JSON.parse(await appData.readText(file)) as Retell;
    return normalizeRetell(parsed);
  } catch (e) {
    console.warn("failed to read a retell", retellId, e);
    return null;
  }
}

export async function saveRetell(retell: Retell): Promise<void> {
  await writeTextAtomic(retellFile(retell.id), JSON.stringify(retell, null, 2));
}

// Every retell on disk, newest first. Unreadable files are skipped.
export async function listAllRetells(): Promise<Retell[]> {
  let entries;
  try {
    entries = await appData.readDir(".");
  } catch {
    return [];
  }
  const out: Retell[] = [];
  for (const e of entries) {
    if (!e.isFile || !e.name) continue;
    const id = retellIdOf(e.name);
    if (!id) continue;
    const retell = await loadRetell(id);
    if (retell) out.push(retell);
  }
  return out.sort((a, b) => b.createdAt - a.createdAt);
}

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
  let now = input.now ?? Date.now();
  while (await appData.exists(retellFile(newRetellId(now)))) now += 1;
  const retell = newRetell({
    id: newRetellId(now),
    topicId: input.topicId,
    materials: input.materials,
    name: input.name,
    now,
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

// Delete a retell, and the record of every time it was given. The conversation
// file and the deck under slides/<retellId>/ are left where they are: the thread
// store owns one and the slides pipeline the other, and an orphan of either is
// inert. The rehearsals are not — they are a list of runs of a retell that no
// longer exists, and nothing will ever open them again.
export async function deleteRetell(retellId: string): Promise<void> {
  try {
    await appData.remove(retellFile(retellId));
  } catch (e) {
    console.warn("failed to delete a retell", retellId, e);
  }
  await deleteRehearsals(retellId);
}

// The retell's conversation lives in its own thread file, keyed like every other
// thread file (platform/app/threads.ts writes threads-<key>.json). The key is
// prefixed so it can never collide with a book's content hash.
export function retellThreadKey(retellId: string): string {
  return `retell-${retellId}`;
}
