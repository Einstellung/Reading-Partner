// A voice call's think run delivered to the meals conversation reads the meals
// data (src/reading/turn/meals-bell.ts registers the desk).
// Run: scripts/t.sh tests/reading/turn/meals-think.test.ts

import { expect, test } from "bun:test";
import { registerMealsBell } from "../../../src/reading/turn/meals-bell";
import { thinkDesk } from "../../../src/soul/think";
import { MEALS_READ_PROMPT, MEALS_READ_TOOLS } from "../../../src/meals/read-tools";

test("a think run at the meals place gets the meals read tools and their prompt", async () => {
  const undo = registerMealsBell();
  try {
    const laid = await thinkDesk({ place: "meals" });
    expect(laid.tools.map((t) => t.name)).toEqual([...MEALS_READ_TOOLS]);
    expect(laid.prompt).toBe(MEALS_READ_PROMPT);
  } finally {
    undo();
  }
  expect((await thinkDesk({ place: "meals" })).tools).toEqual([]);
});

