// A week the checks keep refusing still stops at the turn's round cap: the
// draft the planning tool keeps between calls makes each retry smaller, never
// the turn longer. Driven through the real turn core with a scripted stream.
// Run: scripts/t.sh tests/info/meals/plan-rounds.test.ts

import { expect, test } from "bun:test";
import { createAssistantMessageEventStream, type Api, type Context, type Message, type Model } from "@earendil-works/pi-ai";
import { REFUSE_ROUNDS, runHarnessTurn, type StreamFn } from "../../../src/legion/execute/turn";
import { createSessionFileSystem } from "../../../src/platform/app/session-fs";
import { buildProposeMealsPlanTool } from "../../../src/info/meals/tools";
import type { MealsCard } from "../../../src/info/meals/cards";
import { memoryAppData } from "../../support/memory-appdata";
import { turnEvents, type Turn } from "../../support/scripted-turn";
import { MON, sent, state, week } from "./fixtures/week";

const MODEL = { id: "m", provider: "faux" } as unknown as Model<Api>;

test("a week that never passes stops at the round cap, each retry one meal", async () => {
  const slow = (minutes: number) => ({ ...(sent(week())[0]!.lunch as object), minutes });
  const whole = sent(week());
  whole[0]!.lunch = slow(30);
  const turns: Turn[] = [
    { calls: [{ name: "propose_meals_plan", args: { days: whole }, id: "t1" }] },
    { calls: [{ name: "propose_meals_plan", args: { days: [{ day: 1, lunch: slow(28) }] }, id: "t2" }] },
    { calls: [{ name: "propose_meals_plan", args: { days: [{ day: 1, lunch: slow(26) }] }, id: "t3" }] },
    { calls: [{ name: "propose_meals_plan", args: { days: [{ day: 1, lunch: slow(24) }] }, id: "t4" }] },
  ];
  let round = 0;
  const contexts: Context[] = [];
  const stream: StreamFn = (_model, context) => {
    contexts.push(context);
    const s = createAssistantMessageEventStream();
    const events = turnEvents(turns[round++] ?? { text: "out of script" });
    (async () => {
      for (const ev of events) {
        await Promise.resolve();
        s.push(ev);
      }
      s.end();
    })();
    return s;
  };

  const cards: MealsCard[] = [];
  const current = state({ plan: null });
  const tool = buildProposeMealsPlanTool({
    threadId: "meals",
    state: async () => current,
    today: () => MON,
    now: () => 5,
    region: () => "other",
    onMealsCard: (card) => cards.push(card),
  });

  let refusal: string | undefined;
  let done: string | undefined;
  let error: string | undefined;
  await runHarnessTurn({
    stream,
    model: MODEL,
    messages: [{ role: "user", content: "plan this week", timestamp: 0 }],
    tools: [tool],
    maxRounds: 3,
    fileSystem: createSessionFileSystem(memoryAppData()),
    onDelta: () => {},
    onDone: (t) => {
      done = t;
    },
    onToolStart: () => {},
    onToolEnd: () => {},
    onError: (m) => {
      error = m;
    },
    onRefusal: (m) => {
      refusal = m;
    },
  });

  expect(refusal).toBe(REFUSE_ROUNDS);
  expect(done).toBeUndefined();
  expect(error).toBeUndefined();
  expect(round).toBe(3);
  expect(cards).toEqual([]);
  const results = (contexts[2]?.messages ?? [])
    .filter((m): m is Extract<Message, { role: "toolResult" }> => m.role === "toolResult")
    .flatMap((m) => m.content.flatMap((c) => (c.type === "text" ? [c.text] : [])));
  expect(results).toHaveLength(2);
  expect(results[1]).toContain("Day 1 lunch takes 28 minutes; they allow 20.");
  expect(results[1]).toContain("sending only the meals you change: Day 1 lunch.");
});
