// The meals tools bound to the real store and the real clock (docs/73), the
// way companion-live.ts binds the briefing's.
//
// The pure tools take ports so they can be tested without a filesystem; this is
// where those ports become loadMeals and the four writes. The card sink and
// the screen's reload come from whoever is running the turn.

import type { MealsPorts } from "./apply";
import type { MealsCard } from "./cards";
import { ingredientImageUrl } from "./images";
import { startPhotoRun } from "./photo-run";
import { loadMealsPhotos } from "./photo-store";
import {
  loadMeals,
  saveCharter,
  saveDeviation,
  saveDishMethod,
  savePlan,
  saveShopping,
} from "./store";
import {
  buildAddShoppingItemsTool,
  buildProposeMealsCharterTool,
  buildProposeMealsPlanTool,
  buildRecordDeviationTool,
  buildRefreshMealsPhotosTool,
  buildRemoveShoppingItemTool,
  buildReplaceShoppingItemTool,
  buildWriteMethodTool,
} from "./tools";
import { callModel } from "../../ai/model-call";
import type { MethodPorts } from "./method";
import type { AgentTool } from "../../legion/execute/turn";

export interface LiveMealsOptions {
  // The conversation the cards belong to.
  threadId: string;
  // Where a drafted card goes.
  onMealsCard(card: MealsCard): void;
  // The host's local date, so the tools and the screen agree on which night it
  // is without either of them asking the model.
  today(): string;
  // The screen reloads: a deviation writes without a card, so nothing else
  // would tell it.
  changed(): void;
}

/** The ports every meals write goes through, on the live store. */
export function liveMealsPorts(opts: Pick<LiveMealsOptions, "today" | "changed">): MealsPorts {
  return {
    current: () => loadMeals(),
    saveCharter: (charter) => saveCharter(charter),
    savePlan: (plan, shopping) => savePlan(plan, shopping),
    saveDeviation: (deviation, plan, shopping) => saveDeviation(deviation, plan, shopping),
    saveShopping: (shopping) => saveShopping(shopping),
    saveDishMethod: (dishId, method) => saveDishMethod(dishId, method),
    photos: () => loadMealsPhotos(),
    startPhotoRun: (planId, queries) => startPhotoRun({ planId, queries: [...queries] }),
    bankImage: (en) => ingredientImageUrl(en),
    now: () => Date.now(),
    today: opts.today,
    changed: opts.changed,
  };
}

/** The tools the meals desk mounts. */
export function buildLiveMealsTools(opts: LiveMealsOptions): AgentTool[] {
  const ports = liveMealsPorts(opts);
  const deps = {
    threadId: opts.threadId,
    state: () => loadMeals(),
    today: opts.today,
    now: () => Date.now(),
    onMealsCard: opts.onMealsCard,
  };
  return [
    buildProposeMealsCharterTool(deps),
    buildProposeMealsPlanTool(deps),
    buildRecordDeviationTool({ ...deps, ports }),
    buildAddShoppingItemsTool({ ...deps, ports }),
    buildRemoveShoppingItemTool({ ...deps, ports }),
    buildReplaceShoppingItemTool({ ...deps, ports }),
    buildWriteMethodTool({ ...deps, ports }),
    buildRefreshMealsPhotosTool({ ...deps, ports }),
  ];
}

/**
 * The ports ensureDishMethod runs on: the week off disk and one headless model
 * turn, on the same background model the other unattended pipelines use.
 *
 * No thread and no card — the steps are the dish the reader already agreed to,
 * said in order (method.ts).
 */
export function liveMethodPorts(): MethodPorts {
  return {
    plan: async () => (await loadMeals()).plan,
    charter: async () => (await loadMeals()).charter,
    ask: (system, user) =>
      callModel("prep", "chapter-note", system, user, {
        onProgress: () => {},
        signal: new AbortController().signal,
      }),
    saveDishMethod: (dishId, method) => saveDishMethod(dishId, method),
    now: () => Date.now(),
  };
}
