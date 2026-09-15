// The box store: one item per file under box/, and the three things anybody
// does to one — put it in, read it, move its state.
//
// Two devices write this directory and neither can lock it, so the store is
// thin the way the run store beside it is: it reads a file, decides, and writes
// the file back whole. What happens when both wrote the same file is not here
// at all — that is merge.ts, and sync runs it. So everything written here is
// written to be mergeable: `revision` goes up on every write, the cover is
// written once at birth and never revised, and an exit is never left.
//
// The file system is injected. The default reads and writes AppData; the tests
// hand in a Map.
//
// Nothing holds an item between calls. A pull that lands another device's copy
// is therefore seen by the next read, and the list on screen is redrawn on the
// sync tick — there is no in-process cache for it to go stale against.
// `subscribe` covers the other direction only: a write made in this process,
// so the screen that made it does not wait for a tick.

import { appData } from "../platform/app/appdata";
import { asBoxItem } from "./merge";
import { isExit, isOpen, type BoxItem, type BoxItemState, type BoxOrigin } from "./types";

export const BOX_DIR = "box";

/** What the store needs of a disk. */
export interface BoxIo {
  /** The file names in the box directory. Empty when there is no directory. */
  list(): Promise<string[]>;
  /** A file's text, or null when it is not there. */
  read(name: string): Promise<string | null>;
  /** Written whole, and atomically: a half-written item is one nobody can merge. */
  write(name: string, contents: string): Promise<void>;
}

// An item id has to be a file name, and it is also what the palace row matches
// on (palace/kinds.ts).
const ID = /^b-[0-9a-f]{32}$/;

function fileName(id: string): string {
  return `${id}.json`;
}

function idOf(name: string): string | null {
  if (!name.endsWith(".json")) return null;
  const id = name.slice(0, -".json".length);
  return ID.test(id) ? id : null;
}

/** An item has no key of its own to derive from, so its id is random. */
export function randomBoxItemId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return `b-${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

/** Everything about an item that is settled before it is in the box. */
export interface PutBoxItemInput {
  boxId: string;
  source: "run" | "cable";
  /** One line. Written now and never rewritten. */
  cover: string;
  /** A reference to the full body. Never the text. */
  body?: string;
  origin: BoxOrigin;
  kind?: string;
  runId?: string;
  /** Defaults to false. */
  needsDecision?: boolean;
  /** Defaults to now. */
  at?: number;
  /** An id the caller has already made. Otherwise one is made here. */
  id?: string;
}

export interface BoxFilter {
  boxId?: string;
  state?: BoxItemState | readonly BoxItemState[];
  source?: "run" | "cable";
}

/** A write made in this process, so the screen that made it can redraw. */
export type BoxListener = (item: BoxItem) => void;

export interface BoxStore {
  /**
   * Put one item in the box, in `in-box`. An id already taken is handed back
   * untouched: the cover is written once, so a second put of the same item is
   * not a second cover.
   */
  put(input: PutBoxItemInput): Promise<BoxItem>;
  get(id: string): Promise<BoxItem | null>;
  /** Every item, newest first. */
  list(filter?: BoxFilter): Promise<BoxItem[]>;
  /** The items the reader has not finished with, newest first. */
  open(filter?: BoxFilter): Promise<BoxItem[]>;
  /** How many of those there are — the number on the box. */
  openCount(filter?: BoxFilter): Promise<number>;
  /**
   * Move an item's state. One write, one more revision. An exit is final, so a
   * `told` arriving after a `dismissed` is refused; the refusal is silent in
   * the sense that it is not an error — the item comes back unchanged, and a
   * caller that cares compares `state` or `revision` with what it passed. The
   * same rule is what the merge applies across two devices.
   *
   * A state that is already the one on the file writes nothing and comes back
   * as it is: saying the same thing twice is not a new generation for the merge
   * to weigh.
   */
  setState(id: string, state: BoxItemState, at?: number): Promise<BoxItem | null>;
  /** Hear about writes made in this process. Returns the undo. */
  subscribe(listener: BoxListener): () => void;
}

function matches(item: BoxItem, filter: BoxFilter): boolean {
  if (filter.boxId !== undefined && item.boxId !== filter.boxId) return false;
  if (filter.source !== undefined && item.source !== filter.source) return false;
  if (filter.state !== undefined) {
    const want = typeof filter.state === "string" ? [filter.state] : filter.state;
    if (!want.includes(item.state)) return false;
  }
  return true;
}

export function createBoxStore(io: BoxIo): BoxStore {
  const listeners = new Set<BoxListener>();

  function announce(item: BoxItem): void {
    for (const listener of [...listeners]) listener(item);
  }

  // Read back from disk rather than from what this process remembers writing: a
  // pull may have landed the other device's copy since.
  async function get(id: string): Promise<BoxItem | null> {
    if (!ID.test(id)) return null;
    const text = await io.read(fileName(id));
    if (text === null) return null;
    try {
      const item = asBoxItem(JSON.parse(text));
      return item && item.id === id ? item : null;
    } catch {
      return null;
    }
  }

  async function put(item: BoxItem): Promise<BoxItem> {
    await io.write(fileName(item.id), JSON.stringify(item, null, 2));
    announce(item);
    return item;
  }

  async function all(filter: BoxFilter): Promise<BoxItem[]> {
    const items: BoxItem[] = [];
    for (const name of await io.list()) {
      const id = idOf(name);
      if (!id) continue;
      const item = await get(id);
      // A file that will not parse is not an item anybody can act on. It is
      // left where it is: deleting it would take the only evidence of what went
      // wrong with it.
      if (item && matches(item, filter)) items.push(item);
    }
    // Newest first, and the id breaks the tie so two devices draw one order.
    items.sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id));
    return items;
  }

  return {
    async put(input) {
      const at = input.at ?? Date.now();
      const id = input.id ?? randomBoxItemId();
      if (!ID.test(id)) throw new Error(`box: "${id}" is not a usable item id`);

      const already = await get(id);
      if (already) return already;

      const item: BoxItem = {
        id,
        boxId: input.boxId,
        source: input.source,
        cover: input.cover,
        origin: input.origin,
        needsDecision: input.needsDecision ?? false,
        createdAt: at,
        state: "in-box",
        stateAt: at,
        revision: 1,
      };
      if (input.body !== undefined) item.body = input.body;
      if (input.kind !== undefined) item.kind = input.kind;
      if (input.runId !== undefined) item.runId = input.runId;
      return put(item);
    },

    get,

    list: (filter = {}) => all(filter),

    async open(filter = {}) {
      return (await all(filter)).filter((item) => isOpen(item.state));
    },

    async openCount(filter = {}) {
      return (await all(filter)).filter((item) => isOpen(item.state)).length;
    },

    async setState(id, state, at) {
      const item = await get(id);
      if (!item) return null;
      if (isExit(item.state) || item.state === state) return item;
      return put({ ...item, state, stateAt: at ?? Date.now(), revision: item.revision + 1 });
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** The box directory on this device. */
export const appBoxIo: BoxIo = {
  async list() {
    const entries = await appData.readDir(BOX_DIR).catch(() => []);
    return entries.filter((e) => e.isFile).map((e) => e.name);
  },
  async read(name) {
    const path = `${BOX_DIR}/${name}`;
    if (!(await appData.exists(path))) return null;
    return appData.readText(path).catch(() => null);
  },
  async write(name, contents) {
    await appData.mkdirp(BOX_DIR);
    await appData.writeAtomic(`${BOX_DIR}/${name}`, contents);
  },
};

let live: BoxStore | undefined;

/** The store a delivery puts items in and the reader's list is drawn from. */
export function appBox(): BoxStore {
  live ??= createBoxStore(appBoxIo);
  return live;
}
