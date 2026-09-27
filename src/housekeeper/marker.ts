// Garbage markers: what decides, each night, which files have outlived their
// retention (docs/80).
//
// A marker looks and says; it never touches the disk. What it reads comes
// through MarkReadIo, which has no write in it, and what it hands back is a list
// the housekeeper executes (execute.ts). Marks are not kept anywhere: the next
// night computes them again from the disk, so a grace period is a timestamp the
// disk already holds, never a mark written down and waited on.
//
// Domains register their markers at startup (bootDomains), the way they
// register distillation sources. A marker may only mark paths whose palace row
// names it in its retention; the executor refuses anything else.

/** What becomes of one marked path. */
export type MarkAction =
  /** The file goes, sync-safely for a synced kind. */
  | "delete"
  /** The file keeps its last `keepLines` lines. Local kinds only. */
  | "truncate-tail"
  /** Moved to a local, unsynced cold layer. Defined; nothing implements it yet. */
  | "demote-local";

export interface Mark {
  /** AppData-relative, forward slashes. A file, never a directory. */
  path: string;
  action: MarkAction;
  /** Set for truncate-tail: how many lines stay. */
  keepLines?: number;
  /** One line a person reading the housekeeper log can check against the disk. */
  reason: string;
}

/** A mark with the marker that made it, as the executor receives it. */
export interface MarkedBy extends Mark {
  marker: string;
}

/** One directory entry, as a marker sees it. */
export interface MarkEntry {
  name: string;
  isFile: boolean;
}

/** What a marker may read. Nothing here writes. */
export interface MarkReadIo {
  /** A directory's entries; "" is AppData itself. Empty when it is not there. */
  list(dir: string): Promise<MarkEntry[]>;
  /** mtimeMs is 0 where the platform does not report one. Null when absent. */
  stat(path: string): Promise<{ mtimeMs: number; size: number } | null>;
  /** Null when the file is absent or will not read. */
  readText(path: string): Promise<string | null>;
}

export interface MarkContext {
  io: MarkReadIo;
  now: number;
}

export interface GarbageMarker {
  /** The name palace rows use in `{ rule: "marker", marker }`. */
  name: string;
  mark(ctx: MarkContext): Promise<readonly Mark[]>;
}

const markers = new Map<string, GarbageMarker>();

/**
 * Register a garbage marker. The same name again replaces it. Returns the undo,
 * for tests: the registry is one map for the whole process.
 */
export function registerGarbageMarker(marker: GarbageMarker): () => void {
  markers.set(marker.name, marker);
  return () => {
    if (markers.get(marker.name) === marker) markers.delete(marker.name);
  };
}

export function registeredGarbageMarkers(): GarbageMarker[] {
  return [...markers.values()];
}

export function garbageMarkerRegistered(name: string): boolean {
  return markers.has(name);
}
