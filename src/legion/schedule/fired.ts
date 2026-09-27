// What this device has already fired for, one entry per schedule: the anchor
// it last rang a bell for.
//
// Local and per device (palace kind "schedule-state", sync "local"). It is not
// how two machines agree — the election is — it is how one machine does not
// fire twice for the same hour after a restart or a suspended timer.
//
// The file system is injected, as the bell store's and the claim store's are.

import { appData } from "../../platform/app/appdata";

export const SCHEDULE_DIR = "legion/schedule";
export const FIRED_FILE = `${SCHEDULE_DIR}/fired.json`;

/** What the store needs of a disk. */
export interface FiredIo {
  read(): Promise<string | null>;
  write(contents: string): Promise<void>;
}

export const appFiredIo: FiredIo = {
  async read() {
    try {
      if (!(await appData.exists(FIRED_FILE))) return null;
      return await appData.readText(FIRED_FILE);
    } catch {
      return null;
    }
  },
  async write(contents) {
    await appData.mkdirp(SCHEDULE_DIR);
    await appData.writeAtomic(FIRED_FILE, contents);
  },
};

export interface FiredStore {
  read(): Promise<Record<string, number>>;
  /** Write down that this device has dealt with `anchor` for `scheduleId`. */
  record(scheduleId: string, anchor: number): Promise<void>;
}

export function createFiredStore(io: FiredIo): FiredStore {
  // Held in memory as well as on disk, for the reason info's morning round
  // holds its date: a file that will not write costs the schedule's bells, not
  // one bell per tick.
  //
  // The memo is the promise, not the map: two ticks at a cold launch must
  // share one disk read, or the slower one lands after a record and puts the
  // stale copy back (pitfall 484). Each record chains on the map before it,
  // and writes go out in record order, so the last write holds every record.
  let map: Promise<Record<string, number>> | null = null;
  let writes: Promise<void> = Promise.resolve();

  async function load(): Promise<Record<string, number>> {
    const text = await io.read().catch(() => null);
    let parsed: unknown = null;
    try {
      parsed = text === null ? null : JSON.parse(text);
    } catch {
      parsed = null;
    }
    const out: Record<string, number> = {};
    if (parsed && typeof parsed === "object") {
      for (const [id, at] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof at === "number" && Number.isFinite(at)) out[id] = at;
      }
    }
    return out;
  }

  function read(): Promise<Record<string, number>> {
    map ??= load();
    return map;
  }

  return {
    read,
    record(scheduleId, anchor) {
      const merged = read().then((all) => ({ ...all, [scheduleId]: anchor }));
      map = merged;
      writes = writes.then(async () => {
        const all = await merged;
        try {
          await io.write(JSON.stringify(all, null, 2));
        } catch (e) {
          console.warn("failed to write down the schedule that fired", e);
        }
      });
      return writes;
    },
  };
}

let live: FiredStore | undefined;

export function appFired(): FiredStore {
  live ??= createFiredStore(appFiredIo);
  return live;
}
