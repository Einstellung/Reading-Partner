// Slides persistence under AppData/slides/ (docs/14). A generated deck is a
// self-contained HTML file; slides/talks.json indexes the decks. This directory
// is a build output, NOT synced (verified in tests/sync/range.test.ts — the
// sync range excludes slides/). Derived and rebuildable, same posture as the
// notes and prep stores.

import {
  BaseDirectory,
  exists,
  mkdir,
  readTextFile,
  writeTextFile,
} from "@tauri-apps/plugin-fs";
import { addTalk, type TalkEntry } from "./types";

export const SLIDES_DIR = "slides";
const TALKS_FILE = `${SLIDES_DIR}/talks.json`;
const opts = { baseDir: BaseDirectory.AppData } as const;

export function deckFile(id: string): string {
  return `${SLIDES_DIR}/${id}.html`;
}

async function ensureDir(): Promise<void> {
  await mkdir(SLIDES_DIR, { ...opts, recursive: true });
}

// Write a deck's HTML and return its AppData-relative path.
export async function writeDeck(id: string, html: string): Promise<string> {
  await ensureDir();
  const path = deckFile(id);
  await writeTextFile(path, html, opts);
  return path;
}

// The talk registry, newest last. Missing or corrupt reads as empty so a bad
// file never blocks generating a new deck.
export async function loadTalks(): Promise<TalkEntry[]> {
  try {
    if (!(await exists(TALKS_FILE, opts))) return [];
    const parsed = JSON.parse(await readTextFile(TALKS_FILE, opts));
    return Array.isArray(parsed) ? (parsed as TalkEntry[]) : [];
  } catch (e) {
    console.warn("failed to read talks.json", e);
    return [];
  }
}

// Append one talk to the registry.
export async function appendTalk(entry: TalkEntry): Promise<void> {
  await ensureDir();
  const talks = addTalk(await loadTalks(), entry);
  await writeTextFile(TALKS_FILE, JSON.stringify(talks, null, 2), opts);
}
