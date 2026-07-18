// Notes persistence under AppData, same posture as the prep store: derived,
// rebuildable, one directory per book. Layout:
//   notes-<bookId>/state.json      — plan + per-chapter statuses (the resume point)
//   notes-<bookId>/overview.md     — the whole-book framework
//   notes-<bookId>/chapter-NN.md   — one note per chapter (NN zero-padded)
// The bookId is the library.ts content hash.

import {
  BaseDirectory,
  exists,
  mkdir,
  readTextFile,
  writeTextFile,
} from "@tauri-apps/plugin-fs";
import { NOTES_VERSION, type NotesState } from "./types";

function dirFor(bookId: string): string {
  return `notes-${bookId}`;
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
  await writeTextFile(stateFile(state.bookId), JSON.stringify(state, null, 2), {
    baseDir: BaseDirectory.AppData,
  });
}

export async function writeChapterNote(bookId: string, index: number, body: string): Promise<void> {
  await ensureNotesDir(bookId);
  await writeTextFile(chapterFile(bookId, index), `${body.trim()}\n`, {
    baseDir: BaseDirectory.AppData,
  });
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
  await writeTextFile(overviewFile(bookId), `${body.trim()}\n`, { baseDir: BaseDirectory.AppData });
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
