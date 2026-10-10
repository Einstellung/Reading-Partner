// The stall watch on a book turn (reading/turn/durable-turn.ts, docs/soul/87
// "停摆"), on a clock the test moves: 90 seconds without progress supersedes
// the turn so it lands nothing; a running tool holds the watch; coming back to
// the app after longer than that judges it at once; the caller asks again once
// and shows the second stall as a failure (reading/turn/book-turn-rows.ts).

import { BACKGROUND_CONTEXT as ctx } from "@earendil-works/chord/context";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentTool } from "../../../src/legion/execute/contract";
import { createStallWatches, STALL_MESSAGE, TURN_STALL_MS, type StallTimers } from "../../../src/legion/execute/stall";
import { afterStall, driveBookTurn, turnEnd } from "../../../src/reading/turn/book-turn-rows";
import type { BookOrigin } from "../../../src/reading/turn/durable-book";
import { openReadingDurable } from "../../../src/reading/turn/durable-runtime";
import { testHost, deferred } from "../../legion/durable/support/runtime";
import { fakeThreads } from "./support/durable-threads";

const BOOK: BookOrigin = { place: "book", bookId: "b1", threadId: "t1", home: "b1" };

function fakeClock() {
  let now = 0;
  const ticks = new Set<() => void>();
  const timers: StallTimers = {
    now: () => now,
    every: (_ms, tick) => {
      ticks.add(tick);
      return () => ticks.delete(tick);
    },
  };
  return {
    timers,
    now: () => now,
    advance(ms: number) {
      now += ms;
      for (const tick of [...ticks]) tick();
    },
  };
}

/** A response that never comes: the stream stays open and silent until aborted. */
const silent = (_c: unknown, options: { signal?: AbortSignal } | undefined) =>
  new Promise<AssistantMessage>((resolve) => {
    options?.signal?.addEventListener("abort", () => resolve({ ...fauxAssistantMessage(""), stopReason: "aborted" }));
  });

async function setup(responses: Parameters<ReturnType<typeof fauxProvider>["setResponses"]>[0], tools: AgentTool[] = []) {
  const faux = fauxProvider({ models: [{ id: "faux-1", contextWindow: 200_000, maxTokens: 4096 }] });
  faux.setResponses(responses);
  const models = createModels();
  models.setProvider(faux.provider);
  const { threads, messages } = fakeThreads([{ role: "user", ts: 1000, text: "Why tides?" }]);
  const durable = await openReadingDurable({
    catalog: tools,
    host: testHost(mkdtempSync(join(tmpdir(), "reading-stall-"))),
    models,
    threads,
    watching: () => true,
    openDesk: async () => tools,
    now: () => 1000,
  });
  return { durable, messages };
}

function request(clock: ReturnType<typeof fakeClock>, tools: AgentTool[] = []) {
  return {
    origin: BOOK,
    line: { text: "Why tides?", ts: 1000 },
    systemPrompt: "You are a reading partner.",
    history: [],
    tools,
    model: { provider: "faux", modelId: "faux-1" },
    describe: (name: string) => ({ label: name }),
    watches: createStallWatches({ timers: clock.timers }),
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

test("ninety silent seconds supersede the turn: nothing lands, and it ends stalled", async () => {
  const { durable, messages } = await setup([silent]);
  const clock = fakeClock();
  const turn = await driveBookTurn(durable, request(clock), () => {}, ctx);
  await settle();
  clock.advance(TURN_STALL_MS + 1_000);
  const end = await turn.ended;
  expect(end.kind).toBe("stalled");
  expect(messages.length).toBe(1);
  await durable.runtime.close(ctx);
});

test("a running tool holds the watch, and the turn answers after it", async () => {
  const release = deferred();
  const slow = {
    name: "read_pages",
    description: "Read pages",
    parameters: { type: "object", properties: {} },
    label: () => "Reading",
    effect: "read",
    replay: "safe",
    execute: async () => {
      await release.promise;
      return { content: [{ type: "text", text: "the pages" }], details: undefined };
    },
  } as unknown as AgentTool;
  const { durable, messages } = await setup(
    [fauxAssistantMessage([fauxToolCall("read_pages", {})], { stopReason: "toolUse" }), fauxAssistantMessage(fauxText("The moon."))],
    [slow],
  );
  const clock = fakeClock();
  let toolRuns!: () => void;
  const running = new Promise<void>((resolve) => (toolRuns = resolve));
  const onRows = (rows: { tools?: { state: string }[] }[]) => {
    if (rows.some((r) => r.tools?.some((t) => t.state === "running"))) toolRuns();
  };
  const turn = await driveBookTurn(durable, request(clock, [slow]), onRows, ctx);
  await running;
  await settle();
  clock.advance(3 * TURN_STALL_MS);
  release.resolve();
  const end = await turn.ended;
  expect(end.kind).toBe("answered");
  expect(messages[messages.length - 1]?.text).toBe("The moon.");
  await durable.runtime.close(ctx);
});

test("back in the app after longer than the stall window: judged at once", async () => {
  const { durable, messages } = await setup([silent]);
  const clock = fakeClock();
  const req = request(clock);
  const turn = await driveBookTurn(durable, req, () => {}, ctx);
  await settle();
  req.watches.away(clock.now());
  clock.advance(0);
  req.watches.back(clock.now() + TURN_STALL_MS + 5_000);
  const end = await turn.ended;
  expect(end.kind).toBe("stalled");
  expect(messages.length).toBe(1);
  await durable.runtime.close(ctx);
});

test("a stalled turn is asked again once; the second stall is a failure", () => {
  expect(afterStall(0)).toEqual({ askAgain: true });
  expect(afterStall(1)).toEqual({ askAgain: false, message: STALL_MESSAGE });
});

test("how a turn ended, from what rp.turn settled with", () => {
  expect(turnEnd({ status: "done", landed: true }, [], undefined).kind).toBe("answered");
  expect(turnEnd({ status: "unanswered", landed: true, reason: "aborted" }, [], [{ ts: 5, text: "x" }])).toEqual({
    kind: "stopped",
    rows: [],
    steers: [{ ts: 5, text: "x" }],
  });
  expect(turnEnd({ status: "unanswered", landed: false, reason: "aborted", refusal: "too big" }, [], undefined)).toEqual({
    kind: "refused",
    rows: [],
    message: "too big",
  });
  expect(turnEnd({ status: "unanswered", landed: false, reason: "model_error", detail: "401" }, [], undefined)).toEqual({
    kind: "failed",
    rows: [],
    message: "401",
  });
});
