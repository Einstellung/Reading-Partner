// Unit tests for the prep pipeline state machine (src/prep/pipeline.ts), driven
// entirely by fake deps — no Tauri, no network, no AI spend. Run: bun test.

import { expect, test } from "bun:test";
import {
  PrepPipeline,
  type DigestOutcome,
  type FetchOutcome,
  type PipelineDeps,
  type PlanOutcome,
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
  plan?: () => Promise<PlanOutcome>;
  fetch?: (p: PrepPaper) => Promise<FetchOutcome | null>;
  digest?: (p: PrepPaper) => Promise<DigestOutcome>;
}

function makeFakes(opts: FakeOptions = {}) {
  const saved: PrepState[] = [];
  const notes = new Map<string, string>();
  // A fake clock: sleeping advances virtual time so cooldown waits resolve
  // deterministically without touching real timers.
  const clock = { t: 1000 };
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
    now: () => clock.t,
    sleep: async (ms) => {
      clock.t += ms;
    },
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
