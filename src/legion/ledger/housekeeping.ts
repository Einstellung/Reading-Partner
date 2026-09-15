// The nightly pass that turns hot run files into ledger lines and then takes
// them away (docs/55). Two passes over the same list:
//
//   fold       a terminal, delivered run past its grace gets a line, and the
//              hot file goes.
//   tombstone  a hot run the ledger already accounts for — because the other
//              device folded it and the line came over with sync — goes too,
//              unless the hot copy is newer than the line (tombstone.ts).
//
// The second is not an optimisation of the first: a device that was asleep when
// the other one folded has a run file nothing local will ever fold again, and
// without this pass it would hold that file for good and push it back at the
// device that deleted it (pitfall 208).
//
// Order inside one run: the line first, then the remote purge, then the local
// file. The line is the only thing that authorises either deletion, and the
// remote request survives on disk (platform/sync), so a process that dies
// half-way leaves work the next pass repeats rather than a run nothing accounts
// for. Both passes are idempotent: a second pass finds the line already there
// and the file already gone.

import { contentHash } from "../../platform/app/content-hash";
import { appData } from "../../platform/app/appdata";
import { requestRemotePurge } from "../../platform/sync";
import { appRuns, RUNS_DIR, type RunStore } from "../run";
import { isTerminal } from "../run/types";
import { foldRun, type FoldThresholds, type LedgerLine } from "./fold";
import { appLedger, ledgerDay, type LedgerStore } from "./store";
import { tombstonedRunIds } from "./tombstone";

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
  /**
   * Say the run files are gone from the remote. Queued, not done (docs/50):
   * sync takes them out on a pass when this device is online.
   */
  purgeRemote?: (paths: readonly string[]) => Promise<void>;
}

export interface LedgerHousekeepingResult {
  /** Ids folded into the ledger by this pass. */
  folded: string[];
  /** Ids whose hot file this pass took away, folded here or elsewhere. */
  deleted: string[];
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
 * Fold what is due and take away what the ledger accounts for. Says what it
 * did. Never throws for one run: a file that will not read leaves the rest of
 * the pass to get on with it.
 */
export async function foldPass(
  deps: LedgerHousekeepingDeps = {},
): Promise<LedgerHousekeepingResult> {
  const runs = deps.runs ?? appRuns();
  const ledger = deps.ledger ?? appLedger();
  const now = deps.now ?? Date.now();
  const briefHash = deps.briefHash ?? appBriefHash;
  const purgeRemote = deps.purgeRemote ?? requestRemotePurge;

  const hot = await runs.list();
  const terminal = hot.filter((run) => isTerminal(run.state) && run.endedAt !== undefined);
  if (terminal.length === 0) return { folded: [], deleted: [] };

  const folded: string[] = [];
  const deleted: string[] = [];

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

  for (const id of tombstonedRunIds(terminal, lines)) {
    await forget(runs, purgeRemote, id);
    deleted.push(id);
  }

  return { folded, deleted };
}

// One hot run file, from the remote first and from this device second (docs/50,
// pitfall 208). The other order loses the path if the app stops between the two
// and leaves a copy in Drive that comes back down on the next sign-in.
async function forget(
  runs: RunStore,
  purgeRemote: (paths: readonly string[]) => Promise<void>,
  id: string,
): Promise<void> {
  try {
    await purgeRemote([`${RUNS_DIR}/${id}.json`]);
  } catch (e) {
    console.warn("failed to queue a folded run for remote deletion", id, e);
    return;
  }
  try {
    await runs.remove(id);
  } catch (e) {
    console.warn("failed to delete a folded run", id, e);
  }
}

// The day this process last folded. In memory rather than on disk: the pass is
// idempotent and costs one directory listing, so a restart paying for an extra
// one is cheaper than another file two devices would have to agree about. The
// day is UTC, the one the ledger files are named by.
let foldedOn: string | null = null;

/**
 * The pass as the daily tick calls it: at most once a day on this device, and
 * it never rejects — a ledger that could not be written is a fold that is late,
 * not a tick that is over. The hour it lands on decides nothing: what folds is
 * decided by each run's own grace.
 */
export async function runLedgerHousekeeping(now = Date.now()): Promise<void> {
  const day = new Date(now).toISOString().slice(0, 10);
  if (foldedOn === day) return;
  // Before the pass, not after: a fold that failed must not turn a five-minute
  // tick into a directory listing every five minutes.
  foldedOn = day;
  try {
    await foldPass({ now });
  } catch (e) {
    console.warn("the run ledger fold failed", e);
  }
}
