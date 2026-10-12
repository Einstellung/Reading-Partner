// A week the checks keep refusing still stops at the turn's round cap: the
// draft the planning tool keeps between calls makes each retry smaller, never
// the turn longer. Driven through the durable runtime with a faux model.
// Run: scripts/t.sh tests/info/meals/plan-rounds.test.ts

import { expect, test } from "bun:test";
import type { Message } from "@earendil-works/pi-ai";
import { REFUSE_ROUNDS } from "../../../src/legion/durable/contract";
import { buildProposeMealsPlanTool } from "../../../src/info/meals/tools";
import type { MealsCard } from "../../../src/info/meals/cards";
import { scriptedSubagentRunner } from "../../support/scripted-runner";
import type { Turn } from "../../support/scripted-turn";
import { MON, sent, state, week } from "./fixtures/week";

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
  const runner = scriptedSubagentRunner(turns, { exhausted: { text: "out of script" }, contextWindow: 200_000 });

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

  const outcome = await runner.run({
    name: "meals",
    systemPrompt: "",
    task: "plan this week",
    tools: [tool],
    maxRounds: 3,
    purpose: "chat",
    onRound: () => {},
  });

  expect(outcome).toMatchObject({ kind: "refusal", message: REFUSE_ROUNDS });
  expect(runner.streamed()).toBe(3);
  expect(cards).toEqual([]);
  const results = (runner.contexts[2]?.messages ?? [])
    .filter((m): m is Extract<Message, { role: "toolResult" }> => m.role === "toolResult")
    .flatMap((m) => m.content.flatMap((c) => (c.type === "text" ? [c.text] : [])));
  expect(results).toHaveLength(2);
  expect(results[1]).toContain("Day 1 lunch takes 28 minutes; they allow 20.");
  expect(results[1]).toContain("sending only the meals you change: Day 1 lunch.");
});
