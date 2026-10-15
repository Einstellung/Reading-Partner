// The cascade front handing work to the real call ledger (docs/companion/136
// 并行、取消、改口): a new question is a task of its own and runs beside the
// ones already out; only a change of mind, said with `replaces`, calls one back.
// Run: scripts/t.sh tests/soul/voice/front-delegate.test.ts

import { expect, test } from "bun:test";
import type { Run } from "../../../src/legion/run";
import type { Delegated } from "../../../src/legion/runner/worker";
import { THINK_KIND, createCallBackend } from "../../../src/soul/think";
import { bindCallBack } from "../../../src/soul/voice/front/backend";
import { createCascadeFront } from "../../../src/soul/voice/front/cascade";
import type { FrontModelRequest } from "../../../src/soul/voice/front/model";

function setup() {
  const cancelled: string[] = [];
  let next = 0;
  const backend = createCallBackend({
    delegate: async (): Promise<Delegated> => {
      const run = { id: `r-${++next}`, kind: THINK_KIND, state: "running" } as unknown as Run;
      return { ok: true, run, existing: false, done: new Promise<Run>(() => {}) };
    },
    cancelRun: async (id) => {
      cancelled.push(id);
    },
    listRuns: async () => [],
    watchRuns: () => () => {},
    writeBrief: async () => "legion/briefs/b.md",
    readFile: async () => "",
    box: { setState: async () => null as never },
    onLanding: () => () => {},
    answerSoon: () => {},
    kinds: () => [THINK_KIND],
  });
  let reply: (req: FrontModelRequest) => void = () => {};
  const requests: FrontModelRequest[] = [];
  const front = createCascadeFront({
    model: async (req) => {
      requests.push(req);
      reply(req);
    },
    backend: bindCallBack({
      backend,
      callId: "c1",
      deliverTo: { place: "briefing", date: "2026-10-15" },
      kinds: () => [THINK_KIND],
    }),
    place: () => "Today's briefing.",
    write: () => {},
    filler: { play: async () => true },
    locale: "zh-CN",
    marks: () => {},
    onShow: () => {},
  });
  const turn = async (n: number, text: string, args: Record<string, unknown>) => {
    reply = (req) => req.onToolCall({ name: "delegate", args: { kind: THINK_KIND, ...args } });
    front.transcript.record({ role: "user", turn: n, text, interrupted: false });
    await front.model.ask({ turn: n, text, signal: new AbortController().signal, onDelta: () => {}, onActivity: () => {} });
  };
  return { front, cancelled, requests, turn, states: () => backend.tasks("c1").map((t) => t.state) };
}

test("a second, unrelated delegate leaves task 1 running", async () => {
  const h = setup();
  await h.turn(1, "今天有什么值得看的？", { task: "What is worth reading today?" });
  await h.turn(2, "这篇论文的结论站得住吗？", { task: "Does the paper's conclusion hold?" });
  expect(h.states()).toEqual(["running", "running"]);
  expect(h.cancelled).toEqual([]);
});

test("a question about a running task builds on it and does not call it back", async () => {
  const h = setup();
  await h.turn(1, "今天有什么值得看的？", { task: "What is worth reading today?" });
  // What the front sent in the 10-15 run: a question about task 1, pointing at it.
  await h.turn(2, "第一条讲的是什么？", { task: "Summarise the first item of today's briefing.", follows: 1 });
  expect(h.states()).toEqual(["running", "running"]);
  expect(h.cancelled).toEqual([]);
});

test("only a change of mind, said with replaces, calls the earlier task back", async () => {
  const h = setup();
  await h.turn(1, "查一下日元为什么跌", { task: "Why did the yen fall this week?" });
  await h.turn(2, "不对，我是说欧元", { task: "Why did the euro fall this week?", replaces: 1 });
  expect(h.states()).toEqual(["cancelled", "running"]);
  expect(h.cancelled).toEqual(["r-1"]);
  const delegate = h.requests[0]!.tools.find((t) => t.name === "delegate")!;
  expect(JSON.stringify(delegate.parameters)).toContain("replaces");
});
