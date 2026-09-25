// The repairs the app runs once on the way up, lifted out of App: the names an
// iOS import left percent-encoded, in the shelf and in the library
// (docs/pitfall/106).
//
// The io is an argument so this can be run without a filesystem. The default
// binds the real one; App passes nothing.

import { repairLibraryNames } from "../../platform/app/library";
import { repairTopicPaths } from "../../platform/app/topics";
import { settleDeletions } from "../delete/settle";

export interface StartupRepairIo {
  /** Names an iOS import left percent-encoded (docs/pitfall/106). */
  repairTopicPaths(): Promise<boolean>;
  repairLibraryNames(): Promise<boolean>;
  /** What the deletion log says is gone and is still here (reading/delete/settle.ts). */
  settleDeletions(): Promise<boolean>;
}

export const startupRepairIo: StartupRepairIo = {
  repairTopicPaths,
  repairLibraryNames,
  settleDeletions: () => settleDeletions(),
};

// Runs once, in the background. Answers whether the shelf has to be read again:
// nothing here is on the reader's critical path, so a run that changed nothing
// costs the screen nothing either.
//
// Both repairs are read-time: a clean file is rewritten by neither, so they
// cost no sync revision.
export async function runStartupRepairs(
  io: StartupRepairIo = startupRepairIo,
): Promise<boolean> {
  return Promise.all([io.repairTopicPaths(), io.repairLibraryNames(), io.settleDeletions()])
    .then((wrote) => wrote.some(Boolean))
    .catch((e) => {
      console.warn("name repair skipped", e);
      return false;
    });
}
