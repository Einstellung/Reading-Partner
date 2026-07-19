// Unit tests for the notes pipeline state machine (src/notes/pipeline.ts),
// driven entirely by fake deps — no Tauri, no network, no AI spend. Run: bun test.

import { expect, test } from "bun:test";
import {
  NotesPipeline,
  type AiCallOptions,
  type ChapterGenInput,
  type NotesDeps,
  type PlanOutcome,
} from "../../src/notes/pipeline";
import type { NoteChapter, NotesState } from "../../src/notes/types";

// A short retry delay so error-path tests (which retry the stall watchdog's
// maxAttempts) don't wait out the real 2s default between attempts.
const TEST_CONFIG = { retryDelayMs: 5 };

function chapter(index: number, title = `ch${index}`): NoteChapter {
  return { index, title, startPage: index, endPage: index, status: "pending" };
}

const PLAN: PlanOutcome = {
  chapters: [chapter(1), chapter(2)],
  source: "outline",
};

interface FakeOptions {
  initial?: NotesState | null;
  plan?: (opts: AiCallOptions) => Promise<PlanOutcome>;
  chapter?: (input: ChapterGenInput, opts: AiCallOptions) => Promise<string>;
  overview?: (
    chapters: { index: number; title: string; body: string }[],
    opts: AiCallOptions,
  ) => Promise<string>;
  timers?: Partial<Pick<NotesDeps, "now" | "sleep" | "setTimer">>;
}

function makeFakes(opts: FakeOptions = {}) {
  const chapters = new Map<number, string>();
  let overview: string | null = null;
  const saved: NotesState[] = [];
  const deps: NotesDeps = {
    loadState: async () => opts.initial ?? null,
    saveState: async (s) => {
      saved.push(JSON.parse(JSON.stringify(s)));
    },
    buildPlan: opts.plan ?? (async () => JSON.parse(JSON.stringify(PLAN))),
    generateChapter:
      opts.chapter ?? (async ({ chapter: c }) => `note for ${c.title} [p.${c.startPage}]`),
    writeChapter: async (index, body) => {
      chapters.set(index, body);
    },
    readChapterNote: async (index) => chapters.get(index) ?? null,
    buildOverview: opts.overview ?? (async () => "the whole-book framework"),
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
  for (let i = 0; i < 50 && p.snapshot().running; i++) await new Promise((r) => setTimeout(r, 1));
}

test("full run: plan, chapters in order, overview, everything on disk", async () => {
  const { deps, chapters, getOverview } = makeFakes();
  const p = new NotesPipeline("book", "Book.pdf", deps, TEST_CONFIG);
  await p.ensureStarted();
  expect(p.snapshot().state?.planStatus).toBe("done");
  expect(p.snapshot().state?.planSource).toBe("outline");
  expect(statuses(p)).toEqual({ 1: "done", 2: "done" });
  expect(chapters.get(1)).toContain("ch1");
  expect(p.snapshot().state?.overviewStatus).toBe("done");
  expect(getOverview()).toBe("the whole-book framework");
  expect(p.snapshot().running).toBe(false);
});

test("chapters run in reading order", async () => {
  const order: number[] = [];
  const { deps } = makeFakes({
    chapter: async ({ chapter: c }) => {
      order.push(c.index);
      return "n";
    },
  });
  const p = new NotesPipeline("b", "s", deps, TEST_CONFIG);
  await p.ensureStarted();
  expect(order).toEqual([1, 2]);
});

test("a failed chapter is isolated and blocks the overview", async () => {
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

test("retryChapter reruns a failed chapter and then the overview", async () => {
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
  expect(getOverview()).toBe("the whole-book framework");
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
    version: 1,
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

test("regenerateChapter reruns just that chapter and marks the overview stale", async () => {
  let gen1 = 0;
  const { deps } = makeFakes({
    chapter: async ({ chapter: c, instruction }) => {
      if (c.index === 1) gen1++;
      return instruction ? `revised: ${instruction}` : `note ${c.index}`;
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

test("regenerateOverview refreshes a stale overview", async () => {
  let overviewCalls = 0;
  const { deps } = makeFakes({
    overview: async () => {
      overviewCalls++;
      return `overview v${overviewCalls}`;
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
  expect(overviewCalls).toBe(2);
});

// A three-chapter plan with real page ranges, for the highlight-frontier tests.
const PLAN3: PlanOutcome = {
  chapters: [
    { index: 1, title: "c1", startPage: 1, endPage: 10, status: "pending" },
    { index: 2, title: "c2", startPage: 11, endPage: 20, status: "pending" },
    { index: 3, title: "c3", startPage: 21, endPage: 30, status: "pending" },
  ],
  source: "ai",
};
const plan3 = () => Promise.resolve(JSON.parse(JSON.stringify(PLAN3)) as PlanOutcome);

test("autoAdvance plans, generates marked chapters behind the frontier, skips unmarked, leaves the frontier open", async () => {
  const { deps } = makeFakes({ plan: plan3 });
  const p = new NotesPipeline("b", "s", deps, TEST_CONFIG);
  // Marks in ch1 and ch3 → frontier is ch3.
  await p.autoAdvance([{ page: 5 }, { page: 25 }]);
  await drain(p);
  expect(statuses(p)).toEqual({ 1: "done", 2: "skipped", 3: "pending" });
  // ch3 still pending → the book isn't settled → no overview yet.
  expect(p.snapshot().state?.overviewStatus).toBe("pending");
});

test("autoAdvance runs only the marked chapters, not every pending one", async () => {
  const generated: number[] = [];
  const { deps } = makeFakes({
    plan: plan3,
    chapter: async ({ chapter: c }) => {
      generated.push(c.index);
      return "n";
    },
  });
  const p = new NotesPipeline("b", "s", deps, TEST_CONFIG);
  await p.autoAdvance([{ page: 5 }, { page: 25 }]);
  await drain(p);
  expect(generated).toEqual([1]); // not ch3 (frontier), not ch2 (skipped)
});

test("autoAdvance final pass generates the last chapter and writes the overview", async () => {
  const { deps, getOverview } = makeFakes({ plan: plan3 });
  const p = new NotesPipeline("b", "s", deps, TEST_CONFIG);
  await p.autoAdvance([{ page: 5 }, { page: 25 }]);
  await drain(p);
  expect(statuses(p)).toEqual({ 1: "done", 2: "skipped", 3: "pending" });
  // Reader finished in ch3; the inclusive close pass settles the tail.
  await p.autoAdvance([{ page: 5 }, { page: 25 }], { readingPage: 28 });
  await drain(p);
  expect(statuses(p)).toEqual({ 1: "done", 2: "skipped", 3: "done" });
  expect(p.snapshot().state?.overviewStatus).toBe("done");
  expect(getOverview()).toBe("the whole-book framework");
});

test("the overview skips skipped chapters but still writes once the rest are done", async () => {
  const overviewInputs: number[] = [];
  const { deps } = makeFakes({
    plan: plan3,
    overview: async (chapters) => {
      overviewInputs.push(...chapters.map((c) => c.index));
      return "framework";
    },
  });
  const p = new NotesPipeline("b", "s", deps, TEST_CONFIG);
  // Mark ch1 and ch3, reader done → ch2 skipped, ch1+ch3 done.
  await p.autoAdvance([{ page: 5 }, { page: 25 }], { readingPage: 28 });
  await drain(p);
  expect(p.snapshot().state?.overviewStatus).toBe("done");
  expect(overviewInputs).toEqual([1, 3]); // ch2 (skipped) not fed to the overview
});

test("autoAdvance on a failing plan surfaces the failure and generates nothing", async () => {
  const { deps, saved } = makeFakes({
    plan: async () => {
      throw new Error("bad toc");
    },
  });
  const p = new NotesPipeline("b", "s", deps, TEST_CONFIG);
  await p.autoAdvance([{ page: 5 }]);
  await drain(p);
  expect(p.snapshot().state?.planStatus).toBe("failed");
  expect(saved.some((s) => s.chapters.some((c) => c.status === "done"))).toBe(false);
});

test("generateChapter overrides a skipped chapter", async () => {
  const { deps } = makeFakes({ plan: plan3 });
  const p = new NotesPipeline("b", "s", deps, TEST_CONFIG);
  await p.autoAdvance([{ page: 5 }, { page: 25 }]);
  await drain(p);
  expect(statuses(p)[2]).toBe("skipped");
  p.generateChapter(2);
  await drain(p);
  expect(statuses(p)[2]).toBe("done");
});

test("stop aborts the in-flight chapter and leaves it pending", async () => {
  const { deps } = makeFakes({
    // Chapter 1 hangs until its signal aborts; chapter 2 never reached.
    chapter: ({ chapter: c }, opts) =>
      c.index === 1
        ? new Promise<string>((_, reject) => {
            opts.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
          })
        : Promise.resolve("n"),
    // A huge watchdog window so the stall timer never fires during the test.
    timers: { setTimer: (_ms, _cb) => () => {} },
  });
  const p = new NotesPipeline("b", "s", deps, TEST_CONFIG);
  const run = p.ensureStarted();
  // Let the run reach chapter 1's generate.
  for (let i = 0; i < 20 && p.snapshot().activity?.kind !== "chapter"; i++) {
    await new Promise((r) => setTimeout(r, 1));
  }
  p.stop();
  await run;
  expect(p.snapshot().running).toBe(false);
  expect(statuses(p)[1]).toBe("pending"); // requeued, not failed
  expect(statuses(p)[2]).toBe("pending"); // never started
  expect(p.snapshot().state?.overviewStatus).toBe("pending");
});
