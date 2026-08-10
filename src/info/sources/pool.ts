// Bounded concurrency for the collection engine. A source used to fetch its
// articles one after another, so a run took (articles x page latency) on the
// slowest source; these two pieces let a source fetch several at once without
// letting a dozen sources put sixty requests on the wire together.
//
// Gate is the shared cap across sources; mapSettled is the per-call cap. Both
// are pure (no fetch, no clock) and unit-tested in tests/info/pool.test.ts.
//
// Two properties the engine depends on:
//   - Order. Fetches finish in whatever order the hosts answer, but the results
//     come back in input order, because the item order is what triage reads and
//     what the reader sees.
//   - Isolation. One task rejecting neither cancels its siblings nor loses
//     their results; every slot reports its own outcome.

import { AbortError } from "../../platform/app/abort";

export type Settled<R> = { ok: true; value: R } | { ok: false; error: unknown };

// A counting semaphore. One instance is shared by every source in a run, so the
// per-source limits multiply up to this ceiling and no further.
export class Gate {
  private active = 0;
  private waiting: (() => void)[] = [];

  constructor(private readonly limit: number) {}

  // For tests and diagnostics: how many tasks hold a slot right now.
  get inFlight(): number {
    return this.active;
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  private acquire(): Promise<void> {
    if (this.active < this.limit) {
      this.active++;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => this.waiting.push(resolve));
  }

  // The slot is handed to the next waiter rather than freed and re-taken: a
  // free-then-take would let a task arriving in between slip past the limit.
  private release(): void {
    const waiter = this.waiting.shift();
    if (waiter) waiter();
    else this.active--;
  }
}

export interface MapSettledOptions {
  // Tasks in flight from this call. Values below 1 are treated as 1.
  limit: number;
  // Shared ceiling across concurrent calls, if any.
  gate?: Gate;
  // Once aborted, no queued task starts. Tasks already running are left to
  // settle — the fetch inside them takes the same signal, so they end promptly.
  signal?: AbortSignal;
}

// Run fn over every input with at most `limit` in flight, returning one settled
// outcome per input, in input order. Slots never reached because of an abort
// come back as a failure carrying AbortError.
export async function mapSettled<T, R>(
  inputs: readonly T[],
  fn: (input: T, index: number) => Promise<R>,
  opts: MapSettledOptions,
): Promise<Settled<R>[]> {
  const out = new Array<Settled<R> | undefined>(inputs.length);
  const limit = Math.max(1, Math.floor(opts.limit));
  let next = 0;

  const runOne = (index: number): Promise<R> => {
    const task = () => {
      // Checked inside the gate too: a task can wait there long enough for the
      // user to press Stop, and a stopped run must not open a new request.
      if (opts.signal?.aborted) throw new AbortError();
      return fn(inputs[index], index);
    };
    return opts.gate ? opts.gate.run(task) : task();
  };

  const worker = async (): Promise<void> => {
    while (true) {
      if (opts.signal?.aborted) return;
      const index = next++;
      if (index >= inputs.length) return;
      try {
        out[index] = { ok: true, value: await runOne(index) };
      } catch (error) {
        out[index] = { ok: false, error };
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(limit, inputs.length) }, worker));

  // Written with an index loop, not map: the slots never reached are holes, and
  // map would hand them straight back as holes.
  const settled: Settled<R>[] = [];
  for (let i = 0; i < inputs.length; i++) {
    settled.push(out[i] ?? { ok: false, error: new AbortError() });
  }
  return settled;
}
