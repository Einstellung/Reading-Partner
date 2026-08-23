// One channel for "this did not reach disk", shared by every store that writes
// one.
//
// Each store used to keep a single slot of its own — `let onError = () => {}`
// with an `onXSaveError` setter — six of them, and a second registration
// silently replaced the first rather than joining it. That shape is why App
// registered five of the six while PhoneApp registered two, and why nothing at
// all was listening for the figure index: the compiler cannot notice a handler
// that was never installed. A Set of subscribers and a closed set of scopes
// makes "who hears about a failed write" a question one file answers.
//
// platform/app imports nothing, so the user-facing sentence lives here rather
// than in the shell that draws it: a store says what failed, and the subscriber
// decides where the sentence goes (a toast, in both shells).

/** A data file that could not be read, and where the bad copy was put. */
export interface CorruptFileReport {
  /** The AppData-relative file that could not be read. */
  file: string;
  /** Where the bad copy was moved, or null when it could not be moved aside. */
  savedAs: string | null;
}

// A reset shelf or a lost provider config must never look like the app forgot on
// its own. The two branches are different promises: one file was moved aside,
// the other is still where it was and will not be written over.
export function corruptFileMessage({ file, savedAs }: CorruptFileReport): string {
  return savedAs
    ? `${file} was unreadable and has been set aside as ${savedAs}`
    : `${file} could not be read; it is left untouched and won't be overwritten`;
}

// Every store that can fail to persist. Closed on purpose: a new store has to
// decide here what its failure costs the user before it can report one.
export type StoreScope =
  | "settings"
  | "annotations"
  | "threads"
  | "reading-position"
  | "fulltext"
  | "figures"
  | "corrupt-file";

// The same set as a value, for the test that walks it. Kept in step with the
// union by the assertion below rather than by memory.
export const STORE_SCOPES = [
  "settings",
  "annotations",
  "threads",
  "reading-position",
  "fulltext",
  "figures",
  "corrupt-file",
] as const satisfies readonly StoreScope[];

// A member of StoreScope missing from STORE_SCOPES makes this type an error, so
// the list the test walks cannot fall behind the union it stands for.
type AssertNever<T extends never> = T;
export type AllScopesListed = AssertNever<Exclude<StoreScope, (typeof STORE_SCOPES)[number]>>;

interface ScopeCopy {
  // The console line, and the only one: a store that reports a failure does not
  // also log it, or the same failure is said twice. Null where the store has
  // already said more than this could (atomic-fs names the file and the parse
  // error, per file, before reporting).
  log: string | null;
  // How loud that line is. A lost write is an error; a lost derived cache is a
  // warning, since it is re-extracted from the document on demand.
  level: "error" | "warn";
  // What the user is told, or null when the failure costs work rather than
  // data and a warning would be noise.
  message: (error: unknown) => string | null;
}

const COPY: Record<StoreScope, ScopeCopy> = {
  settings: {
    log: "failed to persist settings",
    level: "error",
    message: () => "Settings could not be saved",
  },
  annotations: {
    log: "failed to persist annotations",
    level: "error",
    message: () => "Annotations could not be saved",
  },
  threads: {
    log: "failed to persist thread",
    level: "error",
    message: () => "AI conversation could not be saved",
  },
  "reading-position": {
    log: "failed to persist reading position",
    level: "error",
    message: () => "Reading position could not be saved",
  },
  // The two derived caches. Both are re-extracted from the document when they
  // are missing, so a failed write costs a second extraction, not a mark. A
  // cache that could not be read reports here too, so the line names either.
  fulltext: {
    log: "failed to read or persist the fulltext cache",
    level: "warn",
    message: () => null,
  },
  // Both halves of this one report here: an extraction that failed and a write
  // that failed cost the same second attempt, so the line covers either.
  figures: {
    log: "failed to build or persist the figure index",
    level: "warn",
    message: () => null,
  },
  // Not a failed write but a failed read, and the one scope whose sentence
  // depends on what happened: whether the bad copy could be moved aside.
  "corrupt-file": {
    log: null,
    level: "error",
    message: (error) => corruptFileMessage(error as CorruptFileReport),
  },
};

export interface StoreError {
  scope: StoreScope;
  // The thrown value, or the report for "corrupt-file".
  error: unknown;
  // The sentence to show, already chosen by scope. null means this one is worth
  // a log line and nothing more.
  message: string | null;
}

const listeners = new Set<(e: StoreError) => void>();

/**
 * Hear about every store failure. Returns the undo. A Set and not a slot: two
 * subscribers both get called, which is what a second shell, a smoke run or a
 * test needs.
 */
export function onStoreError(cb: (e: StoreError) => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** What a store calls when a write (or, for "corrupt-file", a read) failed. */
export function reportStoreError(scope: StoreScope, error: unknown): void {
  const copy = COPY[scope];
  if (copy.log !== null) {
    if (copy.level === "error") console.error(copy.log, error);
    else console.warn(copy.log, error);
  }
  const event: StoreError = { scope, error, message: copy.message(error) };
  // Iterated over a copy: a subscriber that unsubscribes itself while being
  // called must not skip the next one.
  for (const l of [...listeners]) l(event);
}
