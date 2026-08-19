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

import {
  BaseDirectory,
  exists,
  mkdir,
  readTextFile,
} from "@tauri-apps/plugin-fs";
import { writeTextAtomic } from "../../../platform/app/atomic-fs";
import { NOTES_VERSION, type NotesState } from "./types";

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

async function ensureNotesDir(bookId: string): Promise<void> {
  await mkdir(dirFor(bookId), { baseDir: BaseDirectory.AppData, recursive: true });
}

// Missing state is normal (notes never generated); a corrupt or stale-version
// state reads as null so the pipeline starts fresh instead of crashing.
export async function loadNotesState(bookId: string): Promise<NotesState | null> {
  try {
    if (!(await exists(stateFile(bookId), { baseDir: BaseDirectory.AppData }))) return null;
    const parsed = JSON.parse(
      await readTextFile(stateFile(bookId), { baseDir: BaseDirectory.AppData }),
    ) as NotesState;
    if (!parsed || parsed.version !== NOTES_VERSION) return null;
    return parsed;
  } catch (e) {
    console.warn("failed to read notes state", e);
    return null;
  }
}

export async function saveNotesState(state: NotesState): Promise<void> {
  await ensureNotesDir(state.bookId);
  await writeTextAtomic(stateFile(state.bookId), JSON.stringify(state, null, 2));
}

export async function writeChapterNote(bookId: string, index: number, body: string): Promise<void> {
  await ensureNotesDir(bookId);
  await writeTextAtomic(chapterFile(bookId, index), `${body.trim()}\n`);
}

export async function readChapterNote(bookId: string, index: number): Promise<string | null> {
  try {
    if (!(await exists(chapterFile(bookId, index), { baseDir: BaseDirectory.AppData }))) return null;
    return await readTextFile(chapterFile(bookId, index), { baseDir: BaseDirectory.AppData });
  } catch (e) {
    console.warn("failed to read chapter note", e);
    return null;
  }
}

export async function writeOverviewNote(bookId: string, body: string): Promise<void> {
  await ensureNotesDir(bookId);
  await writeTextAtomic(overviewFile(bookId), `${body.trim()}\n`);
}

export async function readOverviewNote(bookId: string): Promise<string | null> {
  try {
    if (!(await exists(overviewFile(bookId), { baseDir: BaseDirectory.AppData }))) return null;
    return await readTextFile(overviewFile(bookId), { baseDir: BaseDirectory.AppData });
  } catch (e) {
    console.warn("failed to read overview note", e);
    return null;
  }
}
