// Source list persistence (docs/17): the user's subscribed sources, one JSON
// array under AppData, in sync range (info-sources.json travels between devices
// like info-profile.md). Everyone starts empty and onboarding fills it — no
// file means no sources, and the home card offers "Start subscribing" instead of
// a briefing. Per-source health is a derived sidecar (not synced). The pure part
// (parse/validate) is unit-tested; the fs wrappers mirror profile.ts.
//
// There was a migration here that wrote two builtins into the list for anyone
// with older info data. It served users who do not exist — this app has never
// shipped a version without source lists — and it could only ever fire on a
// device with no info-sources.json at all, which is not what an existing user's
// device looks like.

import { BaseDirectory, exists, readTextFile } from "@tauri-apps/plugin-fs";
import { writeTextAtomic } from "../../platform/app/atomic-fs";
import { validateDescriptor, type SourceDescriptor } from "./descriptor";
import type { SourceHealth } from "./engine";

export const SOURCES_FILE = "info-sources.json";
const HEALTH_FILE = "info-source-health.json";

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

// --- filesystem ------------------------------------------------------------

export async function saveSources(sources: SourceDescriptor[]): Promise<void> {
  await writeTextAtomic(SOURCES_FILE, JSON.stringify(sources, null, 2));
}

// Load the source list. No file is an empty list and stays one: onboarding owns
// first-source creation, so nothing here writes on a reader's behalf.
export async function loadSources(): Promise<SourceDescriptor[]> {
  try {
    if (await exists(SOURCES_FILE, { baseDir: BaseDirectory.AppData })) {
      return parseSources(await readTextFile(SOURCES_FILE, { baseDir: BaseDirectory.AppData }));
    }
  } catch {
    return [];
  }
  return [];
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
  await writeTextAtomic(HEALTH_FILE, JSON.stringify(health));
}
