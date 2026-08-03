// Where a library card gets its cover images. STUB: the renderer that turns a
// PDF's first page into an <img src> lands as src/reading/covers.ts on another
// branch; until the two meet every cover resolves to null, which is the same
// answer a book with no readable first page gives and which the card already
// draws (a tinted cell with the title's first letter).
//
// The whole file is the seam. Replace its body with
//
//   export { coverUrl } from "../../../reading/covers";
//
// and nothing else in this directory changes. What the real one returns is a
// data: URI (nothing to revoke) rendered to a fixed width; the card crops it to
// the one shape every card on the page uses, so its own proportions do not
// matter. The first pass over a book has to hash it before it can cache, which
// is why the loading state on a cell is a state a user actually sees and not a
// flicker.

import type { FileRef } from "../../../platform/app/topics";

// A URL that can go straight into <img src>, or null when there is no cover.
export async function coverUrl(_file: FileRef): Promise<string | null> {
  return null;
}
