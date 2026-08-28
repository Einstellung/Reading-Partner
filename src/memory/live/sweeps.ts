// When the background passes run and when they refuse to (docs/02 part 2): one
// pass at a time per subject, one sweep at a time, one guess at a time, and the
// guess after distillation because it reads what distillation writes.
//
// The passes themselves are injected. Two passes over the same topic at once
// would each write back the meta they read before the other one wrote, and one
// of the two cursors would be lost — with no error, no log line, and nothing on
// screen. That is not a rule to keep only in live.ts, where the only way to
// reach it is a real model call.

import { selectDistillJob, type DistillJob, type TopicArrears } from "../observations/arrears";

// What set a pass going. Recorded on the event so a log can be read back — a
// topic whose observations only ever come from "hangup" is a topic the sweep is
// not reaching.
export type DistillTrigger =
  | "hangup"
  | "trim"
  | "timer"
  | "startup"
  | "foreground"
  | "book-switch"
  | "talk-exit";

// One pass at a time per subject: a thread id for a transcript pass,
// "marks:<bookId>" for a silent-marking pass. Every trigger goes through it, so
// the sweep cannot start a second pass over what a hangup is already distilling.
export interface DistillGate {
  // Whether any pass is in flight, whatever its subject.
  busy(): boolean;
  // Run the pass unless this subject already has one. The refusal is silent: the
  // work is already being done by whoever got there first.
  run(subject: string, pass: () => Promise<void>): Promise<void>;
}

export function createDistillGate(): DistillGate {
  const inFlight = new Set<string>();
  return {
    busy: () => inFlight.size > 0,
    async run(subject, pass) {
      if (inFlight.has(subject)) return;
      inFlight.add(subject);
      try {
        await pass();
      } finally {
        inFlight.delete(subject);
      }
    },
  };
}

export interface SweepDeps {
  // Shared with the distillation entry points, which is the point: a hangup's
  // pass and the sweep have to be able to see each other.
  gate: DistillGate;
  // What every topic still owes, read off disk. Threads whose reply is still
  // being written are left out — a pass over half a sentence is a pass over the
  // wrong transcript.
  collectArrears(isThreadBusy: (threadId: string) => boolean): Promise<TopicArrears[]>;
  // Run the one job the sweep picked. Never throws.
  distill(job: DistillJob, trigger: DistillTrigger): Promise<void>;
  // One look at whether the AI's guesses about the reader are worth redoing.
  // Owns its own far slower clock, and never throws.
  guess(trigger: DistillTrigger): Promise<void>;
  now(): number;
  // Bind the recurring ticks — the timer and the return to the foreground — and
  // return the undo. The startup tick is not one of these; it has already
  // happened by the time this is called.
  schedule(tick: (trigger: DistillTrigger) => void): () => void;
  warn(message: string, error: unknown): void;
}

export interface Sweeps {
  // Look once, and pay at most one debt. Called on a timer, at startup, when the
  // app comes back to the front, and when a book is closed or swapped — every one
  // of them only a look, so a reader who has done nothing since the last pass
  // costs nothing but a few file reads.
  sweepDistillation(trigger: DistillTrigger): Promise<void>;
  sweepProfileGuess(trigger: DistillTrigger): Promise<void>;
  // Bind the sweep for the life of the app: once now, and on every scheduled
  // tick after that. Returns the undo.
  start(isThreadBusy: (threadId: string) => boolean): () => void;
}

export function createSweeps(deps: SweepDeps): Sweeps {
  // Threads with a reply still being written. Set by the shell, which is the only
  // place that knows.
  let threadBusy: (threadId: string) => boolean = () => false;
  let sweeping = false;
  let guessing = false;

  async function sweepDistillation(trigger: DistillTrigger): Promise<void> {
    // A pass already running is this tick's one pass, whoever started it. Two at
    // once on the same topic would each write back the meta they read before the
    // other one wrote, and one of the two cursors would be lost.
    if (sweeping || deps.gate.busy()) return;
    sweeping = true;
    try {
      const job = selectDistillJob(await deps.collectArrears(threadBusy), deps.now());
      if (!job) return;
      await deps.distill(job, trigger);
    } catch (e) {
      // Reading the arrears is file I/O over data the reader owns; a sweep that
      // cannot read them says so once and waits for the next one.
      deps.warn("observation sweep failed", e);
    } finally {
      sweeping = false;
    }
  }

  async function sweepProfileGuess(trigger: DistillTrigger): Promise<void> {
    // A distillation pass in flight is this tick's one background run, and its
    // writes are exactly the evidence this pass reads — going second, next tick,
    // is strictly better.
    if (guessing || deps.gate.busy()) return;
    guessing = true;
    try {
      await deps.guess(trigger);
    } finally {
      guessing = false;
    }
  }

  function start(isThreadBusy: (threadId: string) => boolean): () => void {
    threadBusy = isThreadBusy;
    const tick = (trigger: DistillTrigger): void => {
      void sweepDistillation(trigger).then(() => sweepProfileGuess(trigger));
    };
    tick("startup");
    const unschedule = deps.schedule(tick);
    return () => {
      unschedule();
      threadBusy = () => false;
    };
  }

  return { sweepDistillation, sweepProfileGuess, start };
}
