// When the desktop app looks for a new version and what it does with one
// (docs/72). The host calls are in updater.ts; this file is the schedule and
// the state, with the host and the clock passed in so it can be tested.
//
// The desktop app is resident — it starts with the machine and closes to the
// tray — so a check at launch alone would leave most machines on whatever
// version they booted with. It checks at start and then every six hours,
// downloads a new version in the background, and holds it until the user picks
// "Restart to update". Installing waits for that click because on Linux a
// .deb or .rpm install asks for the admin password, and on every platform the
// app goes away while it happens.
//
// A failed check or download is logged and forgotten; the next scheduled check
// is the retry.

export const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

// A version the host has found and can fetch. `close` releases the host-side
// handle of one that is not going to be used.
export interface FoundUpdate {
  version: string;
  download(): Promise<void>;
  install(): Promise<void>;
  close(): Promise<void>;
}

export interface UpdateHost {
  // Null when the running version is the newest.
  check(): Promise<FoundUpdate | null>;
  relaunch(): Promise<void>;
}

export interface UpdateClock {
  // Run `fn` every `ms`; returns the function that stops it.
  every(fn: () => void, ms: number): () => void;
}

// What the UI shows. `ready` is a version downloaded and waiting for the
// restart; `installing` is the click having been made.
export type UpdateState =
  | { kind: "none" }
  | { kind: "ready"; version: string }
  | { kind: "installing"; version: string };

export interface UpdateRunner {
  start(): void;
  stop(): void;
  // One check-and-download pass. Exposed for tests; start() schedules it.
  checkNow(): Promise<void>;
  // Install the downloaded version and relaunch into it.
  applyNow(): Promise<void>;
  snapshot(): UpdateState;
  subscribe(listener: () => void): () => void;
}

const NONE: UpdateState = { kind: "none" };

export function createUpdateRunner(
  host: UpdateHost,
  clock: UpdateClock,
  log: (message: string, error: unknown) => void = (m, e) => console.warn(m, e),
): UpdateRunner {
  let state: UpdateState = NONE;
  let ready: FoundUpdate | null = null;
  let checking = false;
  let cancel: (() => void) | null = null;
  const listeners = new Set<() => void>();

  // A function rather than a field read, so the check below is not narrowed
  // away by the one made before the await it has to see past.
  const installing = (): boolean => state.kind === "installing";

  function set(next: UpdateState): void {
    state = next;
    for (const l of listeners) l();
  }

  async function discard(update: FoundUpdate): Promise<void> {
    try {
      await update.close();
    } catch {
      // The handle goes when the process does.
    }
  }

  async function checkNow(): Promise<void> {
    // A download can outlast the interval; the pass in flight covers this one.
    // Once the click has been made the app is on its way out.
    if (checking || installing()) return;
    checking = true;
    try {
      const found = await host.check();
      if (!found) return;
      // Already downloaded and waiting: nothing new to fetch.
      if (ready && ready.version === found.version) {
        await discard(found);
        return;
      }
      await found.download();
      // The click may have landed while this one downloaded; it installs the
      // older one, and this one is surplus.
      if (installing()) {
        await discard(found);
        return;
      }
      const previous = ready;
      ready = found;
      set({ kind: "ready", version: found.version });
      if (previous) await discard(previous);
    } catch (e) {
      log("update check failed", e);
    } finally {
      checking = false;
    }
  }

  async function applyNow(): Promise<void> {
    const update = ready;
    if (!update || state.kind !== "ready") return;
    set({ kind: "installing", version: update.version });
    try {
      // On Windows install() hands over to the installer and the app exits
      // here; macOS and Linux replace the bundle in place and need the relaunch.
      await update.install();
      await host.relaunch();
    } catch (e) {
      // A refused admin password lands here. The download is still good, so
      // the entry comes back for another try.
      log("update install failed", e);
      set({ kind: "ready", version: update.version });
    }
  }

  return {
    start() {
      if (cancel) return;
      cancel = clock.every(() => void checkNow(), UPDATE_CHECK_INTERVAL_MS);
      void checkNow();
    },
    stop() {
      cancel?.();
      cancel = null;
    },
    checkNow,
    applyNow,
    snapshot: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

// The label of the entry, one string so the rail's tooltip and the column's
// text agree.
export function restartLabel(state: UpdateState): string | null {
  if (state.kind === "ready") return `Restart to update (v${state.version})`;
  if (state.kind === "installing") return `Updating to v${state.version}…`;
  return null;
}
