// The front's request under a voice call's stall limits, on a virtual clock:
// the stall watch takes its timers from the registry the test hands in.
//
// Run: bun test tests/soul/voice/front-stall.test.ts

import { expect, test } from "bun:test";
import { createStallWatches, type StallTimers } from "../../../src/legion/durable/stall";
import type { CallBack } from "../../../src/soul/voice/front/backend";
import {
  FRONT_CHUNK_STALL_MS,
  FRONT_FIRST_BYTE_MS,
  FrontStallError,
  createCascadeFront,
} from "../../../src/soul/voice/front/cascade";
import type { FrontModel, FrontModelRequest } from "../../../src/soul/voice/front/model";
import type { ConversationEvent, ConversationSource } from "../../../src/soul/voice/conversation";
import { fillerLine } from "../../../src/soul/voice/front/filler";
import { KICKOFF_TURN, createVoiceCall } from "../../../src/soul/voice/voice-call";

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

/** A clock the test moves, and the tickers armed on it. */
function virtualClock() {
  let clock = 0;
  const tickers = new Set<{ ms: number; next: number; tick: () => void }>();
  const timers: StallTimers = {
    now: () => clock,
    every: (ms, tick) => {
      const t = { ms, next: clock + ms, tick };
      tickers.add(t);
      return () => tickers.delete(t);
    },
  };
  const advance = async (ms: number) => {
    const until = clock + ms;
    for (;;) {
      const due = [...tickers].filter((t) => t.next <= until).sort((a, b) => a.next - b.next)[0];
      if (!due) break;
      clock = due.next;
      due.next += due.ms;
      due.tick();
      await flush();
    }
    clock = until;
    await flush();
  };
  return { timers, advance, now: () => clock, live: () => tickers.size };
}

const backend: CallBack = {
  delegateTool: () => ({
    name: "delegate",
    label: () => "Handing it over",
    effect: "write",
    description: "",
    parameters: { type: "object", properties: {} } as never,
    execute: async () => "Handed over as task 1.",
  }),
  cancel: async () => ({ ok: true }),
  tasks: () => [],
  text: async () => null,
  told: async () => true,
  subscribe: () => () => {},
};

/** A model whose stream never yields and never hears the abort. */
const hung: FrontModel = () => new Promise<void>(() => {});

function setup(model: FrontModel, opts: { clip?: boolean; gapMs?: number } = {}) {
  const clock = virtualClock();
  const traced: string[] = [];
  const cues: { kind: string; played: boolean }[] = [];
  const plays: [string, string][] = [];
  const requests: FrontModelRequest[] = [];
  const front = createCascadeFront({
    model: (req) => {
      requests.push(req);
      return model(req);
    },
    backend,
    place: () => "Today: three labs.",
    write: () => {},
    filler: {
      play: async (kind, locale) => {
        plays.push([kind, locale]);
        return opts.clip ?? true;
      },
    },
    locale: "zh-CN",
    marks: () => {},
    trace: (name, data) => {
      traced.push(name);
      if (name === "front:cue") cues.push(data as { kind: string; played: boolean });
    },
    onShow: () => {},
    stall: createStallWatches({ timers: clock.timers }),
    ...(opts.gapMs !== undefined ? { gapMs: opts.gapMs } : {}),
  });
  return { front, clock, traced, requests, plays, cues };
}

function ask(front: ReturnType<typeof setup>["front"], turn: number, signal = new AbortController().signal) {
  const deltas: string[] = [];
  let outcome: "pending" | "done" | Error = "pending";
  const done = front.model
    .ask({ turn, text: "你好", signal, onDelta: (c) => deltas.push(c), onActivity: () => {} })
    .then(
      () => {
        outcome = "done";
      },
      (e: Error) => {
        outcome = e;
      },
    );
  return { deltas, done, outcome: () => outcome };
}

test("a request that never answers fails the turn at the first-byte limit, not before", async () => {
  const h = setup(hung);
  const r = ask(h.front, 1);
  await h.clock.advance(FRONT_FIRST_BYTE_MS - 1000);
  expect(r.outcome()).toBe("pending");
  await h.clock.advance(1000);
  const e = r.outcome();
  expect(e).toBeInstanceOf(FrontStallError);
  expect((e as FrontStallError).waitedFor).toBe("first-byte");
  expect(h.requests[0]!.signal.aborted).toBe(true);
  expect(h.traced).toContain("front:stall");
  expect(h.clock.live()).toBe(0);
});

test("a stream that stops partway fails at the chunk limit, and what it sends late is dropped", async () => {
  let late: FrontModelRequest | null = null;
  const h = setup(async (req) => {
    req.onText("我觉得，");
    late = req;
    await new Promise<void>(() => {});
  });
  const r = ask(h.front, 1);
  await h.clock.advance(FRONT_CHUNK_STALL_MS - 1000);
  expect(r.outcome()).toBe("pending");
  await h.clock.advance(1000);
  expect((r.outcome() as FrontStallError).waitedFor).toBe("chunk");
  late!.onText("周末读点小说。");
  expect(r.deltas.join("")).toBe("我觉得，");
});

test("a slow first byte inside the limit and a stream that keeps talking are left alone", async () => {
  let req!: FrontModelRequest;
  let finish!: () => void;
  const h = setup(
    (r) =>
      new Promise<void>((resolve) => {
        req = r;
        finish = resolve;
      }),
  );
  const r = ask(h.front, 1);
  await h.clock.advance(FRONT_FIRST_BYTE_MS - 3000);
  req.onText("嗯，");
  // Thinking or a tool call's arguments streaming keep it alive once it has started.
  for (let i = 0; i < 4; i++) {
    await h.clock.advance(FRONT_CHUNK_STALL_MS - 1000);
    req.onProgress?.();
  }
  req.onText("读小说吧。");
  finish();
  await r.done;
  expect(r.outcome()).toBe("done");
  expect(r.deltas.join("")).toBe("嗯，读小说吧。");
  expect(h.clock.live()).toBe(0);
});

test("progress before anything is said does not stop the first-byte clock", async () => {
  const h = setup(async (req) => {
    req.onProgress?.();
    await new Promise<void>(() => {});
  });
  const r = ask(h.front, 1);
  await h.clock.advance(FRONT_FIRST_BYTE_MS);
  expect((r.outcome() as FrontStallError).waitedFor).toBe("first-byte");
});

/** The native call, faked: the commands it was sent and a way to send it events. */
function bridge() {
  const commands: string[] = [];
  let listener: ((e: ConversationEvent) => void) | null = null;
  const source: ConversationSource = {
    start: async (onEvent) => {
      commands.push("start");
      listener = onEvent;
    },
    stop: async () => {
      commands.push("stop");
    },
    setVolume: async () => {},
    speakBegin: async () => {
      commands.push("speak_begin");
      return 1;
    },
    speakPush: async (text) => {
      commands.push(`speak_push ${text}`);
    },
    speakClose: async () => {
      commands.push("speak_close");
    },
    speakStop: async () => ({ utterance: 1, sentence: 0, positionMs: 0, durationMs: 0 }),
  };
  return { source, commands, emit: (e: ConversationEvent) => listener?.(e) };
}

test("a stalled turn hands the floor back and the next turn is answered", async () => {
  let n = 0;
  const h = setup(async (req) => {
    n += 1;
    // The greeting and the second turn answer; the first turn's request hangs.
    if (n === 2) return new Promise<void>(() => {});
    req.onText(n === 1 ? "你好。" : "读小说吧。");
  });
  const b = bridge();
  const call = createVoiceCall({ bridge: b.source, model: h.front.model, transcript: h.front.transcript, front: h.front });
  const phases: string[] = [];
  call.subscribePhase((p) => phases.push(p));
  await call.start();
  b.emit({ kind: "state", turn: 0, running: true, reason: "opened" });
  await call.settled();
  b.emit({ kind: "spoken", turn: 0, utterance: 1, reason: "done" });
  await flush();
  await call.settled();

  b.emit({ kind: "speech-end", turn: 1, text: "你觉得周末适合读点什么？", silentMs: 1200 });
  await flush();
  await call.settled();
  expect(call.snapshot().phase).toBe("thinking");
  await h.clock.advance(FRONT_FIRST_BYTE_MS);
  await call.settled();
  expect(call.snapshot().phase).toBe("listening");
  expect(call.snapshot().running).toBe(true);

  b.emit({ kind: "speech-end", turn: 2, text: "那推荐一本？", silentMs: 1200 });
  await flush();
  await call.settled();
  expect(h.requests).toHaveLength(3);
  expect(b.commands).toContain("speak_push 读小说吧。");
});

test("a stalled reply that said nothing plays the line asking again, once", async () => {
  const h = setup(hung);
  const r = ask(h.front, 1);
  await h.clock.advance(FRONT_FIRST_BYTE_MS);
  await r.done;
  expect(r.outcome()).toBeInstanceOf(FrontStallError);
  expect(h.plays).toEqual([["lost", "zh-CN"]]);
  expect(h.cues).toEqual([{ turn: 1, kind: "lost", played: true }] as never);
  expect(r.deltas).toEqual([]);
  await h.clock.advance(FRONT_FIRST_BYTE_MS * 2);
  expect(h.plays).toHaveLength(1);
});

test("with no clip the line is said as the reply, and the turn ends as one that answered", async () => {
  const h = setup(async () => {
    throw new Error("503 Service Unavailable");
  }, { clip: false });
  const r = ask(h.front, 1);
  await r.done;
  expect(r.outcome()).toBe("done");
  expect(r.deltas.join("")).toBe(fillerLine("lost", "zh-CN"));
  expect(h.cues).toEqual([{ turn: 1, kind: "lost", played: false }] as never);
});

test("a reply the reader cut into is not followed by the line", async () => {
  const barge = new AbortController();
  const h = setup(
    (req) =>
      new Promise<void>((_, reject) => {
        req.signal.addEventListener("abort", () => reject(new Error("Request was aborted")));
      }),
  );
  const r = ask(h.front, 1, barge.signal);
  await h.clock.advance(3000);
  barge.abort();
  await r.done;
  expect(r.outcome()).toBeInstanceOf(Error);
  expect(h.plays).toEqual([]);
});

test("a reply that had already started talking is not followed by the line", async () => {
  const h = setup(async (req) => {
    req.onText("我觉得，");
    await new Promise<void>(() => {});
  });
  const r = ask(h.front, 1);
  await h.clock.advance(FRONT_CHUNK_STALL_MS);
  await r.done;
  expect((r.outcome() as FrontStallError).waitedFor).toBe("chunk");
  expect(h.plays).toEqual([]);
});

test("a failed notice and a failed opening line are not followed by the line", async () => {
  const h = setup(hung, { gapMs: 0 });
  const programs: number[] = [];
  h.front.bind({
    program: async (turn) => {
      programs.push(turn);
      return true;
    },
  });
  h.front.notify({ number: 1, task: "Find X", outcome: "done", cover: "X is Y." });
  h.front.observe({ type: "orb", phase: "listening" });
  await flush();
  expect(programs).toEqual([-1]);
  const notice = ask(h.front, -1);
  const opening = ask(h.front, KICKOFF_TURN);
  await h.clock.advance(FRONT_FIRST_BYTE_MS);
  await Promise.all([notice.done, opening.done]);
  expect(notice.outcome()).toBeInstanceOf(FrontStallError);
  expect(opening.outcome()).toBeInstanceOf(FrontStallError);
  expect(h.plays).toEqual([]);
});
