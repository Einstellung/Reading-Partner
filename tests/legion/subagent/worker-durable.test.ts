// An agent worker end to end on the durable runtime: the worker's default turn
// is legion/durable's runBackgroundTurn on the device runtime the shell
// provided, here a test runtime with the faux provider (docs/soul/87, 第三阶段).
// Run: scripts/t.sh tests/legion/subagent/worker-durable.test.ts

import { BACKGROUND_CONTEXT as ctx } from "@earendil-works/chord/context";
import { fauxAssistantMessage, fauxText, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { afterEach, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { provideBackgroundHost } from "../../../src/legion/durable/background";
import type { WorkerContext } from "../../../src/legion/execute/worker";
import type { Run } from "../../../src/legion/run";
import { StoppedError } from "../../../src/legion/stop";
import type { SubagentDefinition } from "../../../src/legion/subagent";
import { agentWorker } from "../../../src/legion/subagent/worker";
import { deferred, openTestRuntime, type TestRuntime } from "../durable/support/runtime";

const BRIEF = "legion/briefs/one.md";

afterEach(() => provideBackgroundHost(() => undefined));

function definition(search: () => Promise<string>): SubagentDefinition {
  return {
    name: "looker",
    description: "d",
    label: "Looking into it",
    systemPrompt: "You look things up.",
    model: { providerId: "faux" as never, modelId: "faux-1" },
    tools: [
      {
        name: "search",
        label: () => "Searching",
        effect: "read" as const,
        description: "search",
        parameters: { type: "object", properties: { q: { type: "string" } } } as never,
        execute: search,
      },
    ],
  };
}

function context() {
  const reported: string[] = [];
  const ctxOf: WorkerContext = {
    run: { id: "r-durable", kind: "looking" } as unknown as Run,
    report: async (text) => void reported.push(text),
    reportTool: async (tool, round) => void reported.push(`${tool} (round ${round})`),
    delegate: async () => ({ ok: false, reason: "an agent worker has no delegate" }),
  };
  return { ctx: ctxOf, reported };
}

async function open(responses: Parameters<typeof openTestRuntime>[0]["responses"]): Promise<TestRuntime> {
  const t = await openTestRuntime({ root: mkdtempSync(join(tmpdir(), "worker-durable-")), responses });
  provideBackgroundHost(() => Promise.resolve({ runtime: t.runtime }));
  return t;
}

async function idle(t: TestRuntime) {
  const inspection = await t.runtime.harness.inspect(ctx);
  return inspection.tasks.length + inspection.submissions.length === 0;
}

test("an agent worker runs its sub-agent as a background run and writes the brief", async () => {
  const t = await open([
    fauxAssistantMessage([fauxToolCall("search", { q: "since 2020" })], { stopReason: "toolUse" }),
    fauxAssistantMessage(fauxText("Smith 2023 — https://doi.org/10.1/x\nIt settles the question.")),
  ]);
  const outputs = new Map<string, string>();
  const run = agentWorker(
    { agent: async () => definition(async () => "one record"), rounds: 3 },
    {
      readBrief: async () => "what has been published since 2020",
      writeOutput: async (runId, text) => {
        outputs.set(runId, text);
        return `legion/outputs/${runId}.md`;
      },
    },
  );
  const { ctx: workerCtx, reported } = context();
  const outcome = await run(BRIEF, workerCtx).done;

  expect(outcome).toEqual({ output: "legion/outputs/r-durable.md", progress: "2 rounds, 1 of 1 lookups" });
  expect(outputs.get("r-durable")).toContain("Smith 2023");
  expect(reported).toEqual(["search (round 1)"]);
  expect(t.requests[0]).toEqual(["user:what has been published since 2020"]);
  expect(await idle(t)).toBe(true);
  await t.runtime.close(ctx);
});

test("cancelling the worker stops its run and leaves nothing live", async () => {
  const entered = deferred();
  const t = await open([fauxAssistantMessage([fauxToolCall("search", { q: "x" })], { stopReason: "toolUse" })]);
  const run = agentWorker(
    {
      agent: async () =>
        definition(() => {
          entered.resolve();
          return new Promise<string>(() => {});
        }),
      rounds: 3,
    },
    { readBrief: async () => "look", writeOutput: async () => "never" },
  );
  const handle = run(BRIEF, context().ctx);
  await entered.promise;
  handle.cancel();

  await expect(handle.done).rejects.toBeInstanceOf(StoppedError);
  expect(await idle(t)).toBe(true);
  await t.runtime.close(ctx);
});
