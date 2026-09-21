// How a dish is made (src/info/meals/method.ts): one headless turn, validated,
// stored once, and never twice at the same time.
// Run: scripts/t.sh tests/info/meals

import { expect, test } from "bun:test";
import {
  ensureDishMethod,
  methodSystemPrompt,
  methodUserText,
  parseMethod,
  resetMethodsInFlight,
  type MethodPorts,
} from "../../../src/info/meals/method";
import type { DishMethod, WeekPlan } from "../../../src/info/meals/types";
import { week } from "./fixtures/week";

function ports(
  reply: string | (() => Promise<string>),
  plan: WeekPlan | null = week(),
): MethodPorts & { asks: number; saved: { dishId: string; method: DishMethod }[] } {
  const p = {
    asks: 0,
    saved: [] as { dishId: string; method: DishMethod }[],
    plan: async () => plan,
    charter: async () => null,
    ask: async () => {
      p.asks += 1;
      return typeof reply === "string" ? reply : await reply();
    },
    saveDishMethod: async (dishId: string, method: DishMethod) => {
      p.saved.push({ dishId, method });
    },
    now: () => 42,
  };
  return p;
}

test("a good reply is parsed, stored once and handed back", async () => {
  resetMethodsInFlight();
  const p = ports('{"steps":["Rinse the rice.","Simmer."],"note":"Walk away for ten minutes."}');
  const method = await ensureDishMethod("dish-stew", p);
  expect(method).toEqual({
    steps: ["Rinse the rice.", "Simmer."],
    note: "Walk away for ten minutes.",
    writtenAt: 42,
  });
  expect(p.saved).toEqual([{ dishId: "dish-stew", method: method! }]);
});

test("a stored method is returned without asking", async () => {
  resetMethodsInFlight();
  const plan = week();
  plan.dishes[1]!.method = { steps: ["Already written."], writtenAt: 1 };
  const p = ports("{}", plan);
  const method = await ensureDishMethod("dish-stew", p);
  expect(method!.steps).toEqual(["Already written."]);
  expect(p.asks).toBe(0);
  expect(p.saved).toEqual([]);
});

test("two callers at once pay for one turn", async () => {
  resetMethodsInFlight();
  let release: (() => void) | null = null;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  const p = ports(async () => {
    await gate;
    return '{"steps":["One."]}';
  });
  const both = Promise.all([ensureDishMethod("dish-stew", p), ensureDishMethod("dish-stew", p)]);
  release!();
  const [a, b] = await both;
  expect(p.asks).toBe(1);
  expect(a).toEqual(b!);
  expect(p.saved).toHaveLength(1);
  // The gate opens again once it has settled.
  await ensureDishMethod("dish-salmon", p);
  expect(p.asks).toBe(2);
});

test("a reply that is not a method stores nothing", async () => {
  resetMethodsInFlight();
  for (const bad of [
    "sorry, I cannot",
    '{"steps":[]}',
    '{"steps":' + JSON.stringify(Array.from({ length: 11 }, () => "x")) + "}",
    '{"steps":["' + "x".repeat(201) + '"]}',
    '{"steps":"just one line"}',
  ]) {
    const p = ports(bad);
    expect(await ensureDishMethod("dish-stew", p)).toBeNull();
    expect(p.saved).toEqual([]);
    resetMethodsInFlight();
  }
});

test("a model that wraps its JSON in prose still answered", () => {
  const method = parseMethod('Sure:\n```json\n{"steps":["Do it."]}\n```', 1);
  expect(method!.steps).toEqual(["Do it."]);
});

test("a dish the week does not have, and a call that throws, are both null", async () => {
  resetMethodsInFlight();
  expect(await ensureDishMethod("dish-nope", ports("{}"))).toBeNull();
  resetMethodsInFlight();
  const p = ports(async () => {
    throw new Error("the model is down");
  });
  expect(await ensureDishMethod("dish-stew", p)).toBeNull();
  expect(p.saved).toEqual([]);
});

test("the prompt carries the constraints and the dish, and no nutrition", () => {
  const system = methodSystemPrompt(null);
  expect(system).toContain("one pot or pan");
  expect(system).toContain("15 minutes hands-on");
  expect(system).toContain("no nutrition talk at all");
  const user = methodUserText(week().dishes[1]!);
  expect(user).toContain("Chickpea stew");
  expect(user).toContain("chickpeas");
});
