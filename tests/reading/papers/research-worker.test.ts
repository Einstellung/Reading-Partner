// The literature research worker (src/reading/papers/research-worker.ts,
// docs/68): the brief comes off a file, the sub-agent runs on its own harness,
// its progress is reported in the runner's wording, and what it wrote goes to an
// output file the run points at. A run that established nothing throws, so the
// runner counts the attempt.
// Run: scripts/t.sh tests/reading/papers/research-worker.test.ts

import { expect, test } from "bun:test";
import { researchWorker, RESEARCH_KIND } from "../../../src/reading/papers/research-worker";
import type { WorkerContext } from "../../../src/legion/execute/worker";
import type { SubagentDefinition, SubagentTurnFn } from "../../../src/legion/subagent";
import type { Run } from "../../../src/legion/run";

const BRIEF = "legion/briefs/one.md";

function definition(): SubagentDefinition {
  return {
    name: "research_literature",
    description: "d",
    label: "Searching the literature",
    systemPrompt: "s",
    // One tool, so evidence is required the way the real definition's is.
    tools: [
      {
        name: "search_papers",
        description: "search",
        parameters: { type: "object", properties: {} } as never,
        execute: async () => "one paper",
      },
    ],
  };
}

function context(): { ctx: WorkerContext; reported: string[] } {
  const reported: string[] = [];
  const ctx: WorkerContext = {
    run: { id: "r-abc", kind: RESEARCH_KIND } as unknown as Run,
    report: async (text) => {
      reported.push(text);
    },
    reportTool: async (tool, round) => {
      reported.push(`${tool} (round ${round})`);
    },
    delegate: async () => ({ ok: false, reason: "an agent worker has no delegate" }),
  };
  return { ctx, reported };
}

// A turn that calls the injected tool once and then writes the brief. The
// sub-agent runner wraps the tools, so calling one is what makes the evidence
// rule pass.
const answering: SubagentTurnFn = async (request) => {
  const search = request.tools.find((t) => t.name === "search_papers")!;
  await search.execute({});
  request.onRound({ round: 1, rounds: request.maxRounds });
  return { kind: "answer", text: "Smith 2023 — https://doi.org/10.1/x\nIt settles the question." };
};

function worker(turn: SubagentTurnFn, briefText = "what has been published since 2020") {
  const outputs = new Map<string, string>();
  const run = researchWorker({
    turn,
    agent: async () => definition(),
    readBrief: async (path) => {
      if (path !== BRIEF) throw new Error(`no brief at ${path}`);
      return briefText;
    },
    writeOutput: async (runId, text) => {
      const path = `legion/outputs/${runId}.md`;
      outputs.set(path, text);
      return path;
    },
  });
  return { run, outputs };
}

test("the brief the soul wrote becomes the sub-agent's whole task", async () => {
  let task = "";
  const { run } = worker(async (request) => {
    task = request.task;
    const search = request.tools.find((t) => t.name === "search_papers")!;
    await search.execute({});
    return { kind: "answer", text: "one entry" };
  });
  const { ctx } = context();
  await run(BRIEF, ctx).done;
  expect(task).toBe("what has been published since 2020");
});

test("what came back is written to an output file and the run points at it", async () => {
  const { run, outputs } = worker(answering);
  const { ctx } = context();
  const outcome = await run(BRIEF, ctx).done;

  expect(outcome).toBeTruthy();
  expect(outcome!.output).toBe("legion/outputs/r-abc.md");
  expect(outputs.get("legion/outputs/r-abc.md")).toContain("Smith 2023");
  // One line for a person looking at the run, rather than the brief again.
  expect(outcome!.progress).toContain("lookups");
});

test("the sub-agent's tools are reported in the runner's wording, and nothing else is", async () => {
  const { run } = worker(answering);
  const { ctx, reported } = context();
  await run(BRIEF, ctx).done;
  // Round 0: the tool ran before the turn announced the round it was in.
  expect(reported).toEqual(["search_papers (round 0)"]);
});

test("a run that established nothing throws, so the attempt is counted", async () => {
  // No tool ever succeeded: the words are dropped rather than delivered as a
  // finding (docs/25), and the worker fails the attempt.
  const { run, outputs } = worker(async () => ({
    kind: "answer",
    text: "There is no recent research on this.",
  }));
  const { ctx } = context();
  const attempt = run(BRIEF, ctx).done;
  await expect(attempt).rejects.toThrow("not a finding");
  await expect(attempt).rejects.not.toThrow("no recent research");
  expect(outputs.size).toBe(0);
});

test("a brief with nothing in it is a run that cannot start", async () => {
  const { run } = worker(answering, "   ");
  const { ctx } = context();
  await expect(run(BRIEF, ctx).done).rejects.toThrow("empty");
});

test("cancel reaches the turn through its signal", async () => {
  let seen: AbortSignal | undefined;
  const { run } = worker(async (request) => {
    seen = request.signal;
    await new Promise((resolve) => {
      request.signal?.addEventListener("abort", resolve, { once: true });
    });
    throw new Error("stopped");
  });
  const { ctx } = context();
  const handle = run(BRIEF, ctx);
  // Let the turn start before asking it to stop.
  await Promise.resolve();
  await Promise.resolve();
  handle.cancel();
  await expect(handle.done).rejects.toThrow();
  expect(seen!.aborted).toBe(true);
});
