// Reading-position persistence, keyed by a book id (the content hash of the
// file, see library.ts) so the position follows the book across a move/rename
// and across devices. Recency is tracked per-topic (see topics.ts), so this no
// longer keeps a global recents list.

import {
  onFileWritten,
  readGuardedJson,
  writeTextAtomic,
  type GuardedRead,
} from "./atomic-fs";
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

/** Every book's position, which is what the one file holds. */
export interface ViewStateFile {
  states: Record<string, ViewState>;
}

// Everything the store reaches outside itself, passed in rather than imported,
// so a test can build one against its own file. The listener is not in here:
// the process singleton at the bottom subscribes, and a store built for a test
// does not, because onFileWritten's registry is another piece of process state
// and a store nobody unsubscribes would accumulate in it.
export interface ViewStateIo {
  // The guarded read, so the quarantine policy stays in atomic-fs.
  read: () => Promise<GuardedRead<ViewStateFile>>;
  write: (contents: string) => Promise<void>;
}

export interface ViewStateStore {
  get: (bookId: string) => Promise<ViewState | null>;
  save: (bookId: string, state: ViewState) => Promise<void>;
  saveOnExit: (bookId: string, state: ViewState) => Promise<void>;
  /** Forget one book's position, for good: the book was deleted. */
  remove: (bookId: string) => Promise<void>;
  /** Forget the held map: a pull rewrote the file, or anything else did. */
  drop: () => void;
}

export function createViewStateStore(io: ViewStateIo): ViewStateStore {
  // The map as this device last saw it, kept for one purpose: the way out of
  // the app (docs/13). pagehide suspends the webview with no second chance, and
  // a read-then-write there is not only two IPCs — a read that fails writes
  // nothing at all, losing the last position of the session, which is the
  // reason that path exists. A map already reconciled with the file can be
  // written out whole, because at exit there is no second writer.
  //
  // It is only ever as old as the last read or write of the file, because
  // anything else replacing the file drops it: every text write in the app goes
  // through writeTextAtomic, so the key migration (migrate.ts) and a sync pull
  // both announce themselves to the listener the singleton registers below.
  //
  // The announcement has to be the write and not the end of the pass that did
  // it. A sync pass writes reading-state.json in the middle — mergeOne writes
  // the merged bytes, then the remaining merges, every upload, the base seeding
  // and the books channel all run before onPulled is dispatched, and a pass that
  // throws anywhere in there dispatches nothing at all. Held across that window,
  // this map would be written back over the merge at exit, and the flattened
  // file then reads as local-changed against remote-unchanged, which reconcile
  // calls an upload: the other device downloads it.
  //
  // What is left is the ordinary lost update, which predates this map and is not
  // its to fix: a save whose read happened before a sync write and whose write
  // happens after it drops the merged positions either way.
  let cached: ViewStateFile | null = null;

  function hold(store: ViewStateFile): ViewStateFile {
    cached = store;
    return store;
  }

  // One file holds every book's position, and every save rewrites all of it. So
  // a read that failed must not be answered with an empty map: the next scroll
  // would write it back and reading-state.json would hold the book that happens
  // to be open and nothing else. Unparseable content is quarantined and an empty
  // map is then the truth about what is left; a file that is there and could not
  // be read at all raises, which is what leaves it where it is — every save
  // below loads first.
  async function load(): Promise<ViewStateFile> {
    const read = await io.read();
    if (read.status === "ok") return hold(read.value);
    if (read.status === "missing") return hold({ states: {} });
    if (read.savedAs === null) throw new Error(`${STATE_FILE} could not be read`);
    return hold({ states: {} });
  }

  async function save(store: ViewStateFile): Promise<void> {
    await io.write(JSON.stringify(store, null, 2));
    // After the write and not before: the write drops the map through the
    // listener the singleton registers, and this is what restores it. A write
    // that threw leaves whatever was held, which for every caller here is this
    // same object.
    cached = store;
  }

  async function saveOne(bookId: string, state: ViewState): Promise<void> {
    const store = await load();
    store.states[bookId] = state;
    await save(store);
  }

  return {
    get: async (bookId) => (await load()).states[bookId] ?? null,
    save: saveOne,
    // saveViewState on the way out of the app: one IPC when this session has
    // already seen the file, and the ordinary read-then-write when it has not —
    // which still refuses to write over a file it could not read.
    saveOnExit: async (bookId, state) => {
      const held = cached;
      if (!held) return saveOne(bookId, state);
      held.states[bookId] = state;
      await save(held);
    },
    // A book with no position in the file is already in the state this asks
    // for, and writing the file again would only cost a sync revision.
    remove: async (bookId) => {
      const store = await load();
      if (!(bookId in store.states)) return;
      delete store.states[bookId];
      await save(store);
    },
    drop: () => {
      cached = null;
    },
  };
}

const store = createViewStateStore({
  read: () =>
    readGuardedJson<ViewStateFile>(STATE_FILE, (raw) => {
      const parsed = raw as ViewStateFile | null;
      return parsed && typeof parsed === "object" && parsed.states ? parsed : null;
    }),
  write: (contents) => writeTextAtomic(STATE_FILE, contents),
});

// Anyone's write of the file, this module's own included; the store puts the map
// back straight after its own. That is right whenever ours is the last write of
// the turn, and wrong when a foreign write lands between ours and the save's
// continuation: both listeners null the map, then the save puts our pre-merge
// copy back. The window is one turn wide and the loss is the merged positions,
// the same ones the ordinary lost update above already concedes.
//
// Only the singleton subscribes. A store a test builds has no listener to take
// down, so building one does not grow a registry nothing empties.
onFileWritten((path) => {
  if (path === STATE_FILE) store.drop();
});

/** What a pull that rewrote reading-state.json calls (sync/pull-routes.ts). */
export function dropViewStateCache(): void {
  store.drop();
}

export function getViewState(bookId: string): Promise<ViewState | null> {
  return store.get(bookId);
}

export function saveViewState(bookId: string, state: ViewState): Promise<void> {
  return store.save(bookId, state);
}

/**
 * saveViewState on the way out of the app: one IPC when this session has already
 * seen the file, and the ordinary read-then-write when it has not — which still
 * refuses to write over a file it could not read.
 */
export function saveViewStateOnExit(bookId: string, state: ViewState): Promise<void> {
  return store.saveOnExit(bookId, state);
}

/** Drop a deleted book's position (reading/delete/delete-book.ts). */
export function removeViewState(bookId: string): Promise<void> {
  return store.remove(bookId);
}
