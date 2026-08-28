// The background sweeps (src/memory/live/sweeps.ts): the re-entry rules around
// distillation and the profile guess. Two passes over the same topic at once
// would each write back the meta they read before the other one wrote, and one
// of the two cursors would be lost — a failure that leaves no trace and cannot
// be reproduced by hand, so it is tested here with the passes themselves faked.
// Run: bun test.

import { expect, test } from "bun:test";
import {
  createDistillGate,
  createSweeps,
  type DistillTrigger,
  type SweepDeps,
} from "../../src/memory/live/sweeps";
import type { DistillJob, TopicArrears } from "../../src/memory/observations/arrears";

const MIN = 60_000;

// A topic that owes one conversation, which is what makes it due.
function owing(topicId: string, newMessages = 1): TopicArrears {
  return {
    topicId,
    topicName: topicId,
    lastDistilledAt: null,
    books: [
      {
        bookId: `${topicId}-book`,
        bookName: "a book",
        marks: [],
        newMarks: 0,
        threads: [
          {
            threadId: `${topicId}-thread`,
            annotationId: "a1",
            page: 1,
            markedText: "",
            messages: [],
            newMessages,
          },
        ],
      },
    ],
  };
}

// A promise a test resolves by hand, so a pass can be left in flight.
function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve = (): void => {};
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

class Harness {
  now = 1000 * MIN;
  gate = createDistillGate();
  arrears: TopicArrears[] = [owing("t1")];
  // Every collectArrears call, as the answer its thread-busy predicate gave for
  // one thread id.
  busyAnswers: boolean[] = [];
  arrearsCalls = 0;
  // A pass parks here instead of returning, so a test can act mid-sweep.
  pending: { promise: Promise<void>; resolve: () => void } | null = null;
  // The same, for the distillation itself rather than the read before it.
  pendingDistill: { promise: Promise<void>; resolve: () => void } | null = null;
  arrearsError: Error | null = null;
  jobs: { job: DistillJob; trigger: DistillTrigger }[] = [];
  guesses: DistillTrigger[] = [];
  warns: string[] = [];
  order: string[] = [];
  ticks: ((trigger: DistillTrigger) => void)[] = [];
  unschedules = 0;

  deps(): SweepDeps {
    return {
      gate: this.gate,
      collectArrears: async (isThreadBusy) => {
        this.arrearsCalls += 1;
        this.busyAnswers.push(isThreadBusy("live-thread"));
        if (this.pending) await this.pending.promise;
        if (this.arrearsError) throw this.arrearsError;
        return this.arrears;
      },
      // Both passes are a model call and a write, so neither can land anything a
      // caller that started it without waiting could see. Recording before the
      // first await would make `void` and `await` indistinguishable here.
      distill: async (job, trigger) => {
        if (this.pendingDistill) await this.pendingDistill.promise;
        await Promise.resolve();
        this.order.push("distill");
        this.jobs.push({ job, trigger });
      },
      guess: async (trigger) => {
        await Promise.resolve();
        this.order.push("guess");
        this.guesses.push(trigger);
      },
      now: () => this.now,
      schedule: (tick) => {
        this.ticks.push(tick);
        return () => {
          this.unschedules += 1;
        };
      },
      warn: (message) => {
        this.warns.push(message);
      },
    };
  }

  sweeps(): ReturnType<typeof createSweeps> {
    return createSweeps(this.deps());
  }
}

function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

test("the gate runs one pass per subject and lets the subject go again after", async () => {
  const gate = createDistillGate();
  const first = deferred();
  let runs = 0;

  const running = gate.run("thread-1", async () => {
    runs += 1;
    await first.promise;
  });
  expect(gate.busy()).toBe(true);

  // The sweep arriving at the thread a hangup is already distilling.
  await gate.run("thread-1", async () => {
    runs += 1;
  });
  expect(runs).toBe(1);

  // A different subject is a different pass and is not held up.
  await gate.run("marks:book-1", async () => {
    runs += 1;
  });
  expect(runs).toBe(2);

  first.resolve();
  await running;
  expect(gate.busy()).toBe(false);

  await gate.run("thread-1", async () => {
    runs += 1;
  });
  expect(runs).toBe(3);
});

test("the gate releases a subject whose pass threw", async () => {
  const gate = createDistillGate();
  await expect(
    gate.run("thread-1", () => Promise.reject(new Error("no provider"))),
  ).rejects.toThrow("no provider");
  expect(gate.busy()).toBe(false);

  let ran = false;
  await gate.run("thread-1", async () => {
    ran = true;
  });
  expect(ran).toBe(true);
});

test("a sweep runs the selected job and lets the next sweep run after it", async () => {
  const h = new Harness();
  const s = h.sweeps();

  await s.sweepDistillation("timer");
  expect(h.jobs.length).toBe(1);
  expect(h.jobs[0].trigger).toBe("timer");
  expect(h.jobs[0].job.topicId).toBe("t1");

  await s.sweepDistillation("foreground");
  expect(h.jobs.length).toBe(2);
  expect(h.jobs[1].trigger).toBe("foreground");
});

test("a sweep already running is this tick's one sweep", async () => {
  const h = new Harness();
  const s = h.sweeps();
  h.pending = deferred();

  const first = s.sweepDistillation("timer");
  await settle();
  expect(h.arrearsCalls).toBe(1);

  // The app coming back to the front while the timer's sweep is still reading.
  await s.sweepDistillation("foreground");
  expect(h.arrearsCalls).toBe(1);

  h.pending.resolve();
  h.pending = null;
  await first;
  expect(h.jobs.length).toBe(1);
});

test("a sweep whose own pass is still running is this tick's one sweep", async () => {
  const h = new Harness();
  const s = h.sweeps();
  h.pendingDistill = deferred();

  const first = s.sweepDistillation("timer");
  await settle();
  expect(h.arrearsCalls).toBe(1);
  expect(h.jobs.length).toBe(0);

  // The timer coming round again while the pass this sweep started is still
  // running. Two passes over the same topic each write back the meta they read
  // before the other one wrote, and one of the two cursors is lost.
  await s.sweepDistillation("foreground");
  expect(h.arrearsCalls).toBe(1);

  h.pendingDistill.resolve();
  h.pendingDistill = null;
  await first;
  expect(h.jobs.length).toBe(1);

  // And the sweep is available again once the pass it was waiting for is over.
  await s.sweepDistillation("timer");
  expect(h.arrearsCalls).toBe(2);
});

test("a distillation pass in flight holds the sweep and the guess off", async () => {
  const h = new Harness();
  const s = h.sweeps();
  const pass = deferred();
  const running = h.gate.run("thread-1", () => pass.promise);

  await s.sweepDistillation("timer");
  expect(h.arrearsCalls).toBe(0);
  await s.sweepProfileGuess("timer");
  expect(h.guesses.length).toBe(0);

  pass.resolve();
  await running;
  await s.sweepDistillation("timer");
  expect(h.arrearsCalls).toBe(1);
  await s.sweepProfileGuess("timer");
  expect(h.guesses).toEqual(["timer"]);
});

test("a guess pass already running is this tick's one guess", async () => {
  const h = new Harness();
  let inGuess = deferred();
  const deps = h.deps();
  const s = createSweeps({
    ...deps,
    guess: async (trigger) => {
      h.guesses.push(trigger);
      await inGuess.promise;
    },
  });

  const first = s.sweepProfileGuess("timer");
  await settle();
  expect(h.guesses.length).toBe(1);

  await s.sweepProfileGuess("foreground");
  expect(h.guesses.length).toBe(1);

  inGuess.resolve();
  await first;
  inGuess = deferred();
  inGuess.resolve();
  await s.sweepProfileGuess("foreground");
  expect(h.guesses.length).toBe(2);
});

test("nothing owed is no job and no complaint", async () => {
  const h = new Harness();
  h.arrears = [];
  const s = h.sweeps();

  await s.sweepDistillation("startup");
  expect(h.jobs.length).toBe(0);
  expect(h.warns.length).toBe(0);
});

test("a sweep that cannot read the arrears says so once and comes back", async () => {
  const h = new Harness();
  h.arrearsError = new Error("disk gone");
  const s = h.sweeps();

  await s.sweepDistillation("timer");
  expect(h.warns.length).toBe(1);
  expect(h.jobs.length).toBe(0);

  // The flag has to be back down, or the failure is permanent for the session.
  h.arrearsError = null;
  await s.sweepDistillation("timer");
  expect(h.jobs.length).toBe(1);
});

test("a topic that is not due yet is not a job", async () => {
  const h = new Harness();
  h.arrears = [{ ...owing("t1"), lastDistilledAt: h.now - MIN }];
  const s = h.sweeps();

  await s.sweepDistillation("timer");
  expect(h.jobs.length).toBe(0);

  // Half an hour later the same arrears are a job.
  h.now += 30 * MIN;
  await s.sweepDistillation("timer");
  expect(h.jobs.length).toBe(1);
});

test("the sweep skips threads whose reply is still being written", async () => {
  const h = new Harness();
  const s = h.sweeps();
  const stop = s.start((threadId) => threadId === "live-thread");
  await settle();
  expect(h.busyAnswers).toEqual([true]);

  // The predicate belongs to the binding, and the binding is over.
  stop();
  await s.sweepDistillation("timer");
  expect(h.busyAnswers).toEqual([true, false]);
  expect(h.unschedules).toBe(1);
});

test("binding sweeps once at startup and on every scheduled tick, guess last", async () => {
  const h = new Harness();
  const s = h.sweeps();
  s.start(() => false);
  await settle();

  expect(h.jobs.map((j) => j.trigger)).toEqual(["startup"]);
  expect(h.guesses).toEqual(["startup"]);
  // The guess reads what distillation writes, so it goes second every time.
  expect(h.order).toEqual(["distill", "guess"]);

  expect(h.ticks.length).toBe(1);
  h.ticks[0]("foreground");
  await settle();
  expect(h.jobs.map((j) => j.trigger)).toEqual(["startup", "foreground"]);
  expect(h.order).toEqual(["distill", "guess", "distill", "guess"]);
});
