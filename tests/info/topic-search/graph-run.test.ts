// Which runs expand a study's graph (docs/info/92), and with what: a study's
// first look, its retry with graph streams to read again and its update do;
// every other run reads exactly what it read before.

import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerProgramTask, runProgramTask } from "../../../src/legion/durable/program-task";
import { emptyGraphRead } from "../../../src/info/topic-search/graph-read";
import {
  graphRunKind,
  topicSearchTask,
  type GraphRunAbout,
  type TopicSearchBrief,
  type TopicSearchRunDeps,
  type TopicSearchRunResult,
} from "../../../src/info/topic-search/run";
import type { RetryPlan } from "../../../src/info/topic-search/retry";
import {
  loadArxivRead,
  loadFirstPart,
  loadHfRead,
  loadRead,
  saveArxivRead,
  saveFirstPart,
  saveHfRead,
  saveRead,
  type StateFs,
} from "../../../src/info/topic-search/run-state";
import type { TopicSearch } from "../../../src/info/topic-search/types";
import { openTestRuntime } from "../../legion/durable/support/runtime";

const SEARCH: TopicSearch = {
  id: "ts-0a1b2c3d",
  name: "Mechanism discovery",
  concernId: null,
  scope: "",
  subtopics: [],
  want: [],
  avoid: [],
  judgments: [],
  anchors: [],
  queries: [{ id: "q1", subtopic: null, x: "q1", arxiv: "mechanism discovery", ranking: "", weight: 1 }],
  answers: [],
  status: "active",
  sources: ["arxiv"],
  revision: 1,
  createdAt: 0,
  lastRunAt: null,
};
const STUDY: TopicSearch = { ...SEARCH, once: true, seeds: [{ key: "arxiv:2601.00001", title: "Seed", said: "seed", at: 1 }] };

function memFs(): StateFs {
  const files = new Map<string, string>();
  return {
    exists: async (p) => files.has(p),
    readText: async (p) => files.get(p) ?? "",
    writeAtomic: async (p, text) => void files.set(p, text),
    appendText: async (p, text) => void files.set(p, (files.get(p) ?? "") + text),
    mkdirp: async () => {},
  };
}

const NOW = new Date(2026, 9, 22, 14).getTime();

function world(search: TopicSearch, opts: { retry?: RetryPlan; fail?: boolean } = {}) {
  const fs = memFs();
  const graphs: GraphRunAbout[] = [];
  const lines: string[] = [];
  const deps = {
    loadSearch: async () => search,
    ran: async () => {},
    builder: () => async () => ({ resultFile: null, itemCount: 0, empty: true }),
    xPages: () => ({ permalinks: 0 }),
    foldSourceHealth: async () => {},
    runDir: async (runId: string) => `topic-search-runs/${runId}`,
    progress: () => ({ load: async () => [], append: async () => {} }),
    saveRead: (dir: string, x: Parameters<typeof saveRead>[2]) => saveRead(fs, dir, x),
    loadRead: (dir: string) => loadRead(fs, dir),
    searchArxiv: async () => [],
    saveArxiv: (dir: string, read: Parameters<typeof saveArxivRead>[2]) => saveArxivRead(fs, dir, read),
    loadArxiv: (dir: string) => loadArxivRead(fs, dir),
    searchHf: async () => [],
    saveHf: (dir: string, read: Parameters<typeof saveHfRead>[2]) => saveHfRead(fs, dir, read),
    loadHf: (dir: string) => loadHfRead(fs, dir),
    saveFirstPart: (dir: string, part: Parameters<typeof saveFirstPart>[2]) => saveFirstPart(fs, dir, part),
    loadFirstPart: (dir: string) => loadFirstPart(fs, dir),
    memory: { load: async () => ({}), save: async () => {} },
    nightLimits: async () => ({}),
    spendNight: async () => {},
    gate: async () => null,
    readClean: async () => {},
    checkSession: async () => "ok" as const,
    retryPlan: async () => opts.retry ?? { x: [], arxiv: [], huggingface: [] },
    updatePlan: async () => [],
    readGraph: async (about: GraphRunAbout, _signal: AbortSignal, onChange?: (read: ReturnType<typeof emptyGraphRead>) => void) => {
      graphs.push(about);
      if (opts.fail) throw new Error("the disk is full");
      const read = emptyGraphRead([], []);
      onChange?.(read);
      return read;
    },
    halted: async () => {},
    keepAwake: async () => ({ held: true, detail: null, release: async () => {} }),
    open: async () => {
      throw new Error("no browsing here");
    },
    expandLink: async () => null,
    closed: async () => {},
    lane: <T>(work: () => Promise<T>) => work(),
    report: (_runId: string, text: string) => void lines.push(text),
    now: () => NOW,
    random: () => 0.5,
    sleep: async () => {},
  } as unknown as TopicSearchRunDeps;
  return { deps, graphs, lines };
}

async function run(deps: TopicSearchRunDeps, runId: string, brief: TopicSearchBrief): Promise<TopicSearchRunResult> {
  const task = topicSearchTask(deps);
  const off = registerProgramTask(task);
  const t = await openTestRuntime({ root: mkdtempSync(join(tmpdir(), "ts-graph-run-")), responses: [] });
  try {
    const outcome = await runProgramTask<TopicSearchRunResult>(t.runtime, { task, key: runId, name: "topic-search", input: { runId, brief } });
    if (outcome.status !== "completed") throw new Error(`run ${runId}: ${JSON.stringify(outcome)}`);
    return outcome.result;
  } finally {
    off();
  }
}

describe("which runs expand the graph", () => {
  test("a study's first look, once, over a year's window", async () => {
    const w = world(STUDY);
    await run(w.deps, "r-1", { searchId: STUDY.id, kind: "first", night: null });
    expect(w.graphs.map((g) => [g.kind, g.since, g.only, g.dir])).toEqual([["first", "2025-10-22", null, "topic-search-runs/r-1"]]);
    expect(w.lines.some((l) => l.includes("arXiv done") && l.includes("citation graph: 0 of 1 streams read"))).toBe(true);
    expect(w.lines.some((l) => l.startsWith("read 0 arXiv and 0 Hugging Face papers, 0 from the citation graph;"))).toBe(true);
  });

  test("a topic that is not a study reads no graph and says nothing of one", async () => {
    const w = world(SEARCH);
    await run(w.deps, "r-2", { searchId: SEARCH.id, kind: "first", night: null });
    expect(w.graphs).toEqual([]);
    expect(w.lines.some((l) => l.includes("graph"))).toBe(false);
  });

  test("a study's update, and a retry only with graph streams to read again", async () => {
    const u = world(STUDY);
    await run(u.deps, "r-3", { searchId: STUDY.id, kind: "update", night: null, n: 1 });
    expect(u.graphs.map((g) => [g.kind, g.only])).toEqual([["update", null]]);

    const r = world(STUDY, { retry: { x: [], arxiv: [], huggingface: [], graph: ["cites:arxiv:2601.00001"] } });
    await run(r.deps, "r-4", { searchId: STUDY.id, kind: "retry", night: null, n: 1 });
    expect(r.graphs.map((g) => [g.kind, g.only])).toEqual([["retry", ["cites:arxiv:2601.00001"]]]);

    const none = world(STUDY, { retry: { x: [], arxiv: ["q1"], huggingface: [] } });
    await run(none.deps, "r-5", { searchId: STUDY.id, kind: "retry", night: null, n: 2 });
    expect(none.graphs).toEqual([]);
  });

  test("an expansion that fails is told, and the run builds without it", async () => {
    const w = world(STUDY, { fail: true });
    const result = await run(w.deps, "r-6", { searchId: STUDY.id, kind: "first", night: null });
    expect(result.status).toBe("empty");
    expect(w.lines.some((l) => l.includes("citation graph failed: the disk is full"))).toBe(true);
  });

  test("not a split first look's slow part, nor a study that reads no papers", () => {
    expect(graphRunKind(STUDY, "first", { part: "fast" })).toBe("first");
    expect(graphRunKind(STUDY, "first", { part: "slow" })).toBeNull();
    expect(graphRunKind({ ...STUDY, sources: ["x"] }, "first", {})).toBeNull();
    expect(graphRunKind({ ...STUDY, sources: ["huggingface"] }, "first", {})).toBe("first");
    expect(graphRunKind(STUDY, "daily", {})).toBeNull();
  });
});
