// Finishing what the deletion log says (docs/50).
//
// The log is the only thing a deletion is guaranteed to leave behind: a delete
// that died half way wrote it first, and a device that pulled it from another
// device has nothing else. Everything a deleted book leaves on this device that
// the sync pass does not take — its shelf entry and reading position when the
// record delete lost to an edit or never ran, its blob, its covers, its
// fulltext and figures, the pdf/ cache under prep- — is taken here, and a
// topic's row the merge brought back is dropped again. Run once on the way up
// and whenever a pull rewrites the log (reading/session/startup-repairs.ts,
// ui/components/common/useBackgroundServices.ts); a run over a settled device
// finds nothing and writes nothing.
//
// A book is settled only when something of it is still here — its shelf entry
// or its blob — so a log of a hundred old deletions costs a hundred cheap
// probes and not fourteen hundred removes. The shelf's own list needs no
// finishing: the topic store answers from the log already (platform/app/
// topics.ts), and the rewrite here is what stops the merge carrying the record
// round again.

import { appData } from "../../platform/app/appdata";
import { readDeletions, type Deletions } from "../../platform/app/deleted-books";
import {
  findLibraryBookPath,
  listLibraryEntries,
  removeLibraryEntry,
} from "../../platform/app/library";
import { removeViewState } from "../../platform/app/storage";
import { pruneDeletedFromTopics } from "../../platform/app/topics";
import { deadLocalPathsFor } from "./pick";

export interface SettleDeps {
  deletions: () => Promise<Deletions>;
  libraryBookIds: () => Promise<string[]>;
  hasBlob: (bookId: string) => Promise<boolean>;
  removeLibraryEntry: (bookId: string) => Promise<void>;
  removeViewState: (bookId: string) => Promise<void>;
  removeFile: (path: string) => Promise<void>;
  removeDir: (path: string) => Promise<void>;
  pruneTopics: () => Promise<boolean>;
}

async function removeIfPresent(path: string, remove: (p: string) => Promise<void>): Promise<void> {
  if (!(await appData.exists(path))) return;
  await remove(path);
}

export const liveSettleDeps: SettleDeps = {
  deletions: readDeletions,
  libraryBookIds: async () => Object.keys(await listLibraryEntries()),
  hasBlob: async (bookId) => (await findLibraryBookPath(bookId)) !== null,
  removeLibraryEntry,
  removeViewState,
  removeFile: (path) => removeIfPresent(path, (p) => appData.remove(p)),
  removeDir: (path) => removeIfPresent(path, (p) => appData.removeDir(p)),
  pruneTopics: pruneDeletedFromTopics,
};

/** Which deleted books still have something on this device. */
export async function unsettledBooks(deps: SettleDeps): Promise<string[]> {
  const dead = (await deps.deletions()).book;
  if (dead.size === 0) return [];
  const shelved = new Set(await deps.libraryBookIds());
  const out: string[] = [];
  for (const bookId of dead) {
    if (shelved.has(bookId) || (await deps.hasBlob(bookId))) out.push(bookId);
  }
  return out;
}

/**
 * Take off this device what the log says is deleted. Answers whether anything
 * changed, so the shelf can be read again. Best-effort per book and per file:
 * one file that will not go must not keep the next book on the shelf.
 */
export async function settleDeletions(deps: SettleDeps = liveSettleDeps): Promise<boolean> {
  let changed = false;
  for (const bookId of await unsettledBooks(deps)) {
    changed = true;
    try {
      await deps.removeLibraryEntry(bookId);
      await deps.removeViewState(bookId);
    } catch (e) {
      console.warn("failed to take a deleted book off the shelf", bookId, e);
    }
    const { files, dirs } = deadLocalPathsFor(bookId);
    for (const file of files) {
      await deps.removeFile(file).catch((e) => console.warn("failed to delete", file, e));
    }
    for (const dir of dirs) {
      await deps.removeDir(dir).catch((e) => console.warn("failed to delete", dir, e));
    }
  }
  if (await deps.pruneTopics()) changed = true;
  return changed;
}
