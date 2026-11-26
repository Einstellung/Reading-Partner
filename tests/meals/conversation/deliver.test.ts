// The desk the meals conversation's turn is rebuilt over (soul/delivery.ts):
// one standing thread in a file of its own, on the meals desk with the meals
// tools.

import { beforeEach, expect, test } from "bun:test";
import { deliveryOpener } from "../../../src/soul/delivery";
import { DEFAULT_SETTINGS, type Settings } from "../../../src/platform/app/settings";
import { appendMessage, createThread, rebuildThreadStoreForTests } from "../../../src/platform/app/threads";
import { registerMealsDelivery } from "../../../src/meals/conversation/deliver";
import { registerMealsRole } from "../../../src/meals/conversation/role";

registerMealsRole();
import { registerMealsDesk } from "../../../src/meals/desk";
import { EMPTY_MEALS } from "../../../src/meals/plan/types";
import type { AgentTool } from "../../../src/legion/durable/contract";
import { installAppData } from "../../support/appdata-fake";

const DATE = "2026-09-16";
const NOW = new Date(2026, 8, 16, 9, 0, 0).getTime();

const settings: Settings = {
  ...DEFAULT_SETTINGS,
  defaultProviderId: "anthropic",
  defaultModelId: "claude-sonnet-4-5",
};

registerMealsDesk();

beforeEach(() => {
  installAppData();
  rebuildThreadStoreForTests();
});

test("a turn asked from the meals conversation is rebuilt in the meals thread, on the meals desk", async () => {
  const mealsTool: AgentTool = {
    name: "propose_meal_plan",
    label: () => "Propose",
    description: "stand-in",
    parameters: { type: "object", properties: {} } as never,
    effect: "read",
    execute: async () => "",
  };
  const off = registerMealsDelivery({
    state: async () => EMPTY_MEALS,
    today: () => DATE,
    tools: async () => [mealsTool],
  });
  try {
    createThread("info-meals", "info", "meals");
    appendMessage("info-meals", "meals", { role: "user", text: "Is tofu cheaper this week?", ts: NOW - 60_000 });
    const delivery = await deliveryOpener("meals")!({ origin: { place: "meals" }, settings, bell: "" });
    expect(delivery?.key).toBe("info-meals");
    expect(delivery?.threadId).toBe("meals");
    expect(delivery?.turn.systemPrompt).toContain("You plan their meals");
    expect(delivery?.turn.tools.map((t) => t.name)).toContain("propose_meal_plan");
  } finally {
    off();
  }
});
