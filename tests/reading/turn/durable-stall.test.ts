// The stall watch on a book turn (reading/turn/durable-turn.ts, docs/soul/87
// "停摆"), on a clock the test moves: 90 seconds without progress supersedes
// the turn so it lands nothing; bytes on the provider connection are progress,
// keepalive comments included; a running tool holds the watch; coming back to
// the app after a long absence judges it once the connection has had its
// grace; the caller asks again once and shows the second stall as a failure
// (reading/turn/book-turn-rows.ts). A turn joined after a restart
// (resumedBookTurn) is watched the same way. The turn log's end line says the
// turn stalled.

import { BACKGROUND_CONTEXT as ctx } from "@earendil-works/chord/context";
import type { AssistantMessage, FetchFunction, Provider } from "@earendil-works/pi-ai";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { tappingBytes } from "../../../src/ai/provider-bytes";
import { startTurn } from "../../../src/legion/durable/turn";
import type { AgentTool } from "../../../src/legion/durable/contract";
import {
  createStallWatches,
  STALL_GRACE_MS,
  STALL_MESSAGE,
  TURN_STALL_MS,
  type SilenceRecord,
  type StallTimers,
} from "../../../src/legion/durable/stall";
import type { TurnLogLine } from "../../../src/legion/durable/turn-log-sink";
import {
  afterStall,
  driveBookTurn,
  resumedBookTurn,
  turnEnd,
  type DrivenBookTurn,
} from "../../../src/reading/turn/book-turn-rows";
import type { CallRow } from "../../../src/reading/turn/call-state";
import { bookThreadKey, bookThreadOrigin, type BookOrigin } from "../../../src/reading/turn/durable-book";
import { openReadingDurable, TURN_SECTION, type ReadingDurable } from "../../../src/reading/turn/durable-runtime";
import { createPlaceSession, withPlaceTurnRows } from "../../../src/reading/turn/place-session";
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
    /** The process is frozen: the wall clock moves on and no tick runs. */
    freeze(ms: number) {
      now += ms;
    },
  };
}

/** A response that never comes: the stream stays open and silent until aborted. */
const silent = (_c: unknown, options: { signal?: AbortSignal } | undefined) =>
  new Promise<AssistantMessage>((resolve) => {
    options?.signal?.addEventListener("abort", () => resolve({ ...fauxAssistantMessage(""), stopReason: "aborted" }));
  });

/**
 * A provider connection the test feeds by hand. While the model reasons it
 * carries only SSE comment lines, as the ChatGPT backend's every 5 s.
 */
function wire() {
  let feed!: ReadableStreamDefaultController<Uint8Array>;
  let opened!: () => void;
  const open = new Promise<void>((resolve) => (opened = resolve));
  const fetch = (async () => {
    const body = new ReadableStream<Uint8Array>({
      start: (controller) => {
        feed = controller;
        opened();
      },
    });
    return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
  }) as unknown as FetchFunction;
  return {
    fetch,
    open,
    keepalive: () => feed.enqueue(new TextEncoder().encode(": keepalive\n\n")),
    end: () => feed.close(),
  };
}

/** A reasoning model: reads its connection until it closes, then answers. No partial until then. */
const reasoning = async (_c: unknown, options: { signal?: AbortSignal; fetch?: FetchFunction } | undefined) => {
  const response = await options!.fetch!("https://provider.test/responses");
  const reader = response.body!.getReader();
  const aborted = new Promise<"aborted">((resolve) => options?.signal?.addEventListener("abort", () => resolve("aborted")));
  for (;;) {
    const next = await Promise.race([reader.read(), aborted]);
    if (next === "aborted") return { ...fauxAssistantMessage(""), stopReason: "aborted" as const };
    if (next.done) return fauxAssistantMessage(fauxText("The moon."));
  }
};

async function setup(
  responses: Parameters<ReturnType<typeof fauxProvider>["setResponses"]>[0],
  tools: AgentTool[] = [],
  fetch?: FetchFunction,
) {
  const faux = fauxProvider({ models: [{ id: "faux-1", contextWindow: 200_000, maxTokens: 4096 }] });
  faux.setResponses(responses);
  const models = createModels();
  // The connection reports its bytes as the app's providers' do (ai/durable-models.ts).
  const wired = fetch ? { fetch } : {};
  const stream: Provider["stream"] = (model, context, options) =>
    faux.provider.stream(model, context, tappingBytes({ ...options, ...wired }) as typeof options);
  const streamSimple: Provider["streamSimple"] = (model, context, options) =>
    faux.provider.streamSimple(model, context, tappingBytes({ ...options, ...wired }) as typeof options);
  models.setProvider(Object.assign(Object.create(faux.provider) as Provider, { stream, streamSimple }));
  const { threads, messages } = fakeThreads([{ role: "user", ts: 1000, text: "Why tides?" }]);
  const lines: TurnLogLine[] = [];
  const durable = await openReadingDurable({
    catalog: tools,
    host: testHost(mkdtempSync(join(tmpdir(), "reading-stall-"))),
    models,
    threads,
    watching: () => true,
    openDesk: async () => tools,
    now: () => 1000,
    log: (line) => lines.push(line),
  });
  return { durable, messages, lines, faux };
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

type Request = ReturnType<typeof request>;
type Drive = (durable: ReadingDurable, req: Request, onRows: (rows: CallRow[]) => void) => Promise<DrivenBookTurn>;

/** A turn started here, and one already in flight when the thread is opened, as recovery leaves it. */
const drivers: [string, Drive][] = [
  ["started here", (durable, req, onRows) => driveBookTurn(durable, req, onRows, ctx)],
  [
    "joined after a restart",
    async (durable, req, onRows) => {
      await startTurn(
        durable.runtime,
        {
          key: bookThreadKey(BOOK),
          origin: bookThreadOrigin(BOOK),
          content: req.line.text,
          sections: { [TURN_SECTION]: req.systemPrompt },
          tools: req.tools.map((tool) => tool.name),
          model: req.model,
          excludeTs: req.line.ts,
        },
        ctx,
      );
      const found = await resumedBookTurn(durable, BOOK, ctx, { watches: req.watches });
      return found!.follow(onRows);
    },
  ],
];

const ended = (lines: TurnLogLine[]) => lines.filter((line) => line.event === "end").map((line) => (line as { reason: string }).reason);

for (const [how, drive] of drivers) {

test(`${how}: ninety silent seconds supersede the turn: nothing lands, and it ends stalled`, async () => {
  const { durable, messages, lines } = await setup([silent]);
  const clock = fakeClock();
  const turn = await drive(durable, request(clock), () => {});
  await settle();
  clock.advance(TURN_STALL_MS + 1_000);
  const end = await turn.ended;
  expect(end.kind).toBe("stalled");
  expect(messages.length).toBe(1);
  expect(ended(lines)).toEqual(["stalled"]);
  await durable.runtime.close(ctx);
});

test(`${how}: a running tool holds the watch, and the turn answers after it`, async () => {
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
  const { durable, messages, lines } = await setup(
    [fauxAssistantMessage([fauxToolCall("read_pages", {})], { stopReason: "toolUse" }), fauxAssistantMessage(fauxText("The moon."))],
    [slow],
  );
  const clock = fakeClock();
  let toolRuns!: () => void;
  const running = new Promise<void>((resolve) => (toolRuns = resolve));
  const onRows = (rows: { tools?: { state: string }[] }[]) => {
    if (rows.some((r) => r.tools?.some((t) => t.state === "running"))) toolRuns();
  };
  const turn = await drive(durable, request(clock, [slow]), onRows);
  await running;
  await settle();
  clock.advance(3 * TURN_STALL_MS);
  release.resolve();
  const end = await turn.ended;
  expect(end.kind).toBe("answered");
  expect(messages[messages.length - 1]?.text).toBe("The moon.");
  expect(ended(lines)).toEqual(["done"]);
  await durable.runtime.close(ctx);
});

test(`${how}: a reasoning stream that sends only comment lines stays alive, and is cut once they stop`, async () => {
  const w = wire();
  const { durable, messages } = await setup([reasoning], [], w.fetch);
  const clock = fakeClock();
  const turn = await drive(durable, request(clock), () => {});
  let ended: string | undefined;
  void turn.ended.then((end) => (ended = end.kind));
  await w.open;
  await settle();
  // Four minutes with no partial at all, a keepalive every half minute.
  for (let i = 0; i < 8; i++) {
    clock.advance(30_000);
    w.keepalive();
    await settle();
  }
  expect(ended).toBeUndefined();
  clock.advance(TURN_STALL_MS);
  const end = await turn.ended;
  expect(end.kind).toBe("stalled");
  expect(messages.length).toBe(1);
  await durable.runtime.close(ctx);
});

test(`${how}: back in the app after a long absence, bytes within the grace keep the turn`, async () => {
  const w = wire();
  const { durable, messages } = await setup([reasoning], [], w.fetch);
  const clock = fakeClock();
  const req = request(clock);
  const turn = await drive(durable, req, () => {});
  let ended: string | undefined;
  void turn.ended.then((end) => (ended = end.kind));
  await w.open;
  await settle();
  req.watches.away(clock.now());
  clock.freeze(TURN_STALL_MS + 30_000);
  // The first tick after the thaw lands before the way back is heard.
  clock.advance(0);
  req.watches.back(clock.now());
  await settle();
  clock.advance(2_000);
  // What the socket kept through the freeze.
  w.keepalive();
  await settle();
  clock.advance(STALL_GRACE_MS);
  await settle();
  expect(ended).toBeUndefined();
  w.end();
  const end = await turn.ended;
  expect(end.kind).toBe("answered");
  expect(messages[messages.length - 1]?.text).toBe("The moon.");
  await durable.runtime.close(ctx);
});

test(`${how}: back in the app after a long absence with nothing on the connection: cut when the grace runs out`, async () => {
  const { durable, messages } = await setup([silent]);
  const clock = fakeClock();
  const req = request(clock);
  const turn = await drive(durable, req, () => {});
  let ended: string | undefined;
  void turn.ended.then((end) => (ended = end.kind));
  await settle();
  req.watches.away(clock.now());
  clock.freeze(60_000);
  req.watches.back(clock.now());
  clock.advance(STALL_GRACE_MS - 1_000);
  await settle();
  expect(ended).toBeUndefined();
  clock.advance(1_000);
  const end = await turn.ended;
  expect(end.kind).toBe("stalled");
  expect(messages.length).toBe(1);
  await durable.runtime.close(ctx);
});
}

// The rule after a stall is the same however the cut came (docs/soul/87 "停摆").
test("cut on the way back with nothing in the grace, the turn is asked again once; the second cut is a failure", async () => {
  const { durable, faux } = await setup([silent, silent, fauxAssistantMessage(fauxText("The moon."))]);
  const clock = fakeClock();
  const watches = createStallWatches({ timers: clock.timers });
  const key = bookThreadKey(BOOK);
  let screen: CallRow[] = [{ role: "user", text: "Why tides?", ts: 1000 }];
  const s = createPlaceSession({
    durable: () => Promise.resolve(durable),
    key,
    surface: "reading",
    assemble: async () => {
      durable.assembled.put(key, { history: [], tools: [] });
      return {
        kind: "turn",
        request: {
          key,
          origin: bookThreadOrigin(BOOK),
          conversation: BOOK.threadId,
          surface: "reading",
          line: { text: "Why tides?", ts: 1000 },
          systemPrompt: "You are a reading partner.",
          tools: [],
          model: { provider: "faux", modelId: "faux-1" },
        },
      };
    },
    lastLine: () => 1000,
    draw: (after, rows) => (screen = withPlaceTurnRows(screen, after, rows)),
    file: () => {},
    streaming: () => {},
    stall: { watches },
  });
  s.ask();
  for (let trip = 1; trip <= 2; trip++) {
    await until(() => faux.state.callCount === trip);
    await settle();
    watches.away(clock.now());
    clock.freeze(60_000);
    watches.back(clock.now());
    clock.advance(STALL_GRACE_MS);
  }
  await until(() => JSON.stringify(screen).includes(STALL_MESSAGE));
  await settle();
  expect(faux.state.callCount).toBe(2);
  expect(screen.map((row) => row.role)).toEqual(["user", "ai"]);
  await durable.runtime.close(ctx);
});

async function until(check: () => boolean, ms = 5_000) {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error("timed out");
    await settle();
  }
}

test("a development build keeps each turn's longest silence", async () => {
  const before = process.env.DEV;
  process.env.DEV = "1";
  try {
    const host = globalThis as { __stallSilences?: SilenceRecord[] };
    host.__stallSilences = [];
    const { durable } = await setup([silent]);
    const clock = fakeClock();
    const turn = await driveBookTurn(durable, request(clock), () => {}, ctx);
    await settle();
    clock.advance(TURN_STALL_MS + 1_000);
    await turn.ended;
    expect(host.__stallSilences.map((r) => [r.surface, r.ms])).toEqual([["reading", TURN_STALL_MS + 1_000]]);
    await durable.runtime.close(ctx);
  } finally {
    if (before === undefined) delete process.env.DEV;
    else process.env.DEV = before;
  }
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
