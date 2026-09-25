// A queue that runs one task at a time, each one waiting on the one before it
// whether that one resolved or rejected. For a store whose mutators are
// read -> await -> write of a whole file: two of them overlapping would read
// the same content twice and the second write would drop the first one's edit.
//
// Made fresh per store (topics.ts, supplements.ts each call this once for their
// own file) rather than shared at module scope: a queue everything imports one
// copy of makes one caller's unfinished write the thing an unrelated caller
// waits behind.

export interface SerialQueue {
  /** Run `task` after every task already queued has settled, whichever way. */
  run<T>(task: () => Promise<T>): Promise<T>;
}

export function createSerialQueue(): SerialQueue {
  let tail: Promise<unknown> = Promise.resolve();

  return {
    run<T>(task: () => Promise<T>): Promise<T> {
      // Run whether the one before resolved or rejected, and keep the chain's
      // own handle settled: a task that throws must neither block the next one
      // nor surface here as an unhandled rejection. The caller still gets the
      // rejection, from `next`.
      const next = tail.then(task, task);
      tail = next.catch(() => {});
      return next;
    },
  };
}
