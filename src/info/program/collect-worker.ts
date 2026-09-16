// The collect kind, as a legion worker (docs/55 step 12, docs/63).
//
// Collecting the day is the oldest piece of background work in the app and the
// last to still be started by hand: three callers held the pipeline and each
// kept its own record of whether it had run — a date file for the morning
// round, a `lastAskAt` for a reader's request, a "busy" answer for the
// companion's. This is what they call instead. A program worker, `synced` tier,
// no capability tags: every device the reader left background collection on for
// is a candidate, which is who was eligible before capabilities existed
// (briefer/handoff.ts).
//
// The worker is a shell around InfoPipeline and nothing more. It does not know
// the phases, the sources or the rooms; it reads the scope out of the task book,
// starts the matching method, turns the pipeline's phase into one line of run
// progress, and hands the day's briefing file back as the output. The pipeline's
// own resume, checkpoint and halt are untouched.
//
// Single flight is the point of doing it this way. The runner already runs one
// run of a kind at a time on a device (execute/runner.ts), so two collect runs
// never overlap through it; the pipeline can still be busy with the one thing
// that does not come through a run — `init()`, which resumes a checkpoint when
// the app comes to the front — and a worker that found it busy waits for that
// run to end and then takes its turn. Nothing is dropped: a round that cannot
// start this minute is still a pending run on disk.
//
// The task book is a file under legion/briefs/, which is machine-local (palace
// kinds.ts). That is the same device the run executes on: all three callers
// delegate only where `amICollecting()` is true, and the election sends the run
// to that same machine. A run the election moves to another device mid-flight
// finds no task book and fails there, which is the honest reading of it —
// briefs cross devices when translate needs them to (docs/55 step 11).

import { appData } from "../../platform/app/appdata";
import { registerWorker, type WorkerContext, type WorkerHandle } from "../../legion/execute/worker";
import { briefingFile } from "../collect/store";
import { COLLECT_KIND } from "../briefer/handoff";
import type { InfoSnapshot, RunHandle } from "../boxes/pipeline";

export { COLLECT_KIND };

/** Where a collect task book is kept. The subtree is registered in palace. */
export const COLLECT_BRIEFS_DIR = "legion/briefs";

/**
 * How much of the day to do. The same two words a reader's ask uses, because
 * they are the same two things: re-run the rooms over what is already collected,
 * or collect everything again and re-run them (handoff.ts, pipeline.ts).
 */
export type CollectScope = "full" | "retriage";

/** What one collect run's task book says. Frozen when the run is created. */
export interface CollectBrief {
  scope: CollectScope;
  /** Which of the three asked, for a person reading the file. */
  why: string;
}

// A key is written by people — "daily:2026-09-16" — and has to become a file
// name. Anything that is not a letter, a digit or a dash is one dash, which
// keeps the name readable and keeps two different keys apart: the characters
// being replaced are separators, so a key that differs at all differs in what
// is left of it.
function briefName(key: string): string {
  return `collect-${key.replace(/[^A-Za-z0-9-]+/g, "-")}.json`;
}

/** Write the task book for a run about to be delegated, answering its path. */
export async function writeCollectBrief(key: string, brief: CollectBrief): Promise<string> {
  const path = `${COLLECT_BRIEFS_DIR}/${briefName(key)}`;
  await appData.mkdirp(COLLECT_BRIEFS_DIR);
  await appData.writeAtomic(path, JSON.stringify(brief, null, 2));
  return path;
}

/** Read a task book back. A file that does not say which scope is not one. */
export function parseCollectBrief(text: string): CollectBrief {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("the collect task book is not readable JSON");
  }
  const value = parsed as Partial<CollectBrief> | null;
  const scope = value?.scope;
  if (scope !== "full" && scope !== "retriage") {
    throw new Error("the collect task book names no scope");
  }
  return { scope, why: typeof value?.why === "string" ? value.why : "" };
}

/**
 * One line of run progress out of a pipeline snapshot, or null while nothing is
 * going. Pure, so what a person reads on a run file can be tested without a
 * pipeline: the phases are the pipeline's four, and the counts are what the
 * progress card already shows.
 */
export function collectProgressLine(snap: InfoSnapshot): string | null {
  if (!snap.running) return null;
  const c = snap.collect;
  switch (snap.phase) {
    case "discovering":
      return c ? `collecting ${c.done}/${c.total} sources` : "collecting sources";
    case "screening":
      return c ? `screening ${c.screened}/${c.items} headlines` : "screening headlines";
    case "fetching":
      return c ? `reading ${c.bodies}/${c.bodiesTotal} articles` : "reading articles";
    case "analyzing":
      return c ? `analyzing ${c.labs.done}/${c.labs.total} rooms` : "analyzing";
    default:
      return null;
  }
}

/**
 * What the worker uses of the pipeline, structurally: InfoPipeline satisfies it
 * and a test's own does too. The same shape the collector session takes
 * (presence.ts), and for the same reason — neither file constructs one.
 */
export interface CollectPipeline {
  generate(): RunHandle;
  retriage(): RunHandle;
  stop(): void;
  subscribe(fn: () => void): () => void;
  snapshot(): InfoSnapshot;
}

export interface CollectWorkerDeps {
  /** This device's pipeline. live.ts binds the real one on the way up. */
  pipeline: () => CollectPipeline;
  /** The task book, read back off its path. AppData unless injected. */
  readBrief?: (path: string) => Promise<string>;
}

/**
 * Run one collect run: read the scope, wait for the pipeline if something else
 * has it, run it, and report what it produced.
 *
 * A pipeline that parks its run with an error does not throw — it keeps the
 * reason in its snapshot so the screen can show it — so the error is read back
 * after the run and thrown here. That is what makes a failed collection a failed
 * attempt on the run rather than a run that claims it is done with nothing to
 * show.
 */
export function collectWorker(deps: CollectWorkerDeps) {
  const readBrief = deps.readBrief ?? ((path: string) => appData.readText(path));
  return (brief: string, ctx: WorkerContext): WorkerHandle => {
    const p = deps.pipeline();
    let cancelled = false;
    // Only the run this worker started is stopped. The pipeline has one stop
    // button for whatever is going, and cancelling this run must not reach into
    // a run somebody else started and is waiting on.
    let mine = false;

    const done = (async () => {
      const { scope } = parseCollectBrief(await readBrief(brief));
      let last: string | null = null;
      const off = p.subscribe(() => {
        const line = collectProgressLine(p.snapshot());
        if (line === null || line === last) return;
        last = line;
        void ctx.report(line);
      });
      try {
        // Take the pipeline as soon as it is free. `busy` hands back the run
        // already going, so waiting on it is waiting for exactly the thing in
        // the way — no timer, and no second run against the same checkpoint.
        while (!cancelled) {
          const handle = scope === "retriage" ? p.retriage() : p.generate();
          if (handle.start === "started") {
            mine = true;
            await handle.done;
            break;
          }
          await handle.done;
        }
      } finally {
        off();
      }
      if (!mine) return { progress: "stopped before the pipeline was free" };

      const snap = p.snapshot();
      // Parked with a reason: a bad key, no network, a source that would not
      // answer. The checkpoint is still on disk and the next run continues from
      // it; this attempt did not produce a briefing.
      if (snap.error) throw new Error(snap.error);
      const date = snap.briefing?.date;
      if (!date) throw new Error("the collection ended with no briefing");
      return { output: briefingFile(date), progress: `briefing for ${date}` };
    })();

    return {
      cancel: () => {
        cancelled = true;
        if (mine) p.stop();
      },
      done,
    };
  };
}

/** Hand legion the collect kind. Called once at startup; deps are for tests. */
export function registerCollectWorker(deps: CollectWorkerDeps): void {
  registerWorker({
    kind: COLLECT_KIND,
    tier: "synced",
    // No tags. Every device the reader left background collection on for is a
    // candidate; this is the one registration of the kind's capabilities, which
    // is why handoff.ts no longer declares them separately.
    requires: [],
    run: collectWorker(deps),
  });
}
