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

test("the state is read again when the desk opens: a plan confirmed earlier in the conversation is the one the model sees", async () => {
  const unregister = registerMealsDesk();
  try {
    const prompt = async (r: ReturnType<typeof mealsAnchor>["desk"]) =>
      (await openDesk(r, env)).items[0]!.prompt({ dropped: [] } as never);
    const opened = mealsAnchor(state(), MON).desk;
    const now = state({ plan: null });
    const fresh = await prompt(bindItemRef(opened, INFO_MEALS_KIND, { fresh: async () => now }));
    expect(fresh).toBe(await prompt(mealsAnchor(now, MON).desk));
    expect(fresh).not.toBe(await prompt(opened));
    // A read that fails leaves the state the anchor was made with.
    const failed = bindItemRef(opened, INFO_MEALS_KIND, { fresh: () => Promise.reject(new Error("unreadable")) });
    expect(await prompt(failed)).toBe(await prompt(opened));
  } finally {
    unregister();
  }
});
