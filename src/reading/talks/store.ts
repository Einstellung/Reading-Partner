// Talks on disk: talk-<talkId>.json under AppData, one file per talk.
//
// Not a derived cache — nothing can rebuild it, because it is the record of what
// the reader and the AI agreed the talk will contain and in what order. So it is
// a root-level file in the sync range (platform/sync/syncFs.ts), like marks and
// threads, and unlike the deck it produces (slides/**, a build output).
//
// The list is the directory rather than a registry file: two devices starting a
// talk each would otherwise write the same registry and one of them would lose.
// A file per talk means the only thing two devices can collide on is one talk.

import { BaseDirectory, exists, readDir, readTextFile, remove } from "@tauri-apps/plugin-fs";
import { writeTextAtomic } from "../../platform/app/atomic-fs";
import { deleteRunthroughs } from "../runthrough/store";
import {
  newTalk,
  newTalkId,
  normalizeTalk,
  type Talk,
  type TalkDecision,
  type TalkMaterial,
} from "./types";
import { upsertDecision } from "./outline";

const PREFIX = "talk-";

export function talkFile(talkId: string): string {
  return `${PREFIX}${talkId}.json`;
}

// A talk id out of a file name, or null for anything else in the directory.
// threads-talk-<id>.json is the talk's conversation and does not match: it is
// prefixed, and the prefix is checked at the start of the name.
export function talkIdOf(fileName: string): string | null {
  if (!fileName.startsWith(PREFIX) || !fileName.endsWith(".json")) return null;
  const id = fileName.slice(PREFIX.length, -".json".length);
  return id || null;
}

// Missing is normal. A corrupt or stale-version file reads as null rather than
// throwing: the list must still draw, and one unreadable talk must not take the
// topic's whole sidebar with it.
export async function loadTalk(talkId: string): Promise<Talk | null> {
  try {
    const file = talkFile(talkId);
    if (!(await exists(file, { baseDir: BaseDirectory.AppData }))) return null;
    const parsed = JSON.parse(
      await readTextFile(file, { baseDir: BaseDirectory.AppData }),
    ) as Talk;
    return normalizeTalk(parsed);
  } catch (e) {
    console.warn("failed to read a talk", talkId, e);
    return null;
  }
}

export async function saveTalk(talk: Talk): Promise<void> {
  await writeTextAtomic(talkFile(talk.id), JSON.stringify(talk, null, 2));
}

// Every talk on disk, newest first. Unreadable files are skipped.
export async function listAllTalks(): Promise<Talk[]> {
  let entries;
  try {
    entries = await readDir(".", { baseDir: BaseDirectory.AppData });
  } catch {
    return [];
  }
  const out: Talk[] = [];
  for (const e of entries) {
    if (!e.isFile || !e.name) continue;
    const id = talkIdOf(e.name);
    if (!id) continue;
    const talk = await loadTalk(id);
    if (talk) out.push(talk);
  }
  return out.sort((a, b) => b.createdAt - a.createdAt);
}

export async function listTalksForTopic(topicId: string): Promise<Talk[]> {
  return (await listAllTalks()).filter((t) => t.topicId === topicId);
}

export interface StartTalkInput {
  topicId: string;
  materials: TalkMaterial[];
  name?: string;
  now?: number;
}

// Start a talk and write it. The id is the creation time; if a talk already has
// that id (two presses inside one millisecond, or a clock that went backwards)
// the next free millisecond is taken, because the id is also the deck's
// directory name and two talks cannot share one.
export async function startTalk(input: StartTalkInput): Promise<Talk> {
  let now = input.now ?? Date.now();
  while (await exists(talkFile(newTalkId(now)), { baseDir: BaseDirectory.AppData })) now += 1;
  const talk = newTalk({
    id: newTalkId(now),
    topicId: input.topicId,
    materials: input.materials,
    name: input.name,
    now,
  });
  await saveTalk(talk);
  return talk;
}

// Read-modify-write one talk. Serialized by the caller being a single agent loop
// or a single reader; two devices editing at once is the sync engine's problem.
// Returns the new talk, or null when the talk is gone (deleted while a turn was
// still running — the decision is dropped rather than resurrecting the file).
export async function updateTalk(
  talkId: string,
  patch: (talk: Talk) => Talk,
  now = Date.now(),
): Promise<Talk | null> {
  const existing = await loadTalk(talkId);
  if (!existing) return null;
  const next = { ...patch(existing), updatedAt: now };
  await saveTalk(next);
  return next;
}

export function recordTalkDecision(
  talkId: string,
  decision: TalkDecision,
): Promise<Talk | null> {
  return updateTalk(
    talkId,
    (talk) => ({ ...talk, decisions: upsertDecision(talk.decisions, decision) }),
    decision.updatedAt,
  );
}

// Delete a talk, and the record of every time it was given. The conversation
// file and the deck under slides/<talkId>/ are left where they are: the thread
// store owns one and the slides pipeline the other, and an orphan of either is
// inert. The run-throughs are not — they are a list of runs of a talk that no
// longer exists, and nothing will ever open them again.
export async function deleteTalk(talkId: string): Promise<void> {
  try {
    await remove(talkFile(talkId), { baseDir: BaseDirectory.AppData });
  } catch (e) {
    console.warn("failed to delete a talk", talkId, e);
  }
  await deleteRunthroughs(talkId);
}

// The talk's conversation lives in its own thread file, keyed like every other
// thread file (platform/app/threads.ts writes threads-<key>.json). The key is
// prefixed so it can never collide with a book's content hash.
export function talkThreadKey(talkId: string): string {
  return `talk-${talkId}`;
}
