// The turn log for book turns on the durable runtime (reading/turn/durable-turn-log.ts):
// the lines and fields legion/execute/turn-log.ts defines, as the old turn loop
// wrote them — start, each round's first byte and answer, one end — for a turn
// started here and for one this process only saw from its first request.

import { BACKGROUND_CONTEXT as ctx } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startTurn } from "../../../src/legion/durable/turn";
import type { AgentTool } from "../../../src/legion/execute/contract";
import type { TurnLogLine } from "../../../src/legion/execute/turn-log";
import { driveBookTurn } from "../../../src/reading/turn/book-turn-rows";
import { bookThreadKey, bookThreadOrigin, type BookOrigin } from "../../../src/reading/turn/durable-book";
import { openReadingDurable, TURN_SECTION } from "../../../src/reading/turn/durable-runtime";
import { BookTurnLog, turnLogEnd } from "../../../src/reading/turn/durable-turn-log";
import { testHost } from "../../legion/durable/support/runtime";
import { fakeThreads } from "./support/durable-threads";

const BOOK: BookOrigin = { place: "book", bookId: "b1", threadId: "t1", home: "b1" };
const LONG = "The tide follows the moon, and the sun pulls too. ".repeat(20);
const START = { surface: "reading" as const, conversation: "t1", provider: "faux", model: "faux-1" };

/** Each line without its clock fields. */
const shape = (lines: TurnLogLine[]) =>
  lines.map(({ at: _at, turn: _turn, ...rest }) => ("ms" in rest ? { ...rest, ms: typeof rest.ms } : rest));

test("one turn's lines: start, first byte and answer per round, one end, all under one id", () => {
  const lines: TurnLogLine[] = [];
  let now = 0;
  const log = new BookTurnLog((line) => lines.push(line), () => now);
  log.begin("k", START);
  log.begin("k", { ...START, model: "other" });
  now = 10;
  log.request("k", 1, START);
  now = 250;
  log.heard("k", 11);
  log.heard("k", 11);
  now = 900;
  log.response("k", 1, "toolUse");
  now = 1000;
  log.request("k", 2, START);
  // The first round's partial still on the view is not the second round's first byte.
  log.heard("k", 11);
  now = 1300;
  log.heard("k", 1001);
  now = 2000;
  log.response("k", 2, "stop");
  log.end("k", { status: "done", landed: true });
  log.end("k", { status: "unanswered", landed: false, reason: "error" });
  expect(lines.map(({ at: _at, turn: _turn, ...rest }) => rest)).toEqual([
    { event: "start", ...START, held: false },
    { event: "first-byte", round: 1, ms: 240 },
    { event: "round", round: 1, stop: "toolUse", ms: 890 },
    { event: "first-byte", round: 2, ms: 300 },
    { event: "round", round: 2, stop: "stop", ms: 1000 },
    { event: "end", reason: "done", ms: 2000 },
  ]);
  expect(new Set(lines.map((line) => line.turn)).size).toBe(1);
});

test("how a settled turn reads: stalled over anything, refusal, abort, error with its detail", () => {
  expect(turnLogEnd({ status: "done", landed: true }, true)).toEqual({ reason: "stalled" });
  expect(turnLogEnd(undefined, false)).toEqual({ reason: "aborted" });
  expect(turnLogEnd({ status: "unanswered", landed: false, refusal: "too long" }, false)).toEqual({
    reason: "refused",
    error: "too long",
  });
  expect(turnLogEnd({ status: "unanswered", landed: true, reason: "aborted" }, false)).toEqual({ reason: "aborted" });
  expect(turnLogEnd({ status: "unanswered", landed: false, reason: "error", detail: "429" }, false)).toEqual({
    reason: "error",
    error: "429",
  });
});

async function rig(responses: Parameters<ReturnType<typeof fauxProvider>["setResponses"]>[0], tools: AgentTool[] = []) {
  const faux = fauxProvider({
    tokensPerSecond: 400,
    tokenSize: { min: 2, max: 3 },
    models: [{ id: "faux-1", contextWindow: 200_000, maxTokens: 4096 }],
  });
  faux.setResponses(responses);
  const models = createModels();
  models.setProvider(faux.provider);
  const lines: TurnLogLine[] = [];
  const durable = await openReadingDurable({
    catalog: tools,
    host: testHost(mkdtempSync(join(tmpdir(), "reading-turn-log-"))),
    models,
    threads: fakeThreads([{ role: "user", ts: 1000, text: "Why tides?" }]).threads,
    watching: () => true,
    openDesk: async () => tools,
    now: () => 1000,
    log: (line) => lines.push(line),
  });
  return { durable, lines };
}

test("a book turn started here logs its surface, thread and model, each round, and how it ended", async () => {
  const pages = {
    name: "read_pages",
    description: "Read pages",
    parameters: { type: "object", properties: {} },
    label: () => "Reading",
    effect: "read",
    replay: "safe",
    execute: async () => ({ content: [{ type: "text", text: "the pages" }], details: undefined }),
  } as unknown as AgentTool;
  const { durable, lines } = await rig(
    [fauxAssistantMessage([fauxToolCall("read_pages", {})], { stopReason: "toolUse" }), fauxAssistantMessage(fauxText(LONG))],
    [pages],
  );
  const turn = await driveBookTurn(
    durable,
    {
      origin: BOOK,
      line: { text: "Why tides?", ts: 1000 },
      telemetry: { surface: "reading", inline: "chapter" },
      systemPrompt: "You are a reading partner.",
      history: [],
      tools: [pages],
      model: { provider: "faux", modelId: "faux-1" },
      describe: (name) => ({ label: name }),
    },
    () => {},
    ctx,
  );
  expect((await turn.ended).kind).toBe("answered");
  const rows = shape(lines);
  expect(rows[0]).toEqual({ event: "start", ...START, held: false });
  expect(rows.filter((line) => line.event === "round")).toEqual([
    { event: "round", round: 1, stop: "toolUse", ms: "number" },
    { event: "round", round: 2, stop: "stop", ms: "number" },
  ]);
  // The long answer streams past the view's partial interval: its first byte is heard.
  expect(rows).toContainEqual({ event: "first-byte", round: 2, ms: "number" });
  expect(rows[rows.length - 1]).toEqual({ event: "end", reason: "done", ms: "number" });
  expect(rows.filter((line) => line.event === "end").length).toBe(1);
  expect(new Set(lines.map((line) => line.turn)).size).toBe(1);
  await durable.runtime.close(ctx);
});

test("a turn this process did not start is logged from its first request, as reading", async () => {
  const { durable, lines } = await rig([fauxAssistantMessage(fauxText("The moon."))]);
  const started = await startTurn(
    durable.runtime,
    {
      key: bookThreadKey(BOOK),
      origin: bookThreadOrigin(BOOK),
      content: "Why tides?",
      sections: { [TURN_SECTION]: "You are a reading partner." },
      tools: [],
      model: { provider: "faux", modelId: "faux-1" },
      excludeTs: 1000,
    },
    ctx,
  );
  await started.settled;
  expect(shape(lines)).toEqual([
    { event: "start", ...START, held: false },
    { event: "round", round: 1, stop: "stop", ms: "number" },
    { event: "end", reason: "done", ms: "number" },
  ]);
  await durable.runtime.close(ctx);
});
