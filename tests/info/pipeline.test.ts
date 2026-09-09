// The day's run (src/info/boxes/pipeline.ts) as a resumable state machine: the
// snapshot it exposes must carry live progress so the chat/vestibule UI can show
// a run is alive, and a run cut off halfway must come back without paying again
// for what it already has — in any of the funnel's four phases (docs/35), the
// per-room analysis included (docs/63). Deps are injected, so this runs headless
// — the "app was killed" tests abandon one pipeline mid-run and start a second
// one over the same fake disk. Run: bun test.

import { expect, test } from "bun:test";
import {
  InfoPipeline,
  NO_LABS_ERROR,
  type InfoDeps,
  type InfoSnapshot,
  type InfoSourceRef,
} from "../../src/info/boxes/pipeline";
import type { Briefing } from "../../src/info/boxes/types";
import type { CableDay } from "../../src/info/cable/types";
import { INFO_RUN_VERSION, type CollectProgress, type InfoRunState } from "../../src/info/collect/run-state";
import type { ScreenVerdict } from "../../src/info/collect/screen";
import type { Lab } from "../../src/info/labs/types";
import { emptyPicture } from "../../src/info/picture/picture";
import type { Picture } from "../../src/info/picture/types";
import type { AnalystInput, LabRunResult } from "../../src/info/analysis/types";
import type { InfoItem } from "../../src/info/sources/item";

const TODAY = "2026-07-22";

function item(id: string): InfoItem {
  return { id, source: "s", sourceName: "S", title: id, url: `https://x/${id}`, publishedAt: "" };
}

function source(id: string): InfoSourceRef {
  return { id, name: id.toUpperCase() };
}

function lab(id: string, name: string, sources: string[] = []): Lab {
  return {
    id,
    name,
    kind: "lab",
    status: "active",
    charter: { scope: `everything about ${name}`, questions: [], topicId: null },
    sources,
    createdAt: 0,
  };
}

const LAB_A = lab("lab-a", "Robotics");

// The funnel counters a test does not care about, so an expectation can name
// only the fields it is actually about.
function progress(over: Partial<CollectProgress>): CollectProgress {
  return {
    total: 0,
    done: 0,
    failed: 0,
    items: 0,
    lastDone: null,
    screened: 0,
    kept: 0,
    dropped: 0,
    cappedOut: 0,
    bodies: 0,
    bodiesTotal: 0,
    labs: { total: 0, done: 0 },
    ...over,
  };
}

// One room's scope-level hit, which is all these tests need a verdict to carry.
const HIT = { labId: "lab-a", observables: [] as string[] };

function hits(labId: string) {
  return [{ labId, observables: [] as string[] }];
}

// A screen that keeps everything for the first room, which is what most of these
// tests want: they are about the state machine, not about the judging.
function keepAll(items: InfoItem[]): ScreenVerdict[] {
  return items.map((it) => ({ id: it.id, hits: [HIT], confidence: 0.9 }));
}

// What a room hands back by default: it changed, and it named nothing to read.
function moved(input: AnalystInput): LabRunResult {
  return {
    picture: { ...input.picture, updatedAt: 1, lastRunDate: input.date },
    cover: {
      labId: input.lab.id,
      name: input.lab.name,
      cover: `${input.lab.name} moved.`,
      judgments: [],
    },
    mustRead: [],
    oneLiners: [],
    warnings: [],
  };
}

function cable(id: string, labId = "lab-a") {
  return {
    id,
    date: TODAY,
    title: id,
    url: "",
    source: "s",
    sourceName: "S",
    publishedAt: "",
    hits: hits(labId),
  };
}

// The per-day files the pipeline reads and writes, in memory. `until` lets a
// test wait for a checkpoint to land without knowing how many writes it took.
class Disk {
  runs = new Map<string, InfoRunState>();
  briefings = new Map<string, Briefing>();
  items = new Map<string, InfoItem[]>();
  cables = new Map<string, CableDay>();
  pictures = new Map<string, Picture>();
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
  labs: Lab[];
  // Source ids discovery was asked for, in order — "who was discovered twice".
  fetched: string[];
  // Item ids each phase was asked to pay for, so a resume can be checked to have
  // skipped what the checkpoint already holds.
  screened: string[];
  bodies: string[];
  // Lab ids the analysis was run for, in order, and the cables each one saw.
  analyzed: string[];
  analyzedCables: string[][];
  awake: boolean[];
  phases: { phase: string; data: Record<string, number> }[];
  // The `force` each discovery pass was asked for: whether the run was
  // hand-driven, which is what decides if a source on schedule is polled anyway.
  forced: boolean[];
}

// A minimal set of injected deps over a fake disk; individual tests override the
// phases they are about. The default discover settles every requested source
// with one item named after it, the default screen keeps everything for the one
// room, the default body fetch hands each item back with a text body, and the
// default analysis says the room moved.
function makeDeps(fx: Fixture, over: Partial<InfoDeps> = {}): InfoDeps {
  return {
    loadBriefing: async (date) => fx.disk.briefings.get(date) ?? null,
    loadProfile: async () => "",
    loadLabs: async () => fx.labs,
    loadPicture: async (labId) => fx.disk.pictures.get(labId) ?? emptyPicture(labId),
    savePicture: async (picture) => void fx.disk.pictures.set(picture.labId, picture),
    listSources: async () => fx.sources,
    discover: async (refs, onSettled, _signal, opts) => {
      fx.forced.push(opts.force);
      for (const r of refs) {
        fx.fetched.push(r.id);
        await onSettled({ id: r.id, items: [item(`${r.id}1`)] });
      }
    },
    screen: async ({ items }) => {
      for (const it of items) fx.screened.push(it.id);
      return keepAll(items);
    },
    fetchBodies: async (items, onSettled) => {
      for (const it of items) {
        fx.bodies.push(it.id);
        await onSettled({ ...it, textContent: `body of ${it.id}`, summaryOnly: false });
      }
    },
    analyze: async (input) => {
      fx.analyzed.push(input.lab.id);
      fx.analyzedCables.push(input.cables.map((c) => c.id));
      return moved(input);
    },
    saveCableDay: async (day) => void fx.disk.cables.set(day.date, day),
    loadCableDay: async (date) => fx.disk.cables.get(date) ?? null,
    logPhase: (phase, data) => void fx.phases.push({ phase, data }),
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

function fixture(
  sources: InfoSourceRef[] = [source("a")],
  disk = new Disk(),
  labs: Lab[] = [LAB_A],
): Fixture {
  return {
    disk,
    sources,
    labs,
    fetched: [],
    screened: [],
    bodies: [],
    analyzed: [],
    analyzedCables: [],
    awake: [],
    phases: [],
    forced: [],
  };
}

// A checkpoint of the current version, with the fields a test does not care
// about filled in.
function run(over: Partial<InfoRunState>): InfoRunState {
  return {
    version: INFO_RUN_VERSION,
    date: TODAY,
    startedAt: 1,
    updatedAt: 1,
    phase: "discovering",
    sources: [],
    items: [],
    verdicts: {},
    material: [],
    ...over,
  };
}

test("discovery progress accumulates into the snapshot: total, done, failed, items, lastDone", async () => {
  const snaps: InfoSnapshot[] = [];
  const fx = fixture([source("a"), source("b"), source("c")]);
  const p = new InfoPipeline(
    makeDeps(fx, {
      discover: async (refs, onSettled) => {
        await onSettled({ id: "a", items: [item("1"), item("2"), item("3")] });
        await onSettled({ id: "b", items: [], error: "boom" });
        await onSettled({ id: "c", items: [item("4"), item("5")] });
        void refs;
      },
    }),
  );
  p.subscribe(() => snaps.push(p.snapshot()));
  await p.generate().done;

  const discovering = snaps.filter((s) => s.phase === "discovering" && s.collect);
  const last = discovering[discovering.length - 1];
  expect(last.collect).toEqual(progress({ total: 3, done: 3, failed: 1, items: 5, lastDone: "C" }));

  // A mid-run snapshot (after the first source, before the rest) proves it is live.
  const afterFirstDone = discovering.find((s) => s.collect!.done === 1);
  expect(afterFirstDone!.collect).toEqual(
    progress({ total: 3, done: 1, failed: 0, items: 3, lastDone: "A" }),
  );
});

test("the four phases run in funnel order, each logged with its own timing", async () => {
  const snaps: InfoSnapshot[] = [];
  const fx = fixture([source("a")]);
  const p = new InfoPipeline(makeDeps(fx));
  p.subscribe(() => snaps.push(p.snapshot()));
  await p.generate().done;

  const seen: string[] = [];
  for (const s of snaps) if (s.phase !== seen[seen.length - 1]) seen.push(s.phase);
  expect(seen).toEqual(["discovering", "screening", "fetching", "analyzing", "idle"]);
  expect(fx.phases.map((e) => e.phase)).toEqual([
    "discovering",
    "screening",
    "fetching",
    "analyzing",
  ]);
  for (const e of fx.phases) expect(typeof e.data.ms).toBe("number");
  expect(fx.phases[0].data).toMatchObject({ sources: 1, items: 1 });
  expect(fx.phases[1].data).toMatchObject({ items: 1, batches: 1, kept: 1, dropped: 0, cappedOut: 0 });
  expect(fx.phases[2].data).toMatchObject({ items: 1, fetched: 1 });
  expect(fx.phases[3].data).toMatchObject({ cables: 1, labs: 1, analyzed: 1 });
});

test("only the items screening kept get bodies fetched, and each of them becomes a cable", async () => {
  const fx = fixture([source("a")]);
  const p = new InfoPipeline(
    makeDeps(fx, {
      discover: async (_refs, onSettled) => {
        await onSettled({ id: "a", items: [item("keep"), item("drop"), item("keep2")] });
      },
      screen: async ({ items }) => {
        for (const it of items) fx.screened.push(it.id);
        return items.map((it) => ({
          id: it.id,
          hits: it.id.startsWith("keep") ? [HIT] : [],
          confidence: 0.5,
        }));
      },
    }),
  );
  await p.generate().done;

  expect(fx.screened).toEqual(["keep", "drop", "keep2"]);
  expect(fx.bodies).toEqual(["keep", "keep2"]);
  // The cables are the day's evidence, and only the kept items are in them.
  const day = fx.disk.cables.get(TODAY)!;
  expect(day.cables.map((c) => c.id)).toEqual(["keep", "keep2"]);
  expect(day.cables[0].hits).toEqual([HIT]);
  expect(fx.analyzedCables).toEqual([["keep", "keep2"]]);
  // The day's snapshot is what the analysis saw, so a later re-run sees the same.
  expect(fx.disk.items.get(TODAY)!.map((i) => i.id)).toEqual(["keep", "keep2"]);
  // The screened-out item is not in the briefing at all — not as a count, not as
  // an id (docs/63): what the day discarded is nobody's business.
  expect(p.snapshot().briefing!.items.drop).toBeUndefined();
  expect(JSON.stringify(p.snapshot().briefing)).not.toContain("drop");
});

test("the screen is batched, and every item is judged exactly once", async () => {
  const fx = fixture([source("a")]);
  const sizes: number[] = [];
  const many = Array.from({ length: 120 }, (_, i) => item(`i${i}`));
  const p = new InfoPipeline(
    makeDeps(fx, {
      discover: async (_refs, onSettled) => void (await onSettled({ id: "a", items: many })),
      screen: async ({ items }) => {
        sizes.push(items.length);
        for (const it of items) fx.screened.push(it.id);
        return keepAll(items);
      },
    }),
  );
  await p.generate().done;

  // 120 items at the 50-item batch size: two full batches and a remainder.
  expect(sizes.slice().sort((a, b) => b - a)).toEqual([50, 50, 20]);
  expect(fx.screened.length).toBe(120);
  expect(new Set(fx.screened).size).toBe(120);
});

test("the screen is shown the rooms, with the observables their pictures are watching", async () => {
  const fx = fixture([source("a")], new Disk(), [LAB_A, lab("lab-b", "Chips")]);
  fx.disk.pictures.set("lab-a", {
    ...emptyPicture("lab-a"),
    observables: [
      { id: "o-1", text: "arm prices", addedOn: TODAY },
      { id: "o-2", text: "retired thing", addedOn: TODAY, retiredOn: TODAY },
    ],
  });
  let seen: { labId: string; observables: string[] }[] = [];
  const p = new InfoPipeline(
    makeDeps(fx, {
      screen: async ({ targets, items }) => {
        seen = targets.map((t) => ({ labId: t.labId, observables: t.observables.map((o) => o.id) }));
        return keepAll(items);
      },
    }),
  );
  await p.generate().done;

  // Both rooms, and the retired observable is not offered to be hit again.
  expect(seen).toEqual([
    { labId: "lab-a", observables: ["o-1"] },
    { labId: "lab-b", observables: [] },
  ]);
});

test("a batch is shown only the rooms that claim its sources", async () => {
  const fx = fixture([source("a")], new Disk(), [
    lab("lab-a", "Robotics", ["s"]),
    lab("lab-b", "Chips", ["other"]),
  ]);
  let seen: string[] = [];
  const p = new InfoPipeline(
    makeDeps(fx, {
      screen: async ({ targets, items }) => {
        seen = targets.map((t) => t.labId);
        return keepAll(items);
      },
    }),
  );
  await p.generate().done;
  expect(seen).toEqual(["lab-a"]);
});

test("more keeps than the cap allows: the lowest-confidence ones are cut, and the count is reported", async () => {
  const fx = fixture([source("a")]);
  // 130 items, all kept, with the last 20 the least certain.
  const many = Array.from({ length: 130 }, (_, i) => item(`i${i}`));
  const snaps: InfoSnapshot[] = [];
  const p = new InfoPipeline(
    makeDeps(fx, {
      discover: async (_refs, onSettled) => void (await onSettled({ id: "a", items: many })),
      screen: async ({ items }) =>
        items.map((it) => ({
          id: it.id,
          hits: [HIT],
          confidence: Number(it.id.slice(1)) >= 110 ? 0 : 0.9,
        })),
    }),
  );
  p.subscribe(() => snaps.push(p.snapshot()));
  await p.generate().done;

  expect(fx.bodies.length).toBe(120);
  // The 20 least certain went; the cut is never silent.
  expect(fx.bodies).not.toContain("i129");
  expect(fx.phases.find((e) => e.phase === "screening")!.data.cappedOut).toBe(10);
  expect(snaps.some((s) => s.collect?.cappedOut === 10)).toBe(true);
});

// --- the rooms (docs/63) -----------------------------------------------------

test("each room is analyzed over its own cables, and the briefing is cut in room order", async () => {
  const fx = fixture([source("a")], new Disk(), [LAB_A, lab("lab-b", "Chips")]);
  const p = new InfoPipeline(
    makeDeps(fx, {
      discover: async (_refs, onSettled) => {
        await onSettled({ id: "a", items: [item("x1"), item("x2"), item("x3")] });
      },
      screen: async ({ items }) =>
        items.map((it) => ({
          id: it.id,
          hits: it.id === "x3" ? hits("lab-b") : hits("lab-a"),
          confidence: 0.9,
        })),
      analyze: async (input) => {
        fx.analyzed.push(input.lab.id);
        fx.analyzedCables.push(input.cables.map((c) => c.id));
        return {
          ...moved(input),
          mustRead: [
            { itemId: input.cables[0].id, reason: `${input.lab.name} reason`, labId: input.lab.id },
          ],
          oneLiners: [{ itemId: input.cables[0].id, line: "l", labId: input.lab.id }],
        };
      },
    }),
  );
  await p.generate().done;

  expect(fx.analyzed).toEqual(["lab-a", "lab-b"]);
  expect(fx.analyzedCables).toEqual([["x1", "x2"], ["x3"]]);
  const b = p.snapshot().briefing!;
  expect(b.version).toBe(2);
  expect(b.labs.map((l) => l.name)).toEqual(["Robotics", "Chips"]);
  expect(b.quiet).toEqual([]);
  // Room order, and an item a room already claimed as a must-read is not
  // repeated in the one-liners.
  expect(b.mustRead.map((r) => [r.itemId, r.labId])).toEqual([
    ["x1", "lab-a"],
    ["x3", "lab-b"],
  ]);
  expect(b.oneLiners).toEqual([]);
  // Only the items the briefing points at carry meta.
  expect(Object.keys(b.items).sort()).toEqual(["x1", "x3"]);
});

test("the analyst reads the day's bodies, and the picture it hands back is saved", async () => {
  const fx = fixture([source("a")]);
  let seen: AnalystInput | null = null;
  const p = new InfoPipeline(
    makeDeps(fx, {
      loadProfile: async () => "reads robotics",
      analyze: async (input) => {
        seen = input;
        return { ...moved(input), picture: { ...input.picture, baseline: "arms are cheap" } };
      },
    }),
  );
  await p.generate().done;

  expect(seen!.cables[0].text).toBe("body of a1");
  expect(seen!.memory.profile).toBe("reads robotics");
  expect(seen!.date).toBe(TODAY);
  expect(fx.disk.pictures.get("lab-a")!.baseline).toBe("arms are cheap");
});

test("a room that ran and had nothing to say is quiet, and so is one the day never hit", async () => {
  const fx = fixture([source("a")], new Disk(), [LAB_A, lab("lab-b", "Chips")]);
  const p = new InfoPipeline(
    makeDeps(fx, {
      analyze: async (input) => {
        fx.analyzed.push(input.lab.id);
        return { ...moved(input), cover: null };
      },
    }),
  );
  await p.generate().done;

  const b = p.snapshot().briefing!;
  expect(b.labs).toEqual([]);
  expect(b.quiet).toEqual(["Robotics", "Chips"]);
  // lab-b was never hit, so it cost no AI call at all.
  expect(fx.analyzed).toEqual(["lab-a"]);
});

test("a room whose analysis will not come back costs its own day and not the bureau's", async () => {
  const fx = fixture([source("a")], new Disk(), [LAB_A, lab("lab-b", "Chips")]);
  const p = new InfoPipeline(
    makeDeps(fx, {
      screen: async ({ items }) =>
        items.map((it) => ({
          id: it.id,
          hits: [...hits("lab-a"), ...hits("lab-b")],
          confidence: 0.9,
        })),
      analyze: async (input) => {
        fx.analyzed.push(input.lab.id);
        if (input.lab.id === "lab-a") throw new Error("the analyst would not answer");
        return moved(input);
      },
    }),
    { retryDelayMs: 0 },
  );
  await p.generate().done;

  // Three attempts on the room that failed, then the day carried on.
  expect(fx.analyzed.filter((id) => id === "lab-a").length).toBe(3);
  expect(p.snapshot().error).toBeNull();
  const b = p.snapshot().briefing!;
  expect(b.labs.map((l) => l.name)).toEqual(["Chips"]);
  expect(b.quiet).toEqual(["Robotics"]);
  expect(fx.disk.runs.get(TODAY)).toBeUndefined();
});

test("a run with no open room refuses before it spends anything", async () => {
  const fx = fixture([source("a")], new Disk(), []);
  const p = new InfoPipeline(makeDeps(fx));
  await p.generate().done;

  expect(p.snapshot().error).toBe(NO_LABS_ERROR);
  expect(fx.fetched).toEqual([]);
  expect(fx.screened).toEqual([]);
  expect(p.snapshot().briefing).toBeNull();
});

test("an archived room is not screened against and not analyzed", async () => {
  const fx = fixture([source("a")], new Disk(), [
    LAB_A,
    { ...lab("lab-b", "Chips"), status: "archived" as const },
  ]);
  let seen: string[] = [];
  const p = new InfoPipeline(
    makeDeps(fx, {
      screen: async ({ targets, items }) => {
        seen = targets.map((t) => t.labId);
        return keepAll(items);
      },
    }),
  );
  await p.generate().done;
  expect(seen).toEqual(["lab-a"]);
  expect(p.snapshot().briefing!.quiet).toEqual([]);
});

test("the day's one out-of-lane cable becomes the briefing's one out-of-lane pick", async () => {
  const fx = fixture([source("a")]);
  const p = new InfoPipeline(
    makeDeps(fx, {
      discover: async (_refs, onSettled) => {
        await onSettled({ id: "a", items: [item("x1"), item("x2")] });
      },
      screen: async ({ items }) =>
        items.map((it) => ({
          id: it.id,
          hits: it.id === "x1" ? [HIT] : [],
          ...(it.id === "x2" ? { outside: "nobody follows this and it matters" } : {}),
          confidence: 0.9,
        })),
    }),
  );
  await p.generate().done;

  const b = p.snapshot().briefing!;
  expect(b.outOfLane).toEqual([{ itemId: "x2", reason: "nobody follows this and it matters" }]);
  expect(b.items.x2).toBeDefined();
});

test("analysis activity surfaces streaming char counts, then clears when finished", async () => {
  const snaps: InfoSnapshot[] = [];
  // A stepping clock so each char update clears the 250ms activity-notify throttle.
  let t = 1000;
  const fx = fixture();
  const p = new InfoPipeline(
    makeDeps(fx, {
      now: () => (t += 300),
      analyze: async (input, opts) => {
        opts.onProgress(120);
        opts.onProgress(480);
        return moved(input);
      },
    }),
  );
  p.subscribe(() => snaps.push(p.snapshot()));
  await p.generate().done;

  const analyzing = snaps.filter((s) => s.phase === "analyzing" && s.activity);
  expect(analyzing.length).toBeGreaterThan(0);
  const maxChars = Math.max(...analyzing.map((s) => s.activity!.chars));
  expect(maxChars).toBe(480);
  expect(analyzing.every((s) => s.activity!.attempt === 1 && s.activity!.attempts === 3)).toBe(true);

  // Terminal snapshot: not running, collect/activity cleared, briefing set.
  const final = p.snapshot();
  expect(final.running).toBe(false);
  expect(final.collect).toBeNull();
  expect(final.activity).toBeNull();
  expect(final.briefing?.labs[0].cover).toBe("Robotics moved.");
});

test("the progress line counts the rooms as they land", async () => {
  const snaps: InfoSnapshot[] = [];
  const fx = fixture([source("a")], new Disk(), [LAB_A, lab("lab-b", "Chips")]);
  const p = new InfoPipeline(
    makeDeps(fx, {
      screen: async ({ items }) =>
        items.map((it) => ({
          id: it.id,
          hits: [...hits("lab-a"), ...hits("lab-b")],
          confidence: 0.9,
        })),
    }),
  );
  p.subscribe(() => snaps.push(p.snapshot()));
  await p.generate().done;

  const counts = snaps
    .filter((s) => s.phase === "analyzing" && s.collect)
    .map((s) => `${s.collect!.labs.done}/${s.collect!.labs.total}`);
  expect(counts).toContain("0/2");
  expect(counts).toContain("1/2");
  expect(counts[counts.length - 1]).toBe("2/2");
});

test("a collect that yields no items fails the run and leaves an error", async () => {
  const fx = fixture();
  const p = new InfoPipeline(
    makeDeps(fx, {
      discover: async (_refs, onSettled) => void (await onSettled({ id: "a", items: [] })),
    }),
  );
  await p.generate().done;
  const s = p.snapshot();
  expect(s.running).toBe(false);
  expect(s.briefing).toBeNull();
  expect(s.error).toBeTruthy();
});

test("generate saves the day's item snapshot for a later re-analysis", async () => {
  const fx = fixture([source("a"), source("b")]);
  await new InfoPipeline(makeDeps(fx)).generate().done;
  expect(fx.disk.items.get(TODAY)!.map((i) => i.id)).toEqual(["a1", "b1"]);
});

test("a finished run leaves no checkpoint, so the next generate collects everything again", async () => {
  const fx = fixture([source("a"), source("b")]);
  const p = new InfoPipeline(makeDeps(fx));
  await p.generate().done;
  expect(fx.disk.runs.get(TODAY)).toBeUndefined();
  await p.generate().done;
  expect(fx.fetched).toEqual(["a", "b", "a", "b"]);
});

// --- one run at a time, said out loud ---------------------------------------
//
// The refusal used to be a bare `return`, indistinguishable from a start: the
// chat drew a progress card for a run that never began, nothing was ever going
// to update it, and the companion announced a regeneration that never ran.

test("a start while a run is going is refused, and says so instead of starting a second run", async () => {
  const fx = fixture([source("a")]);
  let release = () => {};
  let reached = () => {};
  const inDiscovery = new Promise<void>((r) => (reached = r));
  const p = new InfoPipeline(
    makeDeps(fx, {
      discover: async (refs, onSettled) => {
        for (const r of refs) fx.fetched.push(r.id);
        reached();
        await new Promise<void>((r) => (release = r));
        await onSettled({ id: "a", items: [item("a1")] });
      },
    }),
  );
  const first = p.generate();
  expect(first.start).toBe("started");
  await inDiscovery;

  expect(p.generate().start).toBe("busy");
  expect(p.retriage().start).toBe("busy");
  // Refused, not queued: nothing was discovered twice and no second briefing ran.
  expect(fx.fetched).toEqual(["a"]);

  // The handle a refused caller gets is the run it lost the race to, so waiting
  // on it waits for the answer the user is actually going to see.
  const joined = p.generate().done;
  release();
  await Promise.all([first.done, joined]);
  expect(p.snapshot().running).toBe(false);
  expect(p.snapshot().briefing?.labs[0].cover).toBe("Robotics moved.");
  expect(fx.fetched).toEqual(["a"]);
});

test("the pipeline takes a start again once the run it refused for has ended", async () => {
  const fx = fixture([source("a")]);
  const p = new InfoPipeline(makeDeps(fx));
  await p.generate().done;
  const again = p.generate();
  expect(again.start).toBe("started");
  await again.done;
});

// --- resuming an interrupted run -------------------------------------------

test("a run killed mid-collection resumes: only the source it never got is fetched", async () => {
  const fx = fixture([source("a"), source("b")]);
  // The first pipeline settles "a", then hangs forever on "b" — the app is
  // killed there, so its generate() never returns and is abandoned.
  const killed = new InfoPipeline(
    makeDeps(fx, {
      discover: async (refs, onSettled) => {
        for (const r of refs) fx.fetched.push(r.id);
        await onSettled({ id: "a", items: [item("a1")] });
        await new Promise<void>(() => {});
      },
    }),
  );
  void killed.generate().done;
  await fx.disk.until((s) => s.sources.some((x) => x.id === "a" && x.status === "done"));
  expect(fx.fetched).toEqual(["a", "b"]);

  const restarted = fixture(fx.sources, fx.disk);
  const p = new InfoPipeline(makeDeps(restarted));
  await p.init();

  expect(restarted.fetched).toEqual(["b"]);
  expect(restarted.disk.items.get(TODAY)!.map((i) => i.id)).toEqual(["a1", "b1"]);
  expect(restarted.disk.runs.get(TODAY)).toBeUndefined();
  expect(p.snapshot().briefing?.labs[0].cover).toBe("Robotics moved.");
});

test("a resumed run's progress bar carries on from the checkpoint instead of restarting", async () => {
  const fx = fixture([source("a"), source("b"), source("c")]);
  fx.disk.runs.set(
    TODAY,
    run({
      sources: [
        { id: "a", name: "A", status: "done", items: 1 },
        { id: "b", name: "B", status: "pending", items: 0 },
        { id: "c", name: "C", status: "pending", items: 0 },
      ],
      items: [item("a1")],
      lastSettled: "A",
    }),
  );
  const snaps: InfoSnapshot[] = [];
  const p = new InfoPipeline(makeDeps(fx));
  p.subscribe(() => snaps.push(p.snapshot()));
  await p.init();

  const first = snaps.find((s) => s.phase === "discovering" && s.collect);
  expect(first!.collect).toEqual(progress({ total: 3, done: 1, failed: 0, items: 1, lastDone: "A" }));
});

test("a run killed while analyzing resumes into the analysis, collecting nothing", async () => {
  const fx = fixture([source("a")]);
  fx.disk.runs.set(
    TODAY,
    run({
      phase: "analyzing",
      sources: [{ id: "a", name: "A", status: "done", items: 2 }],
      items: [item("a1"), item("a2")],
      verdicts: {
        a1: { id: "a1", hits: [HIT], confidence: 0.9 },
        a2: { id: "a2", hits: [HIT], confidence: 0.9 },
      },
      selection: { ids: ["a1", "a2"], cappedOut: 0 },
      material: ["a1", "a2"],
    }),
  );
  const p = new InfoPipeline(makeDeps(fx));
  await p.init();

  expect(fx.fetched).toEqual([]);
  expect(fx.screened).toEqual([]);
  expect(fx.analyzed).toEqual(["lab-a"]);
  expect(fx.disk.items.get(TODAY)!.map((i) => i.id)).toEqual(["a1", "a2"]);
  expect(fx.disk.runs.get(TODAY)).toBeUndefined();
});

test("a resumed run does not analyze a room whose picture it already wrote", async () => {
  const fx = fixture([source("a")], new Disk(), [LAB_A, lab("lab-b", "Chips")]);
  fx.disk.runs.set(
    TODAY,
    run({
      phase: "analyzing",
      sources: [{ id: "a", name: "A", status: "done", items: 2 }],
      items: [item("x1"), item("x2")],
      verdicts: {
        x1: { id: "x1", hits: hits("lab-a"), confidence: 0.9 },
        x2: { id: "x2", hits: hits("lab-b"), confidence: 0.9 },
      },
      selection: { ids: ["x1", "x2"], cappedOut: 0 },
      material: ["x1", "x2"],
      labsTotal: 2,
      analysis: [
        {
          labId: "lab-a",
          name: "Robotics",
          cover: { labId: "lab-a", name: "Robotics", cover: "Robotics moved.", judgments: [] },
          mustRead: [{ itemId: "x1", reason: "yesterday's reason", labId: "lab-a" }],
          oneLiners: [],
        },
      ],
      halt: { kind: "stopped" },
    }),
  );
  await new InfoPipeline(makeDeps(fx)).generate().done;

  // Only the room that was still owed cost a call, and the one that landed
  // before the interruption is still in the briefing.
  expect(fx.analyzed).toEqual(["lab-b"]);
  const b = fx.disk.briefings.get(TODAY)!;
  expect(b.labs.map((l) => l.name)).toEqual(["Robotics", "Chips"]);
  expect(b.mustRead.map((r) => r.reason)).toEqual(["yesterday's reason"]);
});

test("Stop while analyzing parks the run with the rooms it already paid for", async () => {
  const fx = fixture([source("a")], new Disk(), [LAB_A, lab("lab-b", "Chips")]);
  const p: InfoPipeline = new InfoPipeline(
    makeDeps(fx, {
      screen: async ({ items }) =>
        items.map((it) => ({
          id: it.id,
          hits: [...hits("lab-a"), ...hits("lab-b")],
          confidence: 0.9,
        })),
      analyze: async (input) => {
        fx.analyzed.push(input.lab.id);
        if (input.lab.id === "lab-b") {
          p.stop();
          throw new Error("should not be reached");
        }
        return moved(input);
      },
    }),
  );
  await p.generate().done;

  expect(p.snapshot().error).toBeNull();
  expect(p.snapshot().briefing).toBeNull();
  const parked = fx.disk.runs.get(TODAY)!;
  expect(parked.halt).toEqual({ kind: "stopped" });
  expect(parked.phase).toBe("analyzing");
  expect(parked.analysis!.map((o) => o.labId)).toEqual(["lab-a"]);
  // The room that landed is on disk, so the resume owes only the other one.
  expect(fx.disk.pictures.has("lab-a")).toBe(true);
  expect(fx.disk.pictures.has("lab-b")).toBe(false);
});

test("an overnight leftover is not resumed, and the next generate collects the day afresh", async () => {
  const fx = fixture([source("a")]);
  fx.disk.runs.set(
    "2026-07-21",
    run({
      date: "2026-07-21",
      sources: [{ id: "a", name: "A", status: "done", items: 1 }],
      items: [item("old1")],
    }),
  );
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
  expect(fx.analyzed).toEqual([]);

  await p.generate().done;
  expect(fx.fetched).toEqual(["a"]);
  expect(fx.disk.items.get(TODAY)!.map((i) => i.id)).toEqual(["a1"]);
  expect(fx.disk.runs.get("2026-07-21")).toBeUndefined();
});

test("a stopped run is left parked, and a hand-driven generate continues it", async () => {
  const fx = fixture([source("a"), source("b")]);
  fx.disk.runs.set(
    TODAY,
    run({
      sources: [
        { id: "a", name: "A", status: "done", items: 1 },
        { id: "b", name: "B", status: "pending", items: 0 },
      ],
      items: [item("a1")],
      halt: { kind: "stopped" },
    }),
  );

  await new InfoPipeline(makeDeps(fx)).init();
  expect(fx.fetched).toEqual([]);
  expect(fx.analyzed).toEqual([]);

  await new InfoPipeline(makeDeps(fx)).generate().done;
  expect(fx.fetched).toEqual(["b"]);
  expect(fx.disk.items.get(TODAY)!.map((i) => i.id)).toEqual(["a1", "b1"]);
});

test("a failed run is not resumed on its own; generate retries the sources that failed", async () => {
  const fx = fixture([source("a"), source("b")]);
  const p = new InfoPipeline(
    makeDeps(fx, {
      discover: async (refs, onSettled) => {
        for (const r of refs) {
          fx.fetched.push(r.id);
          await onSettled(
            r.id === "b"
              ? { id: "b", items: [], error: "host down" }
              : { id: "a", items: [item("a1")] },
          );
        }
      },
      saveCableDay: async () => {
        throw new Error("no room on the disk");
      },
    }),
    // No pause between the watchdog's attempts: this test is about what the
    // failure leaves on disk, not about the retrying.
    { retryDelayMs: 0 },
  );
  await p.generate().done;
  expect(p.snapshot().error).toContain("no room on the disk");
  expect(fx.disk.runs.get(TODAY)!.halt).toEqual({ kind: "failed", error: "no room on the disk" });

  // Restarting the app must not spend a second analysis unasked.
  const restarted = fixture(fx.sources, fx.disk);
  await new InfoPipeline(makeDeps(restarted)).init();
  expect(restarted.analyzed).toEqual([]);

  // Pressing Generate does: the source that failed gets another go, the one that
  // succeeded is not fetched again.
  await new InfoPipeline(makeDeps(restarted)).generate().done;
  expect(restarted.fetched).toEqual(["b"]);
  expect(restarted.disk.items.get(TODAY)!.map((i) => i.id)).toEqual(["a1", "b1"]);
});

test("a source subscribed to after the run started joins it; one removed is dropped", async () => {
  const fx = fixture([source("a"), source("c")]);
  fx.disk.runs.set(
    TODAY,
    run({
      sources: [
        { id: "a", name: "A", status: "done", items: 1 },
        { id: "b", name: "B", status: "pending", items: 0 },
      ],
      items: [item("a1")],
    }),
  );
  await new InfoPipeline(makeDeps(fx)).generate().done;
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
      discover: async (refs, onSettled) => {
        for (const r of refs) fx.fetched.push(r.id);
        await onSettled({ id: "a", items: [item("a1")] });
        // The app goes to the background here, then never comes back.
        await p.flush();
        await new Promise<void>(() => {});
      },
    }),
  );
  void p.generate().done;
  await fx.disk.until((s) => s.sources.some((x) => x.id === "a" && x.status === "done"));
  expect(fx.disk.runs.get(TODAY)!.items.map((i) => i.id)).toEqual(["a1"]);
});

test("the screen wake lock is held for the run and released however it ends", async () => {
  const fx = fixture();
  await new InfoPipeline(makeDeps(fx)).generate().done;
  expect(fx.awake).toEqual([true, false]);

  const failed = fixture();
  await new InfoPipeline(
    makeDeps(failed, {
      saveCableDay: async () => {
        throw new Error("boom");
      },
    }),
    { retryDelayMs: 0 },
  ).generate().done;
  expect(failed.awake).toEqual([true, false]);
});

// --- re-analysis and the rest ------------------------------------------------

test("retriage re-runs the rooms over the day's cables, collecting nothing", async () => {
  const fx = fixture();
  fx.disk.items.set(TODAY, [item("x1")]);
  fx.disk.cables.set(TODAY, { version: 1, date: TODAY, cables: [cable("x1")] });
  const snaps: InfoSnapshot[] = [];
  const p = new InfoPipeline(
    makeDeps(fx, {
      analyze: async (input) => {
        fx.analyzed.push(input.lab.id);
        fx.analyzedCables.push(input.cables.map((c) => c.id));
        return {
          ...moved(input),
          cover: { labId: "lab-a", name: "Robotics", cover: "read again", judgments: [] },
          mustRead: [{ itemId: "x1", reason: "r", labId: "lab-a" }],
        };
      },
    }),
  );
  p.subscribe(() => snaps.push(p.snapshot()));
  await p.retriage().done;

  expect(fx.fetched).toEqual([]);
  expect(snaps.some((s) => s.phase === "fetching")).toBe(false);
  expect(fx.analyzed).toEqual(["lab-a"]);
  const final = p.snapshot();
  expect(final.running).toBe(false);
  expect(final.briefing?.labs[0].cover).toBe("read again");
  expect(final.briefing?.mustRead.map((r) => r.itemId)).toEqual(["x1"]);
  // It never touches the run checkpoint.
  expect(fx.disk.runs.get(TODAY)).toBeUndefined();
});

test("retriage with no cables errors instead of producing a briefing", async () => {
  const fx = fixture();
  const p = new InfoPipeline(makeDeps(fx));
  await p.retriage().done;
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
  fx.disk.cables.set(TODAY, { version: 1, date: TODAY, cables: [cable("1")] });
  const deps = makeDeps(fx, {
    pruneStaleDays: async (today) => {
      order.push("prune");
      pruned.push(today);
    },
    discover: async (refs, onSettled) => {
      order.push("collect");
      for (const r of refs) await onSettled({ id: r.id, items: [item("1")] });
    },
  });

  await new InfoPipeline(deps).generate().done;
  expect(order).toEqual(["prune", "collect"]);
  expect(pruned).toEqual([TODAY]);

  await new InfoPipeline(deps).retriage().done;
  expect(pruned).toEqual([TODAY]);
});

test("a failing prune does not stop the briefing", async () => {
  const fx = fixture();
  const p = new InfoPipeline(
    makeDeps(fx, {
      pruneStaleDays: async () => {
        throw new Error("readDir denied");
      },
    }),
  );
  await p.generate().done;
  const s = p.snapshot();
  expect(s.error).toBeNull();
  expect(s.briefing?.labs[0].cover).toBe("Robotics moved.");
});

test("a room's observations are read for the topic its charter files under", async () => {
  const asked: string[] = [];
  const fx = fixture([source("a")], new Disk(), [
    { ...LAB_A, charter: { ...LAB_A.charter, topicId: "topic-1" } },
  ]);
  let seen = "unset";
  const p = new InfoPipeline(
    makeDeps(fx, {
      loadObservations: async (topicId) => {
        asked.push(topicId);
        return "stuck on grippers";
      },
      analyze: async (input) => {
        seen = input.memory.observations;
        return moved(input);
      },
    }),
  );
  await p.generate().done;
  expect(asked).toEqual(["topic-1"]);
  expect(seen).toBe("stuck on grippers");
});

test("a room with no topic analyzes without observations, and a failing read is the same", async () => {
  const fx = fixture();
  let seen = "unset";
  const p = new InfoPipeline(
    makeDeps(fx, {
      loadObservations: async () => {
        throw new Error("store unreadable");
      },
      analyze: async (input) => {
        seen = input.memory.observations;
        return moved(input);
      },
    }),
  );
  await p.generate().done;
  // The lab's charter files under no topic, so the dep is never even asked.
  expect(seen).toBe("");
  expect(p.snapshot().error).toBeNull();
});

// --- Stop during collection ------------------------------------------------

test("Stop during collection aborts the fetching, keeps what settled, and parks the run", async () => {
  const fx = fixture([source("a"), source("b")]);
  const snaps: InfoSnapshot[] = [];
  let sawAbort = false;
  const p = new InfoPipeline(
    makeDeps(fx, {
      discover: async (refs, onSettled, signal) => {
        // The first source lands, then the user presses Stop while the second
        // is still fetching — noticing the signal is the engine's job.
        await onSettled({ id: refs[0].id, items: [item("a1")] });
        p.stop();
        await new Promise<void>((r) => setTimeout(r, 0));
        sawAbort = signal.aborted;
      },
    }),
  );
  p.subscribe(() => snaps.push(p.snapshot()));
  await p.generate().done;

  expect(sawAbort).toBe(true);
  // Pressing Stop is answered before the run unwinds.
  expect(snaps.some((s) => s.running && s.stopping)).toBe(true);
  // And it is over by the time the pipeline goes idle.
  expect(p.snapshot().stopping).toBe(false);
  expect(p.snapshot().error).toBeNull();
  expect(fx.analyzed).toEqual([]);

  // The source that settled is in the checkpoint; the other is still owed.
  const parked = fx.disk.runs.get(TODAY)!;
  expect(parked.halt).toEqual({ kind: "stopped" });
  expect(parked.items.map((i) => i.id)).toEqual(["a1"]);
  expect(parked.sources.map((s) => s.status)).toEqual(["done", "pending"]);
});

test("a second Stop while already stopping changes nothing", async () => {
  const fx = fixture([source("a")]);
  let aborts = 0;
  const p = new InfoPipeline(
    makeDeps(fx, {
      discover: async (_refs, _onSettled, signal) => {
        signal.addEventListener("abort", () => aborts++);
        p.stop();
        p.stop();
      },
    }),
  );
  await p.generate().done;
  expect(aborts).toBe(1);
});

test("Stop during a re-analysis flips stopping too", async () => {
  const fx = fixture([source("a")]);
  fx.disk.items.set(TODAY, [item("a1")]);
  fx.disk.cables.set(TODAY, { version: 1, date: TODAY, cables: [cable("a1")] });
  const snaps: InfoSnapshot[] = [];
  const p = new InfoPipeline(
    makeDeps(fx, {
      analyze: async () => {
        p.stop();
        throw new Error("cancelled by the user");
      },
    }),
  );
  p.subscribe(() => snaps.push(p.snapshot()));
  await p.retriage().done;
  expect(snaps.some((s) => s.running && s.stopping)).toBe(true);
  expect(p.snapshot().stopping).toBe(false);
});

// --- Stop and resume in the two collecting phases (docs/35) -----------------

// A run whose one source yields the named items, so a test can drive a specific
// phase without arranging discovery each time.
function withItems(fx: Fixture, ids: string[], over: Partial<InfoDeps> = {}): InfoDeps {
  return makeDeps(fx, {
    discover: async (_refs, onSettled) => {
      fx.fetched.push("a");
      await onSettled({ id: "a", items: ids.map(item) });
    },
    ...over,
  });
}

test("Stop while screening parks the run with the verdicts it already bought", async () => {
  const fx = fixture([source("a")]);
  const many = Array.from({ length: 120 }, (_, i) => `i${i}`);
  let batches = 0;
  const p = new InfoPipeline(
    withItems(fx, many, {
      screen: async ({ items }) => {
        // The first batch lands; the user presses Stop while the rest are out.
        if (++batches === 1) {
          for (const it of items) fx.screened.push(it.id);
          return keepAll(items);
        }
        p.stop();
        throw new Error("should not be reached");
      },
    }),
  );
  await p.generate().done;

  expect(p.snapshot().error).toBeNull();
  expect(fx.bodies).toEqual([]);
  expect(fx.analyzed).toEqual([]);
  const parked = fx.disk.runs.get(TODAY)!;
  expect(parked.halt).toEqual({ kind: "stopped" });
  expect(parked.phase).toBe("screening");
  // The batch that landed is on the checkpoint; the rest are still owed.
  expect(Object.keys(parked.verdicts).length).toBe(50);
  expect(parked.selection).toBeUndefined();
});

test("a resumed screen rejudges nothing and rediscovers nothing", async () => {
  const fx = fixture([source("a")]);
  fx.disk.runs.set(
    TODAY,
    run({
      phase: "screening",
      sources: [{ id: "a", name: "A", status: "done", items: 3 }],
      items: [item("x1"), item("x2"), item("x3")],
      verdicts: {
        x1: { id: "x1", hits: [HIT], confidence: 0.9 },
        x2: { id: "x2", hits: [], confidence: 0.9 },
      },
      halt: { kind: "stopped" },
    }),
  );
  const p = new InfoPipeline(makeDeps(fx));
  await p.generate().done;

  expect(fx.fetched).toEqual([]);
  expect(fx.screened).toEqual(["x3"]);
  expect(fx.bodies).toEqual(["x1", "x3"]);
  expect(fx.analyzedCables).toEqual([["x1", "x3"]]);
});

test("a resumed body fetch pays only for the bodies it does not have", async () => {
  const fx = fixture([source("a")]);
  fx.disk.runs.set(
    TODAY,
    run({
      phase: "fetching",
      sources: [{ id: "a", name: "A", status: "done", items: 3 }],
      items: [{ ...item("x1"), textContent: "already fetched" }, item("x2"), item("x3")],
      verdicts: {
        x1: { id: "x1", hits: [HIT], confidence: 0.9 },
        x2: { id: "x2", hits: [HIT], confidence: 0.9 },
        x3: { id: "x3", hits: [HIT], confidence: 0.9 },
      },
      selection: { ids: ["x1", "x2", "x3"], cappedOut: 0 },
      material: ["x1"],
      halt: { kind: "stopped" },
    }),
  );
  const p = new InfoPipeline(makeDeps(fx));
  await p.generate().done;

  expect(fx.fetched).toEqual([]);
  expect(fx.screened).toEqual([]);
  expect(fx.bodies).toEqual(["x2", "x3"]);
  // The body already on the checkpoint reaches the analyst untouched.
  expect(fx.disk.items.get(TODAY)!.find((i) => i.id === "x1")!.textContent).toBe("already fetched");
});

test("Stop while fetching bodies keeps the ones that landed and parks the rest", async () => {
  const fx = fixture([source("a")]);
  const p = new InfoPipeline(
    withItems(fx, ["x1", "x2", "x3"], {
      fetchBodies: async (items, onSettled, signal) => {
        await onSettled({ ...items[0], textContent: "body 1" });
        p.stop();
        await new Promise<void>((r) => setTimeout(r, 0));
        expect(signal.aborted).toBe(true);
      },
    }),
  );
  await p.generate().done;

  expect(fx.analyzed).toEqual([]);
  const parked = fx.disk.runs.get(TODAY)!;
  expect(parked.halt).toEqual({ kind: "stopped" });
  expect(parked.phase).toBe("fetching");
  expect(parked.material).toEqual(["x1"]);
  expect(parked.items.find((i) => i.id === "x1")!.textContent).toBe("body 1");
});

test("a source subscribed to mid-run is screened with the rest, and nothing already paid for is repeated", async () => {
  const fx = fixture([source("a"), source("b")]);
  fx.disk.runs.set(
    TODAY,
    run({
      phase: "fetching",
      sources: [{ id: "a", name: "A", status: "done", items: 1 }],
      items: [{ ...item("a1"), textContent: "already fetched" }],
      verdicts: { a1: { id: "a1", hits: [HIT], confidence: 0.9 } },
      selection: { ids: ["a1"], cappedOut: 0 },
      material: ["a1"],
      halt: { kind: "stopped" },
    }),
  );
  await new InfoPipeline(makeDeps(fx)).generate().done;

  // Only the new source is discovered, only its item is judged, only its body
  // is fetched — and both items land in the same briefing.
  expect(fx.fetched).toEqual(["b"]);
  expect(fx.screened).toEqual(["b1"]);
  expect(fx.bodies).toEqual(["b1"]);
  expect(fx.analyzedCables).toEqual([["a1", "b1"]]);
});

test("a screening batch that will not parse fails the run, keeping the batches that landed", async () => {
  const fx = fixture([source("a")]);
  const many = Array.from({ length: 60 }, (_, i) => `i${i}`);
  const p = new InfoPipeline(
    withItems(fx, many, {
      screen: async ({ items }) => {
        if (items.length === 50) return keepAll(items);
        throw new Error("screening produced invalid JSON");
      },
    }),
    { retryDelayMs: 0 },
  );
  await p.generate().done;

  expect(p.snapshot().error).toContain("invalid JSON");
  const parked = fx.disk.runs.get(TODAY)!;
  expect(parked.halt!.kind).toBe("failed");
  expect(Object.keys(parked.verdicts).length).toBe(50);
  expect(fx.bodies).toEqual([]);
});

test("a day where nothing hits any room still produces a briefing, and it says so", async () => {
  const fx = fixture([source("a")]);
  const p = new InfoPipeline(
    withItems(fx, ["x1", "x2"], {
      screen: async ({ items }) => items.map((it) => ({ id: it.id, hits: [], confidence: 0.9 })),
    }),
  );
  await p.generate().done;

  expect(fx.bodies).toEqual([]);
  expect(fx.analyzed).toEqual([]);
  const b = p.snapshot().briefing!;
  expect(b.labs).toEqual([]);
  expect(b.quiet).toEqual(["Robotics"]);
  expect(b.mustRead).toEqual([]);
  expect(fx.disk.cables.get(TODAY)!.cables).toEqual([]);
});

// --- opening the app is the trigger (docs/35) --------------------------------

test("the day's first open collects the briefing: there is no button behind it", async () => {
  const fx = fixture([source("a")]);
  const p = new InfoPipeline(makeDeps(fx, { canAutoGenerate: async () => true }));
  await p.init();

  expect(fx.fetched).toEqual(["a"]);
  expect(fx.analyzed).toEqual(["lab-a"]);
  expect(p.snapshot().briefing?.labs[0].cover).toBe("Robotics moved.");
  // The run polls only what the collector says is due; a regenerate goes and
  // looks. This is the only thing the distinction decides.
  expect(fx.forced).toEqual([false]);
});

test("nothing is spent unasked without a provider and a source", async () => {
  const fx = fixture([source("a")]);
  await new InfoPipeline(makeDeps(fx, { canAutoGenerate: async () => false })).init();
  expect(fx.fetched).toEqual([]);
  // A dep that throws is the same answer: the guess is never the one that spends.
  await new InfoPipeline(
    makeDeps(fx, {
      canAutoGenerate: async () => {
        throw new Error("settings unreadable");
      },
    }),
  ).init();
  expect(fx.fetched).toEqual([]);
});

test("today's briefing already on disk answers the open by itself", async () => {
  const fx = fixture([source("a")]);
  const p = new InfoPipeline(makeDeps(fx, { canAutoGenerate: async () => true }));
  await p.generate().done;
  expect(fx.analyzed.length).toBe(1);

  // Every return to the foreground calls init again; it must stay cheap.
  const second = fixture(fx.sources, fx.disk);
  await new InfoPipeline(makeDeps(second, { canAutoGenerate: async () => true })).init();
  await new InfoPipeline(makeDeps(second, { canAutoGenerate: async () => true })).init();
  expect(second.fetched).toEqual([]);
  expect(second.analyzed).toEqual([]);
});

test("a run the user stopped is not restarted by opening the app, however auto-collection is set", async () => {
  const fx = fixture([source("a")]);
  fx.disk.runs.set(
    TODAY,
    run({
      sources: [{ id: "a", name: "A", status: "pending", items: 0 }],
      halt: { kind: "stopped" },
    }),
  );
  await new InfoPipeline(makeDeps(fx, { canAutoGenerate: async () => true })).init();
  expect(fx.fetched).toEqual([]);
  expect(fx.analyzed).toEqual([]);
});

test("a hand-driven generate polls every source, whatever the collector's schedule says", async () => {
  const fx = fixture([source("a")]);
  await new InfoPipeline(makeDeps(fx)).generate().done;
  expect(fx.forced).toEqual([true]);
});

// --- the pool (docs/35) ------------------------------------------------------

test("the pool's items join the run's own, and what it already judged is not judged again", async () => {
  const fx = fixture([source("a")]);
  const p = new InfoPipeline(
    makeDeps(fx, {
      poolDraw: async () => ({
        items: [item("overnight"), item("judged")],
        verdicts: { judged: { id: "judged", hits: [HIT], confidence: 0.9 } },
        bodies: { judged: { textContent: "fetched hours ago" } },
        settled: [],
      }),
    }),
  );
  await p.generate().done;

  // Only the two nobody had judged reached the screen; only the one with no body
  // was fetched. The pooled count says what the pool contributed.
  expect(fx.screened.sort()).toEqual(["a1", "overnight"]);
  expect(fx.bodies).toEqual(["a1", "overnight"]);
  expect(fx.analyzedCables[0].slice().sort()).toEqual(["a1", "judged", "overnight"]);
  expect(fx.phases[0].data).toMatchObject({ items: 3, pooled: 2 });
});

test("what an earlier day settled is dropped even though the source offered it again", async () => {
  const fx = fixture([source("a")]);
  const p = new InfoPipeline(
    makeDeps(fx, {
      discover: async (_refs, onSettled) => {
        fx.fetched.push("a");
        await onSettled({ id: "a", items: [item("yesterday"), item("new")] });
      },
      poolDraw: async () => ({ items: [], verdicts: {}, bodies: {}, settled: ["yesterday"] }),
    }),
  );
  await p.generate().done;

  expect(fx.screened).toEqual(["new"]);
  expect(fx.analyzedCables).toEqual([["new"]]);
});

test("the run hands the pool its verdicts at the end of screening and its deliveries at the end", async () => {
  const fx = fixture([source("a")]);
  const records: { verdicts?: string[]; bodies?: string[]; briefed?: string[] }[] = [];
  const p = new InfoPipeline(
    makeDeps(fx, {
      poolRecord: async (_date, record) => {
        records.push({
          verdicts: record.verdicts && Object.keys(record.verdicts),
          bodies: record.bodies,
          briefed: record.briefed,
        });
      },
    }),
  );
  await p.generate().done;

  // Twice: once so a crash before the analysis does not cost the verdicts, once
  // when the briefing lands so tomorrow leaves what it carried alone.
  expect(records).toEqual([
    { verdicts: ["a1"], bodies: undefined, briefed: undefined },
    { verdicts: ["a1"], bodies: ["a1"], briefed: ["a1"] },
  ]);
});

test("a pool that will not load or save costs requests, never the briefing", async () => {
  const fx = fixture([source("a")]);
  const p = new InfoPipeline(
    makeDeps(fx, {
      poolDraw: async () => {
        throw new Error("pool unreadable");
      },
      poolRecord: async () => {
        throw new Error("disk full");
      },
    }),
  );
  await p.generate().done;

  expect(p.snapshot().error).toBeNull();
  expect(p.snapshot().briefing?.labs[0].cover).toBe("Robotics moved.");
  expect(fx.analyzedCables).toEqual([["a1"]]);
});
