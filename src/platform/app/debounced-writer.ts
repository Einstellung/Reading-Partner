// The debounce every store puts between a change and the disk, written once.
//
// Four copies of it existed: annotations.ts and threads.ts were the same
// bindPagehide + schedule pair (threads had a headless guard the other lacked),
// settings.ts had a third with a flush the others lacked, and the reading
// position had a fourth living in App.tsx whose exit path swallowed the failure
// while its debounce path raised a toast for it.
//
// What the four have in common is not just the timer. A store that holds a
// change for half a second has to survive the way out of the app: on iOS the
// webview is suspended without the pending timer ever firing, so the last edit
// of a session is lost unless something flushes it on pagehide. And
// observeAppExit deliberately does not deduplicate (lifecycle.ts) — pagehide
// can fire more than once — so a flush has to be a no-op the second time by
// itself. That is what the dirty set does here: a key is taken out of it before
// its write starts, so nothing is written twice, and a page that comes back and
// is edited again still flushes on the way out after that.

import { observeAppExit } from "./lifecycle";

export interface WriterTimer {
  schedule: (fn: () => void, ms: number) => number;
  cancel: (id: number) => void;
}

// The window's timer, looked up per call rather than captured: a store is built
// when its module is first imported, which in a headless run happens before
// anything has decided whether there is a window at all. Without one there is no
// debounce and nothing is ever written on its own — the in-memory cache is the
// source of truth there, and a real run always has a window.
export const WINDOW_TIMER: WriterTimer = {
  schedule: (fn, ms) => (typeof window === "undefined" ? 0 : window.setTimeout(fn, ms)),
  cancel: (id) => {
    if (typeof window !== "undefined") window.clearTimeout(id);
  },
};

// The default way out. Bound on the first scheduled write rather than at import,
// so a headless caller that only ever reads never touches the DOM.
export function exitOnPagehide(onExit: () => void): void {
  if (typeof window === "undefined") return;
  observeAppExit(window, onExit);
}

export interface DebouncedWriterOptions<K> {
  // Write the key out. Whatever it writes comes from the caller's own cache;
  // this module holds no payload, only which keys are behind.
  write: (key: K) => Promise<void>;
  debounceMs?: number;
  // A failed write, never swallowed (pitfall 09). Both paths report through it:
  // the timer's and the one on the way out.
  onError?: (e: unknown) => void;
  exit?: (onExit: () => void) => void;
  timer?: WriterTimer;
}

export interface DebouncedWriter<K> {
  // The key changed: hold it for the debounce, then write it.
  schedule: (key: K) => void;
  // Whether a key is still waiting to be written. What the cache-drop rules ask
  // before throwing a cached copy away.
  isPending: (key: K) => boolean;
  // Write everything waiting and wait for it to land. Landing and not starting:
  // anyone about to read the file back has to see the bytes, not the write.
  flush: () => Promise<void>;
}

export function createDebouncedWriter<K>({
  write,
  debounceMs = 500,
  onError = () => {},
  exit = exitOnPagehide,
  timer = WINDOW_TIMER,
}: DebouncedWriterOptions<K>): DebouncedWriter<K> {
  const timers = new Map<K, number>();
  const dirty = new Set<K>();
  // The writes already in the air. Chained rather than raced: two atomic
  // replacements of the same file in flight at once have no defined winner, and
  // flush has to be able to wait for the one before it.
  let inFlight: Promise<void> = Promise.resolve();
  let exitBound = false;

  function writeNow(key: K): void {
    dirty.delete(key);
    const t = timers.get(key);
    if (t !== undefined) {
      timer.cancel(t);
      timers.delete(key);
    }
    inFlight = inFlight.then(() => write(key)).catch((e: unknown) => onError(e));
  }

  // Taking each key out of `dirty` before its write starts is what makes the
  // second flush a no-op: pagehide can fire more than once and observeAppExit
  // does not deduplicate, so the second call has to find nothing waiting.
  async function flush(): Promise<void> {
    for (const key of [...dirty]) writeNow(key);
    await inFlight;
  }

  function schedule(key: K): void {
    dirty.add(key);
    if (!exitBound) {
      exitBound = true;
      exit(() => void flush());
    }
    const existing = timers.get(key);
    if (existing !== undefined) timer.cancel(existing);
    timers.set(
      key,
      timer.schedule(() => {
        timers.delete(key);
        writeNow(key);
      }, debounceMs),
    );
  }

  return { schedule, isPending: (key) => dirty.has(key), flush };
}
