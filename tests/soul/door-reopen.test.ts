// A door conversation closed while its turn runs and opened again (docs/soul/87,
// 第二阶段「关对话不停回合」): the detached session and the one that joined
// the turn both follow it to its end. A stall or a stop then asks again once at
// most, leaves one failure row at most, and files the withdrawn line once.

import { BACKGROUND_CONTEXT as ctx } from "@earendil-works/chord/context";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxAssistantMessage, fauxProvider, fauxText } from "@earendil-works/pi-ai/providers/faux";
import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStallWatches, TURN_STALL_MS, type StallTimers, type StallWatches } from "../../src/legion/durable/stall";
import type { TurnLogLine } from "../../src/legion/durable/turn-log-sink";
import type { CallRow } from "../../src/reading/turn/call-state";
import { openReadingDurable, type ReadingDurable } from "../../src/reading/turn/durable-runtime";
import { createPlaceSession, withPlaceTurnRows, type PlaceSession } from "../../src/reading/turn/place-session";
import { doorOrigin, doorPlace, doorThreadKey, type AssembledDoorTurn } from "../../src/soul/door-durable";
import { testHost } from "../legion/durable/support/runtime";
import { fakeThreads } from "../reading/turn/support/durable-threads";

const ORIGIN = doorOrigin("2026-10-11", "d1");
const KEY = doorThreadKey(ORIGIN);
const LINE = { role: "user" as const, text: "What should I read next?", ts: 1000 };
const STEER = { text: "Something short, please.", ts: 2000 };

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

async function rig(responses: Responses) {
  const faux = fauxProvider({ models: [{ id: "faux-1", contextWindow: 200_000, maxTokens: 4096 }] });
  faux.setResponses(responses);
  const models = createModels();
  models.setProvider(faux.provider);
  const file = fakeThreads([{ role: "ai", text: "Morning.", ts: 500 }, LINE]);
  const assembled = new Map<string, AssembledDoorTurn>();
  const log: TurnLogLine[] = [];
  const durable = await openReadingDurable({
    catalog: [],
    host: testHost(mkdtempSync(join(tmpdir(), "door-reopen-"))),
    models,
    threads: file.threads,
    openDesk: async () => [],
    places: { door: doorPlace({ assembled, openDesk: async () => [], watching: () => true, card: async () => {} }) },
    log: (line) => log.push(line),
  });
  return { durable, faux, assembled, log, file };
}

function session(
  durable: ReadingDurable,
  assembled: Map<string, AssembledDoorTurn>,
  watches: StallWatches,
  gate: Promise<void> = Promise.resolve(),
) {
  let screen: CallRow[] = [LINE];
  const filed: { text: string; ts: number }[] = [];
  let ended = 0;
  const s: PlaceSession = createPlaceSession({
    durable: () => Promise.resolve(durable),
    key: KEY,
    surface: "door",
    assemble: async () => {
      await gate;
      assembled.set(KEY, { history: [{ role: "ai", text: "Morning." }], tools: [] });
      return {
        kind: "turn",
        request: {
          key: KEY,
          origin: ORIGIN,
          conversation: ORIGIN.threadId,
          surface: "door",
          line: { text: LINE.text, ts: LINE.ts },
          systemPrompt: "You are Lumen.",
          tools: [],
          model: { provider: "faux", modelId: "faux-1" },
        },
      };
    },
    lastLine: () => Math.max(LINE.ts, ...filed.map((line) => line.ts)),
    draw: (after, rows) => {
      screen = withPlaceTurnRows(screen, after, rows);
    },
    file: (lines) => filed.push(...lines),
    streaming: (on) => {
      if (!on) ended += 1;
    },
    stall: { watches },
  });
  return { s, screen: () => screen, filed, ended: () => ended };
}

const pause = (ms = 30) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(check: () => boolean, ms = 10_000) {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error("timed out");
    await pause(10);
  }
}

/** Ask, say a line into the turn, close the conversation and open it again. */
async function reopened(responses: Responses) {
  const clock = fakeClock();
  const watches = createStallWatches({ timers: clock.timers });
  const r = await rig(responses);
  const first = session(r.durable, r.assembled, watches);
  first.s.ask();
  await until(() => r.faux.state.callCount === 1);
  expect(first.s.say(STEER.text, STEER.ts)).toBe(true);
  await pause();
  first.s.detach();
  const again = session(r.durable, r.assembled, watches);
  expect(await again.s.resume()).toBe(true);
  await pause();
  return { ...r, clock, first, again };
}

const failures = (rows: CallRow[]) => rows.filter((row) => row.role === "ai" && row.text === "" && !row.streaming);
const ends = (log: TurnLogLine[]) => log.filter((line) => line.event === "end").map((line) => (line as { reason: string }).reason);

test("reopened, a stalled turn is asked again once and the withdrawn line is filed once", async () => {
  const r = await reopened([silent, fauxAssistantMessage(fauxText("Try the essays."))]);
  r.clock.advance(TURN_STALL_MS + 1_000);
  await until(() => r.again.ended() > 0);
  await r.again.s.idle();
  await pause(100);
  expect([...r.first.filed, ...r.again.filed]).toEqual([STEER]);
  expect(r.faux.state.callCount).toBe(2);
  expect(failures(r.again.screen())).toEqual([]);
  expect(r.again.screen().map((row) => [row.role, row.text])).toEqual([
    ["user", LINE.text],
    ["user", STEER.text],
    ["ai", "Try the essays."],
  ]);
  expect(ends(r.log)).toEqual(["stalled", "done"]);
  await r.durable.runtime.close(ctx);
});

test("reopened, a stop files the withdrawn line once and opens one next turn for it", async () => {
  const r = await reopened([silent, fauxAssistantMessage(fauxText("Try the essays."))]);
  r.again.s.stop();
  await until(() => r.again.ended() > 0);
  await r.again.s.idle();
  await pause(100);
  expect([...r.first.filed, ...r.again.filed]).toEqual([STEER]);
  expect(r.faux.state.callCount).toBe(2);
  expect(failures(r.again.screen())).toEqual([]);
  expect(ends(r.log)).toEqual(["aborted", "done"]);
  await r.durable.runtime.close(ctx);
});

// Closed before the runtime holds the turn (docs/soul/87, 「装配中重开」): the
// view opened meanwhile waits for it to start and follows it, rather than
// finding nothing and only seeing the answer once it has landed.
test("closed while its turn is assembled and opened again, the new view joins the turn once it starts", async () => {
  let answer!: () => void;
  const answered = new Promise<void>((resolve) => (answer = resolve));
  const r = await rig([
    async () => {
      await answered;
      return fauxAssistantMessage(fauxText("Try the essays."));
    },
  ]);
  const watches = createStallWatches({ timers: fakeClock().timers });
  let assemble!: () => void;
  const first = session(r.durable, r.assembled, watches, new Promise((resolve) => (assemble = resolve)));
  first.s.ask();
  first.s.detach();
  const again = session(r.durable, r.assembled, watches);
  let joined: boolean | undefined;
  const resuming = again.s.resume().then((found) => (joined = found));
  await pause();
  // Still being assembled: the new view is waiting, not told there is nothing.
  expect(joined).toBeUndefined();
  assemble();
  expect(await resuming).toBe(true);
  expect(again.s.running()).toBe(true);
  answer();
  await until(() => again.ended() > 0);
  await again.s.idle();
  await first.s.idle();
  await pause(100);
  expect(r.faux.state.callCount).toBe(1);
  expect(again.screen().map((row) => [row.role, row.text])).toEqual([
    ["user", LINE.text],
    ["ai", "Try the essays."],
  ]);
  // Landed once; the closed view drew nothing and filed nothing.
  expect(r.file.messages.filter((m) => m.text === "Try the essays.")).toHaveLength(1);
  expect(first.screen().map((row) => row.text)).toEqual([LINE.text, ""]);
  expect([...first.filed, ...again.filed]).toEqual([]);
  expect(ends(r.log)).toEqual(["done"]);
  await r.durable.runtime.close(ctx);
});

test("a view opened while a turn is assembled and then stopped finds nothing in flight", async () => {
  const r = await rig([fauxAssistantMessage(fauxText("Try the essays."))]);
  const watches = createStallWatches({ timers: fakeClock().timers });
  const first = session(r.durable, r.assembled, watches, new Promise(() => {}));
  first.s.ask();
  const again = session(r.durable, r.assembled, watches);
  const resuming = again.s.resume();
  await pause();
  first.s.stop();
  expect(await resuming).toBe(false);
  expect(r.faux.state.callCount).toBe(0);
  await r.durable.runtime.close(ctx);
});
