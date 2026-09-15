// Writing this device's claim: when it may be written, what it says, and how
// often it is said again (docs/55, docs/36).
//
// Four rules come from info's collector session, where they were learned:
//
//   - a device that syncs writes no claim until its first pull of the session
//     has landed, because claiming a folder it has not read yet is how two
//     machines both decide they are the one;
//   - and it stops waiting for that pull after the grace period, because a
//     machine that never works while it waits for a file it will never get is
//     worse than two machines working;
//   - `claimedAt` is this process's uptime, never restored from the file, so a
//     restarted device joins the queue at the back and whoever picked the work
//     up keeps it;
//   - a heartbeat every hour, hung off the way out of the page and nothing
//     else: a desktop whose window is minimised while its owner reads on a
//     phone is exactly the machine that has to go on saying it is alive.
//
// Everything real is injected — the files, the clock, the timer, the sync
// subscription — so the domain that binds it decides what a device is and this
// stays a function of its inputs.

import { isElectedFor, mayClaim } from "./elect";
import { HEARTBEAT_MS, type DeviceClaim } from "./types";

// The election result, held briefly. Callers ask on every poll cycle and the
// answer changes on the scale of hours; re-reading every claim file for each of
// them would be a directory listing a minute to learn the same thing.
export const ELECTION_TTL_MS = 60_000;

/** What sync tells the writer: whether an account is attached, and when the last pass landed. */
export interface ClaimSyncStatus {
  engineStarted: boolean;
  lastSyncAt: number | null;
}

/** The fields a domain keeps on its own device's claim, beyond what legion reads. */
export type ClaimExtras = Record<string, unknown>;

export interface ClaimWriterDeps<Handle = unknown> {
  deviceId(): string;
  /** This machine, asked once per session: it does not change while the app runs. */
  describe(): Promise<{ deviceName: string; platform: string; capabilities: string[] }>;
  /**
   * Whether the reader lets this machine take background work at all. Asked on
   * every write, because it is a setting that can be turned off mid-session.
   * A machine whose answer cannot be read does not claim work on a guess.
   */
  willing(): Promise<boolean>;
  /** Domain fields to refresh on every write. */
  extras?(): Promise<ClaimExtras>;
  /** Domain fields on the claim already on disk that outlive a restart. */
  restore?(prior: DeviceClaim | null): ClaimExtras;
  readOwn(deviceId: string): Promise<DeviceClaim | null>;
  readAll(): Promise<DeviceClaim[]>;
  write(claim: DeviceClaim): Promise<void>;
  now(): number;
  setInterval(fn: () => void, ms: number): Handle;
  clearInterval(handle: Handle): void;
  subscribeSyncStatus(cb: (status: ClaimSyncStatus) => void): () => void;
  onExit(cb: () => void): void;
  /**
   * This machine has just started claiming. Whatever declined to act while it
   * held no claim is told here, because nothing else will ask again.
   */
  onTake?(): void | Promise<void>;
}

export interface ClaimWriter {
  /** Claim, and say so every hour. Idempotent. */
  start(): Promise<void>;
  /**
   * Give the claim up now rather than letting it expire, so whoever is next
   * takes over in seconds instead of a day.
   */
  stop(): Promise<void>;
  /** Write the claim as it stands now: the heartbeat, and the fields that follow it. */
  publish(): Promise<void>;
  /** Put domain fields on this device's claim and write it. */
  patch(fields: ClaimExtras): Promise<void>;
  /** Whether this device is the one that runs this kind. False when not running. */
  electedFor(kind: string): Promise<boolean>;
  /** Whether this writer is running at all — not the election, just the switch. */
  running(): boolean;
  /** The claim as last written, for a domain reading back its own fields. */
  current<T extends DeviceClaim = DeviceClaim>(): T | null;
}

export function createClaimWriter<Handle>(deps: ClaimWriterDeps<Handle>): ClaimWriter {
  let claim: DeviceClaim | null = null;
  let running = false;
  let sessionStartedAt = 0;
  let heartbeat: Handle | null = null;
  let unsubSync: (() => void) | null = null;
  let syncing = false;
  let lastSyncAt: number | null = null;
  const elections = new Map<string, { at: number; deviceId: string }>();

  async function electedFor(kind: string): Promise<boolean> {
    if (!running) return false;
    const now = deps.now();
    const held = elections.get(kind);
    if (held && now - held.at < ELECTION_TTL_MS) return held.deviceId === deps.deviceId();
    const claims = await deps.readAll().catch(() => [] as DeviceClaim[]);
    const winner = isElectedFor(kind, claims, deps.deviceId(), now);
    elections.set(kind, { at: now, deviceId: winner ? deps.deviceId() : "" });
    return winner;
  }

  // The claim itself is written only while this machine is both willing (the
  // setting) and allowed (its first pull has landed, or it has waited long
  // enough to stop waiting). The heartbeat is written every time either way.
  //
  // claimedAt is kept once taken, so a machine's standing is its uptime and not
  // the time of its last write. Losing eligibility clears it, and taking it up
  // again puts the machine at the back of the queue rather than back at its old
  // place — which is the point: whoever picked the work up keeps it.
  async function publish(): Promise<void> {
    if (!claim) return;
    const now = deps.now();
    let willing = false;
    try {
      willing = await deps.willing();
    } catch {
      // Unreadable settings: do not claim work on a guess.
    }
    const allowed =
      willing &&
      mayClaim({
        syncing,
        pulledAt: lastSyncAt !== null && lastSyncAt >= sessionStartedAt ? lastSyncAt : null,
        startedAt: sessionStartedAt,
        now,
      });
    const wasClaiming = claim.claimedAt !== null;
    const extras = deps.extras ? await deps.extras().catch(() => ({}) as ClaimExtras) : {};
    claim = {
      ...claim,
      ...extras,
      claimedAt: allowed ? (claim.claimedAt ?? now) : null,
      heartbeatAt: now,
    };
    const took = !wasClaiming && claim.claimedAt !== null;
    try {
      await deps.write(claim);
    } catch (e) {
      console.warn("failed to write this device's claim", e);
    }
    // The file that decides the election just changed; do not answer from a
    // copy taken before it.
    elections.clear();
    if (took) await deps.onTake?.();
  }

  async function patch(fields: ClaimExtras): Promise<void> {
    if (!claim) return;
    claim = { ...claim, ...fields };
    await publish();
  }

  async function start(): Promise<void> {
    if (running) return;
    running = true;
    sessionStartedAt = deps.now();
    unsubSync ??= deps.subscribeSyncStatus((s) => {
      syncing = s.engineStarted;
      const advanced = s.lastSyncAt !== null && s.lastSyncAt !== lastSyncAt;
      lastSyncAt = s.lastSyncAt;
      // A pass landing is the thing a held-back claim was waiting for. Without
      // this it would wait for the next hourly heartbeat instead — an hour of a
      // machine that is willing, allowed, and doing nothing.
      if (advanced && claim && claim.claimedAt === null) void publish();
    });
    const prior = await deps.readOwn(deps.deviceId()).catch(() => null);
    const device = await deps.describe();
    claim = {
      deviceId: deps.deviceId(),
      deviceName: device.deviceName,
      platform: device.platform,
      capabilities: device.capabilities,
      // Deliberately not restored from the file: the claim is this process's
      // uptime, so a restart goes to the back of the queue.
      claimedAt: null,
      heartbeatAt: deps.now(),
      ...(deps.restore?.(prior) ?? {}),
    };
    await publish();
    heartbeat ??= deps.setInterval(() => void publish(), HEARTBEAT_MS);
    deps.onExit(() => {
      if (heartbeat !== null) deps.clearInterval(heartbeat);
      heartbeat = null;
    });
  }

  async function stop(): Promise<void> {
    if (!running) return;
    running = false;
    if (heartbeat !== null) deps.clearInterval(heartbeat);
    heartbeat = null;
    if (claim) {
      claim = { ...claim, claimedAt: null, heartbeatAt: deps.now() };
      await deps.write(claim).catch(() => {});
    }
    elections.clear();
  }

  return {
    start,
    stop,
    publish,
    patch,
    electedFor,
    running: () => running,
    current: <T extends DeviceClaim = DeviceClaim>() => claim as T | null,
  };
}
