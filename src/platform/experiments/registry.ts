// Settings › Experiments (docs/reading/688 「Experiments」): the features that
// are not finished, each behind a switch that is off until this device turns it
// on. The shipped app shows reading and nothing else by default.
//
// Off hides a feature from the screen and nothing more: no entry, no screen, no
// place the companion can take the reader to. Nothing is deleted, so turning it
// back on finds everything where it was.
//
// An entry may sit under another (Meals under Intel). It counts as on only
// while its parent is on too; its own switch keeps its value meanwhile, so
// turning the parent back on brings it back as it was.

import type { MessageKey } from "../../i18n/translate";

export type ExperimentId = "intel" | "meals" | "companion";

export interface Experiment {
  id: ExperimentId;
  // Catalog keys (i18n/messages/settings). The name takes {name}, the
  // companion's current name, which only the companion's entry uses.
  name: MessageKey;
  summary: MessageKey;
  // currentPlatform() values the entry is offered on, or "all".
  hosts: "all" | readonly string[];
  // The entry this one is drawn under and depends on.
  parent?: ExperimentId;
}

export const EXPERIMENTS: readonly Experiment[] = [
  {
    id: "intel",
    name: "settings.experiments.intel.name",
    summary: "settings.experiments.intel.summary",
    hosts: "all",
  },
  {
    id: "meals",
    name: "settings.experiments.meals.name",
    summary: "settings.experiments.meals.summary",
    hosts: "all",
    parent: "intel",
  },
  {
    id: "companion",
    name: "settings.experiments.companion.name",
    summary: "settings.experiments.companion.summary",
    hosts: "all",
  },
];

/** The entries offered on this platform, in registry order. */
export function experimentsFor(platform: string): Experiment[] {
  return EXPERIMENTS.filter((e) => e.hosts === "all" || e.hosts.includes(platform));
}

/** The entries drawn under this one, in registry order. */
export function childrenOf(list: readonly Experiment[], id: ExperimentId): Experiment[] {
  return list.filter((e) => e.parent === id);
}

/** Whether a stored map has this id's own switch on. Absent, or anything but true, is off. */
export function isOn(stored: Record<string, boolean> | undefined, id: ExperimentId): boolean {
  return stored?.[id] === true;
}

/** Whether the feature is shown: its own switch on, and every parent's. */
export function isEffective(stored: Record<string, boolean> | undefined, id: ExperimentId): boolean {
  const parent = EXPERIMENTS.find((e) => e.id === id)?.parent;
  return isOn(stored, id) && (parent === undefined || isEffective(stored, parent));
}

/** The stored map with one id set; every other key, known or not, rides through. */
export function withExperiment(
  stored: Record<string, boolean> | undefined,
  id: ExperimentId,
  on: boolean,
): Record<string, boolean> {
  return { ...stored, [id]: on };
}
