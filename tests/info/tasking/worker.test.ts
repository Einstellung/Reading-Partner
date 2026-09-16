// The tasking worker (src/info/tasking/worker.ts, docs/63): the brief comes off
// a file, a sub-agent runs it over the bureau's own records, its progress is
// reported in the runner's wording, and what it wrote goes to an output file the
// run points at. A run that read nothing throws, so the runner counts the
// attempt instead of delivering general knowledge into the briefing.
// Run: scripts/t.sh tests/info/tasking/worker.test.ts

import { expect, test } from "bun:test";
import { taskingWorker, TASKING_KIND } from "../../../src/info/tasking/worker";
import type { WorkerContext } from "../../../src/legion/execute/worker";
import type { SubagentDefinition, SubagentTurnFn } from "../../../src/legion/subagent";
import type { Run } from "../../../src/legion/run";

const BRIEF = "legion/briefs/one.md";

function definition(): SubagentDefinition {
  return {
    name: "tasking",
    description: "d",
    label: "Looking into it",
    systemPrompt: "s",
    // One tool, so evidence is required the way the real definition's is.
    tools: [
      {
        name: "search_cables",
        description: "search",
        parameters: { type: "object", properties: {} } as never,
        execute: async () => "- [c1] A cable",
      },
    ],
  };
}

function context(): { ctx: WorkerContext; reported: string[] } {
  const reported: string[] = [];
  const ctx: WorkerContext = {
    run: { id: "r-info", kind: TASKING_KIND } as unknown as Run,
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

// A turn that reads one record and then writes the answer.
const answering: SubagentTurnFn = async (request) => {
  const search = request.tools.find((t) => t.name === "search_cables")!;
  await search.execute({});
  request.onRound({ round: 1, rounds: request.maxRounds });
  return {
    kind: "answer",
    text: "The figure was 3.2% (量子位, 2026-09-14).",
  };
};

function worker(turn: SubagentTurnFn, briefText = "what did the ministry say in August") {
  const outputs = new Map<string, string>();
  const run = taskingWorker({
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

test("the brief the secretary wrote becomes the sub-agent's whole task", async () => {
  let task = "";
  const { run } = worker(async (request) => {
    task = request.task;
    await request.tools.find((t) => t.name === "search_cables")!.execute({});
    return { kind: "answer", text: "one answer" };
  });
  await run(BRIEF, context().ctx).done;
  expect(task).toBe("what did the ministry say in August");
});

test("what came back is written to an output file and the run points at it", async () => {
  const { run, outputs } = worker(answering);
  const outcome = await run(BRIEF, context().ctx).done;

  expect(outcome).toBeTruthy();
  expect(outcome!.output).toBe("legion/outputs/r-info.md");
  expect(outputs.get("legion/outputs/r-info.md")).toContain("3.2%");
  expect(outcome!.progress).toContain("lookups");
});

test("the sub-agent's lookups are reported in the runner's wording, and nothing else is", async () => {
  const { run } = worker(answering);
  const { ctx, reported } = context();
  await run(BRIEF, ctx).done;
  // Round 0: the tool ran before the turn announced the round it was in.
  expect(reported).toEqual(["search_cables (round 0)"]);
});

test("a run that read nothing throws, so the attempt is counted", async () => {
  const { run, outputs } = worker(async () => ({
    kind: "answer",
    text: "The ministry usually publishes this in August.",
  }));
  const attempt = run(BRIEF, context().ctx).done;
  await expect(attempt).rejects.toThrow("not a finding");
  await expect(attempt).rejects.not.toThrow("usually publishes");
  expect(outputs.size).toBe(0);
});

test("a brief with nothing in it is a run that cannot start", async () => {
  const { run } = worker(answering, "   ");
  await expect(run(BRIEF, context().ctx).done).rejects.toThrow("empty");
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
  const handle = run(BRIEF, context().ctx);
  // Let the turn start before asking it to stop.
  await Promise.resolve();
  await Promise.resolve();
  handle.cancel();
  await expect(handle.done).rejects.toThrow();
  expect(seen!.aborted).toBe(true);
});
