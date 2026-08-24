// Slides persistence under AppData/slides/ (docs/14, docs/29). Layout:
//   slides/talks.json                  — the deck registry (one row per talk)
//   slides/<talkId>/state.json         — the run state (the resume point)
//   slides/<talkId>/slide-NN.html      — one slide body, sanitized fragment
//   slides/<talkId>/asset-NN.txt       — that slide's resolved asset (data: URL)
//   slides/<talkId>-<slug>.html        — the assembled deck
//
// One directory per talk, same shape as prep-<bookId>/chapters/: the bodies and assets
// are the expensive part, so they live on disk and assemble is pure assembly —
// read what is there, write a deck — which is what makes re-running one page
// (or just re-assembling) possible.
//
// The deck itself stays a flat file next to the directory rather than inside it
// because the opener capability scope is $APPDATA/slides/* (one path segment),
// and the deck is the file the user opens.
//
// Not synced, and it stays that way (asserted in tests/platform/sync/range.test.ts).
// state.json alone rebuilds nothing: the substance is the slide bodies and the
// base64 assets beside it, megabytes of derived data. Syncing the index without
// them would show the other device a "done" deck whose files are not there.

import { appDataDir, join } from "@tauri-apps/api/path";
import { openPath } from "@tauri-apps/plugin-opener";
import { appData } from "../../platform/app/appdata";
import { writeTextAtomic } from "../../platform/app/atomic-fs";
import {
  SLIDES_VERSION,
  upsertTalk,
  type SlidesState,
  type TalkEntry,
} from "./types";

export const SLIDES_DIR = "slides";
const TALKS_FILE = `${SLIDES_DIR}/talks.json`;

export function talkDir(talkId: string): string {
  return `${SLIDES_DIR}/${talkId}`;
}

export function stateFile(talkId: string): string {
  return `${talkDir(talkId)}/state.json`;
}

export function fragmentFile(talkId: string, index: number): string {
  return `${talkDir(talkId)}/slide-${String(index).padStart(2, "0")}.html`;
}

export function assetFile(talkId: string, index: number): string {
  return `${talkDir(talkId)}/asset-${String(index).padStart(2, "0")}.txt`;
}

export function deckFile(talkId: string, slug: string): string {
  return `${SLIDES_DIR}/${talkId}-${slug}.html`;
}

async function ensureDir(dir: string): Promise<void> {
  await appData.mkdirp(dir);
}

async function readIfExists(path: string): Promise<string | null> {
  try {
    if (!(await appData.exists(path))) return null;
    return await appData.readText(path);
  } catch (e) {
    console.warn("failed to read", path, e);
    return null;
  }
}

// Missing state is normal (this talk was never started); a corrupt or
// stale-version state reads as null so the caller starts a fresh talk instead of
// crashing. Same posture as loadChapterSpineState.
export async function loadSlidesState(talkId: string): Promise<SlidesState | null> {
  const text = await readIfExists(stateFile(talkId));
  if (text === null) return null;
  try {
    const parsed = JSON.parse(text) as SlidesState;
    if (!parsed || parsed.version !== SLIDES_VERSION || !Array.isArray(parsed.slides)) return null;
    return parsed;
  } catch (e) {
    console.warn("failed to parse slides state", talkId, e);
    return null;
  }
}

export async function saveSlidesState(state: SlidesState): Promise<void> {
  await ensureDir(talkDir(state.id));
  await writeTextAtomic(stateFile(state.id), JSON.stringify(state, null, 2));
}

// Every talk that has a state on disk, newest first — the talks that can be
// resumed or re-run.
export async function listSlidesStates(): Promise<SlidesState[]> {
  let entries;
  try {
    entries = await appData.readDir(SLIDES_DIR);
  } catch {
    return []; // no slides directory yet
  }
  const out: SlidesState[] = [];
  for (const e of entries) {
    if (!e.isDirectory || !e.name) continue;
    const st = await loadSlidesState(e.name);
    if (st) out.push(st);
  }
  out.sort((a, b) => b.createdAt - a.createdAt);
  return out;
}

export async function writeFragment(talkId: string, index: number, html: string): Promise<void> {
  await ensureDir(talkDir(talkId));
  await writeTextAtomic(fragmentFile(talkId, index), html);
}

export function readFragment(talkId: string, index: number): Promise<string | null> {
  return readIfExists(fragmentFile(talkId, index));
}

// Write the slide's resolved asset, or drop the file when the asset is gone: a
// re-run that produced nothing must not leave the previous image behind.
export async function writeAsset(
  talkId: string,
  index: number,
  dataUrl: string | null,
): Promise<void> {
  const path = assetFile(talkId, index);
  if (dataUrl === null) {
    try {
      if (await appData.exists(path)) await appData.remove(path);
    } catch (e) {
      console.warn("failed to drop asset", path, e);
    }
    return;
  }
  await ensureDir(talkDir(talkId));
  await writeTextAtomic(path, dataUrl);
}

export function readAsset(talkId: string, index: number): Promise<string | null> {
  return readIfExists(assetFile(talkId, index));
}

// Write a deck's HTML and return its AppData-relative path.
export async function writeDeck(talkId: string, slug: string, html: string): Promise<string> {
  await ensureDir(SLIDES_DIR);
  const path = deckFile(talkId, slug);
  await writeTextAtomic(path, html);
  return path;
}

// The talk registry, newest last. Missing or corrupt reads as empty so a bad
// file never blocks generating a new deck.
export async function loadTalks(): Promise<TalkEntry[]> {
  const text = await readIfExists(TALKS_FILE);
  if (text === null) return [];
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? (parsed as TalkEntry[]) : [];
  } catch (e) {
    console.warn("failed to parse talks.json", e);
    return [];
  }
}

// Record one talk in the registry, replacing the row with the same talk id.
export async function recordTalk(entry: TalkEntry): Promise<void> {
  await ensureDir(SLIDES_DIR);
  const talks = upsertTalk(await loadTalks(), entry);
  await writeTextAtomic(TALKS_FILE, JSON.stringify(talks, null, 2));
}

// Read a built deck back as text, by the AppData-relative path the registry
// holds. This is what the in-app rehearsal embeds (docs/31): the deck is
// self-contained, so the whole file is the whole thing to show — several
// megabytes of it, most of that base64 images. Missing or unreadable reads as
// null, the same as every other read here.
export function readDeckHtml(file: string): Promise<string | null> {
  return readIfExists(file);
}

// Hand a built deck to the system's default handler. Not live.ts's openDeck,
// which starts a deck run: this one spends nothing and only reveals a file that
// is already built.
//
// The registry stores the deck as a path relative to AppData, and the opener
// capability is scoped to $APPDATA/slides/*, so the absolute path has to be
// rebuilt here — the one place that knows where a deck file lives.
//
// Returns null when it opened and the message to show when it did not: every
// caller is a view that puts the failure on screen, and there is nothing for it
// to retry.
export async function revealDeckFile(file: string): Promise<string | null> {
  try {
    await openPath(await join(await appDataDir(), file));
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : "Could not open the deck";
  }
}
