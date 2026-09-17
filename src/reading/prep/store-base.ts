// Where a document's prepared material lives, and the two reads both kinds of it
// do the same way. A document has one prep directory, keyed by the library
// content hash: the paper notes sit in it, the chapter spines in a subdirectory,
// so whichever kind of material a document turns out to need is in one place.
// All of it is derived and rebuildable.

import { appData } from "../../platform/app/appdata";

export function prepDir(documentId: string): string {
  return `prep-${documentId}`;
}

// Missing state is normal (nothing was prepared yet); a corrupt or stale-version
// state reads as null so the pipeline starts over instead of crashing. `what`
// names the file in the warning.
export async function loadPrepStateFile<T extends { version: number }>(
  file: string,
  version: number,
  what: string,
): Promise<T | null> {
  try {
    if (!(await appData.exists(file))) return null;
    const parsed = JSON.parse(await appData.readText(file)) as T;
    if (!parsed || parsed.version !== version) return null;
    return parsed;
  } catch (e) {
    console.warn(`failed to read ${what}`, e);
    return null;
  }
}

// A written note, or null when it was never written or cannot be read.
export async function readPrepTextFile(file: string, what: string): Promise<string | null> {
  try {
    if (!(await appData.exists(file))) return null;
    return await appData.readText(file);
  } catch (e) {
    console.warn(`failed to read ${what}`, e);
    return null;
  }
}
