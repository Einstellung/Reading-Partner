// The dinner tools bound to the real store and the real clock (docs/73), the
// way companion-live.ts binds the briefing's.
//
// The pure tools take ports so they can be tested without a filesystem; this is
// where those ports become loadDinner and the four writes. The card sink and
// the screen's reload come from whoever is running the turn.

import type { DinnerPorts } from "./apply";
import type { DinnerCard } from "./cards";
import { ingredientImageUrl } from "./images";
import { startPhotoRun } from "./photo-run";
import { loadDinnerPhotos } from "./photo-store";
import { loadDinner, saveCharter, saveDeviation, savePlan } from "./store";
import {
  buildProposeDinnerCharterTool,
  buildProposeDinnerPlanTool,
  buildRecordDeviationTool,
  buildRefreshDinnerPhotosTool,
} from "./tools";
import type { AgentTool } from "../../legion/execute/turn";

export interface LiveDinnerOptions {
  // The conversation the cards belong to.
  threadId: string;
  // Where a drafted card goes.
  onDinnerCard(card: DinnerCard): void;
  // The host's local date, so the tools and the screen agree on which night it
  // is without either of them asking the model.
  today(): string;
  // The screen reloads: a deviation writes without a card, so nothing else
  // would tell it.
  changed(): void;
}

/** The ports every dinner write goes through, on the live store. */
export function liveDinnerPorts(opts: Pick<LiveDinnerOptions, "today" | "changed">): DinnerPorts {
  return {
    current: () => loadDinner(),
    saveCharter: (charter) => saveCharter(charter),
    savePlan: (plan, shopping) => savePlan(plan, shopping),
    saveDeviation: (deviation, plan, shopping) => saveDeviation(deviation, plan, shopping),
    photos: () => loadDinnerPhotos(),
    startPhotoRun: (planId, queries) => startPhotoRun({ planId, queries: [...queries] }),
    bankImage: (en) => ingredientImageUrl(en),
    now: () => Date.now(),
    today: opts.today,
    changed: opts.changed,
  };
}

/** The tools the dinner desk mounts. */
export function buildLiveDinnerTools(opts: LiveDinnerOptions): AgentTool[] {
  const ports = liveDinnerPorts(opts);
  const deps = {
    threadId: opts.threadId,
    state: () => loadDinner(),
    today: opts.today,
    now: () => Date.now(),
    onDinnerCard: opts.onDinnerCard,
  };
  return [
    buildProposeDinnerCharterTool(deps),
    buildProposeDinnerPlanTool(deps),
    buildRecordDeviationTool({ ...deps, ports }),
    buildRefreshDinnerPhotosTool({ ...deps, ports }),
  ];
}
