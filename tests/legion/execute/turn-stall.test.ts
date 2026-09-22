// A turn whose stream goes silent and never says so (src/legion/execute/turn.ts
// with src/legion/execute/stall.ts).
//
// The iPad case: the app is switched away mid-answer, iOS freezes the process,
// and the connection is dead when it thaws. pi is still inside `drive`, so
// without a watch the run never settles, the lane is never handed back
// (held.ts serialises turns on it) and the thread goes on counting as busy.
// Run: scripts/t.sh tests/legion/execute/turn-stall.test.ts

import { expect, test } from "bun:test";
import { BACKGROUND_CONTEXT } from "@earendil-works/pi-agent-core";
import {
  createAssistantMessageEventStream,
  type Api,
  type Message,
  type Model,
} from "@earendil-works/pi-ai";
import { runHarnessTurn, type StreamFn } from "../../../src/legion/execute/turn";
import { holdHarness } from "../../../src/legion/execute/held";
import { createSessionFileSystem } from "../../../src/platform/app/session-fs";
import {
  createStallWatches,
  isStall,
  type StallTimers,
} from "../../../src/legion/execute/stall";
import { memoryAppData } from "../../support/memory-appdata";
import { turnEvents } from "../../support/scripted-turn";

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

// A stream that opens and then says nothing more, ever: the shape a frozen
// process leaves behind. It ends only when the request is aborted, which is
// what pi does on `requestAbort` and what the plugin's fetch does for real.
function deadStream(started: () => void): StreamFn {
  return (_model, _context, options) => {
    const stream = createAssistantMessageEventStream();
    const signal = options?.signal;
    const end = (): void => {
      for (const ev of turnEvents({ error: "aborted", reason: "aborted" })) stream.push(ev);
      stream.end();
    };
    if (signal?.aborted) end();
    else signal?.addEventListener("abort", end, { once: true });
    queueMicrotask(started);
    return stream;
  };
}

function user(content: string): Message {
  return { role: "user", content, timestamp: 0 };
}

test("a stream that falls silent ends the turn, hands the lane back and says it stalled", async () => {
  const timers = clock();
  const watches = createStallWatches({ timers });
  const disk = memoryAppData();
  const held = holdHarness({ lane: SOUL, fileSystem: createSessionFileSystem(disk) });

  let open = (): void => {};
  const inFlight = new Promise<void>((resolve) => {
    open = resolve;
  });
  let failure: { message: string; thrown: unknown } | undefined;
  let answered = false;

  const turn = runHarnessTurn({
    stream: deadStream(open),
    model: MODEL,
    messages: [user("what does page 12 mean?")],
    tools: [],
    maxRounds: 8,
    held,
    stall: watches,
    stallMs: 90_000,
    onDelta: () => {},
    onToolStart: () => {},
    onToolEnd: () => {},
    onDone: () => {
      answered = true;
    },
    onError: (message, _assistant, thrown) => {
      failure = { message, thrown };
    },
  });

  await inFlight;
  await Bun.sleep(20);
  // Nothing has happened yet: the window has not run out.
  timers.advance(80_000);
  expect(failure).toBeUndefined();

  timers.advance(20_000);
  await turn;

  expect(answered).toBe(false);
  expect(failure).toBeDefined();
  expect(isStall(failure!.thrown)).toBe(true);

  // The lane is free: the next turn on it is not waiting behind the dead one.
  const next = await held.acquire(
    {
      model: MODEL,
      streamFn: deadStream(() => {}),
      tools: [],
      toProviderMessages: (messages) => messages as Message[],
    },
    ctx,
  );
  next.release();
  await held.close(ctx);
});

test("coming back to a turn that said nothing while the app was away cuts it at once", async () => {
  const timers = clock();
  const watches = createStallWatches({ timers });
  const disk = memoryAppData();
  const held = holdHarness({ lane: SOUL, fileSystem: createSessionFileSystem(disk) });

  let open = (): void => {};
  const inFlight = new Promise<void>((resolve) => {
    open = resolve;
  });
  let failure: unknown;

  const turn = runHarnessTurn({
    stream: deadStream(open),
    model: MODEL,
    messages: [user("what does page 12 mean?")],
    tools: [],
    maxRounds: 8,
    held,
    stall: watches,
    stallMs: 90_000,
    onDelta: () => {},
    onToolStart: () => {},
    onToolEnd: () => {},
    onDone: () => {},
    onError: (_message, _assistant, thrown) => {
      failure = thrown;
    },
  });

  await inFlight;
  await Bun.sleep(20);
  const left = timers.now();
  watches.away(left);
  // Frozen for half a minute, then to the front again — a third of the window.
  timers.advance(30_000);
  watches.back(timers.now());
  await turn;

  expect(isStall(failure)).toBe(true);
  await held.close(ctx);
});
