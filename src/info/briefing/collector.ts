// Background collection (docs/35): the thing that keeps the pool stocked.
//
// Collection used to be the first phase of generating a briefing — one pass over
// every source, once a day. That loses most of what a short feed published: a
// Bloomberg section feed holds 20 items covering as little as six hours. So
// polling is its own activity now, on each source's own interval, and generating
// a briefing draws from what the polling has already brought in.
//
// It has to survive being left alone. On the desktop that is the normal state
// of a collector (docs/36): the window is minimised or behind something else
// while its owner reads on a phone, and the polling has to go on through it.
// Only the page going away stops the schedule — see suspend().
//
// It has to survive a phone too. A backgrounded webview stops running JavaScript,
// and iOS may suspend or kill it outright, so a timer is a hint and nothing
// more: whether a source is due is answered from the clock and the last-polled
// timestamps on disk, and coming back to the foreground always runs a cycle. A
// device that was away for six hours catches up in one pass; one that was away
// for six minutes does nothing.
//
// It also owns the one in-memory copy of the pool, because the briefing pipeline
// draws from the same pool it fills. Deps are injected, so the whole thing runs
// headless in tests with a fake clock and no network.

import {
  addDiscovered,
  drawForDay,
  emptyPool,
  dueSources,
  evict,
  markPolled,
  nextPollDelay,
  poolSize,
  recordRun,
  unstockedSources,
  type Pool,
  type PoolRecord,
} from "./item-pool";
import type { RunSeed } from "./run-state";
import type { CachedArticle } from "./store";
import type { SourceDescriptor } from "../sources/descriptor";
import type { InfoItem } from "../sources/item";

// The band a scheduled wake is held to. The floor keeps a source whose interval
// is somehow zero from spinning; the ceiling bounds how stale the schedule can
// get on a desktop that stays open for days, where nothing else re-checks it.
export const MIN_WAKE_MS = 60_000;
export const MAX_WAKE_MS = 30 * 60_000;

export interface CollectorDeps {
  loadPool(): Promise<Pool>;
  savePoolDay(date: string, items: InfoItem[]): Promise<void>;
  savePoolMarks(pool: Pool): Promise<void>;
  savePoolPolled(pool: Pool): Promise<void>;
  removePoolDays(dates: string[]): Promise<void>;
  // Every subscribed source, enabled or not. Disabled ones are filtered here so
  // the schedule and the pool agree on who counts.
  listSources(): Promise<SourceDescriptor[]>;
  // Run the given sources' discovery layer — headlines only, one request each.
  // Per-source isolation belongs to the caller: a source that fails contributes
  // nothing and never sinks the cycle.
  poll(sources: SourceDescriptor[], signal: AbortSignal): Promise<InfoItem[]>;
  // The bodies a day's article cache already holds, so a run that draws an item
  // it fetched hours ago reads the text instead of fetching it again.
  loadBodies(date: string): Promise<Record<string, CachedArticle>>;
  // The background-collection setting. Read per cycle, so turning it off stops
  // the next one rather than waiting for a restart.
  backgroundOn(): Promise<boolean>;
  // Whether a briefing run is in flight. A cycle steps aside for one instead of
  // putting a second round of requests on the same feeds.
  busy(): boolean;
  now(): number;
  today(): string;
  setTimer(ms: number, cb: () => void): () => void;
  // One line per cycle, for events-info.jsonl. Optional: instrumentation never
  // decides whether a poll happens.
  log?(data: Record<string, number>): void;
}

export class InfoCollector {
  private pool: Pool | null = null;
  private loading: Promise<Pool> | null = null;
  private cancelTimer: (() => void) | null = null;
  private running = false;
  private started = false;
  private controller: AbortController | null = null;
  // Serializes the pool's writers: a cycle and a run's discovery can both be
  // adding to today's file, and the copy that must survive is the later state,
  // not whichever write happens to land last.
  private writing: Promise<void> = Promise.resolve();

  constructor(private readonly deps: CollectorDeps) {}

  // The pool, loaded once. Everything else here goes through this, so a cold
  // start reads the files a single time however many callers arrive at once.
  ready(): Promise<Pool> {
    if (this.pool) return Promise.resolve(this.pool);
    if (!this.loading) {
      this.loading = this.deps
        .loadPool()
        .then((p) => {
          this.pool = p;
          return p;
        })
        .catch(() => {
          // An unreadable pool is an empty pool: the run collects the way it did
          // before the pool existed, which is slower, not broken.
          this.pool = this.pool ?? emptyPool();
          return this.pool;
        });
    }
    return this.loading;
  }

  // --- filling ---------------------------------------------------------------

  // File what a poll or a run's discovery brought back. Only the day's file is
  // written, and only when something was actually new.
  async ingest(items: InfoItem[]): Promise<void> {
    if (items.length === 0) return;
    const pool = await this.ready();
    const today = this.deps.today();
    const { pool: next, added } = addDiscovered(pool, items, today);
    if (added.length === 0) return;
    this.pool = next;
    await this.write(() => this.deps.savePoolDay(today, next.days[today] ?? []));
  }

  // Which of these sources a run should actually request. With background
  // collection on, the pool is being kept fresh on each source's own schedule,
  // so a run polls only what is genuinely due and takes the rest from the pool.
  // `force` is the user asking by hand — a regenerate means "go and look", and
  // a schedule is no answer to that.
  async toPoll(
    sources: SourceDescriptor[],
    opts: { force: boolean },
  ): Promise<{ poll: SourceDescriptor[]; skip: SourceDescriptor[] }> {
    if (opts.force || !(await this.on())) return { poll: sources, skip: [] };
    const pool = await this.ready();
    const due = new Set(dueSources(sources, pool, this.deps.now()).map((d) => d.id));
    // A source the pool holds nothing for is polled whatever its schedule says.
    // Skipping it would be trusting the pool with the day's material, and the
    // pool is a saving: a day file that would not load, or a subscription made
    // while collection was off, must cost a request and not the briefing.
    for (const d of unstockedSources(sources, pool)) due.add(d.id);
    return {
      poll: sources.filter((d) => due.has(d.id)),
      skip: sources.filter((d) => !due.has(d.id)),
    };
  }

  // Record that these sources were just polled, whoever polled them. An aborted
  // poll is not a poll: the abort is answered by resolving with whatever had
  // already settled, not by throwing, so the caller passes its signal here to
  // say so. Marking them polled would sit on sources that returned nothing for
  // a whole interval — three hours, on the slowest of them.
  async notePolled(sourceIds: string[], signal?: AbortSignal): Promise<void> {
    if (sourceIds.length === 0 || signal?.aborted) return;
    const pool = await this.ready();
    this.pool = markPolled(pool, sourceIds, this.deps.now());
    const next = this.pool;
    await this.write(() => this.deps.savePoolPolled(next));
  }

  // --- draining --------------------------------------------------------------

  // The day's candidates, with what the pool already knows about them, in the
  // shape a run is seeded from. Aging out happens here as well as in a cycle, so
  // a device that only ever opens the app still expires its old days.
  async draw(date: string): Promise<RunSeed> {
    await this.sweep();
    const pool = await this.ready();
    const seed = drawForDay(pool, date);
    const bodies: Record<string, CachedArticle> = {};
    if (seed.bodied.length > 0) {
      // The text itself is not in the pool — bodies belong to the day's article
      // cache — so the ids are resolved against it here. One that is not there
      // any more simply gets fetched again.
      let cached: Record<string, CachedArticle> = {};
      try {
        cached = await this.deps.loadBodies(date);
      } catch {
        cached = {};
      }
      for (const id of seed.bodied) {
        const body = cached[id];
        if (body && (body.textContent || body.contentHtml)) bodies[id] = body;
      }
    }
    return { items: seed.items, verdicts: seed.verdicts, bodies, settled: seed.settled };
  }

  // Fold a finished (or checkpointed) run's outcome into the pool.
  async record(date: string, record: PoolRecord): Promise<void> {
    const pool = await this.ready();
    this.pool = recordRun(pool, date, record);
    const next = this.pool;
    await this.write(() => this.deps.savePoolMarks(next));
  }

  // Drop what has aged out and delete the day files that went with it.
  async sweep(): Promise<void> {
    const pool = await this.ready();
    let known: string[] = [];
    try {
      known = (await this.deps.listSources()).map((d) => d.id);
    } catch {
      known = Object.keys(pool.lastPolled);
    }
    const { pool: next, droppedDays } = evict(pool, this.deps.today(), known);
    if (next === pool) return;
    this.pool = next;
    await this.write(async () => {
      if (droppedDays.length) await this.deps.removePoolDays(droppedDays);
      await this.deps.savePoolMarks(next);
      await this.deps.savePoolPolled(next);
    });
  }

  // --- the schedule ----------------------------------------------------------

  // Begin polling. Idempotent, so the settings screen can call it on every
  // keystroke; a cycle runs at once (the app just opened, or collection was just
  // turned on) and the next wake is scheduled from what the pool holds.
  start(): void {
    if (this.started) return;
    this.started = true;
    void this.cycle();
  }

  stop(): void {
    this.started = false;
    this.cancelTimer?.();
    this.cancelTimer = null;
    this.controller?.abort();
    this.controller = null;
  }

  // Back in front of the user. Whatever the timers did or did not do while the
  // webview was suspended, the clock is the truth: run a cycle, which polls
  // exactly what is now due and nothing else.
  foreground(): void {
    if (!this.started) return;
    this.cancelTimer?.();
    this.cancelTimer = null;
    void this.cycle();
  }

  // The page is going away: the app is quitting, or iOS is about to suspend the
  // webview. Both things here are about that and only that — a timer that will
  // not fire is dropped, and a request that would hang unanswered in a suspended
  // process is aborted.
  //
  // Not the same edge as leaving the foreground (docs/36). A desktop window that
  // lost focus, or sits minimised while its owner reads on a phone, is the state
  // background collection exists for: its timers keep running and its in-flight
  // poll is a request already paid for, which an abort would throw away without
  // even marking the source polled. Whoever wires this up wires it to
  // observeAppExit, never to onBackground.
  suspend(): void {
    this.cancelTimer?.();
    this.cancelTimer = null;
    this.controller?.abort();
    this.controller = null;
  }

  // Turn polling on or off from the current setting.
  async refresh(): Promise<void> {
    if (await this.on()) this.start();
    else this.stop();
  }

  // One pass: poll what is due, file what came back, schedule the next wake.
  private async cycle(): Promise<void> {
    if (this.running) return;
    this.running = true;
    const startedAt = this.deps.now();
    let polled = 0;
    let added = 0;
    try {
      if (!this.started) return;
      if (!(await this.on())) {
        this.stop();
        return;
      }
      // A generation is already talking to these feeds; a second round of
      // requests on top of it buys nothing and costs the reader's bandwidth.
      if (this.deps.busy()) return;
      await this.sweep();
      const sources = (await this.deps.listSources()).filter((d) => d.enabled);
      const pool = await this.ready();
      const due = dueSources(sources, pool, this.deps.now());
      if (due.length > 0) {
        // Held locally as well, because the field is cleared by whoever aborts
        // and the answer to "was this cycle interrupted" has to survive that.
        const controller = new AbortController();
        this.controller = controller;
        const items = await this.deps.poll(due, controller.signal);
        if (this.controller === controller) this.controller = null;
        polled = due.length;
        const before = poolSize(await this.ready()).items;
        // Whatever settled before the abort is free material; only the marking
        // is withheld, so the next cycle asks these sources again.
        await this.ingest(items);
        added = poolSize(await this.ready()).items - before;
        await this.notePolled(
          due.map((d) => d.id),
          controller.signal,
        );
      }
    } catch (e) {
      // A cycle that fails costs one round of headlines; the next one tries the
      // same sources, since a failed poll never marks them polled.
      console.warn("background collection cycle failed", e);
    } finally {
      this.running = false;
      if (polled > 0) {
        this.deps.log?.({
          ms: Math.round(this.deps.now() - startedAt),
          sources: polled,
          added,
          pool: poolSize(this.pool ?? (await this.ready())).items,
        });
      }
      await this.schedule();
    }
  }

  private async schedule(): Promise<void> {
    if (!this.started) return;
    this.cancelTimer?.();
    let delay = MAX_WAKE_MS;
    try {
      const sources = (await this.deps.listSources()).filter((d) => d.enabled);
      delay = nextPollDelay(sources, await this.ready(), this.deps.now(), {
        min: MIN_WAKE_MS,
        max: MAX_WAKE_MS,
      });
    } catch {
      // Fall back to the ceiling; the next cycle recomputes it properly.
    }
    if (!this.started) return;
    this.cancelTimer = this.deps.setTimer(delay, () => {
      this.cancelTimer = null;
      void this.cycle();
    });
  }

  private async on(): Promise<boolean> {
    try {
      return await this.deps.backgroundOn();
    } catch {
      return false;
    }
  }

  // Chain the writes rather than just awaiting them: two callers can be holding
  // the pool at once, and the state that must end up on disk is the later one.
  private write(fn: () => Promise<void>): Promise<void> {
    this.writing = this.writing.then(fn).catch((e) => {
      console.warn("failed to persist the item pool", e);
    });
    return this.writing;
  }
}
