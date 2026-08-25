// Bringing a deck in from outside (docs/43, "入口"): the reader already has the
// PPT — a self-contained HTML file that speaks the host bridge — and wants to
// rehearse against it. Nothing about it came from the app, so it hangs off the
// topic and not off a retell.
//
// The bytes are copied into AppData rather than referenced where they sit. A
// path outside AppData is a path that means nothing on the iPad, and on iOS the
// picked file is handed over in a temporary inbox the system empties behind you
// — so a reference would be a rehearsal that works once.

import { appData } from "../../platform/app/appdata";
import { importedDeckFile, REHEARSAL_DECK_DIR, reserveRehearsalId, saveRehearsal } from "./store";
import { newRehearsal, type Rehearsal } from "./types";

// The name a picked deck starts with: the file's own, without its extension and
// without the path around it. Both separators, because the picker hands back
// whatever the host uses. The reader renames it from the list.
export function deckNameFromPath(path: string): string {
  const base = path.split(/[/\\]/).pop() ?? "";
  const name = base.replace(/\.[Hh][Tt][Mm][Ll]?$/, "").trim();
  return name || "Untitled deck";
}

// Whether this is a file this can take. The first version's "PPT" is the
// self-contained HTML deck (docs/43); a .pptx is not read by anything here yet,
// and taking one would produce a rehearsal that cannot be opened.
export function isDeckPath(path: string): boolean {
  return /\.[Hh][Tt][Mm][Ll]?$/.test(path);
}

export interface ImportDeckInput {
  topicId: string;
  // The absolute path the reader picked.
  sourcePath: string;
  // Overrides the file's own name when the caller has a better one.
  name?: string;
  now?: number;
}

/**
 * Copy a picked deck into AppData and make the rehearsal that gives it.
 *
 * The id is reserved before the copy and the object is written after it, so a
 * copy that fails leaves nothing behind: an object pointing at bytes that never
 * landed would be a row in the list that cannot be opened and cannot be
 * explained.
 */
export async function importRehearsalDeck(input: ImportDeckInput): Promise<Rehearsal> {
  const name = (input.name ?? deckNameFromPath(input.sourcePath)).trim();
  const { id, at } = await reserveRehearsalId(input.now ?? Date.now());
  const deckFile = importedDeckFile(id);
  const bytes = await appData.readPicked(input.sourcePath);
  await appData.mkdirp(REHEARSAL_DECK_DIR);
  // A plain byte copy rather than the atomic writer: this is somebody else's
  // file going in verbatim, tens of megabytes of it, and the atomic writer would
  // decode the whole thing to a string to decide it is text. A copy torn by a
  // crash leaves no object behind to point at it, because the object is written
  // after this line.
  await appData.writeBytes(deckFile, bytes);
  const rehearsal = newRehearsal({ id, topicId: input.topicId, name, deckFile, now: at });
  await saveRehearsal(rehearsal);
  return rehearsal;
}
