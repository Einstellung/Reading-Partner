// What a dispatch ticket says (docs/72): the piece of work the soul handed off,
// as the reader sees it while it is away and once it is back.
//
// There is no state of its own here, the same way the translation line has none
// (reading/translate/watch.ts): the run record is the state, the runner writes a
// line on it as the work goes, and this is the shape useSyncExternalStore needs
// to read one. The ticket itself is derived from the thread's own trace
// (chatParts.ts) and never stored, so nothing here has to be reconciled with
// what the run file says.
//
// A run file the reader's other device wrote, or one a sweep has folded away, is
// simply not here: that is `gone`, and it is the one state that is about this
// device rather than about the work.

import { appData } from "../../../platform/app/appdata";
import { appRunner } from "../../../legion/execute/runner";
import { isTerminal, type Run } from "../../../legion/run";
import type { Receipt } from "../../../ai/tool-status";
import { clipLine } from "../../../platform/std/text";

/** How far a handed-off piece of work has got, for the one line drawn about it. */
export type DispatchState = "running" | "done" | "failed" | "gone";

export interface DispatchView {
  /** What was sent off: the receipt's own label, written when it was sent. */
  title: string;
  /** Where it has got to, in one line. */
  line: string;
  state: DispatchState;
}

/**
 * What this device knows about one run right now. `loaded` is false until the
 * first read of the run store has come back, so a ticket does not flash `gone`
 * on the way to finding its run.
 */
export interface DispatchSnapshot {
  loaded: boolean;
  run: Run | null;
  /** The finished run's output, once read. Null where there is none to read. */
  output: string | null;
}

/** How long a line about a run may be before it stops being one. */
const LINE = 120;

/** The first sentence of a paragraph written for somebody else to read. */
function firstSentence(text: string): string {
  const t = text.trim();
  const end = t.search(/[.!?](\s|$)/);
  return end < 0 ? t : t.slice(0, end + 1);
}

/**
 * The ticket for one run. The receipt carries what was sent — it was written at
 * the moment of sending and does not change — and the run carries where it got
 * to.
 *
 * `done` says what came back rather than that it came back: the output's first
 * sentence, falling back to the last line of progress where the output has not
 * been read. `failed` says why, which is the last thing the worker reported
 * before it stopped, because nothing else about the failure reaches this file.
 */
export function dispatchView(receipt: Receipt, snap: DispatchSnapshot): DispatchView {
  const title = receipt.label;
  const run = snap.run;
  if (!run) {
    // Still looking: the work was sent from here a moment ago and the store has
    // not answered yet.
    if (!snap.loaded) return { title, line: clipLine(receipt.summary, LINE), state: "running" };
    return { title, line: "No record of it on this device.", state: "gone" };
  }
  if (run.state === "done") {
    const said = snap.output ? firstSentence(snap.output) : run.progress;
    return { title, line: clipLine(said || "Back with an answer.", LINE), state: "done" };
  }
  if (isTerminal(run.state)) {
    const why = run.state === "cancelled" ? "Stopped before it finished." : run.progress;
    return { title, line: clipLine(why || "It stopped without saying why.", LINE), state: "failed" };
  }
  return {
    title,
    line: clipLine(run.progress || receipt.summary, LINE),
    state: "running",
  };
}

// --- the watch --------------------------------------------------------------

export interface DispatchWatchDeps {
  /** Every run this device knows of. */
  list: () => Promise<Run[]>;
  /** The runner's own announcement that it wrote to a run. */
  subscribe: (fn: () => void) => () => void;
  /** A finished run's output file, by the path the run carries. */
  readOutput: (path: string) => Promise<string>;
}

export interface DispatchWatch {
  subscribe(fn: () => void): () => void;
  /** What is known about one run, as a value React may compare by identity. */
  snapshot(runId: string): DispatchSnapshot;
  /** Ask for a fresh read now, without waiting for the runner to say anything. */
  refresh(): Promise<void>;
}

const NOTHING: DispatchSnapshot = { loaded: false, run: null, output: null };

/** Whether two snapshots say the same thing, so React is handed the same object. */
function same(a: DispatchSnapshot, b: DispatchSnapshot): boolean {
  return (
    a.loaded === b.loaded &&
    a.output === b.output &&
    a.run?.id === b.run?.id &&
    a.run?.state === b.run?.state &&
    a.run?.progress === b.run?.progress &&
    a.run?.revision === b.run?.revision
  );
}

/**
 * One watch over every run, shared by every ticket on screen. Per ticket it
 * would be one listener and one list read each, for a thread that may hold a
 * dozen; the runs are read once and each ticket picks its own out.
 */
export function createDispatchWatch(deps: DispatchWatchDeps): DispatchWatch {
  const listeners = new Set<() => void>();
  // The snapshot handed out for each run id, kept until something about that run
  // actually changed: useSyncExternalStore re-renders on identity.
  const snaps = new Map<string, DispatchSnapshot>();
  // What each finished run left behind. A run that answered null once is not
  // asked again: the file is either there or it is not.
  const outputs = new Map<string, string | null>();
  let loaded = false;
  let off: (() => void) | null = null;
  let chain: Promise<void> = Promise.resolve();

  function put(next: DispatchSnapshot): boolean {
    const id = next.run?.id;
    if (!id) return false;
    const prev = snaps.get(id);
    if (prev && same(prev, next)) return false;
    snaps.set(id, next);
    return true;
  }

  async function read(): Promise<void> {
    const runs = await deps.list();
    let changed = !loaded;
    loaded = true;
    for (const run of runs) {
      if (run.state === "done" && run.output !== undefined && !outputs.has(run.id)) {
        outputs.set(run.id, await deps.readOutput(run.output).catch(() => null));
      }
      if (put({ loaded: true, run, output: outputs.get(run.id) ?? null })) changed = true;
    }
    // A run this device has no file for keeps whatever it had; what it loses is
    // `loaded: false`, which is how a ticket stops waiting and says gone.
    for (const [id, snap] of snaps) {
      if (snap.loaded) continue;
      snaps.set(id, { ...snap, loaded: true });
      changed = true;
    }
    if (changed) for (const fn of [...listeners]) fn();
  }

  function refresh(): Promise<void> {
    chain = chain
      .then(() => read())
      .catch((e) => console.warn("the runs behind the dispatch tickets would not read", e));
    return chain;
  }

  return {
    subscribe(fn) {
      listeners.add(fn);
      // The first ticket arms the whole thing; the last one to leave disarms it,
      // so a thread with no tickets in it is not listening to the runner.
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
    snapshot(runId) {
      const held = snaps.get(runId);
      if (held) return held;
      const fresh = loaded ? { loaded: true, run: null, output: null } : NOTHING;
      snaps.set(runId, fresh);
      return fresh;
    },
    refresh,
  };
}

let live: DispatchWatch | undefined;

/** This device's one watch. The runner is the app's, the files are the app's. */
export function dispatchWatch(): DispatchWatch {
  live ??= createDispatchWatch({
    list: () => appRunner().list(),
    subscribe: (fn) => appRunner().subscribe(fn),
    readOutput: (path) => appData.readText(path),
  });
  return live;
}
