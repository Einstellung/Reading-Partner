// The info-briefing orchestrator (src/info/briefing/pipeline.ts) as a resumable
// state machine: the snapshot it exposes must carry live progress so the
// chat/vestibule UI can show a run is alive, and a run cut off halfway must come
// back without refetching what it already has. Deps are injected, so this runs
// headless — the "app was killed" tests abandon one pipeline mid-collection and
// start a second one over the same fake disk. Run: bun test.

import { expect, test } from "bun:test";
import {
  InfoPipeline,
  type InfoDeps,
  type InfoSnapshot,
  type InfoSourceRef,
} from "../../src/info/briefing/pipeline";
import type { InfoRunState } from "../../src/info/briefing/run-state";
import type { Briefing, TriageResult } from "../../src/info/briefing/types";
import type { InfoItem } from "../../src/info/sources/item";

const TODAY = "2026-07-22";

function item(id: string): InfoItem {
  return { id, source: "s", sourceName: "S", title: id, url: `https://x/${id}`, publishedAt: "" };
}

function source(id: string): InfoSourceRef {
  return { id, name: id.toUpperCase() };
}

const EMPTY_TRIAGE: TriageResult = {
  overview: "ov",
  mustRead: [],
  oneLiners: [],
  outOfLane: [],
  filtered: [],
};

// The per-day files the pipeline reads and writes, in memory. `until` lets a
// test wait for a checkpoint to land without knowing how many writes it took.
class Disk {
  runs = new Map<string, InfoRunState>();
  briefings = new Map<string, Briefing>();
  items = new Map<string, InfoItem[]>();
  private waiters: { match: (s: InfoRunState) => boolean; resolve: () => void }[] = [];

  saveRun(state: InfoRunState): void {
    this.runs.set(state.date, JSON.parse(JSON.stringify(state)) as InfoRunState);
    this.waiters = this.waiters.filter((w) => {
      if (!w.match(state)) return true;
      w.resolve();
      return false;
    });
  }

  until(match: (s: InfoRunState) => boolean): Promise<void> {
    const now = this.runs.get(TODAY);
    if (now && match(now)) return Promise.resolve();
    return new Promise((resolve) => this.waiters.push({ match, resolve }));
  }
}

interface Fixture {
  disk: Disk;
  sources: InfoSourceRef[];
  fetched: string[];
  triaged: number;
  awake: boolean[];
}

// A minimal set of injected deps over a fake disk; individual tests override
// collect/triage. The default collect settles every requested source with one
// item named after it, which is what makes "who was fetched twice" observable.
function makeDeps(fx: Fixture, over: Partial<InfoDeps> = {}): InfoDeps {
  return {
    loadBriefing: async (date) => fx.disk.briefings.get(date) ?? null,
    loadProfile: async () => "",
    loadFeedback: async () => [],
    listSources: async () => fx.sources,
    collect: async (refs, onSettled) => {
      for (const r of refs) {
        fx.fetched.push(r.id);
        await onSettled({ id: r.id, items: [item(`${r.id}1`)] });
      }
    },
    triage: async () => {
      fx.triaged += 1;
      return EMPTY_TRIAGE;
    },
    saveBriefing: async (b) => void fx.disk.briefings.set(b.date, b),
    saveArticles: async () => {},
    saveItems: async (date, items) => void fx.disk.items.set(date, items),
    loadItems: async (date) => fx.disk.items.get(date) ?? [],
    loadRun: async (date) => fx.disk.runs.get(date) ?? null,
    saveRun: async (state) => fx.disk.saveRun(state),
    clearRun: async (date) => void fx.disk.runs.delete(date),
    keepAwake: (on) => fx.awake.push(on),
    now: () => Date.now(),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    setTimer: (ms, cb) => {
      const id = setTimeout(cb, ms);
      return () => clearTimeout(id);
    },
    today: () => TODAY,
    ...over,
  };
}

function fixture(sources: InfoSourceRef[] = [source("a")], disk = new Disk()): Fixture {
  return { disk, sources, fetched: [], triaged: 0, awake: [] };
}

test("collection progress accumulates into the snapshot: total, done, failed, items, lastDone", async () => {
  const snaps: InfoSnapshot[] = [];
  const fx = fixture([source("a"), source("b"), source("c")]);
  const p = new InfoPipeline(
    makeDeps(fx, {
      collect: async (refs, onSettled) => {
        await onSettled({ id: "a", items: [item("1"), item("2"), item("3")] });
        await onSettled({ id: "b", items: [], error: "boom" });
        await onSettled({ id: "c", items: [item("4"), item("5")] });
        void refs;
      },
    }),
  );
  p.subscribe(() => snaps.push(p.snapshot()));
  await p.generate();

  const fetching = snaps.filter((s) => s.phase === "fetching" && s.collect);
  const last = fetching[fetching.length - 1];
  expect(last.collect).toEqual({ total: 3, done: 3, failed: 1, items: 5, lastDone: "C" });

  // A mid-run snapshot (after the first source, before the rest) proves it is live.
  const afterFirstDone = fetching.find((s) => s.collect!.done === 1);
  expect(afterFirstDone!.collect).toEqual({ total: 3, done: 1, failed: 0, items: 3, lastDone: "A" });
});

test("triage activity surfaces streaming char counts, then clears when finished", async () => {
  const snaps: InfoSnapshot[] = [];
  // A stepping clock so each char update clears the 250ms activity-notify throttle.
  let t = 1000;
  const fx = fixture();
  const p = new InfoPipeline(
    makeDeps(fx, {
      now: () => (t += 300),
      triage: async (_input, opts) => {
        opts.onProgress(120);
        opts.onProgress(480);
        return EMPTY_TRIAGE;
      },
    }),
  );
  p.subscribe(() => snaps.push(p.snapshot()));
  await p.generate();

  const triaging = snaps.filter((s) => s.phase === "triaging" && s.activity);
  expect(triaging.length).toBeGreaterThan(0);
  const maxChars = Math.max(...triaging.map((s) => s.activity!.chars));
  expect(maxChars).toBe(480);
  expect(triaging.every((s) => s.activity!.attempt === 1 && s.activity!.attempts === 3)).toBe(true);

  // Terminal snapshot: not running, collect/activity cleared, briefing set.
  const final = p.snapshot();
  expect(final.running).toBe(false);
  expect(final.collect).toBeNull();
  expect(final.activity).toBeNull();
  expect(final.briefing?.overview).toBe("ov");
});

test("a collect that yields no items fails the run and leaves an error", async () => {
  const fx = fixture();
  const p = new InfoPipeline(
    makeDeps(fx, { collect: async (_refs, onSettled) => void (await onSettled({ id: "a", items: [] })) }),
  );
  await p.generate();
  const s = p.snapshot();
  expect(s.running).toBe(false);
  expect(s.briefing).toBeNull();
  expect(s.error).toBeTruthy();
});

test("generate saves the day's item snapshot for a later re-triage", async () => {
  const fx = fixture([source("a"), source("b")]);
  await new InfoPipeline(makeDeps(fx)).generate();
  expect(fx.disk.items.get(TODAY)!.map((i) => i.id)).toEqual(["a1", "b1"]);
});

test("a finished run leaves no checkpoint, so the next generate collects everything again", async () => {
  const fx = fixture([source("a"), source("b")]);
  const p = new InfoPipeline(makeDeps(fx));
  await p.generate();
  expect(fx.disk.runs.get(TODAY)).toBeUndefined();
  await p.generate();
  expect(fx.fetched).toEqual(["a", "b", "a", "b"]);
});

// --- resuming an interrupted run -------------------------------------------

test("a run killed mid-collection resumes: only the source it never got is fetched", async () => {
  const fx = fixture([source("a"), source("b")]);
  // The first pipeline settles "a", then hangs forever on "b" — the app is
  // killed there, so its generate() never returns and is abandoned.
  const killed = new InfoPipeline(
    makeDeps(fx, {
      collect: async (refs, onSettled) => {
        for (const r of refs) fx.fetched.push(r.id);
        await onSettled({ id: "a", items: [item("a1")] });
        await new Promise<void>(() => {});
      },
    }),
  );
  void killed.generate();
  await fx.disk.until((s) => s.sources.some((x) => x.id === "a" && x.status === "done"));
  expect(fx.fetched).toEqual(["a", "b"]);

  const restarted = fixture(fx.sources, fx.disk);
  const p = new InfoPipeline(makeDeps(restarted));
  await p.init();

  expect(restarted.fetched).toEqual(["b"]);
  expect(restarted.disk.items.get(TODAY)!.map((i) => i.id)).toEqual(["a1", "b1"]);
  expect(restarted.disk.runs.get(TODAY)).toBeUndefined();
  expect(p.snapshot().briefing?.overview).toBe("ov");
});

test("a resumed run's progress bar carries on from the checkpoint instead of restarting", async () => {
  const fx = fixture([source("a"), source("b"), source("c")]);
  fx.disk.runs.set(TODAY, {
    version: 1,
    date: TODAY,
    startedAt: 1,
    updatedAt: 1,
    phase: "collecting",
    sources: [
      { id: "a", name: "A", status: "done", items: 1 },
      { id: "b", name: "B", status: "pending", items: 0 },
      { id: "c", name: "C", status: "pending", items: 0 },
    ],
    items: [item("a1")],
    lastSettled: "A",
  });
  const snaps: InfoSnapshot[] = [];
  const p = new InfoPipeline(makeDeps(fx));
  p.subscribe(() => snaps.push(p.snapshot()));
  await p.init();

  const first = snaps.find((s) => s.phase === "fetching" && s.collect);
  expect(first!.collect).toEqual({ total: 3, done: 1, failed: 0, items: 1, lastDone: "A" });
});

test("a run killed while triaging resumes straight into triage, collecting nothing", async () => {
  const fx = fixture([source("a")]);
  fx.disk.runs.set(TODAY, {
    version: 1,
    date: TODAY,
    startedAt: 1,
    updatedAt: 1,
    phase: "triaging",
    sources: [{ id: "a", name: "A", status: "done", items: 2 }],
    items: [item("a1"), item("a2")],
  });
  const p = new InfoPipeline(makeDeps(fx));
  await p.init();

  expect(fx.fetched).toEqual([]);
  expect(fx.triaged).toBe(1);
  expect(fx.disk.items.get(TODAY)!.map((i) => i.id)).toEqual(["a1", "a2"]);
  expect(fx.disk.runs.get(TODAY)).toBeUndefined();
});

test("an overnight leftover is not resumed, and the next generate collects the day afresh", async () => {
  const fx = fixture([source("a")]);
  fx.disk.runs.set("2026-07-21", {
    version: 1,
    date: "2026-07-21",
    startedAt: 1,
    updatedAt: 1,
    phase: "collecting",
    sources: [{ id: "a", name: "A", status: "done", items: 1 }],
    items: [item("old1")],
  });
  const p = new InfoPipeline(
    makeDeps(fx, {
      // The real prune deletes every dated info file but today's, the run
      // checkpoint included.
      pruneStaleDays: async (today) => {
        for (const date of [...fx.disk.runs.keys()]) if (date !== today) fx.disk.runs.delete(date);
      },
    }),
  );
  await p.init();
  expect(fx.fetched).toEqual([]);
  expect(fx.triaged).toBe(0);

  await p.generate();
  expect(fx.fetched).toEqual(["a"]);
  expect(fx.disk.items.get(TODAY)!.map((i) => i.id)).toEqual(["a1"]);
  expect(fx.disk.runs.get("2026-07-21")).toBeUndefined();
});

test("a stopped run is left parked, and a hand-driven generate continues it", async () => {
  const fx = fixture([source("a"), source("b")]);
  fx.disk.runs.set(TODAY, {
    version: 1,
    date: TODAY,
    startedAt: 1,
    updatedAt: 1,
    phase: "collecting",
    sources: [
      { id: "a", name: "A", status: "done", items: 1 },
      { id: "b", name: "B", status: "pending", items: 0 },
    ],
    items: [item("a1")],
    halt: { kind: "stopped" },
  });

  await new InfoPipeline(makeDeps(fx)).init();
  expect(fx.fetched).toEqual([]);
  expect(fx.triaged).toBe(0);

  await new InfoPipeline(makeDeps(fx)).generate();
  expect(fx.fetched).toEqual(["b"]);
  expect(fx.disk.items.get(TODAY)!.map((i) => i.id)).toEqual(["a1", "b1"]);
});

test("a failed run is not resumed on its own; generate retries the sources that failed", async () => {
  const fx = fixture([source("a"), source("b")]);
  const p = new InfoPipeline(
    makeDeps(fx, {
      collect: async (refs, onSettled) => {
        for (const r of refs) {
          fx.fetched.push(r.id);
          await onSettled(
            r.id === "b"
              ? { id: "b", items: [], error: "host down" }
              : { id: "a", items: [item("a1")] },
          );
        }
      },
      triage: async () => {
        fx.triaged += 1;
        throw new Error("no API key");
      },
    }),
    // No pause between the watchdog's attempts: this test is about what the
    // failure leaves on disk, not about the retrying.
    { retryDelayMs: 0 },
  );
  await p.generate();
  expect(p.snapshot().error).toContain("no API key");
  expect(fx.disk.runs.get(TODAY)!.halt).toEqual({ kind: "failed", error: "no API key" });

  // Restarting the app must not spend a second triage call unasked.
  const restarted = fixture(fx.sources, fx.disk);
  await new InfoPipeline(makeDeps(restarted)).init();
  expect(restarted.triaged).toBe(0);

  // Pressing Generate does: the source that failed gets another go, the one that
  // succeeded is not fetched again.
  await new InfoPipeline(makeDeps(restarted)).generate();
  expect(restarted.fetched).toEqual(["b"]);
  expect(restarted.disk.items.get(TODAY)!.map((i) => i.id)).toEqual(["a1", "b1"]);
});

test("a source subscribed to after the run started joins it; one removed is dropped", async () => {
  const fx = fixture([source("a"), source("c")]);
  fx.disk.runs.set(TODAY, {
    version: 1,
    date: TODAY,
    startedAt: 1,
    updatedAt: 1,
    phase: "collecting",
    sources: [
      { id: "a", name: "A", status: "done", items: 1 },
      { id: "b", name: "B", status: "pending", items: 0 },
    ],
    items: [item("a1")],
  });
  await new InfoPipeline(makeDeps(fx)).generate();
  expect(fx.fetched).toEqual(["c"]);
});

test("flush writes a checkpoint a failed write left behind", async () => {
  const fx = fixture([source("a"), source("b")]);
  let failNextWrite = true;
  const p = new InfoPipeline(
    makeDeps(fx, {
      saveRun: async (state) => {
        if (failNextWrite) {
          failNextWrite = false;
          throw new Error("disk full");
        }
        fx.disk.saveRun(state);
      },
      collect: async (refs, onSettled) => {
        for (const r of refs) fx.fetched.push(r.id);
        await onSettled({ id: "a", items: [item("a1")] });
        // The app goes to the background here, then never comes back.
        await p.flush();
        await new Promise<void>(() => {});
      },
    }),
  );
  void p.generate();
  await fx.disk.until((s) => s.sources.some((x) => x.id === "a" && x.status === "done"));
  expect(fx.disk.runs.get(TODAY)!.items.map((i) => i.id)).toEqual(["a1"]);
});

test("the screen wake lock is held for the run and released however it ends", async () => {
  const fx = fixture();
  await new InfoPipeline(makeDeps(fx)).generate();
  expect(fx.awake).toEqual([true, false]);

  const failed = fixture();
  await new InfoPipeline(
    makeDeps(failed, {
      triage: async () => {
        throw new Error("boom");
      },
    }),
    { retryDelayMs: 0 },
  ).generate();
  expect(failed.awake).toEqual([true, false]);
});

// --- re-triage and the rest -------------------------------------------------

test("retriage re-triages the cached snapshot without collecting, skipping the fetching phase", async () => {
  const fx = fixture();
  fx.disk.items.set(TODAY, [item("1"), item("2")]);
  const snaps: InfoSnapshot[] = [];
  const p = new InfoPipeline(
    makeDeps(fx, {
      triage: async () => ({ ...EMPTY_TRIAGE, overview: "re-triaged", mustRead: [{ itemId: "1", reason: "r" }] }),
    }),
  );
  p.subscribe(() => snaps.push(p.snapshot()));
  await p.retriage();

  expect(fx.fetched).toEqual([]);
  expect(snaps.some((s) => s.phase === "fetching")).toBe(false);
  const final = p.snapshot();
  expect(final.running).toBe(false);
  expect(final.briefing?.overview).toBe("re-triaged");
  expect(final.briefing?.mustRead.map((r) => r.itemId)).toEqual(["1"]);
});

test("retriage with no cached items errors instead of producing a briefing", async () => {
  const fx = fixture();
  const p = new InfoPipeline(makeDeps(fx));
  await p.retriage();
  const s = p.snapshot();
  expect(s.running).toBe(false);
  expect(s.briefing).toBeNull();
  expect(s.error).toBeTruthy();
});

test("generate prunes past days before collecting; retriage never prunes", async () => {
  const order: string[] = [];
  const pruned: string[] = [];
  const fx = fixture();
  fx.disk.items.set(TODAY, [item("1")]);
  const deps = makeDeps(fx, {
    pruneStaleDays: async (today) => {
      order.push("prune");
      pruned.push(today);
    },
    collect: async (refs, onSettled) => {
      order.push("collect");
      for (const r of refs) await onSettled({ id: r.id, items: [item("1")] });
    },
  });

  await new InfoPipeline(deps).generate();
  expect(order).toEqual(["prune", "collect"]);
  expect(pruned).toEqual([TODAY]);

  await new InfoPipeline(deps).retriage();
  expect(pruned).toEqual([TODAY]);
});

test("a failing prune does not stop the briefing", async () => {
  const fx = fixture();
  const p = new InfoPipeline(
    makeDeps(fx, {
      pruneStaleDays: async () => {
        throw new Error("readDir denied");
      },
      triage: async () => ({ ...EMPTY_TRIAGE, overview: "ok" }),
    }),
  );
  await p.generate();
  const s = p.snapshot();
  expect(s.error).toBeNull();
  expect(s.briefing?.overview).toBe("ok");
});

test("the reading-side context is loaded and passed into triage", async () => {
  let seen: string | undefined = "unset";
  const fx = fixture();
  const p = new InfoPipeline(
    makeDeps(fx, {
      loadReaderContext: async () => "Reading recently:\n- T: on ch.4",
      triage: async (input) => {
        seen = input.readerContext;
        return EMPTY_TRIAGE;
      },
    }),
  );
  await p.generate();
  expect(seen).toBe("Reading recently:\n- T: on ch.4");
});

test("a failing reader-context dep degrades to empty and still triages", async () => {
  let seen: string | undefined = "unset";
  const fx = fixture();
  const p = new InfoPipeline(
    makeDeps(fx, {
      loadReaderContext: async () => {
        throw new Error("boom");
      },
      triage: async (input) => {
        seen = input.readerContext;
        return { ...EMPTY_TRIAGE, overview: "ok" };
      },
    }),
  );
  await p.generate();
  expect(seen).toBe("");
  expect(p.snapshot().briefing?.overview).toBe("ok");
});
