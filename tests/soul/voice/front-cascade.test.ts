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

function setup(script: (req: FrontModelRequest) => Promise<void>) {
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
  const front = createCascadeFront({
    model,
    backend,
    place: () => "Today: three labs.",
    write: (l) => written.push({ key: l.key, text: l.text }),
    filler: { play: async () => false },
    locale: "zh-CN",
    marks: (m) => marks.push(m),
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
  return { back, told, front, marks, cards, requests, written, programs, advance };
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
