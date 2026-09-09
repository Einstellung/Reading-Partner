// Reading a briefing file back, whichever shape it was written in. Pure,
// unit-tested; the files are store.ts and publish.ts next door.
//
// Two shapes exist on disk and only one of them is rendered. A device still on
// the triage build publishes its briefing into sync range, so a phone upgraded
// today can pull one written yesterday by a desktop that has not been upgraded
// yet. Normalizing it here — the overview becomes the one nameless cover, the
// filtered pile and the screen tally go — is what keeps that out of every page
// and every prompt: past this function there is one shape.

import type { CableDay } from "../cable/types";
import type { LabOutcome } from "../collect/run-state";
import type { InfoItem } from "../sources/item";
import {
  BRIEFING_VERSION,
  type Briefing,
  type BriefingItemMeta,
  type LabCover,
  type MustRead,
  type OneLiner,
  type OutOfLane,
} from "./types";

// What one day boxes into a briefing: the rooms as the run knew them, what each
// of the ones that ran handed back, the day's cables, and the items behind them.
export interface BoxInput {
  date: string;
  generatedAt: number;
  // The open rooms, in roster order — which is the order the briefing is cut in.
  labs: readonly { id: string; name: string }[];
  outcomes: readonly LabOutcome[];
  cables: CableDay;
  items: readonly InfoItem[];
}

/**
 * The day, cut by room (docs/63 呈现).
 *
 * Covers on top, in roster order; the rooms that ran and had nothing named
 * underneath them; then every room's picks, concatenated in the same order. An
 * item two rooms both picked appears once, under the first room that asked for
 * it — the reader is reading the article, not the filing.
 *
 * `items` carries only what the briefing points at. A screened-out headline is
 * not in here at all any more: what the day discarded is nobody's business.
 */
export function boxBriefing(input: BoxInput): Briefing {
  const byLab = new Map(input.outcomes.map((o) => [o.labId, o]));
  const known = new Set(input.cables.cables.map((c) => c.id));
  const labs: LabCover[] = [];
  const quiet: string[] = [];
  const mustRead: MustRead[] = [];
  const oneLiners: OneLiner[] = [];
  const taken = new Set<string>();
  for (const lab of input.labs) {
    const outcome = byLab.get(lab.id);
    if (!outcome) {
      // A room with no outcome either had no cables or its analysis did not come
      // back. Neither is something to report, and both leave the room quiet.
      quiet.push(lab.name);
      continue;
    }
    if (outcome.cover) labs.push(outcome.cover);
    else quiet.push(outcome.name);
    for (const r of outcome.mustRead) {
      if (!known.has(r.itemId) || taken.has(r.itemId)) continue;
      taken.add(r.itemId);
      mustRead.push(r);
    }
  }
  for (const lab of input.labs) {
    for (const r of byLab.get(lab.id)?.oneLiners ?? []) {
      if (!known.has(r.itemId) || taken.has(r.itemId)) continue;
      taken.add(r.itemId);
      oneLiners.push(r);
    }
  }
  // The day's one out-of-lane cable, which the screen already cut to one.
  const outside = input.cables.cables.find((c) => c.outside);
  const outOfLane: OutOfLane[] =
    outside && !taken.has(outside.id) ? [{ itemId: outside.id, reason: outside.outside! }] : [];
  for (const r of outOfLane) taken.add(r.itemId);
  return {
    version: BRIEFING_VERSION,
    date: input.date,
    generatedAt: input.generatedAt,
    labs,
    quiet,
    mustRead,
    oneLiners,
    outOfLane,
    items: itemsMeta(input.items, taken),
  };
}

function itemsMeta(
  items: readonly InfoItem[],
  wanted: Set<string>,
): Record<string, BriefingItemMeta> {
  const out: Record<string, BriefingItemMeta> = {};
  for (const it of items) {
    if (!wanted.has(it.id)) continue;
    out[it.id] = {
      title: it.title,
      url: it.url,
      source: it.source,
      sourceName: it.sourceName,
      publishedAt: it.publishedAt,
    };
  }
  return out;
}

/** A stored briefing read back, or null when the bytes are not one. */
export function parseBriefing(raw: unknown): Briefing | null {
  if (!isObject(raw)) return null;
  if (typeof raw.date !== "string" || raw.date === "") return null;
  if (typeof raw.generatedAt !== "number") return null;
  return {
    version: BRIEFING_VERSION,
    date: raw.date,
    generatedAt: raw.generatedAt,
    labs: readLabs(raw),
    quiet: readStrings(raw.quiet),
    mustRead: readList(raw.mustRead, (o) =>
      typeof o.reason === "string" ? { reason: o.reason, ...labId(o) } : null,
    ),
    oneLiners: readList(raw.oneLiners, (o) =>
      typeof o.line === "string" ? { line: o.line, ...labId(o) } : null,
    ),
    outOfLane: readList(raw.outOfLane, (o) =>
      typeof o.reason === "string" ? { reason: o.reason } : null,
    ),
    items: readItems(raw.items),
  };
}

// The rooms that changed. A legacy briefing has one overview and no rooms at
// all, which becomes a single cover under no room: it is still the sentence the
// reader was given for that day, and the page has one place to put it.
function readLabs(raw: Record<string, unknown>): LabCover[] {
  if (Array.isArray(raw.labs)) {
    const out: LabCover[] = [];
    for (const entry of raw.labs) {
      if (!isObject(entry)) continue;
      if (typeof entry.cover !== "string" || entry.cover === "") continue;
      out.push({
        labId: typeof entry.labId === "string" ? entry.labId : "",
        name: typeof entry.name === "string" ? entry.name : "",
        cover: entry.cover,
        judgments: readStrings(entry.judgments),
      });
    }
    return out;
  }
  const overview = typeof raw.overview === "string" ? raw.overview.trim() : "";
  return overview ? [{ labId: "", name: "", cover: overview, judgments: [] }] : [];
}

function labId(o: Record<string, unknown>): { labId?: string } {
  return typeof o.labId === "string" && o.labId !== "" ? { labId: o.labId } : {};
}

// One tier, keeping only the entries that name an item this build can render.
function readList<T>(
  raw: unknown,
  rest: (o: Record<string, unknown>) => Omit<T, "itemId"> | null,
): T[] {
  if (!Array.isArray(raw)) return [];
  const out: T[] = [];
  for (const entry of raw) {
    if (!isObject(entry)) continue;
    if (typeof entry.itemId !== "string" || entry.itemId === "") continue;
    const tail = rest(entry);
    if (tail) out.push({ itemId: entry.itemId, ...tail } as T);
  }
  return out;
}

function readItems(raw: unknown): Record<string, BriefingItemMeta> {
  if (!isObject(raw)) return {};
  const out: Record<string, BriefingItemMeta> = {};
  for (const [id, entry] of Object.entries(raw)) {
    if (!isObject(entry)) continue;
    out[id] = {
      title: str(entry.title),
      url: str(entry.url),
      source: str(entry.source),
      sourceName: str(entry.sourceName),
      publishedAt: str(entry.publishedAt),
    };
  }
  return out;
}

function readStrings(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.filter((s): s is string => typeof s === "string") : [];
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function isObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

/**
 * The day in prose, for a caller that has one line to put it on: the covers of
 * the rooms that changed, in order. "" on a day where nothing did.
 */
export function briefingOverview(b: Briefing): string {
  return b.labs.map((l) => l.cover).join(" ");
}
