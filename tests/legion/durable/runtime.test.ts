// The durable runtime in one process, on the faux provider and the bun:sqlite
// stand-in (docs/soul/87, 第一阶段验收). The killed-process halves are in
// crash.test.ts.

import { BACKGROUND_CONTEXT as ctx } from "@earendil-works/chord/context";
import { fauxAssistantMessage, fauxText, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { LiveDoc } from "@earendil-works/pi-durable";
import { expect, test } from "bun:test";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { REFUSE_MIDTURN, REFUSE_ROUNDS } from "../../../src/legion/execute/contract";
import { recoverBeforeResume } from "../../../src/legion/durable/recover";
import { startTurn, steerTurn, stopTurn, textOf } from "../../../src/legion/durable/turn";
import { deferred, ORIGIN, openTestRuntime, readerTurn } from "./support/runtime";

const root = () => mkdtempSync(join(tmpdir(), "durable-runtime-"));
const tool = (name: string, args: Record<string, string>) =>
  fauxAssistantMessage([fauxToolCall(name, args)], { stopReason: "toolUse" });
const last = <T>(items: T[]): T | undefined => items[items.length - 1];
const LONG = "潮汐是月球和太阳引力共同作用的结果，".repeat(40);

test("a turn sends the file's history before the run and lands the answer once", async () => {
  const t = await openTestRuntime({ root: root(), responses: [fauxAssistantMessage(fauxText("First answer."))] });
  t.file.append({ role: "user", ts: 10, text: "Earlier question" });
  t.file.append({ role: "assistant", ts: 11, text: "Earlier answer", tools: [] });
  const turn = await startTurn(t.runtime, readerTurn(t, "What moves the tides?", 1000), ctx);
  expect((await turn.settled)?.landed).toBe(true);
  expect(t.historyCalls).toEqual([{ excludeTs: 1000 }]);
  expect(t.requests[0]).toEqual(["user:Earlier question", "assistant:Earlier answer", "user:What moves the tides?"]);
  const rows = t.file.rows();
  expect(rows.map((r) => [r.role, r.text])).toEqual([
    ["user", "Earlier question"],
    ["assistant", "Earlier answer"],
    ["user", "What moves the tides?"],
    ["assistant", "First answer."],
  ]);
  expect(t.recorded).toBe(1);
  await t.runtime.close(ctx);
});

test("a steer during a tool round joins the run and splits the landed rows in order", async () => {
  const running = deferred();
  const release = deferred();
  const t = await openTestRuntime({
    root: root(),
    now: () => 1000,
    responses: [tool("lookup", { query: "tides" }), fauxAssistantMessage(fauxText("Page one says the moon."))],
    desk: {
      lookup: async (query) => {
        running.resolve();
        await release.promise;
        return `text of ${query}`;
      },
    },
  });
  const turn = await startTurn(t.runtime, readerTurn(t, "Look it up", 1000), ctx);
  await running.promise;
  expect(await steerTurn(t.runtime, turn.conversation, "Only page one", 5000, ctx)).toBe(true);
  release.resolve();
  await turn.settled;
  expect(t.requests[1]).toEqual(["user:Look it up", "assistant:[lookup]", "toolResult:text of tides", "user:Only page one"]);
  const rows = t.file.rows().slice(1);
  expect(rows.map((r) => [r.role, r.text, r.ts])).toEqual([
    ["assistant", "", 1001],
    ["user", "Only page one", 5000],
    ["assistant", "Page one says the moon.", 5001],
  ]);
  expect((rows[0] as { tools: { name: string }[] }).tools.map((x) => x.name)).toEqual(["lookup"]);
  expect(await steerTurn(t.runtime, turn.conversation, "too late", 6000, ctx)).toBe(false);
  await t.runtime.close(ctx);
});

test("stop keeps the half sentence and the receipt, and hands back the steer never placed", async () => {
  const t = await openTestRuntime({
    root: root(),
    tokensPerSecond: 80,
    responses: [tool("note", { text: "tides" }), fauxAssistantMessage(fauxText(LONG))],
  });
  const turn = await startTurn(t.runtime, readerTurn(t, "Note it and explain", 1000), ctx);
  const view = await turn.conversation.viewState(ctx);
  const streaming = deferred();
  view.subscribe((value) => {
    const live = value.docs["pi.live"] as { generation?: { message?: unknown } } | undefined;
    if (textOf(live?.generation?.message).length >= 40) streaming.resolve();
  });
  await streaming.promise;
  await steerTurn(t.runtime, turn.conversation, "Shorter please", 7000, ctx);
  const steers = await stopTurn(t.runtime, turn.conversation, ctx);
  expect(steers).toEqual([{ ts: 7000, text: "Shorter please" }]);
  const result = await turn.settled;
  expect(result?.status).toBe("unanswered");
  const rows = t.file.rows().slice(1);
  expect(rows).toHaveLength(1);
  const row = rows[0] as { text: string; tools: { name: string; details?: unknown }[] };
  expect(row.text.length).toBeGreaterThanOrEqual(40);
  expect(LONG.startsWith(row.text)).toBe(true);
  expect(row.tools as unknown[]).toEqual([
    { callId: expect.any(String), name: "note", args: { text: "tides" }, isError: false, details: { kind: "note", text: "tides" } },
  ]);
  view.dispose?.();
  await t.runtime.close(ctx);
});

test("past the round cap the request is refused and the refusal lands", async () => {
  const t = await openTestRuntime({
    root: root(),
    responses: [tool("lookup", { query: "a" }), tool("lookup", { query: "b" })],
  });
  const turn = await startTurn(t.runtime, readerTurn(t, "Keep looking", 1000, { maxRounds: 1 }), ctx);
  const result = await turn.settled;
  expect(result?.status).toBe("unanswered");
  expect(t.requests).toHaveLength(1);
  const final = last(t.file.rows()) as { refusal?: string };
  expect(final.refusal).toBe(REFUSE_ROUNDS);
  await t.runtime.close(ctx);
});

test("a request that cannot fit the window is refused before it is sent", async () => {
  const t = await openTestRuntime({
    root: root(),
    contextWindow: 3000,
    responses: [fauxAssistantMessage(fauxText("never"))],
  });
  t.file.append({ role: "user", ts: 10, text: "很长的材料。".repeat(3000) });
  const turn = await startTurn(t.runtime, readerTurn(t, "Summarise", 1000), ctx);
  await turn.settled;
  expect(t.requests).toHaveLength(0);
  expect((last(t.file.rows()) as { refusal?: string }).refusal).toBe(REFUSE_MIDTURN);
  await t.runtime.close(ctx);
});

test("after a generation swap the next turn's context still comes whole from the file", async () => {
  const dir = root();
  const t = await openTestRuntime({
    root: dir,
    rotateAtBytes: 1,
    responses: [fauxAssistantMessage(fauxText("Answer one.")), fauxAssistantMessage(fauxText("Answer two."))],
  });
  const firstPath = t.runtime.path;
  await (await startTurn(t.runtime, readerTurn(t, "Q1", 1000), ctx)).settled;
  expect(t.runtime.path).not.toBe(firstPath);
  expect(existsSync(join(dir, firstPath))).toBe(false);
  await (await startTurn(t.runtime, readerTurn(t, "Q2", 2000), ctx)).settled;
  expect(t.requests[1]).toEqual(["user:Q1", "assistant:Answer one.", "user:Q2"]);
  expect(t.file.rows().map((r) => r.text)).toEqual(["Q1", "Answer one.", "Q2", "Answer two."]);
  await t.runtime.close(ctx);
});

test("conversations run side by side in one Harness", async () => {
  const t = await openTestRuntime({
    root: root(),
    tokensPerSecond: 200,
    responses: [fauxAssistantMessage(fauxText(LONG)), fauxAssistantMessage(fauxText(LONG))],
  });
  const both = deferred();
  const streaming = new Set<string>();
  const turns = await Promise.all(
    ["a", "b"].map((id, i) =>
      startTurn(t.runtime, { ...readerTurn(t, `Q${id}`, 1000 + i), key: `book:${id}`, origin: { ...ORIGIN, threadId: id } }, ctx),
    ),
  );
  for (const [i, turn] of turns.entries()) {
    (await turn.conversation.viewState(ctx)).subscribe((value) => {
      const live = value.docs["pi.live"] as { generation?: { message?: unknown } } | undefined;
      if (textOf(live?.generation?.message).length > 0) streaming.add(String(i));
      else streaming.delete(String(i));
      if (streaming.size === 2) both.resolve();
    });
  }
  await both.promise;
  const results = await Promise.all(turns.map((turn) => turn.settled));
  expect(results.map((r) => r?.status)).toEqual(["done", "done"]);
  await t.runtime.close(ctx);
});

test("the second start with the same run unfinished gives up and lands what there is", async () => {
  const dir = root();
  const blocked = () => ({
    lookup: async () => {
      await new Promise(() => {});
      return "";
    },
  });
  const first = await openTestRuntime({ root: dir, responses: [tool("lookup", { query: "x" })], desk: blocked() });
  const turn = await startTurn(first.runtime, readerTurn(first, "Look", 1000), ctx);
  turn.settled.catch(() => {}); // the Harness closes under it
  await waitFor(async () => (await first.runtime.harness.snapshot(LiveDoc, turn.conversation.id, ctx))?.tools?.[0]?.status === "running");
  await first.runtime.close(ctx);

  const second = await openTestRuntime({ root: dir, responses: [], desk: blocked() });
  expect((await recoverBeforeResume(second.runtime, ctx)).map((r) => r.outcome)).toEqual(["in-tool"]);
  await waitFor(async () => (await second.runtime.harness.snapshot(LiveDoc, turn.conversation.id, ctx))?.tools?.[0]?.status === "running");
  await second.runtime.close(ctx);

  const third = await openTestRuntime({ root: dir, responses: [] });
  expect((await recoverBeforeResume(third.runtime, ctx)).map((r) => r.outcome)).toEqual(["gave-up"]);
  await third.runtime.harness.waitForIdle(ctx);
  await waitFor(async () => (await third.runtime.harness.inspect(ctx)).tasks.length === 0);
  const rows = third.file.rows();
  expect(rows.map((r) => r.role)).toEqual(["user", "assistant"]);
  expect((rows[1] as { tools: { name: string }[] }).tools.map((x) => x.name)).toEqual(["lookup"]);
  await third.runtime.close(ctx);
});

async function waitFor(check: () => Promise<boolean>, ms = 10_000): Promise<void> {
  const until = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() > until) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 10));
  }
}
