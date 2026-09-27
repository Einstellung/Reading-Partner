// The nightly fold (docs/55, docs/80): a terminal, delivered run past its grace
// gets a line in the ledger. That is all this writes. Taking the hot file away
// is the housekeeper's, through the legion-run-files marker (marker.ts), which
// marks every run the ledger accounts for — folded here, or on the other device
// and brought over by sync — and removes it remote first, then local.
//
// A job of its own rather than part of the marker because a marker never
// writes, and the line is a write. It is registered on the same nightly clock
// ahead of the housekeeper, so a run folded tonight is removed tonight.
//
// Idempotent: a second pass finds the line already there.

import { contentHash } from "../../platform/app/content-hash";
import { appData } from "../../platform/app/appdata";
import { appRuns, type RunStore } from "../run";
import { isTerminal } from "../run/types";
import { foldRun, type FoldThresholds, type LedgerLine } from "./fold";
import { appLedger, ledgerDay, type LedgerStore } from "./store";

export interface LedgerHousekeepingDeps {
  /** The hot layer. This device's unless a test hands one in. */
  runs?: RunStore;
  /** The cold layer. */
  ledger?: LedgerStore;
  now?: number;
  thresholds?: FoldThresholds;
  /**
   * The brief's content hash, by reference, or null when it cannot be read. A
   * line carries the hash so a replay can tell the brief it was written against
   * from whatever is at that path now (docs/55).
   */
  briefHash?: (brief: string) => Promise<string | null>;
}

export interface LedgerHousekeepingResult {
  /** Ids folded into the ledger by this pass. */
  folded: string[];
}

// The brief is a reference into a domain's own directory, so the default reader
// is AppData and a reference that is not a path there simply has no hash.
const appBriefHash = async (brief: string): Promise<string | null> => {
  try {
    if (!(await appData.exists(brief))) return null;
    const text = await appData.readText(brief);
    return await contentHash(new TextEncoder().encode(text));
  } catch {
    return null;
  }
};

/**
 * Fold what is due. Says what it did. Never throws for one run: a file that will not read leaves the rest of
 * the pass to get on with it.
 */
export async function foldPass(
  deps: LedgerHousekeepingDeps = {},
): Promise<LedgerHousekeepingResult> {
  const runs = deps.runs ?? appRuns();
  const ledger = deps.ledger ?? appLedger();
  const now = deps.now ?? Date.now();
  const briefHash = deps.briefHash ?? appBriefHash;

  const hot = await runs.list();
  const terminal = hot.filter((run) => isTerminal(run.state) && run.endedAt !== undefined);
  if (terminal.length === 0) return { folded: [] };

  const folded: string[] = [];

  // Only the days these runs ended on can hold a line about them, so that is
  // all the ledger this pass reads.
  const days = new Map<string, LedgerLine[]>();
  for (const run of terminal) {
    const day = ledgerDay(run.endedAt as number);
    if (!days.has(day)) days.set(day, await ledger.read(day));
  }
  const lines = [...days.values()].flat();

  for (const run of terminal) {
    // A line about this run, not merely about its id: a re-run of a batch step
    // derives the id the previous run had, and that run's line says nothing
    // about this one.
    const already = lines.some(
      (line) => line.id === run.id && line.createdAt === Math.trunc(run.createdAt),
    );
    if (already) continue;
    const line = foldRun(run, now, {
      briefHash: await briefHash(run.brief),
      ...(deps.thresholds ?? {}),
    });
    if (!line) continue;
    await ledger.append(line);
    lines.push(line);
    folded.push(run.id);
  }

  return { folded };
}

/**
 * The fold as legion/schedule runs it, every device for its own hot layer. The
 * shell registers it ahead of the housekeeper's job at the same hour: within
 * one tick the jobs run in the order they were registered.
 */
export const LEDGER_FOLD_JOB = {
  id: "legion-ledger-fold",
  at: { daily: { hour: 4 } },
  run: async (): Promise<void> => {
    await foldPass();
  },
};
