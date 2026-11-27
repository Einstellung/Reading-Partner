// A door conversation closed while its turn runs, and the turn then stalls
// (docs/pitfall/709): nobody is looking and nothing landed, so it is asked
// again out of sight with the request it was started with; the answer lands
// with the box card a reply nobody saw gets. A second stall leaves that card
// with the failure instead, and nothing in the file.

import { BACKGROUND_CONTEXT as ctx } from "@earendil-works/chord/context";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxAssistantMessage, fauxProvider, fauxText } from "@earendil-works/pi-ai/providers/faux";
import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStallWatches, STALL_MESSAGE, TURN_STALL_MS, type StallTimers } from "../../src/legion/durable/stall";
import type { TurnLogLine } from "../../src/legion/durable/turn-log-sink";
import { openReadingDurable } from "../../src/reading/turn/durable-runtime";
import { createPlaceSession } from "../../src/reading/turn/place-session";
import { doorOrigin, doorPlace, doorThreadKey, type AssembledDoorTurn } from "../../src/soul/door-durable";
import { testHost } from "../legion/durable/support/runtime";
import { fakeThreads } from "../reading/turn/support/durable-threads";

const ORIGIN = doorOrigin("2026-11-27", "d1");
const KEY = doorThreadKey(ORIGIN);
const LINE = { role: "user" as const, text: "What should I read next?", ts: 1000 };

type Responses = Parameters<ReturnType<typeof fauxProvider>["setResponses"]>[0];

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

const pause = (ms = 30) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(check: () => boolean, ms = 10_000) {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error("timed out");
    await pause(10);
  }
}

/** Ask at the door, close it while the first answer hangs. */
async function closedOnAHang(responses: Responses) {
  const clock = fakeClock();
  const watches = createStallWatches({ timers: clock.timers });
  const faux = fauxProvider({ models: [{ id: "faux-1", contextWindow: 200_000, maxTokens: 4096 }] });
  faux.setResponses(responses);
  const models = createModels();
  models.setProvider(faux.provider);
  const file = fakeThreads([{ role: "ai", text: "Morning.", ts: 500 }, LINE]);
  const assembled = new Map<string, AssembledDoorTurn>();
  const log: TurnLogLine[] = [];
  const cards: { ts: number; text: string }[] = [];
  const durable = await openReadingDurable({
    catalog: [],
    host: testHost(mkdtempSync(join(tmpdir(), "door-detached-stall-"))),
    models,
    threads: file.threads,
    openDesk: async () => [],
    places: {
      door: doorPlace({
        assembled,
        openDesk: async () => [],
        watching: () => false,
        card: async (_origin, ts, text) => {
          cards.push({ ts, text });
        },
      }),
    },
    log: (line) => log.push(line),
  });
  let assemblies = 0;
  let drawnAfterClose = 0;
  let closed = false;
  const session = createPlaceSession({
    durable: () => Promise.resolve(durable),
    key: KEY,
    surface: "door",
    assemble: async () => {
      assemblies += 1;
      assembled.set(KEY, { history: [{ role: "ai", text: "Morning." }], tools: [] });
      return {
        kind: "turn",
        request: {
          key: KEY,
          origin: ORIGIN,
          conversation: ORIGIN.threadId,
          surface: "door",
          line: { text: LINE.text, ts: LINE.ts },
          systemPrompt: "You are Kris.",
          tools: [],
          model: { provider: "faux", modelId: "faux-1" },
        },
      };
    },
    lastLine: () => LINE.ts,
    draw: () => {
      if (closed) drawnAfterClose += 1;
    },
    file: () => {},
    streaming: () => {
      if (closed) drawnAfterClose += 1;
    },
    stall: { watches },
  });
  session.ask();
  await until(() => faux.state.callCount === 1);
  closed = true;
  session.detach();
  return {
    durable,
    faux,
    clock,
    log,
    cards,
    file,
    session,
    assemblies: () => assemblies,
    drawnAfterClose: () => drawnAfterClose,
  };
}

const ends = (log: TurnLogLine[]) => log.filter((line) => line.event === "end").map((line) => (line as { reason: string }).reason);
const replies = (messages: readonly { role: string; text: string; ts: number }[]) =>
  messages.filter((m) => m.role === "ai" && m.ts > LINE.ts).map((m) => m.text);

test("closed, a stalled turn is asked again out of sight; the answer lands with a box card", async () => {
  const r = await closedOnAHang([silent, fauxAssistantMessage(fauxText("Try the essays."))]);
  r.clock.advance(TURN_STALL_MS + 1_000);
  await until(() => r.cards.length > 0);
  await r.session.idle();
  expect(r.faux.state.callCount).toBe(2);
  expect(r.assemblies()).toBe(1);
  expect(replies(r.file.messages)).toEqual(["Try the essays."]);
  expect(r.cards.map((card) => card.text)).toEqual(["Try the essays."]);
  expect(r.drawnAfterClose()).toBe(0);
  expect(ends(r.log)).toEqual(["stalled", "done"]);
  await r.durable.runtime.close(ctx);
});

test("closed, a second stall lands nothing in the file and puts the failure's box card", async () => {
  const r = await closedOnAHang([silent, silent]);
  r.clock.advance(TURN_STALL_MS + 1_000);
  await until(() => r.faux.state.callCount === 2);
  await pause();
  r.clock.advance(TURN_STALL_MS + 1_000);
  await until(() => r.cards.length > 0);
  await r.session.idle();
  await pause(100);
  expect(r.faux.state.callCount).toBe(2);
  expect(replies(r.file.messages)).toEqual([]);
  expect(r.cards.map((card) => card.text)).toEqual([STALL_MESSAGE]);
  expect(r.drawnAfterClose()).toBe(0);
  expect(ends(r.log)).toEqual(["stalled", "stalled"]);
  await r.durable.runtime.close(ctx);
});
