// The meals conversation on the device's durable runtime
// (docs/soul/87, 第二阶段): the place (meals/conversation/durable.ts) driven by
// the place session (reading/turn/place-session.ts) on a faux provider. A turn
// lands in the conversation's file once, Stop keeps the half sentence, a line
// said into the turn is steered into it, a turn left in flight is joined, a
// reply nobody saw gets a card.

import { BACKGROUND_CONTEXT as ctx } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxAssistantMessage, fauxProvider, fauxText } from "@earendil-works/pi-ai/providers/faux";
import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TURN_SECTION } from "../../../src/legion/durable/device";
import type { ThreadOrigin } from "../../../src/legion/durable/extension";
import { startTurn } from "../../../src/legion/durable/turn";
import type { CallRow } from "../../../src/reading/turn/call-state";
import { openReadingDurable, type ReadingDurable } from "../../../src/reading/turn/durable-runtime";
import { createPlaceSession, withPlaceTurnRows, type PlaceSession } from "../../../src/reading/turn/place-session";
import {
  MEALS_ADDRESS,
  MEALS_CONVERSATION_KEY,
  MEALS_ORIGIN,
  mealsPlace,
  type AssembledMealsTurn,
  type MealsOrigin,
} from "../../../src/meals/conversation/durable";
import { testHost } from "../../legion/durable/support/runtime";
import { fakeThreads } from "../../reading/turn/support/durable-threads";

const MEALS: MealsOrigin = MEALS_ORIGIN;
const LINE = { role: "user" as const, text: "What matters today?", ts: 1000 };
const LONG = "The rate decision matters most, then the chip export rules. ".repeat(30);

const PLACES: { name: "meals"; origin: MealsOrigin }[] = [
  { name: "meals", origin: MEALS },
];

test("the conversation is keyed and filed where it always was", () => {
  expect(MEALS).toEqual({ place: "meals" });
  expect(MEALS_CONVERSATION_KEY).toBe("meals:meals");
  expect(MEALS_ADDRESS).toEqual({ key: "info-meals", threadId: "meals" });
});

async function rig(
  replies: string[],
  options: { watching?: boolean | { on: boolean }; tokensPerSecond?: number; empty?: boolean } = {},
) {
  const faux = fauxProvider({
    tokensPerSecond: options.tokensPerSecond ?? 400,
    tokenSize: { min: 2, max: 3 },
    models: [{ id: "faux-1", contextWindow: 200_000, maxTokens: 4096 }],
  });
  faux.setResponses(replies.map((text) => fauxAssistantMessage(fauxText(text))));
  const models = createModels();
  models.setProvider(faux.provider);
  const file = fakeThreads(options.empty ? [] : [{ role: "ai", text: "Morning.", ts: 500 }, LINE]);
  const cards: { origin: ThreadOrigin; text: string }[] = [];
  const assembled = new Map<string, AssembledMealsTurn>();
  const deps = {
    assembled,
    openDesk: async () => [],
    watching: () => (typeof options.watching === "object" ? options.watching.on : (options.watching ?? true)),
    card: async (origin: MealsOrigin, _ts: number, text: string) => {
      cards.push({ origin, text });
    },
  };
  const durable = await openReadingDurable({
    catalog: [],
    host: testHost(mkdtempSync(join(tmpdir(), "meals-durable-"))),
    models,
    threads: file.threads,
    openDesk: async () => [],
    places: { meals: mealsPlace(deps) },
    log: () => {},
  });
  return { durable, faux, file, cards, assembled };
}

function session(
  durable: ReadingDurable,
  assembled: Map<string, AssembledMealsTurn>,
  origin: MealsOrigin,
  opening = false,
) {
  const key = MEALS_CONVERSATION_KEY;
  let screen: CallRow[] = opening ? [] : [LINE];
  const filed: { text: string; ts: number }[] = [];
  let ended!: () => void;
  let ends = new Promise<void>((resolve) => (ended = resolve));
  let streamed!: () => void;
  const streaming = new Promise<void>((resolve) => (streamed = resolve));
  const s: PlaceSession = createPlaceSession({
    durable: () => Promise.resolve(durable),
    key,
    surface: "info",
    assemble: async () => {
      assembled.set(key, { history: opening ? [] : [{ role: "ai", text: "Morning." }], tools: [] });
      return {
        kind: "turn",
        request: {
          key,
          origin,
          conversation: MEALS_ADDRESS.threadId,
          surface: "info",
          line: opening ? { text: "Open the conversation." } : { text: LINE.text, ts: LINE.ts },
          systemPrompt: "You are the secretary.",
          tools: [],
          model: { provider: "faux", modelId: "faux-1" },
        },
      };
    },
    lastLine: () => (opening ? 0 : LINE.ts),
    draw: (after, rows) => {
      screen = withPlaceTurnRows(screen, after, rows);
      const ai = rows.find((r) => r.role === "ai" && r.streaming);
      if (ai && ai.text.length > 30) streamed();
    },
    file: (lines) => filed.push(...lines),
    streaming: (on) => {
      if (on) return;
      ended();
      ends = new Promise<void>((resolve) => (ended = resolve));
    },
  });
  return { s, screen: () => screen, filed, streaming, ended: () => ends };
}

for (const { name, origin } of PLACES) {
  describe(`the ${name} place`, () => {
    test("a turn lands in the conversation's file once, history from the assembly, no card while watched", async () => {
      const { durable, file, cards, assembled } = await rig(["Rates first."]);
      const view = session(durable, assembled, origin);
      const ended = view.ended();
      view.s.ask();
      await ended;
      expect(view.screen().map((r) => [r.role, r.text])).toEqual([
        ["user", LINE.text],
        ["ai", "Rates first."],
      ]);
      expect(file.messages.map((m) => [m.role, m.text])).toEqual([
        ["ai", "Morning."],
        ["user", LINE.text],
        ["ai", "Rates first."],
      ]);
      expect(file.messages[2]!.ts).toBe(view.screen()[1]!.ts);
      const sent = await durable.places.get(name)!.readHistory(origin, { excludeTs: LINE.ts }, ctx);
      expect(sent.map((m) => m.role)).toEqual(["assistant"]);
      expect(cards).toEqual([]);
      await durable.runtime.close(ctx);
    });

    test("Stop keeps the half sentence on screen and in the file; nothing is asked again", async () => {
      const { durable, faux, file, assembled } = await rig([LONG], { tokensPerSecond: 60 });
      const view = session(durable, assembled, origin);
      const ended = view.ended();
      view.s.ask();
      await view.streaming;
      view.s.stop();
      await ended;
      const half = view.screen()[1]!;
      expect(half.role).toBe("ai");
      expect(half.text.length).toBeGreaterThan(30);
      expect(LONG.startsWith(half.text)).toBe(true);
      expect(half.streaming).toBeUndefined();
      expect(file.messages.filter((m) => m.role === "ai").map((m) => m.text)).toEqual(["Morning.", half.text]);
      expect(faux.state.callCount).toBe(1);
      await durable.runtime.close(ctx);
    });

    test("a line said into the turn is steered into it, and the reply after it is a row of its own", async () => {
      const { durable, faux, file, assembled } = await rig([LONG.slice(0, 600), "And the chips after."], {
        tokensPerSecond: 80,
      });
      const view = session(durable, assembled, origin);
      const ended = view.ended();
      view.s.ask();
      await view.streaming;
      const at = Date.now();
      expect(view.s.say("What about chips?", at)).toBe(true);
      expect(view.screen().some((r) => r.role === "user" && r.ts === at && r.queued)).toBe(true);
      await ended;
      expect(view.screen().map((r) => r.role)).toEqual(["user", "ai", "user", "ai"]);
      expect(view.screen()[2]).toMatchObject({ text: "What about chips?", ts: at });
      expect(view.screen()[3]!.text).toBe("And the chips after.");
      expect(file.messages.slice(1).map((m) => m.role)).toEqual(["user", "ai", "user", "ai"]);
      expect(view.filed).toEqual([]);
      expect(faux.state.callCount).toBe(2);
      await durable.runtime.close(ctx);
    });

    test("a turn in flight when the conversation opens is joined, drawn and lands; history off the file", async () => {
      const { durable, faux, file, assembled } = await rig([LONG.slice(0, 400)], { tokensPerSecond: 100 });
      await startTurn(
        durable.runtime,
        {
          key: MEALS_CONVERSATION_KEY,
          origin,
          content: LINE.text,
          sections: { [TURN_SECTION]: "You are the secretary." },
          tools: [],
          model: { provider: "faux", modelId: "faux-1" },
          excludeTs: LINE.ts,
        },
        ctx,
      );
      const view = session(durable, assembled, origin);
      const ended = view.ended();
      expect(await view.s.resume()).toBe(true);
      await view.streaming;
      await ended;
      expect(view.screen().map((r) => r.role)).toEqual(["user", "ai"]);
      expect(file.messages[file.messages.length - 1]!.text).toBe(LONG.slice(0, 400));
      expect(assembled.size).toBe(0);
      const history = await durable.places.get(name)!.readHistory(origin, { excludeTs: LINE.ts }, ctx);
      expect(history.map((m) => m.role)).toEqual(["assistant", "assistant"]);
      expect(faux.state.callCount).toBe(1);
      await durable.runtime.close(ctx);
    });

    test("a reply that lands with the conversation closed gets a card", async () => {
      const { durable, cards, assembled } = await rig(["Rates first."], { watching: false });
      const view = session(durable, assembled, origin);
      const ended = view.ended();
      view.s.ask();
      await ended;
      expect(cards).toEqual([{ origin, text: "Rates first." }]);
      await durable.runtime.close(ctx);
    });

    test("closing the conversation does not stop its turn: opened again it is joined, and closed it lands once with a card", async () => {
      const looking = { on: true };
      const reply = LONG.slice(0, 900);
      const { durable, faux, file, cards, assembled } = await rig([reply], { watching: looking, tokensPerSecond: 80 });
      const first = session(durable, assembled, origin);
      first.s.ask();
      await first.streaming;
      first.s.detach();
      looking.on = false;
      const frozen = first.screen();

      const again = session(durable, assembled, origin);
      looking.on = true;
      expect(await again.s.resume()).toBe(true);
      await again.streaming;
      again.s.detach();
      looking.on = false;

      const end = Date.now() + 10_000;
      while (cards.length === 0 && Date.now() < end) await new Promise((r) => setTimeout(r, 10));
      expect(file.messages.slice(1).map((m) => [m.role, m.text])).toEqual([
        ["user", LINE.text],
        ["ai", reply],
      ]);
      expect(cards).toEqual([{ origin, text: reply }]);
      // Nothing is drawn on a closed screen, nothing is filed for it, and the turn is not asked again.
      expect(first.screen()).toBe(frozen);
      expect(first.filed).toEqual([]);
      expect(again.filed).toEqual([]);
      expect(faux.state.callCount).toBe(1);
      await durable.runtime.close(ctx);
    });
  });
}
