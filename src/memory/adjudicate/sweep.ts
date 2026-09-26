// Finding the parked copies and asking for a run for each (docs/59 §6).
//
// Every device sweeps. The run is keyed by the conflict's content
// (conflicts.ts), so two devices asking for the same one reach the same run
// file, and which of them executes it is the election's answer (docs/55). The
// sweep only ever creates pending runs; it never calls the model.
//
// Two rules are pure functions here, so both devices reach the same answer:
//
//   duplicates   two runs under one key but different ids — a file written
//                before the id was derived from the key, or by hand — keep the
//                lexicographically smaller id; the other is cancelled with a
//                line naming the winner. The same tie-break the claim uses.
//   loop guard   a conflict where both sides were themselves written by an
//                adjudication is never adjudicated again. An observation
//                carries `resolvedBy` in its frontmatter; any other file is
//                matched by digest against what finished runs wrote, which
//                their progress line records.

import type { Run } from "../../legion/run/types";
import { isTerminal } from "../../legion/run/types";
import { bothObservationsAdjudicated, digestOf } from "./adjudicate";
import {
  adjudicationKey,
  discoverConflicts,
  type ConflictListing,
  type ProseConflict,
} from "./conflicts";

/** The legion kind (docs/55). */
export const ADJUDICATE_KIND = "adjudicate-prose";

/** Who the sweep's runs are delegated by. */
export const SWEEP_DELEGATOR = "prose-conflict-sweep";

// What a finished run says it wrote. The run file keeps it, and it is the only
// provenance a file without frontmatter has besides the ledger's output path.
const WROTE = /^wrote ([0-9a-f]+) to (.+?) as (legion\/\S+)$/;

/** The last line of a run that wrote a file. */
export function wroteLine(path: string, digest: string, resolvedBy: string): string {
  return `wrote ${digest} to ${path} as ${resolvedBy}`;
}

/** Path to the digests adjudications wrote to it, read off finished runs. */
export function writtenDigests(runs: readonly Pick<Run, "state" | "progress">[]): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const run of runs) {
    if (run.state !== "done" || !run.progress) continue;
    const m = WROTE.exec(run.progress);
    if (!m) continue;
    const set = out.get(m[2]) ?? new Set<string>();
    set.add(m[1]);
    out.set(m[2], set);
  }
  return out;
}

/**
 * Whether both versions of this conflict came out of an adjudication. `kept`
 * and `parked` are the two files' texts.
 */
export function bothSidesAdjudicated(
  conflict: ProseConflict,
  kept: string,
  parked: string,
  written: ReadonlyMap<string, ReadonlySet<string>>,
): boolean {
  if (conflict.role.shape === "observation") return bothObservationsAdjudicated(kept, parked);
  const mine = written.get(conflict.path);
  return !!mine && mine.has(conflict.digest) && mine.has(digestOf(kept));
}

/** A run to cancel because another run under its key has the smaller id. */
export interface DuplicateRun {
  id: string;
  winner: string;
}

/**
 * The runs that lost to another run under the same key. Only runs that have
 * not stopped are returned: a finished one cannot move back to `cancelled`, and
 * its result is already a plain edit sync carries.
 */
export function duplicateRuns(
  runs: readonly Pick<Run, "id" | "idempotencyKey" | "state">[],
): DuplicateRun[] {
  const winners = new Map<string, string>();
  for (const run of runs) {
    if (run.idempotencyKey === undefined) continue;
    const best = winners.get(run.idempotencyKey);
    if (best === undefined || run.id < best) winners.set(run.idempotencyKey, run.id);
  }
  const out: DuplicateRun[] = [];
  for (const run of runs) {
    if (run.idempotencyKey === undefined || isTerminal(run.state)) continue;
    const winner = winners.get(run.idempotencyKey);
    if (winner !== undefined && winner !== run.id) out.push({ id: run.id, winner });
  }
  return out;
}

/** The line a cancelled duplicate carries. */
export function duplicateLine(winner: string): string {
  return `duplicate of ${winner}`;
}

export interface SweepDeps {
  list: ConflictListing;
  read(path: string): Promise<string | null>;
  /** Every run of the adjudicate kind on this device. */
  runs(): Promise<Run[]>;
  /** Stop a duplicate, leaving the winner's id on it. */
  cancelDuplicate(duplicate: DuplicateRun): Promise<void>;
  /** Ask legion for one run. Idempotent by key. */
  delegate(input: { idempotencyKey: string; brief: string }): Promise<void>;
}

export interface SweepResult {
  /** Keys a run was asked for this time. */
  delegated: string[];
  /** Copies left for a person by the loop guard. */
  guarded: string[];
  /** Duplicate run ids cancelled. */
  cancelled: string[];
}

/** One look for parked copies. Never calls a model. */
export async function sweepProseConflicts(deps: SweepDeps): Promise<SweepResult> {
  const result: SweepResult = { delegated: [], guarded: [], cancelled: [] };
  const runs = await deps.runs();
  for (const duplicate of duplicateRuns(runs)) {
    await deps.cancelDuplicate(duplicate);
    result.cancelled.push(duplicate.id);
  }

  const conflicts = await discoverConflicts(deps.list);
  if (conflicts.length === 0) return result;
  const known = new Set(runs.map((run) => run.idempotencyKey).filter((k): k is string => !!k));
  const written = writtenDigests(runs);
  for (const conflict of conflicts) {
    const key = adjudicationKey(conflict);
    if (known.has(key)) continue;
    const [kept, parked] = await Promise.all([deps.read(conflict.path), deps.read(conflict.copyPath)]);
    if (kept === null || parked === null) continue;
    if (bothSidesAdjudicated(conflict, kept, parked, written)) {
      result.guarded.push(conflict.copyPath);
      continue;
    }
    await deps.delegate({ idempotencyKey: key, brief: conflict.copyPath });
    result.delegated.push(key);
  }
  return result;
}
