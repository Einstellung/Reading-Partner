// Background passes on the durable runtime (legion/durable/background.ts):
// one ownerless conversation per run, the run's own tools, nothing live once
// it settles. The killed-process half is in background-crash.test.ts.

import { BACKGROUND_CONTEXT as ctx } from "@earendil-works/chord/context";
import { Type } from "@earendil-works/pi-ai";
import { fauxAssistantMessage, fauxText, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentTool } from "../../../src/legion/execute/contract";
import { REFUSE_ROUNDS } from "../../../src/legion/execute/contract";
import { runBackgroundTurnOn, type BackgroundTurnRequest } from "../../../src/legion/durable/background";
import { startTurn } from "../../../src/legion/durable/turn";
import { StoppedError } from "../../../src/legion/stop";
import { deferred, openTestRuntime, readerTurn, type TestRuntime } from "./support/runtime";

const root = () => mkdtempSync(join(tmpdir(), "durable-background-"));
const tool = (name: string, args: Record<string, number>) =>
  fauxAssistantMessage([fauxToolCall(name, args)], { stopReason: "toolUse" });

/** A run's own `lookup`: same name as the catalog's, another description and schema. */
function passTool(execute: (args: Record<string, unknown>) => Promise<string>): AgentTool {
  return {
    name: "lookup",
    description: "Look up one row of this pass's index.",
    parameters: Type.Object({ row: Type.Number() }),
    label: () => "Looking up a row",
    effect: "read",
    execute,
  };
}

function request(extra: Partial<BackgroundTurnRequest> = {}): BackgroundTurnRequest {
  return {
    name: "distill",
    systemPrompt: "You distill.",
    task: "Distill this.",
    tools: [],
    maxRounds: 4,
    purpose: "chat",
    model: { providerId: "faux", modelId: "faux-1" },
    ...extra,
  };
}

async function idle(t: TestRuntime): Promise<boolean> {
  const inspection = await t.runtime.harness.inspect(ctx);
  return inspection.tasks.length === 0 && inspection.submissions.length === 0;
}

test("a run calls its own tools, answers with its last message and leaves nothing live", async () => {
  const seen: { system: string; tools: string[] }[] = [];
  const capture = (reply: ReturnType<typeof fauxAssistantMessage>) => (context: { systemPrompt?: string; messages: unknown[]; tools?: { name: string; description: string }[] }) => {
    seen.push({ system: (context.systemPrompt ?? "") + JSON.stringify(context.messages), tools: (context.tools ?? []).map((t) => `${t.name}:${t.description}`) });
    return reply;
  };
  const t = await openTestRuntime({
    root: root(),
    responses: [
      capture(tool("lookup", { row: 2 })) as never,
      capture(fauxAssistantMessage(fauxText("All done."))) as never,
      capture(fauxAssistantMessage(fauxText("Book answer."))) as never,
    ],
  });
  const calls: unknown[] = [];
  const rounds: number[] = [];
  let chars = 0;
  const outcome = await runBackgroundTurnOn(
    { runtime: t.runtime },
    request({
      tools: [passTool(async (args) => (calls.push(args.row), "row two"))],
      onRound: ({ round }) => rounds.push(round),
      onProgress: (n) => (chars = n),
    }),
  );
  expect(outcome).toEqual({ kind: "answer", text: "All done." });
  expect(calls).toEqual([2]);
  expect(rounds[rounds.length - 1]).toBe(2);
  expect(chars).toBeGreaterThan(0);
  expect(t.requests[1]).toEqual(["user:Distill this.", "assistant:[lookup]", "toolResult:row two"]);
  expect(t.recorded).toBe(2);
  expect(await idle(t)).toBe(true);

  // A book turn afterwards still sees the catalog's lookup, not the run's.
  const turn = await startTurn(t.runtime, readerTurn(t, "Look", 1000), ctx);
  expect((await turn.settled)?.landed).toBe(true);
  expect(seen[0]!.system).toContain("You distill.");
  // Tool definitions travel as system entries: the run's description, not the catalog's, and back again.
  expect(seen[0]!.system).toContain("Look up one row of this pass's index.");
  expect(seen[0]!.system).not.toContain("Look up a passage in the open book.");
  expect(seen[2]!.system).toContain("Look up a passage in the open book.");
  expect(seen[2]!.system).not.toContain("Look up one row of this pass's index.");
  await t.runtime.close(ctx);
});

test("an empty answer comes back as an empty answer, not an error", async () => {
  const t = await openTestRuntime({ root: root(), responses: [fauxAssistantMessage(fauxText(""))] });
  expect(await runBackgroundTurnOn({ runtime: t.runtime }, request())).toEqual({ kind: "answer", text: "" });
  expect(await idle(t)).toBe(true);
  await t.runtime.close(ctx);
});

test("past the round cap the run is refused with the cap's message", async () => {
  const t = await openTestRuntime({
    root: root(),
    responses: [tool("lookup", { row: 1 }), tool("lookup", { row: 2 }), fauxAssistantMessage(fauxText("never"))],
  });
  const outcome = await runBackgroundTurnOn(
    { runtime: t.runtime },
    request({ maxRounds: 1, tools: [passTool(async () => "row")] }),
  );
  expect(outcome).toEqual({ kind: "refusal", message: REFUSE_ROUNDS });
  expect(await idle(t)).toBe(true);
  await t.runtime.close(ctx);
});

test("a model error comes back as an error", async () => {
  const t = await openTestRuntime({
    root: root(),
    responses: [fauxAssistantMessage([], { stopReason: "error", errorMessage: "overloaded" })],
  });
  const outcome = await runBackgroundTurnOn({ runtime: t.runtime }, request());
  expect(outcome.kind).toBe("error");
  expect((outcome as { message: string }).message).toContain("overloaded");
  expect(await idle(t)).toBe(true);
  await t.runtime.close(ctx);
});

test("aborting the signal mid-tool rejects with StoppedError and leaves nothing live", async () => {
  const running = deferred();
  const t = await openTestRuntime({ root: root(), responses: [tool("lookup", { row: 1 })] });
  const controller = new AbortController();
  const run = runBackgroundTurnOn(
    { runtime: t.runtime },
    request({
      signal: controller.signal,
      tools: [passTool(async () => (running.resolve(), new Promise<string>(() => {})))],
    }),
  );
  await running.promise;
  controller.abort();
  await expect(run).rejects.toBeInstanceOf(StoppedError);
  expect(await idle(t)).toBe(true);
  await t.runtime.close(ctx);
});

test("a running pass holds off the generation swap; once it settles the swap happens", async () => {
  const running = deferred();
  const release = deferred();
  const t = await openTestRuntime({
    root: root(),
    rotateAtBytes: 1,
    // Never forced: the swap waits for idle.
    forceRotateFactor: 1e12,
    responses: [tool("lookup", { row: 1 }), fauxAssistantMessage(fauxText("Book answer.")), fauxAssistantMessage(fauxText("done"))],
  });
  const before = t.runtime.path;
  const run = runBackgroundTurnOn(
    { runtime: t.runtime },
    request({
      tools: [
        passTool(async () => {
          running.resolve();
          await release.promise;
          return "row";
        }),
      ],
    }),
  );
  await running.promise;
  // A book turn settling asks for a swap; the pass is live, so there is none.
  const turn = await startTurn(t.runtime, readerTurn(t, "Look", 1000), ctx);
  expect((await turn.settled)?.landed).toBe(true);
  expect(t.runtime.path).toBe(before);
  release.resolve();
  expect(await run).toEqual({ kind: "answer", text: "done" });
  expect(t.runtime.path).not.toBe(before);
  expect(await idle(t)).toBe(true);
  await t.runtime.close(ctx);
});
