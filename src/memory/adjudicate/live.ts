// Live wiring of prose adjudication (docs/59 §6): the worker legion runs, and
// the sweep the daily tick calls on every device.
//
// The model call is background work nobody is waiting on, so it runs on the
// everyday tier ("prep") and is accounted as the nightly pass's is — the plan
// budget, spent as "distill" — the same class as dream.

import { registerWorker } from "../../legion/execute/worker";
import { appRunner } from "../../legion/execute/runner";
import { appRuns } from "../../legion/run";
import { appData } from "../../platform/app/appdata";
import { callModel } from "../../ai/model-call";
import { observationFs } from "../live/fs";
import { serializeObservation } from "../observations/files";
import { ObservationFileStore } from "../observations/store";
import type { AdjudicateDeps } from "./adjudicate";
import type { ConflictListing } from "./conflicts";
import {
  ADJUDICATE_KIND,
  SWEEP_DELEGATOR,
  duplicateLine,
  sweepProseConflicts,
  type SweepResult,
} from "./sweep";
import { adjudicateWorker, type AdjudicateDepsFor } from "./worker";

export { ADJUDICATE_KIND };

const liveListing: ConflictListing = {
  files: (dir) => observationFs.listDir(dir === "" ? "." : dir),
  async dirs(dir) {
    try {
      const entries = await appData.readDir(dir === "" ? "." : dir);
      return entries.filter((e) => e.isDirectory).map((e) => e.name);
    } catch {
      return [];
    }
  },
};

const liveDeps: AdjudicateDepsFor = (signal): AdjudicateDeps => ({
  fs: observationFs,
  observations: new ObservationFileStore(observationFs),
  serializeObservation,
  callModel: ({ systemPrompt, task }) =>
    callModel("prep", "plan", systemPrompt, task, { signal, onProgress: () => {} }, {
      spend: { caller: "distill" },
    }),
});

/**
 * Hand legion the adjudicate-prose kind. Synced, so the run file is what two
 * devices share and the election picks the one that executes it; no tags,
 * because any device that can call the model can do this. Not delegable: the
 * brief is a path the sweep writes, not something the soul would.
 */
export function registerProseAdjudicateWorker(depsFor: AdjudicateDepsFor = liveDeps): void {
  registerWorker({
    kind: ADJUDICATE_KIND,
    tier: "synced",
    requires: [],
    agent: true,
    run: adjudicateWorker(depsFor),
  });
}

/** One sweep on this device. Never throws. */
export async function sweepProseConflictsNow(): Promise<SweepResult | null> {
  const runs = appRuns();
  try {
    return await sweepProseConflicts({
      list: liveListing,
      read: (path) => observationFs.read(path),
      runs: () => runs.list({ kind: ADJUDICATE_KIND }),
      async cancelDuplicate({ id, winner }) {
        const run = await runs.get(id);
        if (!run) return;
        if (run.state === "pending") {
          await runs.transition(id, "cancelled", { progress: duplicateLine(winner) });
          return;
        }
        await runs.report(id, duplicateLine(winner));
        await appRunner().cancel(id);
      },
      async delegate({ idempotencyKey, brief }) {
        await appRunner().delegate({
          kind: ADJUDICATE_KIND,
          idempotencyKey,
          delegator: { kind: "program", name: SWEEP_DELEGATOR },
          brief,
        });
      },
    });
  } catch (e) {
    console.warn("the prose conflict sweep failed", e);
    return null;
  }
}
