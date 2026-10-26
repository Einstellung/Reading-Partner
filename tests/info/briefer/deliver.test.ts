// The desk a briefing's or the meals conversation's turn is rebuilt over
// (src/info/briefer/deliver.ts, docs/68). Bells are answered on the durable
// runtime (reading/turn/info-bell.ts); the openers rebuild the desk a place's
// durable turn is resolved over.
// Run: scripts/t.sh tests/info/briefer/deliver.test.ts

import { beforeEach, expect, test } from "bun:test";
import { deliveryOpener } from "../../../src/soul/delivery";
import { DEFAULT_SETTINGS, type Settings } from "../../../src/platform/app/settings";
import { appendMessage, createThread, rebuildThreadStoreForTests } from "../../../src/platform/app/threads";
import { registerInfoDesk } from "../../../src/info/briefer/desk";
import { registerSecretaryRole } from "../../../src/info/briefer/role";
import { registerBriefingDelivery, registerMealsDelivery } from "../../../src/info/briefer/deliver";
import { registerMealsDesk } from "../../../src/info/meals/desk";
import { EMPTY_MEALS } from "../../../src/info/meals/plan/types";
import type { AgentTool } from "../../../src/legion/durable/contract";
import { installAppData } from "../../support/appdata-fake";

const DATE = "2026-09-16";
const BOOK = `info-${DATE}`;
const THREAD = `briefing-${DATE}`;
const NOW = new Date(2026, 8, 16, 9, 0, 0).getTime();

const settings: Settings = {
  ...DEFAULT_SETTINGS,
  defaultProviderId: "anthropic",
  defaultModelId: "claude-sonnet-4-5",
};

registerInfoDesk();
registerMealsDesk();
registerSecretaryRole();

beforeEach(() => {
  installAppData();
  rebuildThreadStoreForTests();
});

// The opener the info domain registers, over records handed in rather than read
// off disk: what is being tested is the desk, not the day's collection.
function briefingDelivery(): () => void {
  return registerBriefingDelivery({
    briefing: async () => null,
    context: async () => ({ reader: "Follows trade policy.", sources: [], collecting: true }),
    tools: async () => [],
  });
}

test("a turn asked from the briefing is rebuilt in that day's thread, on the secretary's desk", async () => {
  const off = briefingDelivery();
  try {
    createThread(BOOK, "info", THREAD);
    appendMessage(BOOK, THREAD, { role: "user", text: "What was the tariff before this?", ts: NOW - 60_000 });
    const delivery = await deliveryOpener("briefing")!({
      origin: { place: "briefing", date: DATE },
      settings,
      bell: "",
    });
    expect(delivery?.key).toBe(BOOK);
    expect(delivery?.threadId).toBe(THREAD);
    expect(delivery?.turn.refusal).toBe("");
    // Assembled as the secretary's desk, not as a stranger at the door.
    expect(delivery?.turn.systemPrompt).toContain("daily briefing");
  } finally {
    off();
  }
});

test("a briefing nothing was said in that day still has somewhere to land", async () => {
  const off = briefingDelivery();
  try {
    const delivery = await deliveryOpener("briefing")!({
      origin: { place: "briefing", date: DATE },
      settings,
      bell: "",
    });
    expect(delivery?.key).toBe(BOOK);
    expect(delivery?.threadId).toBe(THREAD);
  } finally {
    off();
  }
});

// The meals conversation is one standing thread in a file of its own, on the
// meals desk with the meals tools, and not that day's briefing.
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
