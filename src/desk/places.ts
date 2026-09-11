// Where the reader can be taken (docs/67). The shell knows how to navigate; this
// is the table it hands over — one sentence per place saying what it is for, and
// a `go()` that takes the reader there. Where the soul goes, the desk changes,
// so the places belong beside the registry of what can lie on a desk rather
// than inside any one domain.
//
// One set at a time, and the whole set at once. A shell registers what it has
// when it mounts and registers it again when the callbacks it closed over
// change, and the second registration replaces the first instead of adding to
// it: two tables of the same places would take the reader somewhere through a
// callback the shell has already forgotten. Only one shell runs in an app, so
// there is nothing to merge. Two places sharing an id inside one set is a wiring
// mistake and throws — the model is handed ids, and an id that means two places
// means neither.

export interface Place {
  id: string;
  // One sentence, in the reader's language: what this place is for. It is what
  // the soul reads out when it introduces the app, so it says what is there
  // rather than which screen draws it.
  about: string;
  go(): void | Promise<void>;
}

let PLACES: readonly Place[] = [];

/** Register the shell's places, replacing whatever was registered before. */
export function registerPlaces(places: readonly Place[]): () => void {
  const seen = new Set<string>();
  for (const place of places) {
    if (seen.has(place.id)) {
      throw new Error(`desk: two places share the id "${place.id}"`);
    }
    seen.add(place.id);
  }
  const set = [...places];
  PLACES = set;
  return () => {
    if (PLACES === set) PLACES = [];
  };
}

/** The places there are, in the order the shell registered them. */
export function listPlaces(): readonly Place[] {
  return PLACES;
}
