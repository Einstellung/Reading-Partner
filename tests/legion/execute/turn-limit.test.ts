// A turn's whole allowance (src/legion/execute/stall.ts `limit`, wired in
// turn.ts). The silence watch pauses while a tool runs, so a tool that never
// returns used to hold the turn, and its lane, for ever; the allowance is not
// paused by anything. Ending the run is not enough on its own either: pi waits
// on a running tool's promise, so the turn lets go of the tool instead.
// Run: scripts/t.sh tests/legion/execute/turn-limit.test.ts

import { expect, test } from "bun:test";
import { BACKGROUND_CONTEXT } from "@earendil-works/pi-agent-core";
import {
  Type,
  createAssistantMessageEventStream,
  type Api,
  type Message,
  type Model,
} from "@earendil-works/pi-ai";
import { runHarnessTurn, type AgentTool, type AgentToolEnd, type StreamFn } from "../../../src/legion/execute/turn";
import { holdHarness } from "../../../src/legion/execute/held";
import {
  createStallWatches,
  INFO_TURN_LIMIT_MS,
  isStall,
  isTurnLimit,
  TURN_LIMIT_MESSAGE,
  TURN_LIMIT_MS,
  turnLimitFor,
  type StallTimers,
} from "../../../src/legion/execute/stall";
import type { TurnLogLine } from "../../../src/legion/execute/turn-log";
import { createSessionFileSystem } from "../../../src/platform/app/session-fs";
import { memoryAppData } from "../../support/memory-appdata";
import { turnEvents, type Turn } from "../../support/scripted-turn";

const ctx = BACKGROUND_CONTEXT;
const MODEL = { id: "m", provider: "faux" } as unknown as Model<Api>;
const SOUL = { name: "soul", sessions: "soul" };

function clock(): StallTimers & { advance: (ms: number) => void } {
  let at = 1_000_000;
  const ticks = new Set<() => void>();
  return {
    now: () => at,
    every(_ms, tick) {
      ticks.add(tick);
      return () => ticks.delete(tick);
    },
    advance(ms) {
      at += ms;
      for (const tick of [...ticks]) tick();
    },
  };
}

function scriptStream(turns: Turn[]): StreamFn {
  let round = 0;
  return () => {
    const stream = createAssistantMessageEventStream();
    const events = turnEvents(turns[round++] ?? { error: "no scripted turn" });
    (async () => {
      for (const ev of events) {
        await Promise.resolve();
        stream.push(ev);
      }
      stream.end();
    })();
    return stream;
  };
}

function user(content: string): Message {
  return { role: "user", content, timestamp: 0 };
}

// A tool that never comes back, and says when it was called.
function hungTool(): { tool: AgentTool; called: Promise<void> } {
  let markCalled!: () => void;
  const called = new Promise<void>((resolve) => {
    markCalled = resolve;
  });
  return {
    called,
    tool: {
      name: "fetch_forever",
      label: () => "Fetching",
      effect: "read" as const,
      description: "never returns",
      parameters: Type.Object({}),
      execute: () => {
        markCalled();
        return new Promise<string>(() => {});
      },
    },
  };
}

const CALL_THEN_ANSWER: Turn[] = [{ calls: [{ name: "fetch_forever", args: {}, id: "c1" }] }, { text: "never" }];

test("a tool that never returns is cut at the turn's allowance, the reader is told, and the lane is free", async () => {
  const timers = clock();
  const watches = createStallWatches({ timers });
  const held = holdHarness({ lane: SOUL, fileSystem: createSessionFileSystem(memoryAppData()) });
  const hung = hungTool();
  const lines: TurnLogLine[] = [];
  const ends: AgentToolEnd[] = [];
  let failure: { message: string; thrown: unknown } | undefined;
  let answered = false;

  const turn = runHarnessTurn({
    stream: scriptStream(CALL_THEN_ANSWER),
    model: MODEL,
    messages: [user("plan the week")],
    tools: [hung.tool],
    maxRounds: 8,
    held,
    conversation: "meals",
    stall: watches,
    limitMs: 60_000,
    log: (line) => lines.push(line),
    onDelta: () => {},
    onToolStart: () => {},
    onToolEnd: (info) => ends.push(info),
    onDone: () => {
      answered = true;
    },
    onError: (message, _assistant, thrown) => {
      failure = { message, thrown };
    },
  });

  await hung.called;
  await Bun.sleep(10);
  // Far past the silence window: the tool holds it, so only the allowance counts.
  timers.advance(59_000);
  expect(failure).toBeUndefined();
  timers.advance(1_000);
  await turn;

  expect(answered).toBe(false);
  expect(failure?.message).toBe(TURN_LIMIT_MESSAGE);
  expect(isTurnLimit(failure?.thrown)).toBe(true);
  expect(isStall(failure?.thrown)).toBe(false);
  // The running line ends red rather than spinning on.
  expect(ends).toHaveLength(1);
  expect(ends[0]!.isError).toBe(true);
  expect(lines[lines.length - 1]).toMatchObject({ event: "end", reason: "timed-out" });

  // The conversation's next turn is not waiting behind the dead one.
  const next = await held.acquire(
    {
      model: MODEL,
      streamFn: scriptStream([]),
      tools: [],
      toProviderMessages: (messages) => messages as Message[],
      conversation: "meals",
    },
    ctx,
  );
  next.release();
  await held.close(ctx);
});

test("the reader's Stop during a tool that never returns ends the turn quietly and frees the lane", async () => {
  const held = holdHarness({ lane: SOUL, fileSystem: createSessionFileSystem(memoryAppData()) });
  const hung = hungTool();
  const controller = new AbortController();
  const lines: TurnLogLine[] = [];
  const ends: AgentToolEnd[] = [];
  const said: string[] = [];

  const turn = runHarnessTurn({
    stream: scriptStream(CALL_THEN_ANSWER),
    model: MODEL,
    messages: [user("look this up")],
    tools: [hung.tool],
    maxRounds: 8,
    held,
    conversation: "book",
    signal: controller.signal,
    stall: null,
    log: (line) => lines.push(line),
    onDelta: () => {},
    onToolStart: () => {},
    onToolEnd: (info) => ends.push(info),
    onDone: () => said.push("done"),
    onError: (message) => said.push(message),
  });

  await hung.called;
  await Bun.sleep(10);
  controller.abort();
  await turn;

  expect(said).toEqual([]);
  expect(ends).toEqual([]);
  expect(lines[lines.length - 1]).toMatchObject({ event: "end", reason: "aborted" });
  const next = await held.acquire(
    {
      model: MODEL,
      streamFn: scriptStream([]),
      tools: [],
      toProviderMessages: (messages) => messages as Message[],
      conversation: "book",
    },
    ctx,
  );
  next.release();
  await held.close(ctx);
});

test("the allowance runs while a tool holds the silence clock, and arming it again moves it", () => {
  const timers = clock();
  const watches = createStallWatches({ timers });
  const fired: string[] = [];
  const watch = watches.watch({
    stallMs: 90_000,
    onStall: () => fired.push("stall"),
    onLimit: () => fired.push("limit"),
  });
  watch.limit(100_000);
  watch.hold();
  timers.advance(50_000);
  watch.limit(100_000);
  timers.advance(99_000);
  expect(fired).toEqual([]);
  timers.advance(1_000);
  expect(fired).toEqual(["limit"]);
  // One ending only.
  timers.advance(200_000);
  expect(fired).toEqual(["limit"]);
});

test("the info companion gets the longer allowance", () => {
  expect(turnLimitFor("info")).toBe(INFO_TURN_LIMIT_MS);
  expect(turnLimitFor("reading")).toBe(TURN_LIMIT_MS);
  expect(turnLimitFor(undefined)).toBe(TURN_LIMIT_MS);
});
