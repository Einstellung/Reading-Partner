// Source list persistence (docs/17): the user's subscribed sources, one JSON
// array under AppData, in sync range (info-sources.json travels between devices
// like info-profile.md). Everyone starts empty and onboarding fills it — no
// file means no sources, and the home card offers "Start subscribing" instead of
// a briefing. Per-source health is a derived sidecar (not synced).
//
// The list itself is read through readGuardedJson: a source is a descriptor the
// reader authored, nothing can rebuild it, and every mutation here is
// load-modify-save — so a read that failed must not become the list that gets
// written (docs/13, and the same shape that emptied a conversation file).
//
// There was a migration here that wrote two builtins into the list for anyone
// with older info data. It served users who do not exist — this app has never
// shipped a version without source lists — and it could only ever fire on a
// device with no info-sources.json at all, which is not what an existing user's
// device looks like.

import { appData } from "../../platform/app/appdata";
import {
  quarantineFile,
  readGuardedJson,
  writeTextAtomic,
  type CorruptFileReport,
  type GuardedRead,
} from "../../platform/app/atomic-fs";
import { reportStoreError } from "../../platform/app/store-errors";
import type { PullMatcher } from "../../platform/sync/pull-routes";
import { validateDescriptor, type SourceDescriptor } from "./descriptor";
import { parseSiteSessions, type SiteSessions } from "./site-session";
import type { SourceHealth } from "./engine";

export const SOURCES_FILE = "info-sources.json";

// A source subscribed or turned on from another device: the collector acts on it
// now rather than at the next wake, which can be half an hour away.
export const SOURCES_PULL_ROUTE: PullMatcher = {
  id: "sources",
  matches: (path) => path === SOURCES_FILE,
};
const HEALTH_FILE = "info-source-health.json";
const SESSIONS_FILE = "info-site-sessions.json";
// Last known sign-in state per site. Like the health sidecar it is derived and
// out of sync range — and here that is not an optimisation: the session it
// describes is a cookie in this device's webview profile, and copying the
// belief to another device would describe a session that device does not have.

// --- pure helpers (unit-tested) --------------------------------------------

// One file's worth of subscriptions: the descriptors this build understands,
// and the entries it does not.
export interface ParsedSources {
  sources: SourceDescriptor[];
  // Entries with an id that validateDescriptor turns down — a descriptor a newer
  // build on another device wrote, a field this one has never heard of. They are
  // still the reader's subscriptions and they still carry the id the sync merge
  // keys on, so a write from here carries them through instead of deleting them
  // on the other device's behalf.
  foreign: unknown[];
  // True when the file held an entry no writer here produces: one with no id, or
  // a second entry under an id already taken. Those are in neither list, so the
  // bytes are set aside before the next write replaces them.
  repaired: boolean;
}

// Read the entries out of a parsed info-sources.json. Null when it is not an
// array — not this writer's shape at all, which readGuardedJson quarantines.
//
// An entry without a usable id is the one thing that cannot be carried:
// readCollection (platform/sync/merge/records.ts) turns down a whole file that
// holds one, and the merge then copies one device's file over the other's, which
// loses real subscriptions. It stays in the quarantined copy instead.
export function parseSources(raw: unknown): ParsedSources | null {
  if (!Array.isArray(raw)) return null;
  const sources: SourceDescriptor[] = [];
  const foreign: unknown[] = [];
  const seen = new Set<string>();
  let repaired = false;
  for (const entry of raw) {
    const id = entryId(entry);
    if (id === "" || seen.has(id)) {
      repaired = true;
      continue;
    }
    seen.add(id);
    const res = validateDescriptor(entry);
    if (res.ok) sources.push(res.descriptor);
    else foreign.push(entry);
  }
  return { sources, foreign, repaired };
}

// The identity of a stored entry, whatever else is wrong with it. "" when there
// is none.
function entryId(entry: unknown): string {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return "";
  const id = (entry as { id?: unknown }).id;
  return typeof id === "string" ? id : "";
}

// --- filesystem ------------------------------------------------------------

// The file access this store needs, as a parameter. A test hands it an
// in-memory AppData instead of rewriting the module registry with mock.module,
// which rewrites it for every other test file in the same worker (pitfall 119).
// Every exported call takes it last and defaults to the real one, so callers
// pass nothing.
export interface SourcesIo {
  read(
    file: string,
    validate: (raw: unknown) => SourceDescriptor[] | null,
  ): Promise<GuardedRead<SourceDescriptor[]>>;
  write(file: string, contents: string): Promise<void>;
  quarantine(file: string): Promise<string | null>;
  reportCorrupt(report: CorruptFileReport): void;
}

export const sourcesIo: SourcesIo = {
  read: readGuardedJson,
  write: writeTextAtomic,
  quarantine: quarantineFile,
  reportCorrupt: (report) => reportStoreError("corrupt-file", report),
};

// The subscriptions read, plus whether it is safe to write the result back. The
// list cannot be rebuilt from anywhere — a source is a descriptor the reader (or
// the AI, with the reader watching) authored — so one failed read must not turn
// the next toggle into "one source, the one being written". Content that does
// not parse is quarantined and a fresh list takes over; a file that could not be
// read at all is left alone and writing is refused until a later read succeeds.
async function readSources(io: SourcesIo): Promise<{ file: ParsedSources; writable: boolean }> {
  let parsed: ParsedSources = { sources: [], foreign: [], repaired: false };
  const read = await io.read(SOURCES_FILE, (raw) => {
    const res = parseSources(raw);
    if (res === null) return null;
    parsed = res;
    return res.sources;
  });
  if (read.status === "ok") return { file: parsed, writable: true };
  const empty: ParsedSources = { sources: [], foreign: [], repaired: false };
  if (read.status === "missing") return { file: empty, writable: true };
  return { file: empty, writable: read.savedAs !== null };
}

// Load the source list. No file is an empty list and stays one: onboarding owns
// first-source creation, so nothing here writes on a reader's behalf. A file
// that could not be read also reads as empty — the caller is showing a list, and
// the write paths below are the ones that must not act on it.
export async function loadSources(io: SourcesIo = sourcesIo): Promise<SourceDescriptor[]> {
  return (await readSources(io)).file.sources;
}

// Whether the user has any source configured. Drives the onboarding trigger
// (docs/17): false means show first-run source setup.
export async function hasSources(io: SourcesIo = sourcesIo): Promise<boolean> {
  return (await loadSources(io)).length > 0;
}

// Apply a change to the source list and write the file. `change` sees only the
// descriptors this build understands; entries it does not are written back
// unchanged, except where the new list took their id (a source re-added here
// replaces the copy that would not validate).
//
// Returns the list now on disk: the changed one when it was written, the one
// read otherwise, so a caller that renders what it gets back shows the file
// rather than a change that did not land.
async function mutate(
  io: SourcesIo,
  change: (list: SourceDescriptor[]) => SourceDescriptor[],
  removedId?: string,
): Promise<SourceDescriptor[]> {
  const { file, writable } = await readSources(io);
  if (!writable) return file.sources;
  const next = change(file.sources);
  const taken = new Set(next.map((s) => s.id));
  const foreign = file.foreign.filter((e) => {
    const id = entryId(e);
    return id !== removedId && !taken.has(id);
  });
  // An entry was left behind by the read: keep the bytes before replacing them,
  // and refuse the write when they could not be moved (they would then exist
  // nowhere).
  if (file.repaired) {
    let savedAs: string | null = null;
    try {
      savedAs = await io.quarantine(SOURCES_FILE);
    } catch (e) {
      console.error(`failed to quarantine ${SOURCES_FILE}`, e);
    }
    io.reportCorrupt({ file: SOURCES_FILE, savedAs });
    if (savedAs === null) return file.sources;
  }
  await io.write(SOURCES_FILE, JSON.stringify([...next, ...foreign], null, 2));
  return next;
}

export async function addSource(
  source: SourceDescriptor,
  io: SourcesIo = sourcesIo,
): Promise<SourceDescriptor[]> {
  return mutate(io, (list) => [...list.filter((s) => s.id !== source.id), source]);
}

export async function removeSource(
  id: string,
  io: SourcesIo = sourcesIo,
): Promise<SourceDescriptor[]> {
  return mutate(io, (list) => list.filter((s) => s.id !== id), id);
}

export async function updateSource(
  id: string,
  patch: Partial<SourceDescriptor>,
  io: SourcesIo = sourcesIo,
): Promise<SourceDescriptor[]> {
  return mutate(io, (list) => list.map((s) => (s.id === id ? { ...s, ...patch, id: s.id } : s)));
}

export async function setSourceEnabled(
  id: string,
  enabled: boolean,
  io: SourcesIo = sourcesIo,
): Promise<SourceDescriptor[]> {
  return updateSource(id, { enabled }, io);
}

// --- source health (derived sidecar, not synced) ---------------------------

export async function loadSourceHealth(): Promise<Record<string, SourceHealth>> {
  try {
    if (!(await appData.exists(HEALTH_FILE))) return {};
    return JSON.parse(await appData.readText(HEALTH_FILE)) as Record<string, SourceHealth>;
  } catch {
    return {};
  }
}

export async function saveSourceHealth(health: Record<string, SourceHealth>): Promise<void> {
  await writeTextAtomic(HEALTH_FILE, JSON.stringify(health));
}

// --- site sessions (derived sidecar, not synced) ---------------------------

export async function loadSiteSessions(): Promise<SiteSessions> {
  try {
    if (!(await appData.exists(SESSIONS_FILE))) return {};
    return parseSiteSessions(await appData.readText(SESSIONS_FILE));
  } catch {
    return {};
  }
}

export async function saveSiteSessions(sessions: SiteSessions): Promise<void> {
  await writeTextAtomic(SESSIONS_FILE, JSON.stringify(sessions));
}
