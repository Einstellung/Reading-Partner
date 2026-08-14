// Reading-position persistence, keyed by a book id (the content hash of the
// file, see library.ts) so the position follows the book across a move/rename
// and across devices. Recency is tracked per-topic (see topics.ts), so this no
// longer keeps a global recents list.

import { onFileWritten, readGuardedJson, writeTextAtomic } from "./atomic-fs";
import type { ViewState } from "./reader-contract";

// Exported so the pull route that drops the cache below can name it once
// (platform/sync/pull-routes.ts).
export const STATE_FILE = "reading-state.json";

// djb2 — stable key from an absolute path, filesystem-safe. Now only the legacy
// key: it's what the old path-hash-keyed data was stored under, so the content
// migration (migrate.ts) uses it to find that data. New data keys off the book
// id (content hash).
export function hashPath(path: string): string {
  let h = 5381;
  for (let i = 0; i < path.length; i++) {
    h = ((h << 5) + h + path.charCodeAt(i)) >>> 0;
  }
  return h.toString(16);
}

interface Store {
  states: Record<string, ViewState>;
}

// Base used only when persisting the sticky mode flags on a book with no saved
// reading position yet; the reader overwrites the position fields as soon as it
// emits one.
const DEFAULT_VIEW_STATE: ViewState = {
  pageIndex: 0,
  scale: "auto",
  scrollMode: 0,
};

// Pure: merge the sticky mode flags into a view state (or a default base when
// the book has none yet). Kept pure so the persistence logic is testable. The
// parameter is structural rather than a domain type because platform/app imports
// nothing.
export function withModes(state: ViewState | null, modes: { classroom: boolean }): ViewState {
  return { ...(state ?? DEFAULT_VIEW_STATE), classroom: modes.classroom };
}

// One file holds every book's position, and every save rewrites all of it. So a
// read that failed must not be answered with an empty map: the next scroll would
// write it back and reading-state.json would hold the book that happens to be
// open and nothing else. Unparseable content is quarantined and an empty map is
// then the truth about what is left; a file that could not be read at all stays
// where it is and saving is refused until a later read succeeds.
async function load(): Promise<{ store: Store; writable: boolean }> {
  const read = await readGuardedJson<Store>(STATE_FILE, (raw) => {
    const parsed = raw as Store | null;
    return parsed && typeof parsed === "object" && parsed.states ? parsed : null;
  });
  if (read.status === "ok") return hold(read.value, true);
  if (read.status === "missing") return hold({ states: {} }, true);
  // Quarantined: an empty map is what is left. Not quarantined: this is not the
  // truth about the file, only what could be got, so it is not held either.
  return hold({ states: {} }, read.savedAs !== null);
}

// The map as this device last saw it, kept for one purpose: the way out of the
// app (docs/13). pagehide suspends the webview with no second chance, and a
// read-then-write there is not only two IPCs — a read that fails writes nothing
// at all, losing the last position of the session, which is the reason that path
// exists. A map already reconciled with the file can be written out whole,
// because at exit there is no second writer.
//
// It is only ever as old as the last read or write of the file, because
// anything else replacing the file drops it: every text write in the app goes
// through writeTextAtomic, so the key migration (migrate.ts) and a sync pull
// both announce themselves below.
//
// The announcement has to be the write and not the end of the pass that did it.
// A sync pass writes reading-state.json in the middle — mergeOne writes the
// merged bytes, then the remaining merges, every upload, the base seeding and
// the books channel all run before onPulled is dispatched, and a pass that
// throws anywhere in there dispatches nothing at all. Held across that window,
// this map would be written back over the merge at exit, and the flattened file
// then reads as local-changed against remote-unchanged, which reconcile calls an
// upload: the other device downloads it.
//
// What is left is the ordinary lost update, which predates this map and is not
// its to fix: a save whose read happened before a sync write and whose write
// happens after it drops the merged positions either way.
let cached: Store | null = null;

// Anyone's write of the file, this module's own included; save() below puts the
// map back straight after its own, since what it just wrote is what the file
// now says.
onFileWritten((path) => {
  if (path === STATE_FILE) cached = null;
});

function hold(store: Store, writable: boolean): { store: Store; writable: boolean } {
  if (writable) cached = store;
  return { store, writable };
}

/** What a pull that rewrote reading-state.json calls (sync/pull-routes.ts). */
export function dropViewStateCache(): void {
  cached = null;
}

async function save(store: Store): Promise<void> {
  await writeTextAtomic(STATE_FILE, JSON.stringify(store, null, 2));
  // After the write and not before: the write drops the map through the
  // listener above, and this is what restores it. A write that threw leaves
  // whatever was held, which for every caller here is this same object.
  cached = store;
}

export async function getViewState(bookId: string): Promise<ViewState | null> {
  const { store } = await load();
  return store.states[bookId] ?? null;
}

export async function saveViewState(bookId: string, state: ViewState): Promise<void> {
  const { store, writable } = await load();
  if (!writable) {
    throw new Error(`${STATE_FILE} could not be read; refusing to overwrite it`);
  }
  store.states[bookId] = state;
  await save(store);
}

/**
 * saveViewState on the way out of the app: one IPC when this session has already
 * seen the file, and the ordinary read-then-write when it has not — which still
 * refuses to write over a file it could not read.
 */
export async function saveViewStateOnExit(bookId: string, state: ViewState): Promise<void> {
  const held = cached;
  if (!held) return saveViewState(bookId, state);
  held.states[bookId] = state;
  await save(held);
}
