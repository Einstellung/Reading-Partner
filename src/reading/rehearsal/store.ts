// Rehearsal decisions on disk: rehearsal-<bookId>.json under AppData, one file
// per book, keyed by the library content hash like every other per-book file.
//
// Unlike the prep and notes stores this is NOT a derived cache — nothing can
// rebuild it, because it is the record of what the reader and the AI agreed the
// talk will contain. That is why it is a root-level file in the sync range
// (platform/sync/syncFs.ts) and why a read failure returns null rather than
// throwing: a turn that cannot see the record is worse when it cannot run.

import { BaseDirectory, exists, readTextFile } from "@tauri-apps/plugin-fs";
import { writeTextAtomic } from "../../platform/app/atomic-fs";
import { createPlan, normalizePlan, upsertDecision } from "./plan";
import { REHEARSAL_VERSION, type RehearsalDecision, type RehearsalPlan } from "./types";

export function rehearsalFile(bookId: string): string {
  return `rehearsal-${bookId}.json`;
}

// Missing is normal (no rehearsal started). A corrupt or stale-version file
// reads as null so the next decision starts a fresh one instead of crashing the
// turn.
export async function loadRehearsalPlan(bookId: string): Promise<RehearsalPlan | null> {
  try {
    const file = rehearsalFile(bookId);
    if (!(await exists(file, { baseDir: BaseDirectory.AppData }))) return null;
    const parsed = JSON.parse(
      await readTextFile(file, { baseDir: BaseDirectory.AppData }),
    ) as RehearsalPlan;
    if (!parsed || parsed.version !== REHEARSAL_VERSION) return null;
    return normalizePlan(parsed);
  } catch (e) {
    console.warn("failed to read the rehearsal plan", e);
    return null;
  }
}

export async function saveRehearsalPlan(plan: RehearsalPlan): Promise<void> {
  await writeTextAtomic(rehearsalFile(plan.bookId), JSON.stringify(plan, null, 2));
}

// Read-modify-write one chapter's decision. Serialized per book by the caller
// being a single agent loop; two devices editing at once is the sync engine's
// problem, not this one's.
export async function recordDecision(
  bookId: string,
  decision: RehearsalDecision,
): Promise<RehearsalPlan> {
  const existing = await loadRehearsalPlan(bookId);
  const base = existing ?? createPlan(bookId, decision.updatedAt);
  const next = upsertDecision(base, decision);
  await saveRehearsalPlan(next);
  return next;
}
