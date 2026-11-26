// A bell answered in the meals conversation on the durable runtime
// (reading/turn/meals-bell.ts, place-bell.ts), on a faux provider: headless
// when nobody has the conversation open, and in the open conversation's
// session otherwise.

import { BACKGROUND_CONTEXT as ctx } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxAssistantMessage, fauxProvider, fauxText } from "@earendil-works/pi-ai/providers/faux";
import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BoxOrigin } from "../../../src/box";
import type { Settings } from "../../../src/platform/app/settings";
import type { CallRow } from "../../../src/reading/turn/call-state";
import { openReadingDurable, type ReadingDurable } from "../../../src/reading/turn/durable-runtime";
import { deliverMealsBell, type MealsBellDeps } from "../../../src/reading/turn/meals-bell";
import {
  MEALS_CONVERSATION_KEY,
  mealsPlace,
  type AssembledMealsTurn,
  type MealsOrigin,
} from "../../../src/meals/conversation/durable";
import { createPlaceSession, openPlaceSession, registerOpenSession, withPlaceTurnRows } from "../../../src/reading/turn/place-session";
import type { AssembledTurn, TurnDelivery } from "../../../src/soul";
import { testHost } from "../../legion/durable/support/runtime";
import { fakeThreads } from "./support/durable-threads";

const MEALS: MealsOrigin = { place: "meals" };
const LINE = { role: "user" as const, text: "Which story matters most?", ts: 1000 };
const LONG = "The rate decision matters most, then the chip export rules. ".repeat(30);
const SETTINGS = { defaultProviderId: "faux", defaultModelId: "faux-1" } as Settings;

async function rig(replies: string[], tokensPerSecond = 400, root = mkdtempSync(join(tmpdir(), "meals-bell-"))) {
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
  const assembled = new Map<string, AssembledMealsTurn>();
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
    places: { meals: mealsPlace(placeDeps) },
    log: () => {},
  });
  const laid: { origin: MealsOrigin; messages: string[] }[] = [];
  const opened: string[] = [];
  const deps: MealsBellDeps = {
    durable: () => Promise.resolve(durable),
    threads: file.threads,
    session: openPlaceSession,
    now: Date.now,
    openThread: async (key, threadId) => void opened.push(`${key}/${threadId}`),
    lay: async (input) => {
      laid.push({ origin: MEALS, messages: input.messages.map((m) => m.text) });
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

function bell(id: string, origin: BoxOrigin = { place: "meals" }, waits?: () => void): TurnDelivery {
  return {
    origin,
    settings: SETTINGS,
    bell: "[bell from legion — this was not said by the reader]\nA run finished.",
    bellId: id,
    runId: `run-${id}`,
    ...(waits ? { onWait: waits } : {}),
  };
}

function openChat(durable: ReadingDurable, assembled: Map<string, AssembledMealsTurn>, origin: MealsOrigin = MEALS) {
  const key = MEALS_CONVERSATION_KEY;
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
          conversation: "meals",
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

test("a meals bell lands in the standing meals conversation", async () => {
  const { durable, file, deps, laid, opened } = await rig(["Tuesday's shopping is set."]);
  const outcome = await deliverMealsBell(bell("m1", { place: "meals" }), deps);
  expect(outcome).toEqual({ status: "answered", reply: "Tuesday's shopping is set.", watching: false, address: expect.any(Object) });
  expect(opened).toEqual(["info-meals/meals"]);
  expect(laid.map((l) => l.origin)).toEqual([MEALS]);
  expect(file.messages.filter((m) => m.origin?.runId === "run-m1").map((m) => m.text)).toEqual(["Tuesday's shopping is set."]);
  await durable.runtime.close(ctx);
});

test("a bell's turn in the open meals conversation streams there and can be stopped, keeping the half sentence", async () => {
  const { durable, file, assembled, deps } = await rig([LONG], 60);
  const chat = openChat(durable, assembled, MEALS);
  const outcome = deliverMealsBell(bell("m3", { place: "meals" }), deps);
  await chat.streaming;
  expect(chat.session.running()).toBe(true);
  chat.session.stop();
  expect((await outcome)?.status).toBe("answered");
  const half = file.messages.filter((m) => m.role === "ai" && m.origin?.runId === "run-m3");
  expect(half).toHaveLength(1);
  expect(half[0]!.text.length).toBeGreaterThan(30);
  expect(half[0]!.text.length).toBeLessThan(LONG.length);
  chat.close();
  expect(openPlaceSession(MEALS_CONVERSATION_KEY)).toBeUndefined();
  await durable.runtime.close(ctx);
});
