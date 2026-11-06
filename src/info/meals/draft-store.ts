// info-meals-draft.json on disk (draft-file.ts): read, written whole, and
// heard about when it changes, by a write on this device or by a pull. The
// conversation showing the draft card listens and patches the card
// (draft-file.ts draftCardFromFile).

import { appGuardedFileIo, readGuardedFile, type GuardedFileIo } from "../../platform/app/guarded-file";
import { registerLattice } from "../../platform/sync/merge/lattice";
import { registerPullRoute, type PullMatcher } from "../../platform/sync/pull-routes";
import {
  draftFileBody,
  joinDraftFiles,
  MEALS_DRAFT_FILE,
  MEALS_DRAFT_KIND,
  parseDraftFile,
  type MealsDraftFile,
  type MealsDraftPorts,
} from "./draft-file";

export type MealsDraftIo = GuardedFileIo<MealsDraftFile>;

export const mealsDraftIo: MealsDraftIo = appGuardedFileIo();

// Registered at import, the way plan/merge.ts registers the plan file's join.
registerLattice(MEALS_DRAFT_KIND, joinDraftFiles);

/** The draft on disk, or null when there is none. */
export async function loadMealsDraft(io: MealsDraftIo = mealsDraftIo): Promise<MealsDraftFile | null> {
  return readGuardedFile(io, MEALS_DRAFT_FILE, parseDraftFile);
}

const listeners = new Set<() => void>();

function changed(): void {
  for (const listener of [...listeners]) listener();
}

export async function saveMealsDraft(file: MealsDraftFile, io: MealsDraftIo = mealsDraftIo): Promise<void> {
  await io.write(MEALS_DRAFT_FILE, draftFileBody(file));
  changed();
}

export const MEALS_DRAFT_PULL_ROUTE: PullMatcher = {
  id: "meals-draft",
  matches: (path) => path === MEALS_DRAFT_FILE,
};

/** Hear every write of the draft file, here or by a pull. Returns the undo. */
export function watchMealsDraft(listener: () => void): () => void {
  listeners.add(listener);
  const off = registerPullRoute({ ...MEALS_DRAFT_PULL_ROUTE, onPulled: listener });
  return () => {
    listeners.delete(listener);
    off();
  };
}

/** The draft file's ports on this device. */
export function liveDraftPorts(io: MealsDraftIo = mealsDraftIo): MealsDraftPorts {
  return { load: () => loadMealsDraft(io), save: (file) => saveMealsDraft(file, io) };
}
