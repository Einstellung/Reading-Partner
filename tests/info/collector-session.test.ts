// The collector session (src/info/briefing/presence.ts): which machine holds the
// claim, when it gives it up, and what it does with the requests readers leave
// behind (docs/36). Every dependency is injected, so this runs with a fake clock,
// fake interval, no disk and no Tauri — which is the only way these paths get
// exercised at all: the failure modes are "two machines collect the same day" and
// "the briefing runs twice", neither reproducible by hand. Run: bun test.

import { expect, test } from "bun:test";
import {
  createCollectorSession,
  type CollectorSession,
  type CollectorSessionDeps,
  type SessionSyncStatus,
} from "../../src/info/briefing/presence";
import {
  ASK_PULL_ROUTE,
  CLAIM_SYNC_GRACE_MS,
  HEARTBEAT_MS,
  type AskRecord,
  type CollectorClaim,
} from "../../src/info/briefing/handoff";
import { SOURCES_FILE, SOURCES_PULL_ROUTE } from "../../src/info/sources/source-store";
const MIN = 60_000;

// One turn of the event loop, which is the least a real call out of this module
// costs: every one of them ends in disk or network. Used by the fakes below so
// that nothing they do can be observed by a caller that started them without
// waiting.
function aRoundTrip(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

// Everything the session retells to, in memory. The claim files are a map keyed by
// device id, because that is what the folder is: one file per device, written
// whole by its owner.
class Harness {
  now = 10_000 * MIN;
  deviceId = "this-device";
  claims = new Map<string, CollectorClaim>();
  asks: AskRecord[] = [];
  backgroundCollect = true;
  health: CollectorClaim["sources"] = {};
  sites: Record<string, boolean> = {};
  // Every claim this session wrote, oldest first.
  writes: CollectorClaim[] = [];
  // How many times the election went to the files rather than to its own answer.
  claimReads = 0;
  timers = new Map<number, { fn: () => void; ms: number }>();
  nextTimerId = 1;
  clearedTimers: number[] = [];
  exitHandlers: (() => void)[] = [];
  sourcesSubs: (() => void)[] = [];
  askSubs: (() => void)[] = [];
  pulledUnsubs = 0;
  syncSubs: ((s: SessionSyncStatus) => void)[] = [];
  refreshes = 0;
  foregrounds = 0;
  inits = 0;
  generates = 0;
  retriages = 0;
  backfills = 0;
  // The three round-trips the took branch makes, in the order their effects
  // landed. The order is the thing being protected: the backfill has to settle
  // before the poll it would otherwise race for the same two file names.
  order: string[] = [];
  // Non-null while the backfill is being held open, so a test can look at what
  // the took branch did next while the briefing is still going up.
  heldBackfill: Promise<void> | null = null;
  pipelineSubs: (() => void)[] = [];
  snapshot = {
    running: false,
    briefing: null as { date: string } | null,
    error: null as string | null,
  };

  deps(): CollectorSessionDeps<number> {
    return {
      deviceId: () => this.deviceId,
      describeDevice: async () => ({
        deviceName: "kestrel",
        platform: "linux",
        hasWebviewFetch: true,
      }),
      readOwnClaim: async (id) => this.claims.get(id) ?? null,
      readClaims: async () => {
        this.claimReads += 1;
        return [...this.claims.values()];
      },
      writeClaim: async (claim) => {
        this.writes.push(claim);
        this.claims.set(claim.deviceId, claim);
      },
      readAsks: async () => [...this.asks],
      loadDeviceSettings: async () => ({ backgroundCollect: this.backgroundCollect }),
      loadSourceHealth: async () => this.health,
      siteStates: async () => this.sites,
      now: () => this.now,
      setInterval: (fn, ms) => {
        const id = this.nextTimerId++;
        this.timers.set(id, { fn, ms });
        return id;
      },
      clearInterval: (id) => {
        this.clearedTimers.push(id);
        this.timers.delete(id);
      },
      subscribeSyncStatus: (cb) => {
        this.syncSubs.push(cb);
        return () => {};
      },
      subscribeSourcesPulled: (cb) => {
        this.sourcesSubs.push(cb);
        return () => {
          this.pulledUnsubs += 1;
        };
      },
      subscribeAskPulled: (cb) => {
        this.askSubs.push(cb);
        return () => {
          this.pulledUnsubs += 1;
        };
      },
      onExit: (cb) => {
        this.exitHandlers.push(cb);
      },
      // The three fakes below land their effect only after an await boundary,
      // the way the real calls do: backfillPublish is three file reads and an
      // upload, refresh is a poll, init is the pipeline's startup read. A fake
      // that counted before its first await would let `void` stand in for
      // `await` at any of the three call sites and keep every assertion green.
      backfillPublish: async () => {
        await aRoundTrip();
        if (this.heldBackfill) await this.heldBackfill;
        this.backfills += 1;
        this.order.push("backfill");
      },
      pipeline: () => ({
        init: async () => {
          await aRoundTrip();
          this.inits += 1;
          this.order.push("init");
        },
        generate: () => {
          this.generates += 1;
        },
        retriage: () => {
          this.retriages += 1;
        },
        subscribe: (fn) => {
          this.pipelineSubs.push(fn);
          return () => {};
        },
        snapshot: () => this.snapshot,
      }),
      collector: () => ({
        refresh: async () => {
          await aRoundTrip();
          this.refreshes += 1;
          this.order.push("refresh");
        },
        foreground: () => {
          this.foregrounds += 1;
        },
      }),
    };
  }

  session(): CollectorSession {
    return createCollectorSession(this.deps());
  }

  // A rival machine that has been claiming since `since`, alive as of now.
  rival(deviceId: string, since: number): void {
    this.claims.set(deviceId, {
      deviceId,
      deviceName: deviceId,
      platform: "linux",
      hasWebviewFetch: true,
      claimedAt: since,
      heartbeatAt: this.now,
      lastRunAt: null,
      lastBriefingDate: null,
      halt: null,
      sources: {},
      sites: {},
      lastAskAt: null,
    });
  }

  last(): CollectorClaim {
    const claim = this.writes[this.writes.length - 1];
    if (!claim) throw new Error("nothing was written");
    return claim;
  }

  // Stands in for dispatchPull (platform/sync/pull-routes): the routes' own
  // matchers decide who hears, so a handler wired to the wrong one of them shows
  // up here rather than only in production.
  pull(paths: string[]): void {
    if (paths.some((path) => SOURCES_PULL_ROUTE.matches(path))) {
      for (const cb of this.sourcesSubs) cb();
    }
    if (paths.some((path) => ASK_PULL_ROUTE.matches(path))) {
      for (const cb of this.askSubs) cb();
    }
  }

  syncStatus(s: SessionSyncStatus): void {
    for (const cb of this.syncSubs) cb(s);
  }

  // Park the backfill until the returned function is called.
  holdTheBackfill(): () => void {
    let release = (): void => {};
    this.heldBackfill = new Promise<void>((resolve) => {
      release = () => {
        this.heldBackfill = null;
        resolve();
      };
    });
    return () => release();
  }
}

// Everything the session does off a pull or a timer is fire-and-forget, so a test
// that wants to see the end of it has to leave the microtask queue.
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

// Long enough that anything the session started and did not wait for has had
// its turn — so "has not happened" means "was never started", not "is one turn
// behind the assertion".
async function everythingStartedHasLanded(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await settle();
}

test("a willing machine takes the claim and tells the collector and the pipeline", async () => {
  const h = new Harness();
  const s = h.session();
  await s.start();
  await settle();

  expect(h.last().claimedAt).toBe(h.now);
  expect(h.last().deviceName).toBe("kestrel");
  // Taking the claim publishes the briefing already on disk, wakes the polling
  // that had declined to schedule itself, and gives the pipeline its second
  // chance — a machine that just started claiming asked all three and got no.
  expect(h.backfills).toBe(1);
  expect(h.refreshes).toBe(1);
  // Two calls, from the two places that make them: the took branch above and
  // the end of start(). Counted rather than merely present, because either one
  // alone satisfies "at least one" and neither would then be pinned. The next
  // test holds start()'s own call still at one; the transition test below holds
  // the took branch's.
  expect(h.inits).toBe(2);
  // And the backfill settles before the poll: run the other way round, the two
  // of them race for the same two briefing file names.
  expect(h.order).toEqual(["backfill", "refresh", "init", "init"]);
  expect(await s.amICollecting()).toBe(true);
});

test("the briefing already on disk goes up before the poll that would race it", async () => {
  const h = new Harness();
  h.backgroundCollect = false;
  const s = h.session();
  await s.start();
  await settle();

  const release = h.holdTheBackfill();
  h.backgroundCollect = true;
  h.now += MIN;
  const taking = s.publishClaim();
  await everythingStartedHasLanded();
  // The briefing is still going up, so nothing else the took branch does may
  // have started: the run the poll wakes publishes under the same two names.
  expect(h.backfills).toBe(0);
  expect(h.refreshes).toBe(0);

  release();
  await taking;
  expect(h.order).toEqual(["init", "backfill", "refresh"]);
});

test("an unwilling machine writes a heartbeat and no claim", async () => {
  const h = new Harness();
  h.backgroundCollect = false;
  const s = h.session();
  await s.start();
  await settle();

  expect(h.last().claimedAt).toBe(null);
  expect(h.last().heartbeatAt).toBe(h.now);
  expect(h.backfills).toBe(0);
  expect(h.refreshes).toBe(0);
  // start() gives the pipeline its second chance whether or not the claim was
  // taken, so this is that call site on its own.
  expect(h.inits).toBe(1);
  expect(h.order).toEqual(["init"]);
  expect(await s.amICollecting()).toBe(false);
});

test("taking the claim is a transition, and the next heartbeat is not one", async () => {
  const h = new Harness();
  h.backgroundCollect = false;
  const s = h.session();
  await s.start();
  await settle();
  expect(h.last().claimedAt).toBe(null);
  // start()'s own call, and nothing from the took branch.
  expect(h.inits).toBe(1);

  // Collection turned on: this is the moment the machine goes from declining to
  // poll and declining to generate to doing both, and the only moment the three
  // one-shot calls belong to.
  h.backgroundCollect = true;
  h.now += MIN;
  const tookAt = h.now;
  await s.publishClaim();
  // Read before settling: publishClaim() has returned, so anything it started
  // without waiting for has not landed yet, and these two would still be zero.
  expect(h.backfills).toBe(1);
  expect(h.refreshes).toBe(1);
  await settle();
  expect(h.last().claimedAt).toBe(tookAt);
  expect(h.inits).toBe(2);

  // An hour on, the same machine is still the collector and writes its hourly
  // heartbeat. It did not take anything: re-entering here would republish a
  // briefing, restart the poll and re-run the pipeline's startup on a machine
  // that never stopped collecting, once an hour, forever.
  h.now += 60 * MIN;
  await s.publishClaim();
  await settle();
  expect(h.last().claimedAt).toBe(tookAt);
  expect(h.last().heartbeatAt).toBe(h.now);
  expect(h.backfills).toBe(1);
  expect(h.refreshes).toBe(1);
  expect(h.inits).toBe(2);
  expect(h.order).toEqual(["init", "backfill", "refresh", "init"]);
});

test("the claim is kept once taken and goes to the back of the queue when retaken", async () => {
  const h = new Harness();
  const s = h.session();
  const startedAt = h.now;
  await s.start();
  expect(h.last().claimedAt).toBe(startedAt);

  // Still claiming an hour later: standing is uptime, not the time of the last
  // write, so claimedAt must not move.
  h.now += 60 * MIN;
  await s.publishClaim();
  expect(h.last().claimedAt).toBe(startedAt);
  expect(h.last().heartbeatAt).toBe(h.now);

  // Collection turned off: out of the election at once rather than at forfeit.
  h.backgroundCollect = false;
  h.now += 10 * MIN;
  await s.publishClaim();
  expect(h.last().claimedAt).toBe(null);

  // Turned back on: the back of the queue, not the old place.
  h.backgroundCollect = true;
  h.now += 10 * MIN;
  const retakenAt = h.now;
  await s.publishClaim();
  expect(h.last().claimedAt).toBe(retakenAt);
});

test("the election answer is held for a minute and dropped when the claim is written", async () => {
  const h = new Harness();
  const s = h.session();
  await s.start();
  expect(await s.amICollecting()).toBe(true);

  // A machine that has been claiming for longer appears in the folder. The held
  // answer is still the old one for as long as it is held.
  h.rival("older-machine", h.now - 1000 * MIN);
  h.claimReads = 0;
  h.now += 30_000;
  expect(await s.amICollecting()).toBe(true);
  expect(h.claimReads).toBe(0);

  // Past the TTL the files are read again and this machine has lost.
  h.now += 31_000;
  expect(await s.amICollecting()).toBe(false);
  expect(h.claimReads).toBe(1);

  // A write changes the file the election is decided from, so the held answer
  // goes even though the TTL has not run out.
  h.claims.delete("older-machine");
  h.claimReads = 0;
  await s.publishClaim();
  expect(await s.amICollecting()).toBe(true);
  expect(h.claimReads).toBeGreaterThan(0);
});

test("a syncing machine holds its claim back until a pull lands", async () => {
  const h = new Harness();
  const s = h.session();
  // Sync running, nothing pulled yet: claiming on a folder this machine has not
  // read is how two machines both decide they are the collector.
  const pending = s.start();
  h.syncStatus({ engineStarted: true, lastSyncAt: null });
  await pending;
  expect(h.last().claimedAt).toBe(null);

  // The pass lands. Without the status subscription acting on it, the held-back
  // claim would wait for the next hourly heartbeat.
  h.now += 5 * MIN;
  h.syncStatus({ engineStarted: true, lastSyncAt: h.now });
  await settle();
  expect(h.last().claimedAt).toBe(h.now);
});

test("a pull from before this session does not release the claim", async () => {
  const h = new Harness();
  const s = h.session();
  const pending = s.start();
  // The stamp of the last pass the previous run of the app made. This session has
  // still read nothing, which is exactly the state the grace period is for.
  h.syncStatus({ engineStarted: true, lastSyncAt: h.now - 10 * MIN });
  await pending;
  await settle();
  expect(h.last().claimedAt).toBe(null);
});

test("a machine whose sync never lands claims after the grace period", async () => {
  const h = new Harness();
  const s = h.session();
  const pending = s.start();
  h.syncStatus({ engineStarted: true, lastSyncAt: null });
  await pending;
  expect(h.last().claimedAt).toBe(null);

  h.now += CLAIM_SYNC_GRACE_MS;
  await s.publishClaim();
  expect(h.last().claimedAt).toBe(h.now);
});

test("one run for everything asked, at the widest scope, and never the same ask twice", async () => {
  const h = new Harness();
  const askedAt = h.now - 5 * MIN;
  h.asks = [
    { deviceId: "phone", askedAt: askedAt - 1000, scope: "full" },
    { deviceId: "ipad", askedAt, scope: "retriage" },
  ];
  const s = h.session();
  await s.start();

  // Two readers asking at once get one run, and a re-triage does not shrink the
  // full regeneration the other one wanted.
  expect(h.generates).toBe(1);
  expect(h.retriages).toBe(0);
  // Recorded before the run, so a run that dies halfway is not a reason to run it
  // again on the next pull.
  expect(h.last().lastAskAt).toBe(askedAt);

  // The same files pulled again: nothing new to run.
  h.pull(["info-ask-ipad.json"]);
  await settle();
  expect(h.generates).toBe(1);

  // A newer ask is a new run.
  h.asks.push({ deviceId: "ipad", askedAt: h.now, scope: "retriage" });
  h.pull(["info-ask-ipad.json"]);
  await settle();
  expect(h.retriages).toBe(1);
  expect(h.last().lastAskAt).toBe(h.now);
});

test("a machine that is not the collector runs nobody's ask", async () => {
  const h = new Harness();
  h.rival("older-machine", h.now - 1000 * MIN);
  h.asks = [{ deviceId: "phone", askedAt: h.now - MIN, scope: "full" }];
  const s = h.session();
  await s.start();

  expect(h.generates).toBe(0);
  expect(h.retriages).toBe(0);
  // Its own older briefing must not go over the winner's either.
  expect(h.backfills).toBe(0);
});

test("a pulled source list collects now rather than at the next wake", async () => {
  const h = new Harness();
  const s = h.session();
  await s.start();
  const before = h.refreshes;
  // A request is waiting all along, so a pull that runs it when it should not is
  // a run nobody asked for on this pass.
  h.asks = [{ deviceId: "phone", askedAt: h.now, scope: "full" }];

  h.pull([SOURCES_FILE]);
  await settle();
  expect(h.foregrounds).toBe(1);
  expect(h.generates).toBe(0);
  expect(h.refreshes).toBe(before);

  h.pull(["briefing-2026-08-13.json"]);
  await settle();
  expect(h.foregrounds).toBe(1);
  expect(h.generates).toBe(0);

  h.pull(["info-ask-phone.json"]);
  await settle();
  expect(h.generates).toBe(1);
});

test("the heartbeat republishes the claim every hour and stops on the way out", async () => {
  const h = new Harness();
  const s = h.session();
  await s.start();
  const timers = [...h.timers.entries()];
  expect(timers.length).toBe(1);
  const [timerId, timer] = timers[0];
  expect(timer.ms).toBe(HEARTBEAT_MS);

  const before = h.writes.length;
  h.now += HEARTBEAT_MS;
  timer.fn();
  await settle();
  expect(h.writes.length).toBe(before + 1);
  expect(h.last().heartbeatAt).toBe(h.now);

  // A desktop being closed: the interval goes, and it goes exactly once.
  for (const exit of h.exitHandlers) exit();
  expect(h.clearedTimers).toEqual([timerId]);
});

test("a finished run is reported in the claim", async () => {
  const h = new Harness();
  const s = h.session();
  await s.start();
  expect(h.pipelineSubs.length).toBe(1);

  const before = h.writes.length;
  h.snapshot = { running: true, briefing: null, error: null };
  for (const cb of h.pipelineSubs) cb();
  await settle();
  // A run starting is not a run ending: nothing is reported until it is over.
  expect(h.writes.length).toBe(before);

  h.now += MIN;
  h.snapshot = { running: false, briefing: { date: "2026-08-13" }, error: "no provider" };
  for (const cb of h.pipelineSubs) cb();
  await settle();
  expect(h.writes.length).toBeGreaterThan(before);
  expect(h.last().lastRunAt).toBe(h.now);
  expect(h.last().lastBriefingDate).toBe("2026-08-13");
  expect(h.last().halt).toBe("no provider");
});

test("stopping gives the claim up now rather than letting it expire", async () => {
  const h = new Harness();
  const s = h.session();
  await s.start();
  expect(s.isCollecting()).toBe(true);

  h.now += MIN;
  await s.stop();
  expect(h.last().claimedAt).toBe(null);
  expect(h.last().heartbeatAt).toBe(h.now);
  expect(h.timers.size).toBe(0);
  expect(h.pulledUnsubs).toBe(2);
  expect(s.isCollecting()).toBe(false);

  // Nothing to elect: a stopped session is not the collector whatever the files
  // say, and does not read them to find out.
  h.claimReads = 0;
  expect(await s.amICollecting()).toBe(false);
  expect(h.claimReads).toBe(0);

  // And a stopped session acts on nothing that arrives afterwards.
  h.asks = [{ deviceId: "phone", askedAt: h.now, scope: "full" }];
  h.pull(["info-ask-phone.json"]);
  await settle();
  expect(h.generates).toBe(0);
});

test("starting twice is one session", async () => {
  const h = new Harness();
  const s = h.session();
  await s.start();
  const writes = h.writes.length;
  await s.start();
  expect(h.writes.length).toBe(writes);
  expect(h.timers.size).toBe(1);
  expect(h.pipelineSubs.length).toBe(1);
});

test("a restart keeps what the last session already ran and drops its standing", async () => {
  const h = new Harness();
  h.claims.set(h.deviceId, {
    deviceId: h.deviceId,
    deviceName: "kestrel",
    platform: "linux",
    hasWebviewFetch: true,
    claimedAt: h.now - 1000 * MIN,
    heartbeatAt: h.now - MIN,
    lastRunAt: h.now - 2 * MIN,
    lastBriefingDate: "2026-08-12",
    halt: "stopped",
    sources: {},
    sites: {},
    lastAskAt: h.now - 3 * MIN,
  });
  h.asks = [{ deviceId: "phone", askedAt: h.now - 4 * MIN, scope: "full" }];
  const s = h.session();
  await s.start();

  // claimedAt is this process's uptime, so the restart goes to the back of the
  // queue; lastAskAt survives, so the request it already ran is not run again.
  expect(h.last().claimedAt).toBe(h.now);
  expect(h.last().lastRunAt).toBe(h.now - 2 * MIN);
  expect(h.last().lastBriefingDate).toBe("2026-08-12");
  expect(h.generates).toBe(0);
});
