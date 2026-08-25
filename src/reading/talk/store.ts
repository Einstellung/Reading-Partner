// Talk outlines on disk: one file each, `outline-<id>.json`, in the AppData
// root beside the retells and the rehearsals it sits between.
//
// One file and not two. The spine wants the fields strategy and the segments want
// the records strategy, and a file gets one strategy — but the records strategy
// already merges the keys sitting beside the collection as fields
// (writeCollection, platform/sync/merge/records.ts). So `segments` is the
// collection, keyed by the segment's own id, and `spine`, `name` and the rest
// merge key by key beside it, recursing into the spine's own fields. Two devices
// that each rewrote a different segment keep both; two that each edited the
// thesis and the audience keep both of those too.
//
// The name has to be recognised in two places or it is silently wrong. Both
// platform/sync/syncFs.ts (is this file synced) and
// platform/sync/merge/contract.ts (how is it merged) decide by file name, and a
// name neither knows falls through to `opaque`, which keeps one device's whole
// file and parks the other's beside it — every segment the other device wrote
// gone from the copy anyone opens. tests/platform/sync/merge.test.ts pins the
// strategy for that reason.
//
// Not named talk-<id>.json: an earlier build wrote the retells under that name
// (reading/retell/store.ts), those files are still on disk, and a listing that
// picked them up would be showing retells as outlines.

import { appData } from "../../platform/app/appdata";
import { readGuardedJson, writeTextAtomic } from "../../platform/app/atomic-fs";
import {
  newTalkOutline,
  newTalkOutlineId,
  normalizeTalkOutline,
  type TalkOutline,
} from "./types";

const PREFIX = "outline-";

export function talkOutlineFile(outlineId: string): string {
  return `${PREFIX}${outlineId}.json`;
}

/** An outline id out of a file name, or null for anything else in the directory. */
export function talkOutlineIdOf(fileName: string): string | null {
  if (!fileName.startsWith(PREFIX) || !fileName.endsWith(".json")) return null;
  const id = fileName.slice(PREFIX.length, -".json".length);
  return id || null;
}

/**
 * The outline, or null when there is none this build can use. Content that will
 * not parse, or that is not this shape, is moved aside by readGuardedJson before
 * the null comes back — the failure docs/29 recorded on slides/retells.json is a
 * loader that answers empty and a writer that then makes the empty version the
 * only one left.
 */
export async function loadTalkOutline(outlineId: string): Promise<TalkOutline | null> {
  const read = await readGuardedJson(talkOutlineFile(outlineId), normalizeTalkOutline);
  return read.status === "ok" ? read.value : null;
}

/**
 * The same read, for a caller that is about to write the file back. A read that
 * failed for IO reasons is a raise here rather than a null: the bytes are still
 * on disk and nothing is known to be wrong with them, so answering "there is no
 * outline" would let one failed read replace a whole talk with whatever the
 * caller was about to add — on a file the other device syncs.
 */
async function outlineToEdit(outlineId: string): Promise<TalkOutline | null> {
  const file = talkOutlineFile(outlineId);
  const read = await readGuardedJson(file, normalizeTalkOutline);
  if (read.status === "ok") return read.value;
  // savedAs is the quarantine copy. Null means the read itself failed, so the
  // content is untouched and unread.
  if (read.status === "corrupt" && read.savedAs === null) {
    throw new Error(`${file} could not be read`);
  }
  return null;
}

export async function saveTalkOutline(outline: TalkOutline): Promise<void> {
  await writeTextAtomic(talkOutlineFile(outline.id), JSON.stringify(outline, null, 2));
}

/**
 * Read an outline, change it, and write back only what changed. Answers the
 * outline as it now stands, or null when there is no such outline.
 *
 * The identity check is the point: every function in edit.ts answers the outline
 * it was given when the change was not a change, so a write that would produce
 * the same bytes never happens, and the file does not gain a revision for having
 * been looked at.
 */
export async function editTalkOutline(
  outlineId: string,
  change: (outline: TalkOutline) => TalkOutline,
): Promise<TalkOutline | null> {
  const outline = await outlineToEdit(outlineId);
  if (!outline) return null;
  const next = change(outline);
  if (next === outline) return outline;
  await saveTalkOutline(next);
  return next;
}

/**
 * An id nothing on disk is using, and the moment it stands for. The id is the
 * creation time, and a name already taken steps to the next free millisecond —
 * the same reservation a rehearsal makes, so two objects created in one gesture
 * cannot land on one name.
 */
export async function reserveTalkOutlineId(now = Date.now()): Promise<{ id: string; at: number }> {
  let at = now;
  while (await appData.exists(talkOutlineFile(newTalkOutlineId(at)))) at += 1;
  return { id: newTalkOutlineId(at), at };
}

export interface StartTalkOutlineInput {
  topicId: string;
  retellId?: string | null;
  name?: string;
  now?: number;
}

export async function startTalkOutline(input: StartTalkOutlineInput): Promise<TalkOutline> {
  const { id, at } = await reserveTalkOutlineId(input.now ?? Date.now());
  const outline = newTalkOutline({
    id,
    topicId: input.topicId,
    retellId: input.retellId ?? null,
    name: input.name,
    now: at,
  });
  await saveTalkOutline(outline);
  return outline;
}

/** Every outline on disk, newest first. Unreadable files are skipped. */
export async function listAllTalkOutlines(): Promise<TalkOutline[]> {
  let entries;
  try {
    entries = await appData.readDir(".");
  } catch {
    return [];
  }
  const out: TalkOutline[] = [];
  for (const e of entries) {
    if (!e.isFile || !e.name) continue;
    const id = talkOutlineIdOf(e.name);
    if (!id) continue;
    const outline = await loadTalkOutline(id);
    if (outline) out.push(outline);
  }
  return out.sort((a, b) => b.createdAt - a.createdAt);
}

export async function listTalkOutlinesForTopic(topicId: string): Promise<TalkOutline[]> {
  return (await listAllTalkOutlines()).filter((o) => o.topicId === topicId);
}

/** The outline a retell produced, or null when it has not produced one. */
export async function talkOutlineOfRetell(retellId: string): Promise<TalkOutline | null> {
  return (await listAllTalkOutlines()).find((o) => o.retellId === retellId) ?? null;
}

/**
 * The outline of this retell's talk, made if this is the first time. A retell has
 * one (docs/44: the arrangement comes out of the last exchange of the retell), so
 * asking twice must not leave two — this is the same find-or-create shape
 * rehearsalForRetell has, and for the same reason: two doors, one object.
 *
 * An outline made here is empty. The retell's decisions are not copied into it:
 * the arrangement is what the conversation produces, and a copy would be an
 * arrangement nobody agreed to sitting in the file the AI is about to write.
 */
export async function talkOutlineForRetell(input: {
  topicId: string;
  retellId: string;
  name?: string;
  now?: number;
}): Promise<TalkOutline> {
  const existing = await talkOutlineOfRetell(input.retellId);
  if (existing) return existing;
  return startTalkOutline({
    topicId: input.topicId,
    retellId: input.retellId,
    name: input.name,
    now: input.now,
  });
}

// The talk's conversation lives in its own thread file, keyed like every other
// one (platform/app/threads.ts). Anchored on the outline and not on a rehearsal
// or a pass (docs/43, with the anchor now the outline): one conversation spans
// every pass over this talk, so the coach reads the second pass with the first
// one still in front of it. The key is prefixed so it can never collide with a
// book's content hash or with a retell's.
export function talkThreadKey(outlineId: string): string {
  return `talk-${outlineId}`;
}

/** Drop an outline. The rehearsals against it are the caller's to deal with. */
export async function deleteTalkOutline(outlineId: string): Promise<void> {
  const file = talkOutlineFile(outlineId);
  try {
    if (await appData.exists(file)) await appData.remove(file);
  } catch (e) {
    console.warn("failed to delete", file, e);
  }
}
