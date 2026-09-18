// The translation the screen is watching (docs/55 step 11).
//
// There is no state of its own here. The run record is the state — the runner
// writes a line on it as the work goes and a terminal state when it stops — and
// this is the shape useSyncExternalStore needs to read one: subscribe to the
// runner, re-read the runs it knows of, keep the last view so React sees the
// same object until something actually changed.
//
// The one thing it fetches is the output file of a finished run, which is where
// the worker put what replaced the original. Once per run: a run reaches `done`
// exactly once and the file does not change afterwards.

import { appData } from "../../platform/app/appdata";
import { appRunner } from "../../legion/execute/runner";
import type { Run } from "../../legion/run";
import {
  TRANSLATE_KIND,
  latestTranslateRun,
  parseReplacement,
  translateView,
  type Replacement,
  type TranslateView,
} from "./book-run";

export interface TranslateWatchDeps {
  /** Every translation run this device knows of. */
  list: () => Promise<Run[]>;
  /** The runner's own announcement that it wrote to a run. */
  subscribe: (fn: () => void) => () => void;
  /** A finished run's output file, by the path the run carries. */
  readOutput: (path: string) => Promise<string>;
}

export interface TranslateWatch {
  subscribe(fn: () => void): () => void;
  snapshot(): TranslateView | null;
  /** The reader closed the line. That run is not shown again. */
  dismiss(runId: string): void;
  /** Ask for a fresh read now, without waiting for the runner to say anything. */
  refresh(): Promise<void>;
}

/** Whether two views say the same thing, so React is handed the same object. */
function same(a: TranslateView | null, b: TranslateView | null): boolean {
  if (a === null || b === null) return a === b;
  return (
    a.runId === b.runId && a.phase === b.phase && a.text === b.text && a.replaced === b.replaced
  );
}

export function createTranslateWatch(deps: TranslateWatchDeps): TranslateWatch {
  const listeners = new Set<() => void>();
  const dismissed = new Set<string>();
  // What each finished run left behind. A run that answered null once is not
  // asked again: the file is either there or it is not.
  const outputs = new Map<string, Replacement | null>();
  let view: TranslateView | null = null;
  let off: (() => void) | null = null;
  let chain: Promise<void> = Promise.resolve();

  function publish(next: TranslateView | null): void {
    if (same(view, next)) return;
    view = next;
    for (const fn of [...listeners]) fn();
  }

  async function read(): Promise<void> {
    const run = latestTranslateRun(await deps.list());
    if (!run || dismissed.has(run.id)) {
      publish(null);
      return;
    }
    if (run.state === "done" && run.output !== undefined && !outputs.has(run.id)) {
      const text = await deps.readOutput(run.output).catch(() => null);
      outputs.set(run.id, text === null ? null : parseReplacement(text));
    }
    publish(translateView(run, outputs.get(run.id) ?? null));
  }

  function refresh(): Promise<void> {
    chain = chain.then(() => read()).catch((e) => console.warn("a translation run would not read", e));
    return chain;
  }

  return {
    subscribe(fn) {
      listeners.add(fn);
      // The first watcher arms the whole thing; the last one to leave disarms
      // it, so a shell with the reader closed is not listening to the runner.
      off ??= deps.subscribe(() => void refresh());
      void refresh();
      return () => {
        listeners.delete(fn);
        if (listeners.size === 0) {
          off?.();
          off = null;
        }
      };
    },
    snapshot: () => view,
    dismiss(runId) {
      dismissed.add(runId);
      void refresh();
    },
    refresh,
  };
}

let live: TranslateWatch | undefined;

/** This device's one watch. The runner is the app's, the files are the app's. */
export function translateWatch(): TranslateWatch {
  live ??= createTranslateWatch({
    list: () => appRunner().list({ kind: TRANSLATE_KIND }),
    subscribe: (fn) => appRunner().subscribe(fn),
    readOutput: (path) => appData.readText(path),
  });
  return live;
}
