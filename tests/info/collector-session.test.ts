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
  CLAIM_SYNC_GRACE_MS,
  HEARTBEAT_MS,
  type AskRecord,
  type CollectorClaim,
} from "../../src/info/briefing/handoff";

const SOURCES_FILE = "info-sources.json";
const MIN = 60_000;

// Everything the session talks to, in memory. The claim files are a map keyed by
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
  pulledSubs: ((paths: string[]) => void)[] = [];
  pulledUnsubs = 0;
  syncSubs: ((s: SessionSyncStatus) => void)[] = [];
  refreshes = 0;
  foregrounds = 0;
  inits = 0;
  generates = 0;
  retriages = 0;
  backfills = 0;
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
      sourcesFile: SOURCES_FILE,
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
      subscribePulled: (cb) => {
        this.pulledSubs.push(cb);
        return () => {
          this.pulledUnsubs += 1;
        };
      },
      onExit: (cb) => {
        this.exitHandlers.push(cb);
      },
      backfillPublish: async () => {
        this.backfills += 1;
      },
      pipeline: () => ({
        init: async () => {
          this.inits += 1;
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
          this.refreshes += 1;
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

  pull(paths: string[]): void {
    for (const cb of this.pulledSubs) cb(paths);
  }

  syncStatus(s: SessionSyncStatus): void {
    for (const cb of this.syncSubs) cb(s);
  }
}

// Everything the session does off a pull or a timer is fire-and-forget, so a test
// that wants to see the end of it has to leave the microtask queue.
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

test("a willing machine takes the claim and tells the collector and the pipeline", async () => {
  const h = new Harness();
  const s = h.session();
  await s.start();

  expect(h.last().claimedAt).toBe(h.now);
  expect(h.last().deviceName).toBe("kestrel");
  // Taking the claim publishes the briefing already on disk, wakes the polling
  // that had declined to schedule itself, and gives the pipeline its second
  // chance — a machine that just started claiming asked all three and got no.
  expect(h.backfills).toBe(1);
  expect(h.refreshes).toBe(1);
  expect(h.inits).toBeGreaterThan(0);
  expect(await s.amICollecting()).toBe(true);
});

test("an unwilling machine writes a heartbeat and no claim", async () => {
  const h = new Harness();
  h.backgroundCollect = false;
  const s = h.session();
  await s.start();

  expect(h.last().claimedAt).toBe(null);
  expect(h.last().heartbeatAt).toBe(h.now);
  expect(h.backfills).toBe(0);
  expect(h.refreshes).toBe(0);
  expect(await s.amICollecting()).toBe(false);
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
  expect(h.pulledUnsubs).toBe(1);
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
