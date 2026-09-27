// The housekeeper's night (docs/80): ask every marker, then carry out what they
// marked. Every device runs it for its own disk, once a night, as a nightly job
// on legion/schedule's clock — the shell registers HOUSEKEEPER_JOB at startup.

import { appData } from "../platform/app/appdata";
import { requestRemotePurge } from "../platform/sync";
import type { PalaceRow } from "../palace";
import { executeMarks, type ExecuteIo, type ExecuteResult, type HousekeeperLogLine } from "./execute";
import { genericMarker } from "./generic";
import { registeredGarbageMarkers, type GarbageMarker, type MarkedBy, type MarkReadIo } from "./marker";

/** The local, unsynced log: one line per mark (palace kind "housekeeper-log"). */
export const HOUSEKEEPER_LOG = "housekeeper-log.jsonl";

/**
 * Remote purges one night may ask for. Each is a Drive request on the next sync
 * pass; what is over waits for the next night, still on disk and marked again.
 */
export const REMOTE_PURGES_PER_NIGHT = 100;

export const appMarkReadIo: MarkReadIo = {
  async list(dir) {
    try {
      return (await appData.readDir(dir === "" ? "." : dir)).map((e) => ({
        name: e.name,
        isFile: e.isFile,
      }));
    } catch {
      return [];
    }
  },
  async stat(path) {
    try {
      return await appData.stat(path);
    } catch {
      return null;
    }
  },
  async readText(path) {
    try {
      return await appData.readText(path);
    } catch {
      return null;
    }
  },
};

export const appExecuteIo: ExecuteIo = {
  remove: (path) => appData.remove(path),
  readText: appMarkReadIo.readText,
  writeAtomic: (path, contents) => appData.writeAtomic(path, contents),
  purgeRemote: (paths) => requestRemotePurge(paths),
  log: (line: HousekeeperLogLine) => appData.appendText(HOUSEKEEPER_LOG, `${JSON.stringify(line)}\n`),
};

export interface HousekeeperDeps {
  now?: number;
  readIo?: MarkReadIo;
  executeIo?: ExecuteIo;
  /** The generic marker plus everything registered, unless a test hands its own. */
  markers?: readonly GarbageMarker[];
  rows?: readonly PalaceRow[];
  remoteBudget?: number;
}

/** Collect the marks of every marker. A marker that throws costs its own marks only. */
export async function collectMarks(
  markers: readonly GarbageMarker[],
  io: MarkReadIo,
  now: number,
): Promise<MarkedBy[]> {
  const out: MarkedBy[] = [];
  for (const marker of markers) {
    try {
      for (const mark of await marker.mark({ io, now })) out.push({ ...mark, marker: marker.name });
    } catch (e) {
      console.warn(`housekeeper: the marker ${marker.name} failed`, e);
    }
  }
  return out;
}

/** One night's pass. Never throws. */
export async function runHousekeeper(deps: HousekeeperDeps = {}): Promise<ExecuteResult | null> {
  const now = deps.now ?? Date.now();
  try {
    const markers = deps.markers ?? [genericMarker(deps.rows), ...registeredGarbageMarkers()];
    const marks = await collectMarks(markers, deps.readIo ?? appMarkReadIo, now);
    return await executeMarks(marks, deps.executeIo ?? appExecuteIo, {
      now,
      remoteBudget: deps.remoteBudget ?? REMOTE_PURGES_PER_NIGHT,
      ...(deps.rows ? { rows: deps.rows } : {}),
    });
  } catch (e) {
    console.warn("housekeeper: the night's pass failed", e);
    return null;
  }
}

/**
 * The nightly job the shell registers with legion/schedule. Four in the
 * morning, after dream's three: nothing depends on the order today, but a
 * marker gated on a distillation watermark will want the night's pass done.
 */
export const HOUSEKEEPER_JOB = {
  id: "housekeeper",
  at: { daily: { hour: 4 } },
  run: async (): Promise<void> => {
    await runHousekeeper();
  },
};
