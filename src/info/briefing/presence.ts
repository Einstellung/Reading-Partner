// The claim, the heartbeat, and the readers' asks (docs/36) — the part of the
// live wiring that decides which machine spends the money.
//
// Only a collector runs any of this. A reader never starts a session, so it
// writes no claim, takes part in no election, and constructs neither singleton.
//
// Everything real is injected: the claim files, the device settings, the clock,
// the interval, the sync subscriptions, and the two singletons this session
// drives. live.ts binds them. Nothing here imports live.ts back — the seven
// places the upper half of that file needs are handed in as callbacks, because
// an import in that direction would be a cycle between the two files.

import {
  chooseAsk,
  HEARTBEAT_MS,
  isElectedCollector,
  mayClaim,
  type AskRecord,
  type CollectorClaim,
} from "./handoff";

// A pulled path that is some reader's request. Matches this device's own file
// too, which costs one read of a request it has already run.
const ASK_PATH = /^info-ask-.+\.json$/;

// The election result, held briefly. Every poll cycle asks, and the answer
// changes on the scale of hours; re-reading every claim file for each of them
// would be a directory listing per minute to learn the same thing.
export const ELECTION_TTL_MS = 60_000;

// What sync tells the session: whether an account is attached at all, and when
// the last pass landed.
export interface SessionSyncStatus {
  engineStarted: boolean;
  lastSyncAt: number | null;
}

// The two singletons the session drives, structurally — the session never
// constructs either, and only uses what is listed here.
export interface SessionPipeline {
  init(): Promise<void>;
  generate(): unknown;
  retriage(): unknown;
  subscribe(fn: () => void): () => void;
  snapshot(): {
    running: boolean;
    briefing: { date: string } | null;
    error: string | null;
  };
}

export interface SessionCollector {
  refresh(): Promise<void>;
  foreground(): void;
}

export interface CollectorSessionDeps<Handle = unknown> {
  deviceId(): string;
  // This machine's name and platform, asked once per session. The name is for a
  // sentence a reader can act on ("the briefing is built on kestrel").
  describeDevice(): Promise<{
    deviceName: string;
    platform: string;
    hasWebviewFetch: boolean;
  }>;
  readOwnClaim(deviceId: string): Promise<CollectorClaim | null>;
  readClaims(): Promise<CollectorClaim[]>;
  writeClaim(claim: CollectorClaim): Promise<void>;
  readAsks(): Promise<AskRecord[]>;
  loadDeviceSettings(): Promise<{ backgroundCollect: boolean }>;
  loadSourceHealth(): Promise<CollectorClaim["sources"]>;
  // Which sites this machine currently has a session with. The yes-or-no
  // travels; the cookie does not leave the webview it was set in (docs/36).
  siteStates(): Promise<Record<string, boolean>>;
  // The synced source list, by name, so a pull carrying it can be recognised.
  sourcesFile: string;
  now(): number;
  setInterval(fn: () => void, ms: number): Handle;
  clearInterval(handle: Handle): void;
  subscribeSyncStatus(cb: (status: SessionSyncStatus) => void): () => void;
  subscribePulled(cb: (paths: string[]) => void): () => void;
  onExit(cb: () => void): void;
  // Publish the briefing this machine already had and never published. What it
  // reports is the caller's business, not the session's.
  backfillPublish(): Promise<unknown>;
  pipeline(): SessionPipeline;
  collector(): SessionCollector;
}

export interface CollectorSession {
  // Become the collector: claim, say so every hour, and act on what the readers
  // asked for. Idempotent, so a settings change can call it without checking.
  start(): Promise<void>;
  // Give the claim up now rather than letting it expire, so whoever is next
  // takes over in seconds instead of a day.
  stop(): Promise<void>;
  publishClaim(): Promise<void>;
  // Whether this machine is the one collecting. False for anything that is not a
  // running collector, so every caller can ask without knowing the role.
  amICollecting(): Promise<boolean>;
  // A sync pass landed carrying these paths.
  onPulled(paths: string[]): void;
  // Whether this session is running at all — not the election, just the switch.
  isCollecting(): boolean;
}

export function createCollectorSession<Handle>(
  deps: CollectorSessionDeps<Handle>,
): CollectorSession {
  let claim: CollectorClaim | null = null;
  let collecting = false;
  let sessionStartedAt = 0;
  let heartbeat: Handle | null = null;
  let unsubSync: (() => void) | null = null;
  let unsubPulled: (() => void) | null = null;
  let syncing = false;
  let lastSyncAt: number | null = null;
  let electionAt = 0;
  let electionValue = false;

  // Whether this machine is the one collecting, from the files or from the
  // answer it got a moment ago.
  async function amICollecting(): Promise<boolean> {
    if (!collecting) return false;
    const now = deps.now();
    if (now - electionAt < ELECTION_TTL_MS) return electionValue;
    const claims = await deps.readClaims().catch(() => [] as CollectorClaim[]);
    electionValue = isElectedCollector(claims, deps.deviceId(), now);
    electionAt = now;
    return electionValue;
  }

  // The briefing this machine had before it could publish one (docs/36). Same
  // files, same order, decided by publish.ts; the only thing added here is the
  // election, which is what keeps a desktop that lost it from putting its own
  // older briefing over the winner's.
  //
  // Swallowed: the readers get the next one.
  async function backfillPublishedBriefing(): Promise<void> {
    if (!(await amICollecting())) return;
    try {
      await deps.backfillPublish();
    } catch (e) {
      console.warn("failed to publish the briefing already on disk", e);
    }
  }

  // Write this machine's claim: a heartbeat every time, and the claim itself only
  // while this machine is both willing (the setting) and allowed (its first pull
  // has landed, or it has waited long enough to stop waiting).
  //
  // claimedAt is kept once taken, so a machine's standing is its uptime and not
  // the time of its last write. Losing eligibility clears it, and taking it up
  // again puts the machine at the back of the queue rather than back at its old
  // place — which is the point: whoever picked the work up keeps it.
  async function publishClaim(): Promise<void> {
    if (!claim) return;
    const now = deps.now();
    let willing = false;
    try {
      willing = (await deps.loadDeviceSettings()).backgroundCollect;
    } catch {
      // Unreadable device settings: do not claim work on a guess.
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
    claim = {
      ...claim,
      claimedAt: allowed ? (claim.claimedAt ?? now) : null,
      heartbeatAt: now,
      sources: await deps.loadSourceHealth().catch(() => ({})),
      sites: await deps.siteStates(),
    };
    const took = !wasClaiming && claim.claimedAt !== null;
    try {
      await deps.writeClaim(claim);
    } catch (e) {
      console.warn("failed to write the collector claim", e);
    }
    // The file that decides the election just changed; do not answer from a copy
    // taken before it.
    electionAt = 0;
    // A machine that has just started claiming was, until a moment ago, one that
    // declined to poll and declined to generate. Both asked the claim and both got
    // no for an answer, and neither will ask again on its own — polling waits for
    // its next wake, which it never scheduled, and the pipeline waits for the next
    // return to the foreground. So the claim tells them.
    //
    // It is also the moment to publish a briefing this machine already had and
    // never published, and that goes first: it settles in three file reads, and
    // running it after the run below had started would race the run's own publish
    // for the same two names.
    if (took) {
      await backfillPublishedBriefing();
      await deps.collector().refresh();
      void deps.pipeline().init();
    }
  }

  // A reader asked for a briefing. Run at most one, whatever arrived: the newest
  // request at the widest scope anyone asked for, and never one already run.
  //
  // Called on every pull that carried an ask, and once at startup — a request
  // uploaded during the last session was pulled during the last session, so its
  // file is already on disk and no event will ever mention it again.
  async function runPendingAsk(): Promise<void> {
    if (!claim || !(await amICollecting())) return;
    const asks = await deps.readAsks().catch(() => [] as AskRecord[]);
    const chosen = chooseAsk(asks, claim.lastAskAt, deps.now());
    if (!chosen) return;
    // Recorded before the run, not after: a run that dies halfway is not a reason
    // to run the same request again on the next pull.
    claim = { ...claim, lastAskAt: chosen.askedAt };
    await deps.writeClaim(claim).catch(() => {});
    const p = deps.pipeline();
    if (chosen.scope === "retriage") void p.retriage();
    else void p.generate();
  }

  // Report how the run that just ended went, so a reader can say what happened on
  // a machine nobody is sitting at. `error` is the halt reason the pipeline parked
  // the run with; null means it finished.
  function watchRuns(p: SessionPipeline): void {
    let wasRunning = p.snapshot().running;
    p.subscribe(() => {
      const snap = p.snapshot();
      const ended = wasRunning && !snap.running;
      wasRunning = snap.running;
      if (!ended || !claim) return;
      claim = {
        ...claim,
        lastRunAt: deps.now(),
        lastBriefingDate: snap.briefing?.date ?? null,
        halt: snap.error,
      };
      void publishClaim();
    });
  }

  function onPulled(paths: string[]): void {
    // A source the reader subscribed to or turned on elsewhere: collect on it
    // now rather than at the next wake, which can be half an hour away.
    if (paths.includes(deps.sourcesFile)) deps.collector().foreground();
    if (paths.some((p) => ASK_PATH.test(p))) void runPendingAsk();
  }

  async function start(): Promise<void> {
    if (collecting) return;
    collecting = true;
    sessionStartedAt = deps.now();
    unsubSync ??= deps.subscribeSyncStatus((s) => {
      syncing = s.engineStarted;
      const advanced = s.lastSyncAt !== null && s.lastSyncAt !== lastSyncAt;
      lastSyncAt = s.lastSyncAt;
      // A pass landing is the thing a held-back claim was waiting for. Without
      // this it would wait for the next hourly heartbeat instead — an hour of a
      // machine that is willing, allowed, and doing nothing.
      if (advanced && claim && claim.claimedAt === null) void publishClaim();
    });
    const prior = await deps.readOwnClaim(deps.deviceId());
    const device = await deps.describeDevice();
    claim = {
      deviceId: deps.deviceId(),
      deviceName: device.deviceName,
      platform: device.platform,
      hasWebviewFetch: device.hasWebviewFetch,
      // Deliberately not restored from the file: the claim is this process's
      // uptime, so a restart goes to the back of the queue.
      claimedAt: null,
      heartbeatAt: deps.now(),
      lastRunAt: prior?.lastRunAt ?? null,
      lastBriefingDate: prior?.lastBriefingDate ?? null,
      halt: prior?.halt ?? null,
      sources: {},
      sites: {},
      // This does survive: a request this machine already ran must not run again
      // because the app was restarted.
      lastAskAt: prior?.lastAskAt ?? null,
    };
    await publishClaim();
    // The heartbeat hangs off the way out of the page and nothing else: a desktop
    // whose window is minimised or unfocused while its owner reads on a phone is
    // exactly the machine that has to go on saying it is alive (docs/36).
    heartbeat ??= deps.setInterval(() => void publishClaim(), HEARTBEAT_MS);
    deps.onExit(() => {
      if (heartbeat !== null) deps.clearInterval(heartbeat);
      heartbeat = null;
    });
    watchRuns(deps.pipeline());
    unsubPulled ??= deps.subscribePulled(onPulled);
    await runPendingAsk();
    // Only now can the pipeline decide anything: its startup action asks whether
    // this machine holds the claim, and until this function returned it did not.
    // The screens call init() too, on mount, and that call arrives before this one
    // — it finds no claim, declines to generate, and this is the second chance.
    // Cheap when there is nothing to do, and a no-op if the ask above started one.
    void deps.pipeline().init();
  }

  async function stop(): Promise<void> {
    if (!collecting) return;
    collecting = false;
    if (heartbeat !== null) deps.clearInterval(heartbeat);
    heartbeat = null;
    unsubPulled?.();
    unsubPulled = null;
    if (claim) {
      claim = { ...claim, claimedAt: null, heartbeatAt: deps.now() };
      await deps.writeClaim(claim).catch(() => {});
    }
    electionAt = 0;
    electionValue = false;
    void deps.collector().refresh();
  }

  return {
    start,
    stop,
    publishClaim,
    amICollecting,
    onPulled,
    isCollecting: () => collecting,
  };
}
