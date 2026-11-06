// Who the model-call log names for each kind of meals spend: the standing
// conversation, a recipe, a batch-cook session's steps, a dish picture. Each
// used to be logged as "info", which is also the briefing's name.
// Run: scripts/t.sh tests/info/meals/model-callers.test.ts

import { expect, spyOn, test } from "bun:test";
import * as modelCall from "../../../src/ai/model-call";
import type { ModelCallReport } from "../../../src/ai/model-usage";
import { infoPlace, infoThreadOrigin, mealsPlace } from "../../../src/info/briefer/info-durable";
import { mealsAnchor } from "../../../src/info/briefer/anchors";
import { drawDishPicture } from "../../../src/info/meals/photos/dish-draw-sweep";
import { writePrepStepsOnce, writeRecipeOnce } from "../../../src/info/meals/recipe/recipe-live";
import type { PrepStepsRequest } from "../../../src/info/meals/recipe/prep-steps";
import type { RecipeRequest } from "../../../src/info/meals/recipe/recipe";
import { usageReport } from "../../../src/legion/durable/device";
import { fakeThreads } from "../../reading/turn/support/durable-threads";

const DATE = "2026-10-11";
const shared = { threads: fakeThreads().threads, describe: () => ({}) as never, now: () => 0 };
const message = { provider: "p", model: "m", stopReason: "stop", usage: { input: 1, output: 1 } } as never;

test("the meals conversation logs as meals-chat, the briefing as info", () => {
  const meals = infoThreadOrigin(mealsAnchor({ household: null, plan: null } as never, DATE), DATE);
  const briefing = infoThreadOrigin({ threadId: `briefing-${DATE}` }, DATE);
  const mealsTelemetry = mealsPlace()(shared).telemetry(meals);
  const infoTelemetry = infoPlace()(shared).telemetry(briefing);
  expect(usageReport(message, mealsTelemetry).caller).toBe("meals-chat");
  expect(usageReport(message, infoTelemetry).caller).toBe("info");
  // The cache log keeps its surface for both.
  expect(mealsTelemetry.surface).toBe("info");
});

async function spendOf(run: () => Promise<unknown>): Promise<unknown> {
  const call = spyOn(modelCall, "callModel").mockRejectedValue(new Error("stop"));
  spyOn(modelCall, "resolveModel").mockResolvedValue({ providerId: "p", modelId: "m", aiLanguage: "en" } as never);
  await run().catch(() => {});
  expect(call).toHaveBeenCalledTimes(1);
  return call.mock.calls[0]![5];
}

test("a recipe is logged as meals-recipe", async () => {
  const request: RecipeRequest = {
    key: "recipe-caller-test",
    name: "Congee",
    flavour: "",
    minutes: null,
    method: "",
    rows: [],
    kitchen: [],
    effort: "simple",
    language: "en",
    pot: null,
  };
  expect(await spendOf(() => writeRecipeOnce(request, "chat"))).toEqual({ spend: { caller: "meals-recipe" } });
});

test("a prep session's steps are logged as meals-prep-steps", async () => {
  const request: PrepStepsRequest = {
    kind: "prep",
    key: "prep-caller-test",
    session: "s",
    name: "Pots",
    pots: [],
    rice: null,
    devices: ["stove"],
    burners: 1,
    thermometer: false,
    language: "en",
  };
  expect(await spendOf(() => writePrepStepsOnce(request, "chat"))).toEqual({ spend: { caller: "meals-prep-steps" } });
});

test("a dish picture is logged as meals-dish-art", async () => {
  const recorded: ModelCallReport[] = [];
  await drawDishPicture("a bowl", {
    providerId: async () => "xai",
    apiKey: async () => "sk-test",
    fetch: async () => new Response("{}", { status: 500 }),
    record: (r) => {
      recorded.push(r);
    },
  });
  expect(recorded).toHaveLength(1);
  expect(recorded[0]!.caller).toBe("meals-dish-art");
});
