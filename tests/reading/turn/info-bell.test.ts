// A bell answered in a day's briefing conversation or the meals conversation
// on the durable runtime (reading/turn/info-bell.ts, place-bell.ts), on a faux
// provider: headless when nobody has the conversation open, after the reader's
// turn has landed when it is busy, in the open conversation's session
// otherwise, and never twice for one bell, across a restart too.

import { BACKGROUND_CONTEXT as ctx } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxAssistantMessage, fauxProvider, fauxText } from "@earendil-works/pi-ai/providers/faux";
import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BoxOrigin } from "../../../src/box";
import { infoPlace, infoThreadKey, mealsPlace, type AssembledInfoTurn, type InfoOrigin, type MealsOrigin } from "../../../src/info/briefer/info-durable";
import { briefingThreadId } from "../../../src/info/briefer/anchors";
import type { Settings } from "../../../src/platform/app/settings";
import type { CallRow } from "../../../src/reading/turn/call-state";
import { openReadingDurable, type ReadingDurable } from "../../../src/reading/turn/durable-runtime";
import { deliverInfoBell, type InfoBellDeps } from "../../../src/reading/turn/info-bell";
import { createPlaceSession, openPlaceSession, registerOpenSession, withPlaceTurnRows } from "../../../src/reading/turn/place-session";
import type { AssembledTurn, TurnDelivery } from "../../../src/soul";
import { testHost } from "../../legion/durable/support/runtime";
import { fakeThreads } from "./support/durable-threads";

const DATE = "2026-10-11";
const BRIEFING: InfoOrigin = { place: "info", date: DATE, threadId: briefingThreadId(DATE) };
const MEALS: MealsOrigin = { place: "meals" };
const LINE = { role: "user" as const, text: "Which story matters most?", ts: 1000 };
const LONG = "The rate decision matters most, then the chip export rules. ".repeat(30);
const SETTINGS = { defaultProviderId: "faux", defaultModelId: "faux-1" } as Settings;

async function rig(replies: string[], tokensPerSecond = 400, root = mkdtempSync(join(tmpdir(), "info-bell-"))) {
  const faux = fauxProvider({
    tokensPerSecond,
    tokenSize: { min: 2, max: 3 },
    models: [{ id: "faux-1", contextWindow: 200_000, maxTokens: 4096 }],
  });
  faux.setResponses(replies.map((text) => fauxAssistantMessage(fauxText(text))));
  const models = createModels();
  models.setProvider(faux.provider);
  const file = fakeThreads([{ role: "ai", text: "Here is today's briefing.", ts: 500 }, LINE]);
  const cards: number[] = [];
  const assembled = new Map<string, AssembledInfoTurn>();
  const placeDeps = {
    assembled,
    openDesk: async () => [],
    watching: () => false,
    card: async (_o: unknown, ts: number) => void cards.push(ts),
  };
  const durable = await openReadingDurable({
    catalog: [],
    host: testHost(root),
    models,
    threads: file.threads,
    openDesk: async () => [],
    places: { info: infoPlace(placeDeps), meals: mealsPlace(placeDeps) },
    log: () => {},
  });
  const laid: { origin: InfoOrigin | MealsOrigin; messages: string[] }[] = [];
  const opened: string[] = [];
  const deps: InfoBellDeps = {
    durable: () => Promise.resolve(durable),
    threads: file.threads,
    session: openPlaceSession,
    now: Date.now,
    openThread: async (key, threadId) => void opened.push(`${key}/${threadId}`),
    lay: async (origin, input) => {
      laid.push({ origin, messages: input.messages.map((m) => m.text) });
      return {
        systemPrompt: "You are the secretary.",
        tools: [],
        messages: input.messages,
        notice: "",
        refusal: "",
        report: {},
      } satisfies AssembledTurn;
    },
    assembled,
    watching: () => false,
  };
  return { root, durable, faux, file, cards, assembled, deps, laid, opened };
}

function bell(id: string, origin: BoxOrigin = { place: "briefing", date: DATE }, waits?: () => void): TurnDelivery {
  return {
    origin,
    settings: SETTINGS,
    bell: "[bell from legion — this was not said by the reader]\nA run finished.",
    bellId: id,
    runId: `run-${id}`,
    ...(waits ? { onWait: waits } : {}),
  };
}

function openChat(durable: ReadingDurable, assembled: Map<string, AssembledInfoTurn>, origin: InfoOrigin | MealsOrigin = BRIEFING) {
  const key = infoThreadKey(origin);
  let screen: CallRow[] = [{ role: "ai", text: "Here is today's briefing.", ts: 500 }, LINE];
  let streamed!: () => void;
  const streaming = new Promise<void>((resolve) => (streamed = resolve));
  const session = createPlaceSession({
    durable: () => Promise.resolve(durable),
    key,
    surface: "info",
    assemble: async () => {
      assembled.set(key, { history: [{ role: "ai", text: "Here is today's briefing." }], tools: [] });
      return {
        kind: "turn",
        request: {
          key,
          origin: origin as never,
          conversation: origin.place === "meals" ? "meals" : origin.threadId,
          surface: "info",
          line: { text: LINE.text, ts: LINE.ts },
          systemPrompt: "You are the secretary.",
          tools: [],
          model: { provider: "faux", modelId: "faux-1" },
        },
      };
    },
    lastLine: () => LINE.ts,
    draw: (after, rows) => {
      screen = withPlaceTurnRows(screen, after, rows);
      if (rows.some((r) => r.role === "ai" && r.streaming && r.text.length > 30)) streamed();
    },
    file: () => {},
    streaming: () => {},
  });
  const closed = registerOpenSession(key, session);
  const close = () => {
    session.leave();
    closed();
  };
  return { session, close, screen: () => screen, streaming };
}

test("a briefing bell with nobody looking runs headless over the day's thread, lands once, and is not asked again after a restart", async () => {
  const first = await rig(["The run found the filing."]);
  const outcome = await deliverInfoBell(bell("b1"), first.deps);
  expect(outcome).toEqual({ status: "answered", reply: "The run found the filing.", watching: false });
  expect(first.opened).toEqual([`info-${DATE}/${briefingThreadId(DATE)}`]);
  // Laid over the thread as its file holds it, the bell last and never written.
  expect(first.laid).toEqual([{ origin: BRIEFING, messages: ["Here is today's briefing.", LINE.text, expect.stringContaining("A run finished.")] }]);
  const landed = first.file.messages.filter((m) => m.role === "ai" && m.text === "The run found the filing.");
  expect(landed).toHaveLength(1);
  expect(landed[0]!.origin?.runId).toBe("run-b1");
  expect(first.file.messages.some((m) => m.text.includes("A run finished."))).toBe(false);
  // The bell's own card is the bell pass's to put (soul/bell.ts), not the lander's.
  expect(first.cards).toEqual([]);
  await first.durable.runtime.close(ctx);

  // The same bell after a restart, before its ack: found by its id on the device's database, not asked again.
  const again = await rig([], 400, first.root);
  again.file.messages.splice(0, again.file.messages.length, ...first.file.messages);
  const second = await deliverInfoBell(bell("b1"), again.deps);
  expect(second).toEqual({ status: "answered", reply: "The run found the filing.", watching: false });
  expect(again.faux.state.callCount).toBe(0);
  expect(again.laid).toEqual([]);
  await again.durable.runtime.close(ctx);
});

test("a meals bell lands in the standing meals conversation", async () => {
  const { durable, file, deps, laid, opened } = await rig(["Tuesday's shopping is set."]);
  const outcome = await deliverInfoBell(bell("m1", { place: "meals" }), deps);
  expect(outcome).toEqual({ status: "answered", reply: "Tuesday's shopping is set.", watching: false });
  expect(opened).toEqual(["info-meals/meals"]);
  expect(laid.map((l) => l.origin)).toEqual([MEALS]);
  expect(file.messages.filter((m) => m.origin?.runId === "run-m1").map((m) => m.text)).toEqual(["Tuesday's shopping is set."]);
  await durable.runtime.close(ctx);
});

test("a bell for a briefing conversation busy with the reader's turn waits until it has landed, then streams in it", async () => {
  const { durable, faux, file, assembled, deps } = await rig([LONG.slice(0, 600), "And the run is done."], 120);
  const chat = openChat(durable, assembled);
  chat.session.ask();
  await chat.streaming;
  let waited = 0;
  const outcome = await deliverInfoBell(bell("b2", undefined, () => (waited += 1)), deps);
  expect(waited).toBeGreaterThan(0);
  expect(outcome).toEqual({ status: "answered", reply: "And the run is done.", watching: false });
  expect(faux.state.callCount).toBe(2);
  expect(file.messages.map((m) => [m.role, m.text.slice(0, 20)])).toEqual([
    ["ai", "Here is today's brie"],
    ["user", LINE.text.slice(0, 20)],
    ["ai", LONG.slice(0, 20)],
    ["ai", "And the run is done."],
  ]);
  expect(chat.screen().map((r) => r.text)).toContain("And the run is done.");
  chat.close();
  await durable.runtime.close(ctx);
});

test("a bell for the meals conversation does not wait on a busy briefing conversation", async () => {
  const { durable, faux, assembled, deps } = await rig([LONG.slice(0, 900), "Meals are planned."], 60);
  const chat = openChat(durable, assembled);
  chat.session.ask();
  await chat.streaming;
  let waited = 0;
  const outcome = await deliverInfoBell(bell("m2", { place: "meals" }, () => (waited += 1)), deps);
  expect(outcome).toMatchObject({ status: "answered" });
  expect(waited).toBe(0);
  // The reader's briefing turn is still streaming: the meals bell went past it.
  expect(chat.session.running()).toBe(true);
  expect(faux.state.callCount).toBe(2);
  chat.session.stop();
  await chat.session.idle();
  chat.close();
  await durable.runtime.close(ctx);
});

test("a bell's turn in the open meals conversation streams there and can be stopped, keeping the half sentence", async () => {
  const { durable, file, assembled, deps } = await rig([LONG], 60);
  const chat = openChat(durable, assembled, MEALS);
  const outcome = deliverInfoBell(bell("m3", { place: "meals" }), deps);
  await chat.streaming;
  expect(chat.session.running()).toBe(true);
  chat.session.stop();
  expect((await outcome)?.status).toBe("answered");
  const half = file.messages.filter((m) => m.role === "ai" && m.origin?.runId === "run-m3");
  expect(half).toHaveLength(1);
  expect(half[0]!.text.length).toBeGreaterThan(30);
  expect(half[0]!.text.length).toBeLessThan(LONG.length);
  chat.close();
  expect(openPlaceSession(infoThreadKey(MEALS))).toBeUndefined();
  await durable.runtime.close(ctx);
});

test("what the reader says into a bell's turn in the open briefing goes into that turn", async () => {
  const { durable, faux, file, assembled, deps } = await rig([LONG.slice(0, 600), "The chip rules, yes."], 80);
  const chat = openChat(durable, assembled);
  const outcome = deliverInfoBell(bell("b4"), deps);
  await chat.streaming;
  expect(chat.session.say("And the chips?", Date.now())).toBe(true);
  expect(await outcome).toMatchObject({ status: "answered", reply: "The chip rules, yes." });
  expect(faux.state.callCount).toBe(2);
  expect(file.messages.filter((m) => m.role === "user").map((m) => m.text)).toEqual([LINE.text, "And the chips?"]);
  chat.close();
  await durable.runtime.close(ctx);
});

test("a bell asked about anywhere else is not the info side's", async () => {
  const { durable, deps } = await rig([]);
  expect(await deliverInfoBell(bell("d1", { place: "door", date: DATE }), deps)).toBeNull();
  await durable.runtime.close(ctx);
});
