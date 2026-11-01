// A voice call's think run delivered to the meals conversation reads the meals
// data (src/reading/turn/info-bell.ts registers the desk), and the tasking
// worker holds the same reads.
// Run: scripts/t.sh tests/reading/turn/meals-think.test.ts

import { expect, test } from "bun:test";
import { registerInfoDelivery } from "../../../src/reading/turn/info-bell";
import { thinkDesk } from "../../../src/soul/think";
import { MEALS_READ_PROMPT, MEALS_READ_TOOLS } from "../../../src/info/meals/read-tools";
import { buildTaskingAgent } from "../../../src/info/tasking/tasking-agent";

test("a think run at the meals place gets the meals read tools and their prompt", async () => {
  const undo = registerInfoDelivery();
  try {
    const laid = await thinkDesk({ place: "meals" });
    expect(laid.tools.map((t) => t.name)).toEqual([...MEALS_READ_TOOLS]);
    expect(laid.prompt).toBe(MEALS_READ_PROMPT);
  } finally {
    undo();
  }
  expect((await thinkDesk({ place: "meals" })).tools).toEqual([]);
});

test("the tasking worker can read the meals data", () => {
  const names = buildTaskingAgent().tools.map((t) => t.name);
  for (const name of MEALS_READ_TOOLS) expect(names).toContain(name);
  expect(buildTaskingAgent().systemPrompt).toContain("meals_read_plan");
});
