// A document's prep material as a set of files, for the two things that act on
// all of it at once: deleting the document, and a translation taking its place
// (delete-book.ts, retire-book.ts). Everything under prep-<id>/ is found by the directory; the
// downloaded papers' text and figure caches are not — they sit at the AppData
// root under a hash of a synthetic path (papers/store.ts: paperFulltextHash), so
// the only way to them is through the slugs in the prep state.

import { appData } from "../../platform/app/appdata";
import { paperFulltextHash } from "../prep/papers/store";
import { prepDir } from "../prep/store-base";

function fulltextFile(key: string): string {
  return `fulltext-${key}.json`;
}

function figuresFile(key: string): string {
  return `figures-${key}.json`;
}

/**
 * Pure: the slugs a paper prep state names. Tolerant of any version and of
 * content that does not parse, which names none.
 */
export function paperSlugsOf(stateText: string | null): string[] {
  if (!stateText) return [];
  try {
    const parsed = JSON.parse(stateText) as { papers?: unknown };
    if (!Array.isArray(parsed.papers)) return [];
    return parsed.papers
      .map((p) => (p && typeof p === "object" ? (p as { slug?: unknown }).slug : undefined))
      .filter((s): s is string => typeof s === "string" && s !== "");
  } catch {
    return [];
  }
}

/** Pure: the cache files of the papers a document's prep downloaded. */
export function paperCacheFilesOf(documentId: string, slugs: readonly string[]): string[] {
  return slugs.flatMap((slug) => {
    const key = paperFulltextHash(documentId, slug);
    return [fulltextFile(key), figuresFile(key)];
  });
}

/**
 * Pure: a prep state file rewritten to name another document. The paper state
 * carries `surveyHash`, the chapter state `bookId`; savePrepState writes to the
 * directory the state names, so a moved state that kept the old id would put
 * the next write back under the old directory. Null when it does not parse.
 */
export function renamedPrepState(text: string, field: "surveyHash" | "bookId", toId: string): string | null {
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object" || !(field in parsed)) return null;
    return JSON.stringify({ ...parsed, [field]: toId }, null, 2);
  } catch {
    return null;
  }
}

export interface PrepFilesIo {
  exists(path: string): Promise<boolean>;
  readText(path: string): Promise<string>;
  writeText(path: string, text: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
}

const liveIo: PrepFilesIo = {
  exists: (p) => appData.exists(p),
  readText: (p) => appData.readText(p),
  writeText: (p, t) => appData.writeAtomic(p, t),
  rename: (a, b) => appData.rename(a, b),
};

async function readIfPresent(io: PrepFilesIo, path: string): Promise<string | null> {
  return (await io.exists(path)) ? io.readText(path) : null;
}

/** The paper caches of a document's prep, read off its state before it goes. */
export async function prepPaperCacheFiles(
  documentId: string,
  io: PrepFilesIo = liveIo,
): Promise<string[]> {
  const state = await readIfPresent(io, `${prepDir(documentId)}/state.json`);
  return paperCacheFilesOf(documentId, paperSlugsOf(state));
}

/**
 * Move a document's prep material to another document id: the directory, the
 * ids inside its two state files, and the paper caches keyed through it.
 * Nothing is moved onto prep that is already there. Answers whether it moved.
 */
export async function movePrep(
  fromId: string,
  toId: string,
  io: PrepFilesIo = liveIo,
): Promise<boolean> {
  const from = prepDir(fromId);
  const to = prepDir(toId);
  if (fromId === toId || !(await io.exists(from)) || (await io.exists(to))) return false;
  const slugs = paperSlugsOf(await readIfPresent(io, `${from}/state.json`));
  await io.rename(from, to);

  for (const [file, field] of [
    [`${to}/state.json`, "surveyHash"],
    [`${to}/chapters/state.json`, "bookId"],
  ] as const) {
    const text = await readIfPresent(io, file);
    const next = text === null ? null : renamedPrepState(text, field, toId);
    if (next !== null) await io.writeText(file, next);
  }

  const olds = paperCacheFilesOf(fromId, slugs);
  const news = paperCacheFilesOf(toId, slugs);
  for (let i = 0; i < olds.length; i++) {
    if ((await io.exists(olds[i])) && !(await io.exists(news[i]))) await io.rename(olds[i], news[i]);
  }
  return true;
}
