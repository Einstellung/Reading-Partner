// Chapter-spine persistence under AppData: derived, rebuildable, and inside the
// document's own prep directory, because a document gets one kind of prep
// material and this is where the other kind already lives. Layout:
//   prep-<bookId>/chapters/state.json    — the chapter table and per-chapter
//                                          statuses (the resume point)
//   prep-<bookId>/chapters/overview.md   — the chapter graph
//   prep-<bookId>/chapters/chapter-NN.md — one spine per chapter (NN zero-padded)
// The bookId is the library.ts content hash — the same hash the paper side keys
// prep-<surveyHash>/ by, so a document has one prep directory whichever kind of
// material it turns out to need.

import { appData } from "../../../platform/app/appdata";
import { writeTextAtomic } from "../../../platform/app/atomic-fs";
import { CHAPTER_SPINE_VERSION, type ChapterSpineState } from "./types";

function dirFor(bookId: string): string {
  return `prep-${bookId}/chapters`;
}

function stateFile(bookId: string): string {
  return `${dirFor(bookId)}/state.json`;
}

export function chapterFileName(index: number): string {
  return `chapter-${String(index).padStart(2, "0")}.md`;
}

function chapterFile(bookId: string, index: number): string {
  return `${dirFor(bookId)}/${chapterFileName(index)}`;
}

function overviewFile(bookId: string): string {
  return `${dirFor(bookId)}/overview.md`;
}

async function ensureChapterSpineDir(bookId: string): Promise<void> {
  await appData.mkdirp(dirFor(bookId));
}

// Missing state is normal (the spine was never generated); a corrupt or stale-version
// state reads as null so the pipeline starts fresh instead of crashing.
export async function loadChapterSpineState(bookId: string): Promise<ChapterSpineState | null> {
  try {
    if (!(await appData.exists(stateFile(bookId)))) return null;
    const parsed = JSON.parse(await appData.readText(stateFile(bookId))) as ChapterSpineState;
    if (!parsed || parsed.version !== CHAPTER_SPINE_VERSION) return null;
    return parsed;
  } catch (e) {
    console.warn("failed to read chapter-spine state", e);
    return null;
  }
}

export async function saveChapterSpineState(state: ChapterSpineState): Promise<void> {
  await ensureChapterSpineDir(state.bookId);
  await writeTextAtomic(stateFile(state.bookId), JSON.stringify(state, null, 2));
}

export async function writeChapterSpine(bookId: string, index: number, body: string): Promise<void> {
  await ensureChapterSpineDir(bookId);
  await writeTextAtomic(chapterFile(bookId, index), `${body.trim()}\n`);
}

export async function readChapterSpine(bookId: string, index: number): Promise<string | null> {
  try {
    if (!(await appData.exists(chapterFile(bookId, index)))) return null;
    return await appData.readText(chapterFile(bookId, index));
  } catch (e) {
    console.warn("failed to read chapter note", e);
    return null;
  }
}

export async function writeSpineOverview(bookId: string, body: string): Promise<void> {
  await ensureChapterSpineDir(bookId);
  await writeTextAtomic(overviewFile(bookId), `${body.trim()}\n`);
}

export async function readSpineOverview(bookId: string): Promise<string | null> {
  try {
    if (!(await appData.exists(overviewFile(bookId)))) return null;
    return await appData.readText(overviewFile(bookId));
  } catch (e) {
    console.warn("failed to read overview note", e);
    return null;
  }
}
