// The legion-run-files garbage marker (docs/80): what of a run is left on this
// device once the ledger accounts for it.
//
//   legion/runs/<id>.json   a terminal run the ledger has a line for, whoever
//                           folded it (tombstone.ts). Synced, so the housekeeper
//                           purges it from the remote before removing it here.
//   legion/briefs/*         a brief or an output no hot run points at any more,
//   legion/outputs/*        older than RUN_FILE_GRACE_MS. Both are local, and a
//                           run is the only thing that names one: the box item
//                           holds the output's text, not its path (box/types.ts).
//
// The second rule covers a folded run and an orphan alike. The grace is for the
// moment between writing a brief and creating the run that names it, and it is
// counted from the file's own mtime, which for a frozen brief is its creation.
//
// Reads only. The runs and the ledger come through their own stores, read-only
// here; the directory listings and mtimes through the housekeeper's io.

import type { GarbageMarker, Mark } from "../../housekeeper";
import { appRuns, RUNS_DIR, type RunStore } from "../run";
import { isTerminal } from "../run/types";
import type { LedgerLine } from "./fold";
import { appLedger, ledgerDay, type LedgerStore } from "./store";
import { tombstonedRunIds } from "./tombstone";

export const RUN_FILES_MARKER = "legion-run-files";

const BRIEFS_DIR = "legion/briefs";
const OUTPUTS_DIR = "legion/outputs";

/** How long an unreferenced brief or output stays. */
export const RUN_FILE_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

export interface RunFilesMarkerDeps {
  runs?: () => RunStore;
  ledger?: () => LedgerStore;
}

export function runFilesMarker(deps: RunFilesMarkerDeps = {}): GarbageMarker {
  return {
    name: RUN_FILES_MARKER,
    async mark({ io, now }) {
      const runs = await (deps.runs ?? appRuns)().list();
      const ledger = (deps.ledger ?? appLedger)();
      const marks: Mark[] = [];

      // Only the days these runs ended on can hold a line about them.
      const terminal = runs.filter((run) => isTerminal(run.state) && run.endedAt !== undefined);
      const lines: LedgerLine[] = [];
      for (const day of new Set(terminal.map((run) => ledgerDay(run.endedAt as number)))) {
        lines.push(...(await ledger.read(day)));
      }
      const folded = new Set(tombstonedRunIds(terminal, lines));
      for (const id of folded) {
        marks.push({ path: `${RUNS_DIR}/${id}.json`, action: "delete", reason: "folded into the ledger" });
      }

      const named = new Set<string>();
      for (const run of runs) {
        if (folded.has(run.id)) continue;
        named.add(run.brief);
        if (run.output !== undefined) named.add(run.output);
      }
      for (const dir of [BRIEFS_DIR, OUTPUTS_DIR]) {
        for (const entry of await io.list(dir)) {
          if (!entry.isFile) continue;
          const path = `${dir}/${entry.name}`;
          if (named.has(path)) continue;
          const stat = await io.stat(path);
          // mtime 0 is a platform that does not say; that is not old.
          if (!stat || stat.mtimeMs === 0 || now - stat.mtimeMs < RUN_FILE_GRACE_MS) continue;
          marks.push({ path, action: "delete", reason: "no hot run names it, past a week" });
        }
      }
      return marks;
    },
  };
}
