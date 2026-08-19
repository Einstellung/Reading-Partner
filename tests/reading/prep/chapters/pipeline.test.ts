// Unit tests for the chapter-spine pipeline state machine
// (src/reading/notes/pipeline.ts), driven entirely by fake deps — no Tauri, no
// network, no AI spend. Covers the two passes, the parallel first pass and its
// pacing, the serialized state file, and stop. Run: bun test.

import { expect, test } from "bun:test";
import {
  NotesPipeline,
  type AiCallOptions,
  type ChapterGenInput,
  type NotesDeps,
  type PlanOutcome,
} from "../../../../src/reading/prep/chapters/pipeline";
import { NOTES_VERSION, type NoteChapter, type NotesState } from "../../../../src/reading/prep/chapters/types";

// A short retry delay so error-path tests (which retry the stall watchdog's
// maxAttempts) don't wait out the real 2s default between attempts, and no
// stagger so the parallel tests don't wait out the real 3s ramp.
const TEST_CONFIG = { retryDelayMs: 5, rampMs: 0 };

function chapter(index: number, title = `ch${index}`): NoteChapter {
  return { index, title, startPage: index, endPage: index, status: "pending" };
}

const PLAN: PlanOutcome = {
  chapters: [chapter(1), chapter(2)],
  source: "outline",
};

function planOf(n: number): PlanOutcome {
  return { chapters: Array.from({ length: n }, (_, i) => chapter(i + 1)), source: "outline" };
}

interface FakeOptions {
  initial?: NotesState | null;
  plan?: (opts: AiCallOptions) => Promise<PlanOutcome>;
  chapter?: (input: ChapterGenInput, opts: AiCallOptions) => Promise<string>;
  overview?: (
    chapters: { index: number; title: string; body: string }[],
    opts: AiCallOptions,
  ) => Promise<string>;
  saveState?: (state: NotesState) => Promise<void>;
  timers?: Partial<Pick<NotesDeps, "now" | "sleep" | "setTimer">>;
}

function makeFakes(opts: FakeOptions = {}) {
  const chapters = new Map<number, string>();
  let overview: string | null = null;
  const saved: NotesState[] = [];
  const deps: NotesDeps = {
    loadState: async () => opts.initial ?? null,
    saveState:
      opts.saveState ??
      (async (s) => {
        saved.push(JSON.parse(JSON.stringify(s)));
      }),
    buildPlan: opts.plan ?? (async () => JSON.parse(JSON.stringify(PLAN))),
    generateChapter:
      opts.chapter ?? (async ({ chapter: c }) => `spine for ${c.title} [p.${c.startPage}]`),
    writeChapter: async (index, body) => {
      chapters.set(index, body);
    },
    readChapterNote: async (index) => chapters.get(index) ?? null,
    buildOverview: opts.overview ?? (async () => "the chapter graph"),
    writeOverview: async (body) => {
      overview = body;
    },
    now: opts.timers?.now ?? (() => Date.now()),
    sleep: opts.timers?.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))),
    setTimer:
      opts.timers?.setTimer ??
      ((ms, cb) => {
        const id = setTimeout(cb, ms);
        return () => clearTimeout(id);
      }),
  };
  return { deps, chapters, saved, getOverview: () => overview };
}

function statuses(p: NotesPipeline): Record<number, string> {
  const out: Record<number, string> = {};
  for (const c of p.snapshot().state?.chapters ?? []) out[c.index] = c.status;
  return out;
}

async function drain(p: NotesPipeline): Promise<void> {
  for (let i = 0; i < 200 && p.snapshot().running; i++) await new Promise((r) => setTimeout(r, 1));
}

// The virtual clock the watchdog and limiter tests use, for the paths where real
// waiting would be minutes.
function makeClock(start = 1000) {
  interface Ev {
    at: number;
    seq: number;
    fire: () => void;
    cancelled: boolean;
  }
  let now = start;
  let seq = 0;
  let pumping = false;
  const q: Ev[] = [];
  function schedule(ms: number, fire: () => void): Ev {
    const ev: Ev = { at: now + Math.max(0, ms), seq: seq++, fire, cancelled: false };
    q.push(ev);
    if (!pumping) {
      pumping = true;
      void pump();
    }
    return ev;
  }
  async function pump(): Promise<void> {
    for (let guard = 0; guard < 100000; guard++) {
      await new Promise<void>((r) => setTimeout(r, 0));
      const live = q.filter((e) => !e.cancelled);
      if (live.length === 0) {
        pumping = false;
        return;
      }
      live.sort((a, b) => a.at - b.at || a.seq - b.seq);
      const ev = live[0];
      q.splice(q.indexOf(ev), 1);
      if (ev.at > now) now = ev.at;
      ev.fire();
    }
    pumping = false;
  }
  return {
    now: () => now,
    sleep: (ms: number) => new Promise<void>((resolve) => schedule(ms, resolve)),
    setTimer: (ms: number, cb: () => void) => {
      const ev = schedule(ms, cb);
      return () => {
        ev.cancelled = true;
      };
    },
  };
}

test("full run: plan, every chapter, the graph, everything on disk", async () => {
  const { deps, chapters, getOverview } = makeFakes();
  const p = new NotesPipeline("book", "Book.pdf", deps, TEST_CONFIG);
  await p.ensureStarted();
  expect(p.snapshot().state?.planStatus).toBe("done");
  expect(p.snapshot().state?.planSource).toBe("outline");
  expect(statuses(p)).toEqual({ 1: "done", 2: "done" });
  expect(chapters.get(1)).toContain("ch1");
  expect(p.snapshot().state?.overviewStatus).toBe("done");
  expect(getOverview()).toBe("the chapter graph");
  expect(p.snapshot().running).toBe(false);
});

// The point of the rewrite: chapter calls share nothing, so they run together.
test("chapters run together, up to the limit", async () => {
  let live = 0;
  let peak = 0;
  const { deps } = makeFakes({
    plan: async () => planOf(6),
    chapter: async () => {
      live++;
      peak = Math.max(peak, live);
      await new Promise((r) => setTimeout(r, 5));
      live--;
      return "n";
    },
  });
  const p = new NotesPipeline("b", "s", deps, { ...TEST_CONFIG, limit: 3 });
  await p.ensureStarted();
  expect(peak).toBe(3);
  expect(statuses(p)).toEqual({ 1: "done", 2: "done", 3: "done", 4: "done", 5: "done", 6: "done" });
});

// Every status change rewrites the whole state file. With six chapters changing
// status at once, two overlapping writes would race to write the same path.
test("state writes never overlap", async () => {
  let writing = 0;
  let overlaps = 0;
  let writes = 0;
  const { deps } = makeFakes({
    plan: async () => planOf(6),
    saveState: async () => {
      writes++;
      if (writing > 0) overlaps++;
      writing++;
      await new Promise((r) => setTimeout(r, 1));
      writing--;
    },
  });
  const p = new NotesPipeline("b", "s", deps, TEST_CONFIG);
  await p.ensureStarted();
  expect(overlaps).toBe(0);
  expect(writes).toBeGreaterThan(0);
  expect(statuses(p)[6]).toBe("done");
});

test("each chapter call is handed the whole chapter table, with itself in it", async () => {
  const seen: { index: number; table: number[] }[] = [];
  const { deps } = makeFakes({
    plan: async () => planOf(3),
    chapter: async ({ chapter: c, chapters }) => {
      seen.push({ index: c.index, table: chapters.map((x) => x.index) });
      return "n";
    },
  });
  const p = new NotesPipeline("b", "s", deps, TEST_CONFIG);
  await p.ensureStarted();
  expect(seen.length).toBe(3);
  for (const s of seen) expect(s.table).toEqual([1, 2, 3]);
});

test("a failed chapter is isolated and blocks the graph", async () => {
  const { deps, getOverview } = makeFakes({
    chapter: async ({ chapter: c }) => {
      if (c.index === 1) throw new Error("model down");
      return "n";
    },
  });
  const p = new NotesPipeline("b", "s", deps, TEST_CONFIG);
  await p.ensureStarted();
  expect(statuses(p)).toEqual({ 1: "failed", 2: "done" });
  expect(p.snapshot().state?.chapters[0].error).toBe("model down");
  expect(p.snapshot().state?.overviewStatus).toBe("pending"); // not all done
  expect(getOverview()).toBeNull();
});

test("retryChapter reruns a failed chapter and then the graph", async () => {
  let fail = true;
  const { deps, getOverview } = makeFakes({
    chapter: async ({ chapter: c }) => {
      if (c.index === 1 && fail) throw new Error("boom");
      return "n";
    },
  });
  const p = new NotesPipeline("b", "s", deps, TEST_CONFIG);
  await p.ensureStarted();
  expect(statuses(p)[1]).toBe("failed");
  fail = false;
  p.retryChapter(1);
  await drain(p);
  expect(statuses(p)).toEqual({ 1: "done", 2: "done" });
  expect(getOverview()).toBe("the chapter graph");
});

test("a failed plan is recorded; chapters never start", async () => {
  const { deps, saved } = makeFakes({
    plan: async () => {
      throw new Error("bad toc");
    },
  });
  const p = new NotesPipeline("b", "s", deps, TEST_CONFIG);
  await p.ensureStarted();
  expect(p.snapshot().state?.planStatus).toBe("failed");
  expect(p.snapshot().state?.planError).toBe("bad toc");
  expect(saved.some((s) => s.chapters.length > 0)).toBe(false);
});

test("retryPlan replans a failed plan and completes", async () => {
  let fail = true;
  const { deps } = makeFakes({
    plan: async () => {
      if (fail) throw new Error("bad toc");
      return JSON.parse(JSON.stringify(PLAN));
    },
  });
  const p = new NotesPipeline("b", "s", deps, TEST_CONFIG);
  await p.ensureStarted();
  expect(p.snapshot().state?.planStatus).toBe("failed");
  fail = false;
  p.retryPlan();
  await drain(p);
  expect(p.snapshot().state?.planStatus).toBe("done");
  expect(statuses(p)).toEqual({ 1: "done", 2: "done" });
});

test("resume: an interrupted running chapter is requeued and finishes", async () => {
  const initial: NotesState = {
    version: NOTES_VERSION,
    bookId: "b",
    bookName: "s",
    createdAt: 0,
    planStatus: "done",
    chapters: [
      { ...chapter(1), status: "running" },
      { ...chapter(2), status: "done" },
    ],
    overviewStatus: "pending",
  };
  const { deps } = makeFakes({ initial });
  const p = new NotesPipeline("b", "s", deps, TEST_CONFIG);
  await p.ensureStarted();
  expect(statuses(p)).toEqual({ 1: "done", 2: "done" });
  expect(p.snapshot().state?.overviewStatus).toBe("done");
});

test("the graph is written from every chapter's spine", async () => {
  const graphInputs: number[] = [];
  const { deps } = makeFakes({
    plan: async () => planOf(4),
    overview: async (chapters) => {
      graphInputs.push(...chapters.map((c) => c.index));
      return "graph";
    },
  });
  const p = new NotesPipeline("b", "s", deps, TEST_CONFIG);
  await p.ensureStarted();
  expect(graphInputs).toEqual([1, 2, 3, 4]);
});

test("regenerateChapter reruns just that chapter and marks the graph stale", async () => {
  let gen1 = 0;
  const { deps } = makeFakes({
    chapter: async ({ chapter: c, instruction }) => {
      if (c.index === 1) gen1++;
      return instruction ? `revised: ${instruction}` : `spine ${c.index}`;
    },
  });
  const p = new NotesPipeline("b", "s", deps, TEST_CONFIG);
  await p.ensureStarted();
  expect(p.snapshot().state?.overviewStatus).toBe("done");
  expect(gen1).toBe(1);

  p.regenerateChapter(1, "shorter");
  await drain(p);
  expect(gen1).toBe(2); // chapter 1 re-ran
  expect(statuses(p)).toEqual({ 1: "done", 2: "done" }); // chapter 2 untouched
  expect(p.snapshot().state?.overviewStatus).toBe("stale"); // not auto-regenerated
});

test("regenerateOverview refreshes a stale graph", async () => {
  let graphCalls = 0;
  const { deps } = makeFakes({
    overview: async () => {
      graphCalls++;
      return `graph v${graphCalls}`;
    },
  });
  const p = new NotesPipeline("b", "s", deps, TEST_CONFIG);
  await p.ensureStarted();
  p.regenerateChapter(2);
  await drain(p);
  expect(p.snapshot().state?.overviewStatus).toBe("stale");

  p.regenerateOverview();
  await drain(p);
  expect(p.snapshot().state?.overviewStatus).toBe("done");
  expect(graphCalls).toBe(2);
});

test("stop aborts every in-flight chapter and starts none of the queued ones", async () => {
  const started = new Set<number>();
  const { deps } = makeFakes({
    plan: async () => planOf(4),
    // Every chapter hangs until its signal aborts.
    chapter: ({ chapter: c }, opts) => {
      started.add(c.index);
      return new Promise<string>((_, reject) => {
        opts.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      });
    },
    // A huge watchdog window so the stall timer never fires during the test.
    timers: { setTimer: () => () => {} },
  });
  const p = new NotesPipeline("b", "s", deps, { ...TEST_CONFIG, limit: 2 });
  const run = p.ensureStarted();
  for (let i = 0; i < 50 && started.size < 2; i++) await new Promise((r) => setTimeout(r, 1));
  expect(started.size).toBe(2); // the limit, not all four
  p.stop();
  await run;
  expect(p.snapshot().running).toBe(false);
  // Aborted and never-started alike are left pending, not failed.
  expect(statuses(p)).toEqual({ 1: "pending", 2: "pending", 3: "pending", 4: "pending" });
  expect(p.snapshot().state?.overviewStatus).toBe("pending");
  expect(started.size).toBe(2);
});

// A 429 is the group being told to slow down, not one unlucky call. The chapter
// that hit it waits out the interval the provider named, and so does every
// chapter still queued behind it.
test("a rate limit slows the whole group, and the call retries after it", async () => {
  const clock = makeClock();
  const starts: { index: number; at: number }[] = [];
  let limited = false;
  const { deps } = makeFakes({
    plan: async () => planOf(4),
    chapter: async ({ chapter: c }) => {
      starts.push({ index: c.index, at: clock.now() });
      if (c.index === 1 && !limited) {
        limited = true;
        throw new Error("HTTP 429 rate_limit_error; retry-after: 30");
      }
      await clock.sleep(10);
      return "n";
    },
    timers: clock,
  });
  const p = new NotesPipeline("b", "s", deps, { retryDelayMs: 5, rampMs: 0, limit: 1 });
  const run = p.ensureStarted();
  for (let i = 0; i < 400 && p.snapshot().running; i++) await new Promise((r) => setTimeout(r, 0));
  await run;
  expect(statuses(p)).toEqual({ 1: "done", 2: "done", 3: "done", 4: "done" });
  const firstAttempt = starts[0].at;
  // Everything after the 429 — the retry of chapter 1 included — waited out the
  // 30 seconds the provider asked for.
  for (const s of starts.slice(1)) expect(s.at - firstAttempt).toBeGreaterThanOrEqual(30_000);
});

// The book name goes into every chapter prompt. A state written before host
// paths were normalized holds the percent-encoded filename, and the model was
// being told the book is called "%E4%B8%AD%E6%96%87.pdf".
test("resume: a book name left percent-encoded by an iOS import is decoded", async () => {
  const initial: NotesState = {
    version: NOTES_VERSION,
    bookId: "b",
    bookName: "%E4%B8%AD%E6%96%87.pdf",
    createdAt: 0,
    planStatus: "done",
    chapters: [{ ...chapter(1), status: "done" }],
    overviewStatus: "done",
  };
  const { deps } = makeFakes({ initial });
  const p = new NotesPipeline("b", "中文.pdf", deps, TEST_CONFIG);
  await p.ensureStarted();
  expect(p.snapshot().state?.bookName).toBe("中文.pdf");
});
