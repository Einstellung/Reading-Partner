// The adjudicate-prose kind, as a legion worker (docs/59 §6, docs/55).
//
// The brief is the parked copy's path and nothing else: the run file holds a
// reference, and everything the model reads is read off disk when the run
// starts. The output is the path of the file that was written; the last line
// says what digest went into it and under which run, which is the provenance a
// file without frontmatter has.

import type { WorkerContext, WorkerHandle, WorkerOutcome } from "../../legion/execute/worker";
import { GiveUpError } from "../../legion/stop";
import { adjudicate, resolvedByFor, type AdjudicateDeps } from "./adjudicate";
import { parseConflictPath } from "./conflicts";
import { wroteLine } from "./sweep";

/** The deps for one run; the signal aborts its model call. */
export type AdjudicateDepsFor = (signal: AbortSignal) => AdjudicateDeps;

export function adjudicateWorker(depsFor: AdjudicateDepsFor) {
  return (brief: string, ctx: WorkerContext): WorkerHandle => {
    const controller = new AbortController();
    const done = (async (): Promise<WorkerOutcome> => {
      const conflict = parseConflictPath(brief);
      if (!conflict) throw new GiveUpError(`${brief} is not a conflict copy this kind settles`);
      await ctx.report(`Adjudicating ${conflict.path}`);
      const outcome = await adjudicate(conflict, ctx.run.id, depsFor(controller.signal));
      if (outcome.status === "gone") {
        return { progress: `${conflict.copyPath} was already settled` };
      }
      return {
        output: outcome.path,
        progress: wroteLine(outcome.path, outcome.digest, resolvedByFor(ctx.run.id)),
      };
    })();
    return { cancel: () => controller.abort(), done };
  };
}
