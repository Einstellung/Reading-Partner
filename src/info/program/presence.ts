// The collector session: info's half of the claim, and the readers' asks
// (docs/36).
//
// Only a collector runs any of this. A reader never starts a session, so it
// writes no claim, takes part in no election, and constructs neither singleton.
//
// What is left here is the info wiring. Who claims, when the claim may be
// written, the hourly heartbeat and the election all moved to legion/claim: the
// claim is no longer "I am the collector" but "this is what this machine can
// do", and collecting is one kind that runs on the machine that wins it.
//
// Everything real is injected: the claim files, the device settings, the clock,
// the interval, the sync subscriptions and pull routes, and the two singletons
// this session drives. live.ts binds them. Nothing here imports live.ts back — the seven
// places the upper half of that file needs are handed in as callbacks, because
// an import in that direction would be a cycle between the two files.

import { createClaimWriter, type ClaimWriter, type DeviceClaim } from "../../legion/claim";
import {
  chooseAsk,
  COLLECT_KIND,
  type AskRecord,
  type AskScope,
  type CollectorClaim,
} from "../briefer/handoff";

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
  // This machine's name and what it can do, asked once per session. The name is
  // for a sentence a reader can act on ("the briefing is built on kestrel").
  describeDevice(): Promise<{
    deviceName: string;
    platform: string;
    capabilities: string[];
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
  now(): number;
  setInterval(fn: () => void, ms: number): Handle;
  clearInterval(handle: Handle): void;
  subscribeSyncStatus(cb: (status: SessionSyncStatus) => void): () => void;
  // The two pulls this session acts on, each subscribed through the route table
  // (platform/sync/pull-routes). Which paths they mean is declared once, beside
  // the file each belongs to, so nothing here filters a path list again.
  subscribeSourcesPulled(cb: () => void): () => void;
  subscribeAskPulled(cb: () => void): () => void;
  onExit(cb: () => void): void;
  // Publish the briefing this machine already had and never published. What it
  // reports is the caller's business, not the session's.
  backfillPublish(): Promise<unknown>;
  pipeline(): SessionPipeline;
  collector(): SessionCollector;
  /**
   * Delegate the collect run a reader asked for. The session decides which ask
   * to act on and when; what a collect run is, and that there is one at a time,
   * is legion's (info/program/collect-worker.ts).
   */
  requestCollect(scope: AskScope, askedAt: number): Promise<void>;
}

export interface CollectorSession {
  // Become a candidate: claim, say so every hour, and act on what the readers
  // asked for. Idempotent, so a settings change can call it without checking.
  start(): Promise<void>;
  // Give the claim up now rather than letting it expire, so whoever is next
  // takes over in seconds instead of a day.
  stop(): Promise<void>;
  publishClaim(): Promise<void>;
  // Whether this machine is the one collecting. False for anything that is not a
  // running collector, so every caller can ask without knowing the role.
  amICollecting(): Promise<boolean>;
  // Whether this session is running at all — not the election, just the switch.
  isCollecting(): boolean;
}

export function createCollectorSession<Handle>(
  deps: CollectorSessionDeps<Handle>,
): CollectorSession {
  let unsubPulled: (() => void) | null = null;
  let watching = false;

  function amICollecting(): Promise<boolean> {
    return writer.electedFor(COLLECT_KIND);
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

  const writer: ClaimWriter = createClaimWriter<Handle>({
    deviceId: deps.deviceId,
    describe: deps.describeDevice,
    willing: async () => (await deps.loadDeviceSettings()).backgroundCollect,
    // Asked on every write: what the sources did last and which sites this
    // machine is signed in to are what a reader on another device reads off the
    // claim.
    extras: async () => ({
      sources: await deps.loadSourceHealth().catch(() => ({})),
      sites: await deps.siteStates(),
    }),
    // What survives a restart: how the last run went, and a request this machine
    // already ran, which must not run again because the app was restarted.
    restore: (prior: DeviceClaim | null) => {
      const was = prior as CollectorClaim | null;
      return {
        lastRunAt: was?.lastRunAt ?? null,
        lastBriefingDate: was?.lastBriefingDate ?? null,
        halt: was?.halt ?? null,
        sources: {},
        sites: {},
        lastAskAt: was?.lastAskAt ?? null,
      };
    },
    readOwn: deps.readOwnClaim,
    readAll: deps.readClaims,
    write: (claim) => deps.writeClaim(claim as CollectorClaim),
    now: deps.now,
    setInterval: deps.setInterval,
    clearInterval: deps.clearInterval,
    subscribeSyncStatus: deps.subscribeSyncStatus,
    // The heartbeat hangs off the way out of the page and nothing else: a
    // desktop whose window is minimised or unfocused while its owner reads on a
    // phone is exactly the machine that has to go on saying it is alive
    // (docs/36).
    onExit: deps.onExit,
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
    onTake: async () => {
      await backfillPublishedBriefing();
      await deps.collector().refresh();
      void deps.pipeline().init();
    },
  });

  // A reader asked for a briefing. Run at most one, whatever arrived: the newest
  // request at the widest scope anyone asked for, and never one already run.
  //
  // Called on every pull that carried an ask, and once at startup — a request
  // uploaded during the last session was pulled during the last session, so its
  // file is already on disk and no event will ever mention it again.
  async function runPendingAsk(): Promise<void> {
    const claim = writer.current<CollectorClaim>();
    if (!claim || !(await amICollecting())) return;
    const asks = await deps.readAsks().catch(() => [] as AskRecord[]);
    const chosen = chooseAsk(asks, claim.lastAskAt, deps.now());
    if (!chosen) return;
    // Recorded before the run, not after: a run that dies halfway is not a reason
    // to run the same request again on the next pull.
    await writer.patch({ lastAskAt: chosen.askedAt }).catch(() => {});
    // A run rather than a call into the pipeline (docs/55 step 12). The ask's own
    // moment names it, so the same ask pulled twice — or pulled again after a
    // restart — reaches the run that is already there.
    await deps.requestCollect(chosen.scope, chosen.askedAt);
  }

  // Report how the run that just ended went, so a reader can say what happened on
  // a machine nobody is sitting at. `error` is the halt reason the pipeline parked
  // the run with; null means it finished.
  function watchRuns(p: SessionPipeline): void {
    if (watching) return;
    watching = true;
    let wasRunning = p.snapshot().running;
    p.subscribe(() => {
      const snap = p.snapshot();
      const ended = wasRunning && !snap.running;
      wasRunning = snap.running;
      if (!ended || !writer.current()) return;
      void writer.patch({
        lastRunAt: deps.now(),
        lastBriefingDate: snap.briefing?.date ?? null,
        halt: snap.error,
      });
    });
  }

  async function start(): Promise<void> {
    if (writer.running()) return;
    await writer.start();
    watchRuns(deps.pipeline());
    if (unsubPulled === null) {
      // A source the reader subscribed to or turned on elsewhere: collect on it
      // now rather than at the next wake, which can be half an hour away. And a
      // reader asking for a briefing, which is run when its file lands.
      const offs = [
        deps.subscribeSourcesPulled(() => deps.collector().foreground()),
        deps.subscribeAskPulled(() => void runPendingAsk()),
      ];
      unsubPulled = () => {
        for (const off of offs) off();
      };
    }
    await runPendingAsk();
    // Only now can the pipeline decide anything: its startup action asks whether
    // this machine holds the claim, and until this function returned it did not.
    // The screens call init() too, on mount, and that call arrives before this one
    // — it finds no claim, declines to generate, and this is the second chance.
    // Cheap when there is nothing to do, and a no-op if the ask above started one.
    void deps.pipeline().init();
  }

  async function stop(): Promise<void> {
    if (!writer.running()) return;
    unsubPulled?.();
    unsubPulled = null;
    await writer.stop();
    void deps.collector().refresh();
  }

  return {
    start,
    stop,
    publishClaim: () => writer.publish(),
    amICollecting,
    isCollecting: () => writer.running(),
  };
}
