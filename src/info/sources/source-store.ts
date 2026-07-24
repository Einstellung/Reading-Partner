// Source list persistence (docs/17): the user's subscribed sources, one JSON
// array under AppData, in sync range (info-sources.json travels between devices
// like info-profile.md). A new user starts empty (onboarding fills it); an
// existing user — detected by prior info data — is migrated to the two original
// builtins. Per-source health is a derived sidecar (not synced). The pure parts
// (parse/validate, migration decision) are unit-tested; the fs wrappers mirror
// profile.ts.

import {
  BaseDirectory,
  exists,
  readDir,
  readTextFile,
  writeTextFile,
} from "@tauri-apps/plugin-fs";
import { validateDescriptor, type SourceDescriptor } from "./descriptor";
import { builtinById } from "./builtins";
import type { SourceHealth } from "./engine";

export const SOURCES_FILE = "info-sources.json";
const HEALTH_FILE = "info-source-health.json";
// The signals that a device has been using the info feature before source lists
// existed: the seeded profile, or any generated briefing.
const PROFILE_FILE = "info-profile.md";

// --- pure helpers (unit-tested) --------------------------------------------

// Parse + validate a sources.json body, dropping any malformed descriptor so one
// bad entry never blanks the list.
export function parseSources(text: string): SourceDescriptor[] {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return [];
  }
  if (!Array.isArray(data)) return [];
  const out: SourceDescriptor[] = [];
  for (const raw of data) {
    const res = validateDescriptor(raw);
    if (res.ok) out.push(res.descriptor);
  }
  return out;
}

// The descriptors an existing user is migrated to: the two original builtins,
// enabled. A new user (no prior info data) gets an empty list — onboarding fills
// it. Pure so the migration policy is tested without the filesystem.
export function migratedSources(hasPriorInfoData: boolean): SourceDescriptor[] {
  if (!hasPriorInfoData) return [];
  const out: SourceDescriptor[] = [];
  for (const id of ["jiqizhixin", "qbitai"]) {
    const d = builtinById(id);
    if (d) out.push({ ...d, enabled: true });
  }
  return out;
}

// --- filesystem ------------------------------------------------------------

// True when this device shows signs of prior info use (a seeded profile or any
// past briefing), so the source list should be migrated rather than left empty.
async function hasPriorInfoData(): Promise<boolean> {
  try {
    if (await exists(PROFILE_FILE, { baseDir: BaseDirectory.AppData })) return true;
  } catch {
    // Fall through to the briefing scan.
  }
  try {
    const entries = await readDir("", { baseDir: BaseDirectory.AppData });
    return entries.some((e) => e.isFile && /^briefing-\d{4}-\d{2}-\d{2}\.json$/.test(e.name));
  } catch {
    return false;
  }
}

export async function saveSources(sources: SourceDescriptor[]): Promise<void> {
  await writeTextFile(SOURCES_FILE, JSON.stringify(sources, null, 2), {
    baseDir: BaseDirectory.AppData,
  });
}

// Load the source list. On first run (no file), migrate: an existing user gets
// the two original builtins written out; a new user gets an empty list and no
// file is written (onboarding owns first-source creation).
export async function loadSources(): Promise<SourceDescriptor[]> {
  try {
    if (await exists(SOURCES_FILE, { baseDir: BaseDirectory.AppData })) {
      return parseSources(await readTextFile(SOURCES_FILE, { baseDir: BaseDirectory.AppData }));
    }
  } catch {
    return [];
  }
  const migrated = migratedSources(await hasPriorInfoData());
  if (migrated.length) await saveSources(migrated);
  return migrated;
}

// Whether the user has any source configured. Drives the onboarding trigger
// (docs/17): false means show first-run source setup.
export async function hasSources(): Promise<boolean> {
  return (await loadSources()).length > 0;
}

export async function addSource(source: SourceDescriptor): Promise<SourceDescriptor[]> {
  const list = await loadSources();
  const next = [...list.filter((s) => s.id !== source.id), source];
  await saveSources(next);
  return next;
}

export async function removeSource(id: string): Promise<SourceDescriptor[]> {
  const next = (await loadSources()).filter((s) => s.id !== id);
  await saveSources(next);
  return next;
}

export async function updateSource(
  id: string,
  patch: Partial<SourceDescriptor>,
): Promise<SourceDescriptor[]> {
  const next = (await loadSources()).map((s) => (s.id === id ? { ...s, ...patch, id: s.id } : s));
  await saveSources(next);
  return next;
}

export async function setSourceEnabled(id: string, enabled: boolean): Promise<SourceDescriptor[]> {
  return updateSource(id, { enabled });
}

// --- source health (derived sidecar, not synced) ---------------------------

export async function loadSourceHealth(): Promise<Record<string, SourceHealth>> {
  try {
    if (!(await exists(HEALTH_FILE, { baseDir: BaseDirectory.AppData }))) return {};
    return JSON.parse(
      await readTextFile(HEALTH_FILE, { baseDir: BaseDirectory.AppData }),
    ) as Record<string, SourceHealth>;
  } catch {
    return {};
  }
}

export async function saveSourceHealth(health: Record<string, SourceHealth>): Promise<void> {
  await writeTextFile(HEALTH_FILE, JSON.stringify(health), { baseDir: BaseDirectory.AppData });
}
