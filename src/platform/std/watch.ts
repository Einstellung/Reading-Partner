// The subscribe half of a useSyncExternalStore view over somebody else's store.
// The view keeps no state of its own; it re-reads the source whenever the
// source announces a write, and tells its own listeners when what it read
// changed. The first listener arms the source subscription and the last one to
// leave disarms it, so nothing is listening while nothing is on screen. Reads
// run one after another, and one that throws is logged and does not stop the
// next. Pure, and imports nothing.

export interface WatchSourceOptions {
  /** The source's own announcement that it wrote something. */
  subscribe: (fn: () => void) => () => void;
  /** One read of the source. Calls `notify` when what it read changed. */
  read: (notify: () => void) => Promise<void>;
  /** What the warning says when a read throws. */
  failure: string;
}

export interface SourceWatch {
  subscribe(fn: () => void): () => void;
  /** Ask for a fresh read now, without waiting for the source to say anything. */
  refresh(): Promise<void>;
}

export function watchSource(options: WatchSourceOptions): SourceWatch {
  const listeners = new Set<() => void>();
  let off: (() => void) | null = null;
  let chain: Promise<void> = Promise.resolve();

  function notify(): void {
    for (const fn of [...listeners]) fn();
  }

  function refresh(): Promise<void> {
    chain = chain.then(() => options.read(notify)).catch((e) => console.warn(options.failure, e));
    return chain;
  }

  return {
    subscribe(fn) {
      listeners.add(fn);
      off ??= options.subscribe(() => void refresh());
      void refresh();
      return () => {
        listeners.delete(fn);
        if (listeners.size === 0) {
          off?.();
          off = null;
        }
      };
    },
    refresh,
  };
}
