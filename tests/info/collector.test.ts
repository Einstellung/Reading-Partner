// Background collection (src/info/briefing/collector.ts): the polling that keeps
// the pool stocked so a briefing is not limited to whatever the feeds happen to
// be showing when it runs. Deps are injected, so this runs with a fake clock,
// fake timers and no network — the point being that the schedule is decided from
// the clock and what is on disk, never from a timer having fired, because on a
// phone it will not have. Run: bun test.

import { expect, test } from "bun:test";
import {
  collectorStatusLine,
  InfoCollector,
  type CollectorDeps,
  type CollectorStatus,
} from "../../src/info/briefing/collector";
import { emptyPool, type Pool } from "../../src/info/briefing/item-pool";
import type { CachedArticle } from "../../src/info/briefing/store";
import type { SourceDescriptor } from "../../src/info/sources/descriptor";
import type { InfoItem } from "../../src/info/sources/item";

const MIN = 60_000;

function item(id: string, source = "s"): InfoItem {
  return { id, source, sourceName: source.toUpperCase(), title: id, url: `https://x/${id}`, publishedAt: "" };
}

function source(id: string, pollMinutes: number): SourceDescriptor {
  return {
    id,
    name: id,
    line: "AI",
    enabled: true,
    pollMinutes,
    discovery: { kind: "feed", url: `https://${id}/feed` },
    fulltext: { mode: "none" },
  };
}

// The pool's files in memory, plus a fake clock and a timer queue a test fires
// by hand — nothing here waits on real time.
class Harness {
  pool: Pool = emptyPool();
  days = new Map<string, InfoItem[]>();
  removed: string[] = [];
  markWrites = 0;
  polledWrites = 0;
  sources: SourceDescriptor[] = [];
  bodies: Record<string, CachedArticle> = {};
  on = true;
  busy = false;
  now = 1_000 * MIN;
  today = "2026-08-11";
  // Every poll, as the source ids it was given.
  polls: string[][] = [];
  yields = new Map<string, InfoItem[]>();
  fails = new Set<string>();
  timer: { at: number; cb: () => void } | null = null;
  logs: Record<string, number>[] = [];
  statuses: CollectorStatus[] = [];
  // With this set, a poll parks instead of returning, so a test can act while a
  // request is in flight — which is where an abort actually lands. It resolves
  // when released, never throws: collectAll answers an abort by handing back
  // whatever settled first, and a source that did not settle simply yields
  // nothing.
  hold = false;
  private waiting: Array<() => void> = [];

  deps(): CollectorDeps {
    return {
      loadPool: async () => this.pool,
      savePoolDay: async (date, items) => void this.days.set(date, items),
      savePoolMarks: async () => void this.markWrites++,
      savePoolPolled: async () => void this.polledWrites++,
      removePoolDays: async (dates) => void this.removed.push(...dates),
      listSources: async () => this.sources,
      poll: async (sources) => {
        this.polls.push(sources.map((d) => d.id));
        if (this.hold) await new Promise<void>((r) => this.waiting.push(r));
        const out: InfoItem[] = [];
        for (const d of sources) {
          if (this.fails.has(d.id)) throw new Error(`${d.id} is down`);
          out.push(...(this.yields.get(d.id) ?? []));
        }
        return out;
      },
      loadBodies: async () => this.bodies,
      backgroundOn: async () => this.on,
      busy: () => this.busy,
      now: () => this.now,
      today: () => this.today,
      setTimer: (ms, cb) => {
        this.timer = { at: this.now + ms, cb };
        return () => {
          this.timer = null;
        };
      },
      log: (data) => void this.logs.push(data),
      onStatus: (status) => void this.statuses.push(status),
    };
  }

  // Let the parked polls return, and let what they fed into run to a stop.
  async release(): Promise<void> {
    const waiting = this.waiting;
    this.waiting = [];
    this.hold = false;
    for (const r of waiting) r();
    await settle();
  }

  // Move the clock forward and fire the pending timer if it has come due, the
  // way a device that stayed awake would.
  async tick(ms: number): Promise<void> {
    this.now += ms;
    const t = this.timer;
    if (t && t.at <= this.now) {
      this.timer = null;
      t.cb();
    }
    await settle();
  }
}

// The collector's cycles are async and fired from timers, so a test waits for
// the microtask queue to drain rather than for a promise it cannot name.
function settle(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0));
}

test("a cycle polls only the sources that are due and files what they brought back", async () => {
  const h = new Harness();
  h.sources = [source("fast", 30), source("slow", 720)];
  h.yields.set("fast", [item("f1", "fast")]);
  h.yields.set("slow", [item("s1", "slow")]);
  const c = new InfoCollector(h.deps());

  c.start();
  await settle();
  // Nothing has ever been polled, so the first pass takes everything.
  expect(h.polls).toEqual([["fast", "slow"]]);
  expect(h.days.get("2026-08-11")!.map((it) => it.id)).toEqual(["f1", "s1"]);

  h.yields.set("fast", [item("f1", "fast"), item("f2", "fast")]);
  await h.tick(31 * MIN);
  // Only the 30-minute source came due; the 12-hour one is left alone. And the
  // headline it had already brought back is not stored a second time.
  expect(h.polls[1]).toEqual(["fast"]);
  expect(h.days.get("2026-08-11")!.map((it) => it.id)).toEqual(["f1", "s1", "f2"]);
});

test("a suspended webview catches up on the way back in, without a timer having fired", async () => {
  const h = new Harness();
  h.sources = [source("fast", 30), source("slow", 720)];
  const c = new InfoCollector(h.deps());
  c.start();
  await settle();
  expect(h.polls.length).toBe(1);

  // The page goes away; iOS suspends it. No timer runs for six hours.
  c.suspend();
  expect(h.timer).toBeNull();
  h.now += 6 * 60 * MIN;

  c.foreground();
  await settle();
  // The clock says the 30-minute source is long overdue and the 12-hour one is
  // not, and that is the whole answer — nothing counted ticks.
  expect(h.polls[1]).toEqual(["fast"]);
});

test("a cycle with nothing due sends no request and still schedules the next one", async () => {
  const h = new Harness();
  h.sources = [source("slow", 720)];
  const c = new InfoCollector(h.deps());
  c.start();
  await settle();
  const before = h.polls.length;
  await h.tick(31 * MIN);
  expect(h.polls.length).toBe(before);
  expect(h.timer).not.toBeNull();
});

test("collection turned off polls nothing, and turning it back on starts at once", async () => {
  const h = new Harness();
  h.on = false;
  h.sources = [source("fast", 30)];
  const c = new InfoCollector(h.deps());

  await c.refresh();
  await settle();
  expect(h.polls).toEqual([]);
  expect(h.timer).toBeNull();

  h.on = true;
  await c.refresh();
  await settle();
  expect(h.polls).toEqual([["fast"]]);
});

test("a cycle steps aside for a briefing run rather than putting a second round of requests on the same feeds", async () => {
  const h = new Harness();
  h.sources = [source("fast", 30)];
  h.busy = true;
  const c = new InfoCollector(h.deps());
  c.start();
  await settle();
  expect(h.polls).toEqual([]);

  h.busy = false;
  await h.tick(MIN);
  expect(h.polls).toEqual([["fast"]]);
});

test("a poll that failed does not count as polled, so the next cycle tries it again", async () => {
  const h = new Harness();
  h.sources = [source("fast", 30)];
  h.fails.add("fast");
  const c = new InfoCollector(h.deps());
  c.start();
  await settle();
  expect(h.polls).toEqual([["fast"]]);

  h.fails.clear();
  h.yields.set("fast", [item("f1", "fast")]);
  await h.tick(2 * MIN);
  expect(h.polls[1]).toEqual(["fast"]);
  expect(h.days.get("2026-08-11")!.map((it) => it.id)).toEqual(["f1"]);
});

test("a cycle the app interrupted does not count as polled, and comes back a minute later", async () => {
  const h = new Harness();
  h.sources = [source("fast", 30), source("slow", 180)];
  h.hold = true;
  // "fast" settled before the app went away; "slow" was still in flight, and an
  // abort brings it back empty rather than as an error.
  h.yields.set("fast", [item("f1", "fast")]);
  const c = new InfoCollector(h.deps());

  c.start();
  await settle();
  expect(h.polls).toEqual([["fast", "slow"]]);

  // The page goes away — on iOS that is a backgrounded app — with the request
  // still in flight. Losing the desktop window's focus is not this edge and
  // leaves the request alone (docs/36).
  c.suspend();
  await h.release();

  // The headlines that did settle are kept: they cost a request already.
  expect(h.days.get("2026-08-11")!.map((it) => it.id)).toEqual(["f1"]);
  // Nothing is marked polled, though. This cycle collected almost none of what
  // it asked for, and treating it as done would sit on "slow" for three hours.
  expect(h.polledWrites).toBe(0);
  expect((await c.toPoll(h.sources, { force: false })).poll.map((d) => d.id)).toEqual([
    "fast",
    "slow",
  ]);

  // Which is why nothing else has to remember the interrupted cycle: the wake
  // the unmarked sources ask for is immediate, held to the floor.
  expect(h.timer!.at).toBe(h.now + MIN);
  await h.tick(MIN);
  expect(h.polls[1]).toEqual(["fast", "slow"]);
  expect(h.polledWrites).toBe(1);
});

test("a run the user stopped leaves its sources unpolled too", async () => {
  const h = new Harness();
  h.sources = [source("fast", 30), source("slow", 180)];
  const c = new InfoCollector(h.deps());
  const stop = new AbortController();

  // The shape of a run's discovery (live.ts): each source goes into the pool as
  // it settles, and the batch is marked polled at the end.
  await c.ingest([item("f1", "fast")]);
  stop.abort();
  await c.notePolled(["fast", "slow"], stop.signal);

  expect(h.polledWrites).toBe(0);
  expect(h.days.get("2026-08-11")!.map((it) => it.id)).toEqual(["f1"]);
  expect((await c.toPoll(h.sources, { force: false })).poll.map((d) => d.id)).toEqual([
    "fast",
    "slow",
  ]);
});

test("the draw resolves already-fetched bodies against the day's article cache, and drops the ones that are gone", async () => {
  const h = new Harness();
  const c = new InfoCollector(h.deps());
  await c.ingest([item("kept"), item("lost")]);
  await c.record("2026-08-11", {
    verdicts: {
      kept: { id: "kept", keep: true, why: "", confidence: 3 },
      lost: { id: "lost", keep: true, why: "", confidence: 3 },
    },
    bodies: ["kept", "lost"],
  });
  h.bodies = { kept: { textContent: "the body" } };

  const seed = await c.draw("2026-08-11");
  expect(seed.items.map((it) => it.id)).toEqual(["kept", "lost"]);
  expect(Object.keys(seed.bodies)).toEqual(["kept"]);
  expect(seed.bodies["kept"].textContent).toBe("the body");
  // Carried verdicts mean the screen never sees either of them again.
  expect(seed.verdicts["lost"].keep).toBe(true);
});

test("drawing sweeps first, so a device that only ever opens the app still expires its old days", async () => {
  const h = new Harness();
  h.sources = [source("fast", 30)];
  h.today = "2026-08-01";
  const c = new InfoCollector(h.deps());
  await c.ingest([item("ancient")]);
  h.today = "2026-08-11";

  await c.draw("2026-08-11");
  expect(h.removed).toEqual(["2026-08-01"]);
  expect((await c.draw("2026-08-11")).items).toEqual([]);
});

test("a cycle logs what it polled and what it added, and stays quiet when it polled nothing", async () => {
  const h = new Harness();
  h.sources = [source("fast", 30)];
  h.yields.set("fast", [item("f1", "fast")]);
  const c = new InfoCollector(h.deps());
  c.start();
  await settle();
  expect(h.logs).toEqual([{ ms: 0, sources: 1, added: 1, pool: 1 }]);

  await h.tick(MIN);
  expect(h.logs.length).toBe(1);
});

// --- what a briefing run still has to request --------------------------------

test("a run takes the sources the background already polled out of the pool instead of asking again", async () => {
  const h = new Harness();
  h.sources = [source("fast", 30), source("slow", 240)];
  h.yields.set("fast", [item("f1", "fast")]);
  h.yields.set("slow", [item("s1", "slow")]);
  const c = new InfoCollector(h.deps());
  c.start();
  await settle();
  expect(h.polls[0]).toEqual(["fast", "slow"]);

  // An hour on: "fast" is due again, "slow" is not and its items are in the pool.
  h.now += 60 * MIN;
  const { poll, skip } = await c.toPoll(h.sources, { force: false });
  expect(poll.map((d) => d.id)).toEqual(["fast"]);
  expect(skip.map((d) => d.id)).toEqual(["slow"]);
});

test("a regenerate the user asked for goes and looks, whatever the schedule says", async () => {
  const h = new Harness();
  h.sources = [source("fast", 30), source("slow", 240)];
  h.yields.set("fast", [item("f1", "fast")]);
  h.yields.set("slow", [item("s1", "slow")]);
  const c = new InfoCollector(h.deps());
  c.start();
  await settle();

  const { poll, skip } = await c.toPoll(h.sources, { force: true });
  expect(poll.map((d) => d.id)).toEqual(["fast", "slow"]);
  expect(skip).toEqual([]);
});

test("collection turned off leaves the run polling everything itself", async () => {
  const h = new Harness();
  h.sources = [source("fast", 30)];
  h.on = false;
  const c = new InfoCollector(h.deps());
  expect((await c.toPoll(h.sources, { force: false })).poll.map((d) => d.id)).toEqual(["fast"]);
});

test("a source the pool is holding nothing for is polled even when its schedule says otherwise", async () => {
  const h = new Harness();
  h.sources = [source("fast", 30), source("empty", 240)];
  h.yields.set("fast", [item("f1", "fast")]);
  const c = new InfoCollector(h.deps());
  c.start();
  await settle();
  h.now += MIN;

  // Both were just polled, but "empty" brought nothing back — a source whose day
  // file went missing looks exactly the same, and the run must not go hungry for
  // it. A lost pool costs a request, never the briefing.
  const { poll, skip } = await c.toPoll(h.sources, { force: false });
  expect(poll.map((d) => d.id)).toEqual(["empty"]);
  expect(skip.map((d) => d.id)).toEqual(["fast"]);
});

// --- what the tray is told ---------------------------------------------------

test("the schedule reports where it stands, and the last poll comes off the pool", async () => {
  const h = new Harness();
  h.sources = [source("fast", 30)];
  const c = new InfoCollector(h.deps());

  c.start();
  await settle();
  // Turning on is said at once, before a cycle has run — the pool is not even
  // loaded yet, so nothing has been collected as far as anyone can tell.
  expect(h.statuses[0]).toEqual({ collecting: true, lastPollAt: null });
  // And once the cycle lands, the time the poll went out.
  expect(h.statuses[h.statuses.length - 1]).toEqual({ collecting: true, lastPollAt: h.now });

  h.on = false;
  await c.refresh();
  expect(h.statuses[h.statuses.length - 1].collecting).toBe(false);
});

test("the status line names the time of day, and the date only when it is not today", () => {
  const now = new Date(2026, 7, 12, 21, 30).getTime();

  expect(collectorStatusLine({ collecting: false, lastPollAt: now }, now)).toBe(
    "Collection is off",
  );
  expect(collectorStatusLine({ collecting: true, lastPollAt: null }, now)).toBe(
    "Nothing collected yet",
  );
  expect(
    collectorStatusLine(
      { collecting: true, lastPollAt: new Date(2026, 7, 12, 9, 5).getTime() },
      now,
    ),
  ).toBe("Last collected 09:05");
  // A machine left running with collection just switched back on can be hours or
  // days past its last poll, and "Last collected 09:05" would read as this
  // morning's.
  expect(
    collectorStatusLine(
      { collecting: true, lastPollAt: new Date(2026, 7, 9, 9, 5).getTime() },
      now,
    ),
  ).toBe("Last collected 2026-08-09 09:05");
});
