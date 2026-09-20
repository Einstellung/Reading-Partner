// The repairs and backfills the app runs once on the way up, lifted out of App.
// The name repairs, and the pass that gives every topic file a content hash
// (docs/13, M-sync-1): import it into the library and write the id down.
//
// The io is an argument so this can be run without a filesystem. The default
// binds the real one; App passes nothing.

import { appData } from "../../platform/app/appdata";
import { importBook, repairLibraryNames } from "../../platform/app/library";
import { listTopics, repairTopicPaths, setFileHash, type Topic } from "../../platform/app/topics";

export interface StartupMigrationIo {
  /** Names an iOS import left percent-encoded (docs/pitfall/106). */
  repairTopicPaths(): Promise<boolean>;
  repairLibraryNames(): Promise<boolean>;
  listTopics(): Promise<Topic[]>;
  /** The file at the absolute path the reader picked, not an AppData one. */
  readFile(path: string): Promise<Uint8Array>;
  importBook(bytes: Uint8Array, originalPath: string): Promise<{ hash: string }>;
  setFileHash(topicId: string, path: string, hash: string): Promise<void>;
}

export const startupMigrationIo: StartupMigrationIo = {
  repairTopicPaths,
  repairLibraryNames,
  listTopics,
  readFile: (path) => appData.readPicked(path),
  importBook,
  setFileHash,
};

// Runs once, in the background. Answers whether the shelf has to be read again:
// nothing here is on the reader's critical path, so a run that changed nothing
// costs the screen nothing either.
//
// Idempotent throughout — a file that already carries an id is skipped, and the
// name repairs write nothing when there is nothing to repair, so they cost no
// sync revision.
export async function runStartupMigrations(
  io: StartupMigrationIo = startupMigrationIo,
): Promise<boolean> {
  // The name repairs run first, so the backfill below reads the repaired paths.
  let changed = await Promise.all([io.repairTopicPaths(), io.repairLibraryNames()])
    .then((wrote) => wrote.some(Boolean))
    .catch((e) => {
      console.warn("name repair skipped", e);
      return false;
    });
  const all = await io.listTopics().catch((): Topic[] => []);
  for (const t of all) {
    for (const f of t.files) {
      if (f.hash) continue;
      try {
        // Sequentially: books can be hundreds of MB, so never read several at
        // once.
        const bytes = await io.readFile(f.path);
        const entry = await io.importBook(bytes, f.path);
        await io.setFileHash(t.id, f.path, entry.hash);
        changed = true;
      } catch (e) {
        console.warn("library migration skipped a file", f.path, e);
      }
    }
  }
  return changed;
}
