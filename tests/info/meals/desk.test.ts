// The meals desk (src/info/meals/desk.ts): the draft card the surface binds
// reaches the prompt, read when the desk opens.
// Run: scripts/t.sh tests/info/meals/desk.test.ts

import { expect, test } from "bun:test";
import { bindItemRef, openDesk, type DeskEnv } from "../../../src/desk";
import { mealsAnchor } from "../../../src/info/briefer/anchors";
import { INFO_MEALS_KIND, registerMealsDesk } from "../../../src/info/meals/desk";
import { DEFAULT_SETTINGS } from "../../../src/platform/app/settings";
import { MON, state } from "./fixtures/week";
import { draftCard } from "./planner/card-fixture";

const env: DeskEnv = {
  settings: { ...DEFAULT_SETTINGS, defaultProviderId: "anthropic", defaultModelId: "claude-sonnet-4-5" },
  thread: { key: "info-meals", id: "meals" },
};

test("the draft card bound to the meals ref is in the prompt; without one it is not", async () => {
  const unregister = registerMealsDesk();
  try {
    const refs = mealsAnchor(state(), MON).desk;
    const prompt = async (r: typeof refs) => (await openDesk(r, env)).items[0]!.prompt({ dropped: [] } as never);
    const card = draftCard();
    expect(await prompt(bindItemRef(refs, INFO_MEALS_KIND, { draft: () => card }))).toContain("THE DRAFT ON THE CARD (version 1");
    expect(await prompt(bindItemRef(refs, INFO_MEALS_KIND, { draft: () => null }))).not.toContain("THE DRAFT ON THE CARD (");
    expect(await prompt(refs)).not.toContain("THE DRAFT ON THE CARD (");
  } finally {
    unregister();
  }
});
