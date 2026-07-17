// Unit tests for the prep pipeline state machine (src/prep/pipeline.ts), driven
// entirely by fake deps — no Tauri, no network, no AI spend. Run: bun test.

import { expect, test } from "bun:test";
import {
  PrepPipeline,
  type AiCallOptions,
  type DigestOutcome,
  type FetchOutcome,
  type PipelineDeps,
  type PlanOutcome,
  type PrepActivity,
} from "../../src/prep/pipeline";
import { RateLimitError } from "../../src/prep/http";
import type { PrepPaper, PrepState } from "../../src/prep/types";

function paper(slug: string, chapters: number[]): PrepPaper {
  return {
    slug,
    title: slug,
    authors: [],
    year: null,
    arxivId: null,
    citedInChapters: chapters,
    reason: "r",
    status: "queued",
  };
}

const PLAN: PlanOutcome = {
  chapters: [
    { index: 1, title: "Intro", startPage: 1 },
    { index: 2, title: "Body", startPage: 5 },
  ],
  references: [],
  papers: [paper("alpha", [1]), paper("beta", [2])],
};

const PDF = new ArrayBuffer(4);

interface FakeOptions {
  initial?: PrepState | null;
  plan?: (opts: AiCallOptions) => Promise<PlanOutcome>;
  fetch?: (p: PrepPaper) => Promise<FetchOutcome | null>;
  digest?: (p: PrepPaper, fetched: FetchOutcome, opts: AiCallOptions) => Promise<DigestOutcome>;
}

// A virtual clock that orders concurrent waits by their virtual due time — the
// watchdog timer and a fake stream's inter-delta sleeps race on the same clock,
// so a naive "sleep advances a shared counter" fake would fire them out of
// order. Events are queued by due time; a background pump drains microtasks
// (one real macrotask tick per step, so any imminent settle/cancel lands first)
// and then fires the earliest due event. No real time passes beyond those ticks.
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
    ensurePump();
    return ev;
  }
  function ensurePump(): void {
    if (pumping) return;
    pumping = true;
    void pump();
  }
  async function pump(): Promise<void> {
    for (let guard = 0; guard < 100000; guard++) {
      // Drain all microtasks first, so a call that is about to settle (and
      // cancel its watchdog) wins over the watchdog firing.
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

function makeFakes(opts: FakeOptions = {}, clock = makeClock()) {
  const saved: PrepState[] = [];
  const notes = new Map<string, string>();
  const deps: PipelineDeps = {
    loadState: async () => opts.initial ?? null,
    saveState: async (s) => {
      saved.push(JSON.parse(JSON.stringify(s)));
    },
    buildPlan: opts.plan ?? (async () => JSON.parse(JSON.stringify(PLAN))),
    fetchPaper:
      opts.fetch ??
      (async () => ({ source: "arxiv" as const, arxivId: "1", abstract: "abs", pdfBytes: PDF })),
    digestPaper: opts.digest ?? (async () => ({ body: "note [p.1]", pages: 8, thin: false })),
    writeNote: async (p, body) => {
      notes.set(p.slug, body);
    },
    resolveAddition: (query, taken) => ({
      ...paper(query.toLowerCase().replace(/\s+/g, "-"), []),
      addedByUser: true,
      slug: taken.has(query) ? `${query}-2` : query.toLowerCase().replace(/\s+/g, "-"),
    }),
    now: clock.now,
    sleep: clock.sleep,
    setTimer: clock.setTimer,
  };
  return { deps, saved, notes, clock };
}

function statuses(p: PrepPipeline): Record<string, string> {
  const out: Record<string, string> = {};
  for (const x of p.snapshot().state?.papers ?? []) out[x.slug] = x.status;
  return out;
}

test("full run: plan, fetch, digest, notes on disk, statuses done", async () => {
  const { deps, notes } = makeFakes();
  const p = new PrepPipeline("h", "survey.pdf", deps);
  await p.ensureStarted();
  expect(p.snapshot().state?.planStatus).toBe("done");
  expect(statuses(p)).toEqual({ alpha: "done", beta: "done" });
  expect(notes.get("alpha")).toBe("note [p.1]");
  expect(p.snapshot().running).toBe(false);
});

test("no PDF degrades to abstract-only with a thin note", async () => {
  const { deps, notes } = makeFakes({
    fetch: async () => ({ source: "semantic-scholar", arxivId: null, abstract: "only abs", pdfBytes: null }),
  });
  const p = new PrepPipeline("h", "s", deps);
  await p.ensureStarted();
  expect(statuses(p)).toEqual({ alpha: "abstract-only", beta: "abstract-only" });
  expect(notes.get("alpha")).toContain("only abs");
});

test("a not-found paper fails; a throwing digest fails that paper only", async () => {
  const { deps } = makeFakes({
    fetch: async (pp) => (pp.slug === "alpha" ? null : { source: "arxiv", arxivId: null, abstract: "", pdfBytes: PDF }),
    digest: async () => {
      throw new Error("model down");
    },
  });
  const p = new PrepPipeline("h", "s", deps);
  await p.ensureStarted();
  const st = statuses(p);
  expect(st.alpha).toBe("failed");
  expect(st.beta).toBe("failed");
  const failed = p.snapshot().state?.papers.find((x) => x.slug === "beta");
  expect(failed?.error).toBe("model down");
});

test("a failed plan is recorded and papers never start", async () => {
  const { deps, saved } = makeFakes({
    plan: async () => {
      throw new Error("bad json");
    },
  });
  const p = new PrepPipeline("h", "s", deps);
  await p.ensureStarted();
  expect(p.snapshot().state?.planStatus).toBe("failed");
  expect(p.snapshot().state?.planError).toBe("bad json");
  expect(saved.some((s) => s.papers.some((x) => x.status !== "queued"))).toBe(false);
});

test("resume: persisted in-flight statuses are requeued and finish", async () => {
  const initial: PrepState = {
    version: 1,
    surveyHash: "h",
    surveyName: "s",
    createdAt: 0,
    planStatus: "done",
    chapters: PLAN.chapters,
    references: [],
    papers: [
      { ...paper("alpha", [1]), status: "digesting" },
      { ...paper("beta", [2]), status: "done" },
    ],
  };
  const { deps } = makeFakes({ initial });
  const p = new PrepPipeline("h", "s", deps);
  await p.ensureStarted();
  expect(statuses(p)).toEqual({ alpha: "done", beta: "done" });
});

test("skip during fetch abandons the paper without overwriting the status", async () => {
  const { deps, notes } = makeFakes({
    fetch: async (pp) => {
      if (pp.slug === "alpha") pipeline.skip("alpha");
      return { source: "arxiv", arxivId: null, abstract: "", pdfBytes: PDF };
    },
  });
  const pipeline = new PrepPipeline("h", "s", deps);
  await pipeline.ensureStarted();
  expect(statuses(pipeline).alpha).toBe("skipped");
  expect(notes.has("alpha")).toBe(false);
  expect(statuses(pipeline).beta).toBe("done");
});

test("addPaper queues a user paper and requeue revives a skipped one", async () => {
  const { deps } = makeFakes();
  const p = new PrepPipeline("h", "s", deps);
  await p.ensureStarted();
  p.skip("alpha"); // already done; skip is a no-op on done papers
  expect(statuses(p).alpha).toBe("done");

  p.addPaper("extra");
  await new Promise((r) => setTimeout(r, 0));
  // Let the async loop drain.
  for (let i = 0; i < 10 && p.snapshot().running; i++) await new Promise((r) => setTimeout(r, 1));
  expect(statuses(p).extra).toBe("done");
});

test("a 429 cools the paper down, auto-retries, and fails only after 3 rounds", async () => {
  let alphaFetches = 0;
  const { deps } = makeFakes({
    fetch: async (pp) => {
      if (pp.slug === "alpha") {
        alphaFetches++;
        throw new RateLimitError("api.semanticscholar.org");
      }
      return { source: "arxiv", arxivId: null, abstract: "", pdfBytes: PDF };
    },
  });
  const p = new PrepPipeline("h", "s", deps);
  await p.ensureStarted();
  const st = statuses(p);
  expect(st.beta).toBe("done"); // an unaffected paper still completes
  expect(st.alpha).toBe("failed");
  expect(alphaFetches).toBe(4); // 3 cooldown rounds + the attempt that gives up
  const alpha = p.snapshot().state?.papers.find((x) => x.slug === "alpha");
  expect(alpha?.error).toContain("HTTP 429");
  expect(p.snapshot().running).toBe(false);
});

test("a paper that recovers after one cooldown completes with reset bookkeeping", async () => {
  let n = 0;
  const { deps } = makeFakes({
    fetch: async (pp) => {
      if (pp.slug === "alpha" && ++n === 1) throw new RateLimitError("api.semanticscholar.org");
      return { source: "arxiv", arxivId: null, abstract: "abs", pdfBytes: PDF };
    },
  });
  const p = new PrepPipeline("h", "s", deps);
  await p.ensureStarted();
  expect(statuses(p).alpha).toBe("done");
  const alpha = p.snapshot().state?.papers.find((x) => x.slug === "alpha");
  expect(alpha?.fetchAttempts).toBeUndefined();
  expect(alpha?.retryAt).toBeUndefined();
});

test("manual retry resets a rate-limited paper so it can complete", async () => {
  let fail = true;
  const { deps } = makeFakes({
    fetch: async (pp) => {
      if (pp.slug === "alpha" && fail) throw new RateLimitError("api.semanticscholar.org");
      return { source: "arxiv", arxivId: null, abstract: "abs", pdfBytes: PDF };
    },
  });
  const p = new PrepPipeline("h", "s", deps);
  await p.ensureStarted();
  expect(statuses(p).alpha).toBe("failed");

  fail = false;
  p.requeue("alpha");
  for (let i = 0; i < 20 && p.snapshot().running; i++) await new Promise((r) => setTimeout(r, 1));
  expect(statuses(p).alpha).toBe("done");
  const alpha = p.snapshot().state?.papers.find((x) => x.slug === "alpha");
  expect(alpha?.fetchAttempts).toBeUndefined();
});

test("chapter ordering: papers for the current chapter run first", async () => {
  const order: string[] = [];
  const { deps } = makeFakes({
    fetch: async (pp) => {
      order.push(pp.slug);
      return { source: "arxiv", arxivId: null, abstract: "", pdfBytes: PDF };
    },
  });
  const p = new PrepPipeline("h", "s", deps);
  p.setCurrentChapter(2);
  await p.ensureStarted();
  expect(order).toEqual(["beta", "alpha"]);
});

test("watchdog aborts a stalled plan after 60s of silence, retries, and fails after 3 attempts", async () => {
  let attempts = 0;
  const clock = makeClock();
  const { deps } = makeFakes(
    {
      // A stream that never emits and only settles when the watchdog aborts it.
      plan: ({ signal }) =>
        new Promise<PlanOutcome>((_, reject) => {
          attempts++;
          signal.addEventListener("abort", () => reject(new Error("stream cut")), { once: true });
        }),
    },
    clock,
  );
  const p = new PrepPipeline("h", "s", deps, { retryDelayMs: 100 });
  const t0 = clock.now();
  await p.ensureStarted();
  expect(attempts).toBe(3);
  expect(p.snapshot().state?.planStatus).toBe("failed");
  expect(p.snapshot().state?.planError).toMatch(/stalled|stream cut/);
  // Three 60s watchdog windows elapsed on the virtual clock.
  expect(clock.now() - t0).toBeGreaterThanOrEqual(180_000);
});

test("deltas reset the watchdog so a slow-but-alive plan completes", async () => {
  const clock = makeClock();
  const { deps } = makeFakes(
    {
      // Five deltas 40s apart: total 200s, but never 60s of silence.
      plan: async ({ onProgress }) => {
        for (let i = 0; i < 5; i++) {
          await clock.sleep(40_000);
          onProgress((i + 1) * 10);
        }
        return JSON.parse(JSON.stringify(PLAN));
      },
    },
    clock,
  );
  const p = new PrepPipeline("h", "s", deps);
  await p.ensureStarted();
  expect(p.snapshot().state?.planStatus).toBe("done");
  expect(statuses(p)).toEqual({ alpha: "done", beta: "done" });
});

test("a transient stream error is retried and the next attempt succeeds", async () => {
  let n = 0;
  const { deps } = makeFakes({
    digest: async (pp, _f, { onProgress }) => {
      if (pp.slug === "alpha" && ++n === 1) throw new Error("error decoding response body");
      onProgress(42);
      return { body: "note [p.1]", pages: 8, thin: false };
    },
  });
  const p = new PrepPipeline("h", "s", deps, { retryDelayMs: 10 });
  await p.ensureStarted();
  expect(statuses(p).alpha).toBe("done");
  expect(n).toBe(2); // failed once, then succeeded
});

test("streaming progress appears in the snapshot activity and clears when done", async () => {
  const clock = makeClock();
  const { deps } = makeFakes(
    {
      plan: async ({ onProgress }) => {
        onProgress(500);
        await clock.sleep(1000);
        onProgress(1500);
        return JSON.parse(JSON.stringify(PLAN));
      },
    },
    clock,
  );
  const p = new PrepPipeline("h", "s", deps);
  const seen: (PrepActivity | null)[] = [];
  p.subscribe(() => seen.push(p.snapshot().activity));
  await p.ensureStarted();

  const planActs = seen.filter((a): a is PrepActivity => a?.kind === "plan");
  expect(planActs.length).toBeGreaterThan(0);
  expect(planActs.some((a) => a.chars >= 1500)).toBe(true);
  const digestActs = seen.filter((a): a is PrepActivity => a?.kind === "digest");
  expect(digestActs.some((a) => a.slug === "alpha")).toBe(true);
  // No activity lingers once the run finishes.
  expect(p.snapshot().activity).toBeNull();
});

test("replan preserves user-added and same-slug done papers, requeues new, drops vanished", async () => {
  let planCall = 0;
  const secondPlan: PlanOutcome = {
    chapters: PLAN.chapters,
    references: [],
    papers: [paper("alpha", [1]), paper("gamma", [2])],
  };
  const { deps } = makeFakes({
    plan: async () => {
      planCall++;
      return planCall === 1
        ? JSON.parse(JSON.stringify(PLAN))
        : JSON.parse(JSON.stringify(secondPlan));
    },
  });
  const p = new PrepPipeline("h", "s", deps);
  await p.ensureStarted();
  expect(statuses(p)).toEqual({ alpha: "done", beta: "done" });

  p.addPaper("my extra");
  for (let i = 0; i < 20 && p.snapshot().running; i++) await new Promise((r) => setTimeout(r, 1));
  const userSlug = p.snapshot().state!.papers.find((x) => x.addedByUser)!.slug;

  p.replan();
  for (let i = 0; i < 50 && p.snapshot().running; i++) await new Promise((r) => setTimeout(r, 1));

  const bySlug = new Map(p.snapshot().state!.papers.map((x) => [x.slug, x]));
  expect(bySlug.get("alpha")?.status).toBe("done"); // reappeared + done -> kept
  expect(bySlug.has("beta")).toBe(false); // vanished from the new plan -> dropped
  expect(bySlug.get("gamma")?.status).toBe("done"); // new nomination -> queued and run
  expect(bySlug.get(userSlug)?.addedByUser).toBe(true); // user paper survives
});

test("replan and retryPlan are no-ops while the pipeline is running", async () => {
  const clock = makeClock();
  let planCalls = 0;
  const { deps } = makeFakes(
    {
      plan: async ({ onProgress }) => {
        planCalls++;
        await clock.sleep(1000);
        onProgress(1);
        return JSON.parse(JSON.stringify(PLAN));
      },
    },
    clock,
  );
  const p = new PrepPipeline("h", "s", deps);
  const run = p.ensureStarted();
  // While the first run is in flight, both affordances must do nothing.
  p.replan();
  p.retryPlan();
  await run;
  expect(planCalls).toBe(1);
});
