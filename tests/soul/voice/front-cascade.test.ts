import { expect, test } from "bun:test";
import { Type } from "@earendil-works/pi-ai";
import type { AgentTool } from "../../../src/legion/durable/contract";
import type { CallNote, CallTask } from "../../../src/soul/think/contract";
import type { CallBack } from "../../../src/soul/voice/front/backend";
import { createCascadeFront, resumeOffset, type FrontCard } from "../../../src/soul/voice/front/cascade";
import {
  FRONT_DUTY,
  FRONT_TOKEN_CAP,
  estimateTokens,
  frontMessages,
  frontRequest,
} from "../../../src/soul/voice/front/context";
import type { FillerPort } from "../../../src/soul/voice/front/filler";
import type { FrontTurnMarks } from "../../../src/soul/voice/front/marks";
import type { FrontModel, FrontModelRequest } from "../../../src/soul/voice/front/model";
import { frontReasoning } from "../../../src/soul/voice/front/model";
import type { TurnActivity } from "../../../src/ai/turn-view/activity";
import { INTERRUPTED_MARK } from "../../../src/soul/voice/voice-session";

class Back {
  list: CallTask[] = [];
  dispatched: string[] = [];
  texts = new Map<number, string>();
  listeners = new Set<(note: CallNote) => void>();
  delegateTool(): AgentTool {
    return {
      name: "delegate",
      label: () => "Handing it over",
      effect: "write",
      description: "",
      parameters: Type.Object({}),
      execute: async (args) => {
        this.dispatched.push(String(args.task));
        const n = this.list.length + 1;
        this.list.push({ n, runId: `r${n}`, kind: "think", task: String(args.task), state: "running", told: false });
        return `Handed over as task ${n}.`;
      },
    };
  }
  cancel = async () => ({ ok: true });
  tasks = () => this.list;
  text = async (n: number) => this.texts.get(n) ?? null;
  subscribe = (fn: (note: CallNote) => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
}

function setup(script: (req: FrontModelRequest) => Promise<void>, filler: FillerPort = { play: async () => false }) {
  const back = new Back();
  const told: number[] = [];
  const backend: CallBack = {
    delegateTool: () => back.delegateTool(),
    cancel: back.cancel,
    tasks: back.tasks,
    text: back.text,
    told: async (n) => {
      told.push(n);
      return true;
    },
    subscribe: back.subscribe,
  };
  let clock = 0;
  const timers: { at: number; fn: () => void }[] = [];
  const marks: FrontTurnMarks[] = [];
  const cards: FrontCard[] = [];
  const requests: FrontModelRequest[] = [];
  const model: FrontModel = async (req) => {
    requests.push(req);
    await script(req);
  };
  const written: { key: string; text: string }[] = [];
  const traced: { name: string; data?: Record<string, unknown> }[] = [];
  const front = createCascadeFront({
    model,
    backend,
    place: () => "Today: three labs.",
    write: (l) => written.push({ key: l.key, text: l.text }),
    filler,
    locale: "zh-CN",
    marks: (m) => marks.push(m),
    trace: (name, data) => traced.push({ name, ...(data ? { data } : {}) }),
    onShow: (c) => cards.push(c),
    now: () => clock,
    setTimer: (fn, ms) => {
      const t = { at: clock + ms, fn };
      timers.push(t);
      return () => timers.splice(timers.indexOf(t), 1);
    },
  });
  const programs: number[] = [];
  front.bind({
    program: async (turn) => {
      programs.push(turn);
      return true;
    },
  });
  void front.open({} as never);
  const advance = (ms: number) => {
    clock += ms;
    for (const t of [...timers]) {
      if (t.at <= clock) {
        timers.splice(timers.indexOf(t), 1);
        t.fn();
      }
    }
  };
  return { back, told, front, marks, cards, requests, written, programs, advance, traced };
}

async function ask(front: ReturnType<typeof setup>["front"], turn: number, text = "", signal = new AbortController().signal) {
  const deltas: string[] = [];
  const activity: TurnActivity[] = [];
  await front.model.ask({ turn, text, signal, onDelta: (c) => deltas.push(c), onActivity: (a) => activity.push(a) });
  return { said: deltas.join(""), activity };
}

test("a sentence and a delegate in one reply: the sentence is spoken, the run sent, nothing more", async () => {
  const h = setup(async (req) => {
    req.onSent();
    req.onText("我去查一下。");
    req.onToolCall({ name: "delegate", args: { kind: "think", task: "Find X" } });
  });
  h.front.event({ kind: "speech-end", turn: 1, text: "X 是什么", silentMs: 0 });
  h.front.transcript.record({ role: "user", turn: 1, text: "X 是什么", interrupted: false });
  const r = await ask(h.front, 1, "X 是什么");
  expect(r.said).toBe("我去查一下。");
  expect(h.back.dispatched).toEqual(["Find X"]);
  expect(h.requests).toHaveLength(1);
  const m = h.marks.find((x) => x.turn === 1)!.marks;
  for (const k of ["speech-end", "request-sent", "first-byte", "delegate-sent"] as const) expect(m[k]).toBeNumber();
});

test("a reply that only hands off gets the filler line", async () => {
  const h = setup(async (req) => {
    req.onToolCall({ name: "delegate", args: { kind: "think", task: "Find Y" } });
  });
  const r = await ask(h.front, 1, "Y?");
  expect(r.said).toBe("我去想想。");
});

test("a hand-off with the cue ready plays the cue and writes no line", async () => {
  const played: string[] = [];
  const h = setup(
    async (req) => {
      req.onToolCall({ name: "delegate", args: { kind: "think", task: "Find Y" } });
    },
    {
      play: async (kind, locale) => {
        played.push(`${kind}:${locale}`);
        return true;
      },
    },
  );
  const r = await ask(h.front, 1, "Y?");
  expect(played).toEqual(["thinking:zh-CN"]);
  expect(r.said).toBe("");
});

test("the trace hears each mark as it is set, the hand-off and the cue", async () => {
  const h = setup(
    async (req) => {
      req.onSent();
      req.onToolCall({ name: "delegate", args: { kind: "think", task: "Find Y" } });
    },
    { play: async () => true },
  );
  h.front.event({ kind: "speech-end", turn: 1, text: "Y?", silentMs: 0 });
  await ask(h.front, 1, "Y?");
  expect(h.traced.map((t) => t.name)).toEqual([
    "front:speech-end",
    "front:request-sent",
    "front:delegate-sent",
    "front:delegate-done",
    "front:cue",
  ]);
  expect(h.traced[4]!.data).toEqual({ turn: 1, kind: "thinking", played: true });
});

test("a task's note carries its failure reason into the trace", () => {
  const h = setup(async () => {});
  for (const fn of h.back.listeners) fn({ callId: "c", n: 1, task: "Find X", status: "done", cover: "X is Y." });
  for (const fn of h.back.listeners) fn({ callId: "c", n: 2, task: "Find Z", status: "failed", reason: "Importing a module script failed." });
  expect(h.traced.filter((t) => t.name === "front:note").map((t) => t.data)).toEqual([
    { number: 1, status: "done" },
    { number: 2, status: "failed", reason: "Importing a module script failed." },
  ]);
});

test("a barge-in cuts the sentence but not the run it handed off", async () => {
  const stop = new AbortController();
  const h = setup(async (req) => {
    req.onText("好，");
    req.onToolCall({ name: "delegate", args: { kind: "think", task: "Z" } });
    stop.abort();
  });
  await ask(h.front, 1, "Z?", stop.signal);
  expect(h.back.dispatched).toEqual(["Z"]);
});

test("the request is the duty, the place and the list first, then the call's turns", async () => {
  const h = setup(async (req) => req.onText("嗯。"));
  h.back.list.push({ n: 1, runId: "r1", kind: "think", task: "Find X", state: "running", progress: "reading two papers", told: false });
  h.front.transcript.record({ role: "user", turn: 1, text: "好了没", interrupted: false });
  await ask(h.front, 1, "好了没");
  const sys = h.requests[0]!.system;
  expect(sys.startsWith(FRONT_DUTY)).toBe(true);
  expect(sys.indexOf("Today: three labs.")).toBeLessThan(sys.indexOf("#1 | running | Find X | progress: reading two papers"));
  expect(h.requests[0]!.messages).toEqual([{ role: "user", text: "好了没" }]);
});

test("a result back is said in the next gap, not while anyone is talking", async () => {
  const h = setup(async (req) => req.onText("刚才那个想好了，要我念还是你自己看？"));
  h.front.observe({ type: "orb", phase: "speaking" });
  for (const fn of h.back.listeners) fn({ callId: "c", n: 1, task: "Find X", status: "done", cover: "X is Y." });
  h.advance(3000);
  expect(h.programs).toEqual([]);
  h.front.observe({ type: "orb", phase: "listening" });
  h.front.event({ kind: "speech-duck", turn: 2 });
  h.advance(3000);
  expect(h.programs).toEqual([]);
  h.front.event({ kind: "speech-resume", turn: 2 });
  h.advance(1000);
  expect(h.programs).toEqual([]);
  h.advance(1100);
  expect(h.programs).toEqual([-1]);
  const r = await ask(h.front, -1);
  expect(r.said).toContain("想好了");
  expect(h.requests[0]!.tools).toEqual([]);
  expect(h.requests[0]!.messages[h.requests[0]!.messages.length - 1]!.text).toContain("#1 (Find X) is ready");
});

test("a notice waits out the user's whole turn: speech-stop opens it, speech-end closes it", async () => {
  const h = setup(async (req) => req.onText("想好了。"));
  h.front.observe({ type: "orb", phase: "listening" });
  h.front.event({ kind: "speech-duck", turn: 3 });
  h.front.event({ kind: "speech-stop", turn: 4, cut: { utterance: -1, sentence: -1, charOffset: -1, playedMs: 0 } });
  for (const fn of h.back.listeners) fn({ callId: "c", n: 1, task: "Find X", status: "done", cover: "X is Y." });
  h.advance(5000);
  expect(h.programs).toEqual([]);
  h.front.event({ kind: "speech-end", turn: 4, text: "", silentMs: 0 });
  h.advance(2100);
  expect(h.programs).toEqual([-1]);
});

test("a notice cut off by the user is said at the next gap, once, together with what came in since", async () => {
  const cut = new AbortController();
  let notices = 0;
  const h = setup(async (req) => {
    notices++;
    if (notices === 1) {
      // The 10-15 run: the user started talking while the request was out.
      await new Promise((r) => cut.signal.addEventListener("abort", r));
      throw new Error("Request was aborted");
    }
    req.onText("两个都好了，要念还是要看？");
  });
  h.front.observe({ type: "orb", phase: "listening" });
  for (const fn of h.back.listeners) fn({ callId: "c", n: 1, task: "Find X", status: "done", cover: "X is Y." });
  h.advance(2100);
  expect(h.programs).toEqual([-1]);
  const first = ask(h.front, -1, "", cut.signal);
  h.front.observe({ type: "orb", phase: "thinking" });
  // The user talks over it; a second result comes back meanwhile.
  h.front.event({ kind: "speech-duck", turn: 1 });
  h.front.event({ kind: "speech-stop", turn: 2, cut: { utterance: -1, sentence: -1, charOffset: -1, playedMs: 0 } });
  h.front.observe({ type: "orb", phase: "listening" });
  for (const fn of h.back.listeners) fn({ callId: "c", n: 2, task: "Find Z", status: "done", cover: "Z is W." });
  h.front.event({ kind: "speech-end", turn: 2, text: "周末读什么？", silentMs: 0 });
  h.front.observe({ type: "abort", turn: -1 });
  h.front.observe({ type: "orb", phase: "thinking" });
  cut.abort();
  await first;
  expect(h.traced.some((t) => t.name === "front:notify-requeued")).toBe(true);
  // The reply to the user's turn: no gap, so nothing is said.
  h.advance(3000);
  h.front.observe({ type: "orb", phase: "speaking" });
  h.advance(3000);
  expect(h.programs).toEqual([-1]);
  h.front.observe({ type: "orb", phase: "listening" });
  h.advance(1900);
  expect(h.programs).toEqual([-1]);
  h.advance(200);
  expect(h.programs).toEqual([-1, -2]);
  const r = await ask(h.front, -2);
  expect(r.said).toContain("两个都好了");
  const asked = h.requests[1]!.messages[h.requests[1]!.messages.length - 1]!.text;
  expect(asked).toContain("#1 (Find X) is ready");
  expect(asked).toContain("#2 (Find Z) is ready");
  // Said once: later gaps bring nothing back.
  h.front.observe({ type: "orb", phase: "speaking" });
  h.front.observe({ type: "orb", phase: "listening" });
  h.advance(10000);
  expect(h.programs).toEqual([-1, -2]);
  expect(h.requests).toHaveLength(2);
});

test("read_out speaks the original without the model; told only when heard to the end", async () => {
  let call = 0;
  const h = setup(async (req) => {
    call++;
    if (call === 1) req.onToolCall({ name: "read_out", args: { number: 1 } });
  });
  h.back.texts.set(1, "第一句结论。第二句理由。第三句。");
  await ask(h.front, 1, "念吧");
  h.front.observe({ type: "orb", phase: "listening" });
  expect(h.programs).toEqual([-1]);
  const r = await ask(h.front, -1);
  expect(r.said).toBe("第一句结论。第二句理由。第三句。");
  expect(h.requests).toHaveLength(1);
  // Cut in the second sentence: not told, and the next read starts there.
  h.front.transcript.record({ role: "ai", turn: -1, text: `第一句结论。第二句理由。\n${INTERRUPTED_MARK}`, interrupted: true });
  expect(h.told).toEqual([]);
  expect(h.written).toEqual([]);
  call = 0;
  await ask(h.front, 2, "接着念");
  h.front.observe({ type: "orb", phase: "thinking" });
  h.front.observe({ type: "orb", phase: "listening" });
  const again = await ask(h.front, -2);
  expect(again.said).toBe("第二句理由。第三句。");
  h.front.transcript.record({ role: "ai", turn: -2, text: "第二句理由。第三句。", interrupted: false });
  expect(h.told).toEqual([1]);
});

test("show opens the card and marks it told", async () => {
  const h = setup(async (req) => req.onToolCall({ name: "show", args: { number: 1 } }));
  h.back.texts.set(1, "全文。");
  await ask(h.front, 1, "我自己看");
  expect(h.cards).toEqual([{ number: 1, text: "全文。" }]);
  expect(h.told).toEqual([1]);
});

test("resumeOffset starts at the sentence the cut fell in", () => {
  expect(resumeOffset(`第一句。第二`)).toBe(4);
  expect(resumeOffset(`One. Two`)).toBe(4);
  expect(resumeOffset("only")).toBe(0);
});

test("the call's turns: ten at most, alternating, within the budget", () => {
  const lines = [{ role: "ai" as const, text: "你好" }];
  for (let i = 0; i < 15; i++) {
    lines.push({ role: "user" as never, text: `问${i}` }, { role: "ai", text: `答${i}` });
  }
  lines.push({ role: "ai", text: "刚才那个想好了" });
  const msgs = frontMessages(lines, FRONT_TOKEN_CAP);
  expect(msgs.filter((m) => m.role === "user")).toHaveLength(10);
  expect(msgs[msgs.length - 1]).toEqual({ role: "assistant", text: "答14\n刚才那个想好了" });
  const tight = frontMessages(lines, 12);
  expect(tight[0]!.role).toBe("user");
  expect(tight.reduce((n, m) => n + estimateTokens(m.text), 0)).toBeLessThanOrEqual(12);
  expect(frontMessages([{ role: "ai", text: "hi" }], 100)[0]).toEqual({ role: "user", text: "(the call opened)" });
  const req = frontRequest({ place: "x".repeat(20000), list: [], lines: [] });
  expect(estimateTokens(req.system)).toBeLessThan(FRONT_TOKEN_CAP);
});

test("thinking: off passes none; a model that cannot turn it off gets its lowest", () => {
  const base = { id: "m", reasoning: true } as never as Parameters<typeof frontReasoning>[0];
  expect(frontReasoning(base, "off")).toBeUndefined();
  expect(frontReasoning(base, "low")).toBe("low");
  expect(frontReasoning({ ...base, reasoning: false }, "low")).toBeUndefined();
  const always = { ...base, thinkingLevelMap: { off: null, minimal: null } } as typeof base;
  expect(frontReasoning(always, "off")).toBe("low");
});
