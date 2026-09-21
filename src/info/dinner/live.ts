// The dinner tools bound to the real store and the real clock (docs/73), the
// way companion-live.ts binds the briefing's.
//
// The pure tools take ports so they can be tested without a filesystem; this is
// where those ports become loadDinner and the four writes. The card sink and
// the screen's reload come from whoever is running the turn.

import type { DinnerPorts } from "./apply";
import type { DinnerCard } from "./cards";
import { lookupDishPhoto, type DishPhotoLookup } from "./dish-photos";
import { composeDishPhotoLookup, googleSearchCreds, lookupGoogleImage } from "./google-images";
import { loadDinner, saveCharter, saveDeviation, saveDishPhotos, savePlan } from "./store";
import {
  buildProposeDinnerCharterTool,
  buildProposeDinnerPlanTool,
  buildRecordDeviationTool,
} from "./tools";
import type { AgentTool } from "../../legion/execute/turn";
import { loadSettings } from "../../platform/app/settings";

/**
 * One dish name, through whichever searches this reader has: their own web
 * image search first when they have registered a key, and Openverse behind it
 * always (docs/73 图片).
 *
 * The settings are read per lookup rather than captured when the ports are
 * built: a key typed into Settings is in use at the next Apply, and a reader
 * with no key pays one file read they would pay anyway.
 */
async function lookupDishPhotoHere(searchName: string): Promise<DishPhotoLookup> {
  const settings = await loadSettings().catch(() => null);
  const creds = googleSearchCreds(settings);
  const lookup = composeDishPhotoLookup(
    creds ? (name) => lookupGoogleImage(name, creds) : null,
    (name) => lookupDishPhoto(name),
  );
  return lookup(searchName);
}

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
    saveDishPhotos: (photos, plan) => saveDishPhotos(photos, plan),
    lookupDishPhoto: (searchName) => lookupDishPhotoHere(searchName),
    now: () => Date.now(),
    today: opts.today,
    changed: opts.changed,
  };
}

/** The three tools the dinner desk mounts. */
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
  ];
}
