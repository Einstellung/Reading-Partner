// Reading a day of cables. Pure, unit-tested; the files are store.ts next door.

import { CABLES_VERSION, type Cable, type CableDay, type CableHit } from "./types";

/**
 * The day's cables that hit one room, in the order the run filed them — which
 * is the order the analyst is handed them in, so two runs over one day read the
 * same way.
 */
export function cablesForLab(day: CableDay, labId: string): Cable[] {
  return day.cables.filter((c) => c.hits.some((h) => h.labId === labId));
}

/** A stored day read back. Null when the bytes are not one. */
export function parseCableDay(raw: unknown): CableDay | null {
  if (!isObject(raw)) return null;
  if (raw.version !== CABLES_VERSION) return null;
  if (typeof raw.date !== "string" || raw.date === "") return null;
  if (!Array.isArray(raw.cables)) return null;
  const cables: Cable[] = [];
  for (const entry of raw.cables) {
    const cable = readCable(entry);
    if (cable) cables.push(cable);
  }
  return { version: CABLES_VERSION, date: raw.date, cables };
}

function readCable(entry: unknown): Cable | null {
  if (!isObject(entry)) return null;
  for (const field of ["id", "date", "title", "url", "source", "sourceName", "publishedAt"]) {
    if (typeof entry[field] !== "string") return null;
  }
  if (entry.id === "") return null;
  const hits: CableHit[] = [];
  for (const h of Array.isArray(entry.hits) ? entry.hits : []) {
    if (!isObject(h) || typeof h.labId !== "string" || h.labId === "") continue;
    const observables = Array.isArray(h.observables)
      ? h.observables.filter((o): o is string => typeof o === "string")
      : [];
    hits.push({ labId: h.labId, observables });
  }
  return { ...(entry as unknown as Cable), hits };
}

function isObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}
