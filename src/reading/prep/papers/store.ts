// Prep persistence under AppData, same posture as the fulltext cache: derived,
// rebuildable, one directory per survey. Layout:
//   prep-<surveyHash>/state.json     — plan + per-paper statuses (the resume point)
//   prep-<surveyHash>/<slug>.md      — one note per paper
//   prep-<surveyHash>/pdf/<slug>.pdf — downloaded paper PDFs
// Paper full texts reuse the fulltext cache keyed by a synthetic path.

import { appData } from "../../../platform/app/appdata";
import { writeTextAtomic } from "../../../platform/app/atomic-fs";
import { hashPath } from "../../../platform/app/storage";
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
  await appData.mkdirp(dirFor(hash));
}

// Missing state is normal (prep never started); a corrupt or stale-version
// state reads as null so the pipeline replans instead of crashing.
export async function loadPrepState(hash: string): Promise<PrepState | null> {
  try {
    if (!(await appData.exists(stateFile(hash)))) return null;
    const parsed = JSON.parse(await appData.readText(stateFile(hash))) as PrepState;
    if (!parsed || parsed.version !== PREP_VERSION) return null;
    return parsed;
  } catch (e) {
    console.warn("failed to read prep state", e);
    return null;
  }
}

export async function savePrepState(state: PrepState): Promise<void> {
  await ensurePrepDir(state.surveyHash);
  await writeTextAtomic(stateFile(state.surveyHash), JSON.stringify(state, null, 2));
}

export async function writePrepNote(hash: string, slug: string, content: string): Promise<void> {
  await ensurePrepDir(hash);
  await writeTextAtomic(noteFile(hash, slug), content);
}

export async function readPrepNote(hash: string, slug: string): Promise<string | null> {
  try {
    if (!(await appData.exists(noteFile(hash, slug)))) return null;
    return await appData.readText(noteFile(hash, slug));
  } catch (e) {
    console.warn("failed to read prep note", e);
    return null;
  }
}

export async function writePaperPdf(hash: string, slug: string, bytes: ArrayBuffer): Promise<void> {
  await appData.mkdirp(`${dirFor(hash)}/pdf`);
  await appData.writeBytes(pdfFile(hash, slug), new Uint8Array(bytes));
}

export async function readPaperPdf(hash: string, slug: string): Promise<ArrayBuffer | null> {
  try {
    if (!(await appData.exists(pdfFile(hash, slug)))) return null;
    const bytes = await appData.readBytes(pdfFile(hash, slug));
    return bytes.slice().buffer as ArrayBuffer;
  } catch (e) {
    console.warn("failed to read cached paper pdf", e);
    return null;
  }
}
