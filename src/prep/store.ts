// Prep persistence under AppData, same posture as the fulltext cache: derived,
// rebuildable, one directory per survey. Layout:
//   prep-<surveyHash>/state.json     — plan + per-paper statuses (the resume point)
//   prep-<surveyHash>/<slug>.md      — one note per paper
//   prep-<surveyHash>/pdf/<slug>.pdf — downloaded paper PDFs
// Paper full texts reuse the fulltext cache keyed by a synthetic path.

import {
  BaseDirectory,
  exists,
  mkdir,
  readFile,
  readTextFile,
  writeFile,
  writeTextFile,
} from "@tauri-apps/plugin-fs";
import { hashPath } from "../app/storage";
import { PREP_VERSION, type PrepState } from "./types";

function dirFor(hash: string): string {
  return `prep-${hash}`;
}

function stateFile(hash: string): string {
  return `${dirFor(hash)}/state.json`;
}

function noteFile(hash: string, slug: string): string {
  return `${dirFor(hash)}/${slug}.md`;
}

function pdfFile(hash: string, slug: string): string {
  return `${dirFor(hash)}/pdf/${slug}.pdf`;
}

// The synthetic path that keys a prepped paper's fulltext cache entry (fed
// through the same djb2 path hash as real documents).
export function paperCachePath(surveyHash: string, slug: string): string {
  return `prep://${surveyHash}/${slug}`;
}

export function paperFulltextHash(surveyHash: string, slug: string): string {
  return hashPath(paperCachePath(surveyHash, slug));
}

async function ensurePrepDir(hash: string): Promise<void> {
  await mkdir(dirFor(hash), { baseDir: BaseDirectory.AppData, recursive: true });
}

// Missing state is normal (prep never started); a corrupt or stale-version
// state reads as null so the pipeline replans instead of crashing.
export async function loadPrepState(hash: string): Promise<PrepState | null> {
  try {
    if (!(await exists(stateFile(hash), { baseDir: BaseDirectory.AppData }))) return null;
    const parsed = JSON.parse(
      await readTextFile(stateFile(hash), { baseDir: BaseDirectory.AppData }),
    ) as PrepState;
    if (!parsed || parsed.version !== PREP_VERSION) return null;
    return parsed;
  } catch (e) {
    console.warn("failed to read prep state", e);
    return null;
  }
}

export async function savePrepState(state: PrepState): Promise<void> {
  await ensurePrepDir(state.surveyHash);
  await writeTextFile(stateFile(state.surveyHash), JSON.stringify(state, null, 2), {
    baseDir: BaseDirectory.AppData,
  });
}

export async function writePrepNote(hash: string, slug: string, content: string): Promise<void> {
  await ensurePrepDir(hash);
  await writeTextFile(noteFile(hash, slug), content, { baseDir: BaseDirectory.AppData });
}

export async function readPrepNote(hash: string, slug: string): Promise<string | null> {
  try {
    if (!(await exists(noteFile(hash, slug), { baseDir: BaseDirectory.AppData }))) return null;
    return await readTextFile(noteFile(hash, slug), { baseDir: BaseDirectory.AppData });
  } catch (e) {
    console.warn("failed to read prep note", e);
    return null;
  }
}

export async function writePaperPdf(hash: string, slug: string, bytes: ArrayBuffer): Promise<void> {
  await mkdir(`${dirFor(hash)}/pdf`, { baseDir: BaseDirectory.AppData, recursive: true });
  await writeFile(pdfFile(hash, slug), new Uint8Array(bytes), {
    baseDir: BaseDirectory.AppData,
  });
}

export async function readPaperPdf(hash: string, slug: string): Promise<ArrayBuffer | null> {
  try {
    if (!(await exists(pdfFile(hash, slug), { baseDir: BaseDirectory.AppData }))) return null;
    const bytes = await readFile(pdfFile(hash, slug), { baseDir: BaseDirectory.AppData });
    return bytes.slice().buffer as ArrayBuffer;
  } catch (e) {
    console.warn("failed to read cached paper pdf", e);
    return null;
  }
}
