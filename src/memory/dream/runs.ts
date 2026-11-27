// Which devices ran a night, and when (docs/48).
//
// One file per device under dream-runs/, written by that device alone, so two
// devices that both ran write two files rather than one conflict. Synced: the
// file exists so that the device opened second learns, once its first sync
// pass has landed, that the first one already ran. Two devices opened within
// minutes of each other can both run; that costs one extra night and nothing
// stops it.

export const DREAM_RUNS_DIR = "dream-runs";

export function dreamRunPath(deviceId: string): string {
  return `${DREAM_RUNS_DIR}/${deviceId}.json`;
}

export interface DreamRunRecord {
  deviceId: string;
  /** When this device last started a night. */
  lastRunAt: number;
}

/** A record, or null for a file that is not one. */
export function parseDreamRun(text: string): DreamRunRecord | null {
  try {
    const raw = JSON.parse(text) as Partial<DreamRunRecord>;
    if (typeof raw.deviceId !== "string" || typeof raw.lastRunAt !== "number") return null;
    return { deviceId: raw.deviceId, lastRunAt: raw.lastRunAt };
  } catch {
    return null;
  }
}

/** The latest night any device started, this one's own state included. */
export function latestDreamRun(
  ownLastRunAt: number | null,
  records: readonly DreamRunRecord[],
): number | null {
  let latest = ownLastRunAt;
  for (const r of records) if (latest === null || r.lastRunAt > latest) latest = r.lastRunAt;
  return latest;
}
