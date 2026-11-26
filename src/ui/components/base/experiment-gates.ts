// Which of the experiments (platform/experiments) this device shows, as the
// shells hand them down. Each one decides only what is drawn and where a
// reader can be taken; what runs behind it is not asked.

export interface ExperimentGates {
  // The meals line's screens, entries and cards.
  meals: boolean;
  // The companion in the corner, its menus, its box and the door chat.
  companion: boolean;
}

/** Every experiment shown: the default for callers and tests that predate them. */
export const ALL_EXPERIMENTS_SHOWN: ExperimentGates = { meals: true, companion: true };
