// What a study's brief in the reader (docs/info/91 「版本」, info/issue/study-reader.ts)
// is wired to in the app: the info shelf, the study's record, its result file,
// the runs in flight, the cached material bodies, and the marks. None of it
// runs under bun.

import { INFO_SHELF_FILE, parseShelf } from "../../../../info/issue/types";
import { ITEM_CLASS, itemAnchorId, itemOfAnchorId } from "../../../../info/issue/study-cites";
import { excerptBody, excerptInBook } from "../../../../info/issue/study-excerpts";
import {
  materialBodyPaths,
  sameItemIn,
  studyBookContext,
  updatingTo,
  type StudyBookContext,
} from "../../../../info/issue/study-reader";
import type { MaterialBody } from "../../../../info/dossier/registry";
import { parseResultFile, type TopicSearchResult } from "../../../../info/topic-search/result-types";
import { TOPIC_SEARCH_KIND } from "../../../../info/topic-search/run";
import { addRollback, loadStudy } from "../../../../info/topic-search/study";
import { appRuns } from "../../../../legion/run";
import { loadAnnotations, saveAnnotations } from "../../../../platform/app/annotations";
import { appData } from "../../../../platform/app/appdata";
import { getLibraryEntry, readLibraryBook } from "../../../../platform/app/library";
import { isPageMark, type Annotation } from "../../../../platform/app/reader-contract";
import { parseEpub } from "../../../../reading/epub/file/parse";
import { carryMarksByBlock, type MarkRecord } from "../../../../reading/replace/carry-marks";

async function readText(path: string): Promise<string | null> {
  try {
    return (await appData.exists(path)) ? await appData.readText(path) : null;
  } catch {
    return null;
  }
}

export interface StudyReaderData {
  ctx: StudyBookContext;
  result: TopicSearchResult | null;
  /** The version an update in flight is making; null when none is. */
  updating: number | null;
}

/** Everything the reader's study chrome draws from; null when the book is no study version. */
export async function loadStudyReader(bookId: string): Promise<StudyReaderData | null> {
  const shelf = parseShelf(await readText(INFO_SHELF_FILE));
  const first = studyBookContext(shelf, bookId, []);
  if (!first) return null;
  const [study, library] = await Promise.all([
    loadStudy(first.searchId).catch(() => null),
    Promise.all(first.issue.study!.versions.map(async (v) => [v.bookId, (await getLibraryEntry(v.bookId).catch(() => null)) !== null] as const)),
  ]);
  const has = new Map(library);
  const ctx = studyBookContext(shelf, bookId, study?.rollbacks ?? [], (id) => has.get(id) === true) ?? first;
  const resultId = first.issue.results[0];
  const resultText = resultId ? await readText(`topic-search-${resultId}.json`) : null;
  const result = resultText ? parseResultFile(resultText) : null;
  const runs = await appRuns()
    .list({ kind: TOPIC_SEARCH_KIND, state: ["pending", "running"] })
    .catch(() => []);
  return { ctx, result, updating: updatingTo(runs, first.searchId, ctx.newest) };
}

/** The open book's parsed pages, kept for the next tap; one book at a time. */
let parsedBook: { bookId: string; docs: Promise<{ doc: Document }[]> } | null = null;

/**
 * The cited section's text the book itself carries (study-excerpts.ts), as a
 * body citeSheet reads; null when the book has none for it (made before the
 * excerpts, or the section did not fit).
 */
export async function readBookExcerpt(bookId: string, anchor: string): Promise<MaterialBody | null> {
  if (parsedBook?.bookId !== bookId) parsedBook = { bookId, docs: readLibraryBook(bookId).then((bytes) => parseEpub(bytes).docs) };
  const docs = await parsedBook.docs.catch(() => {
    parsedBook = null;
    return [];
  });
  const paras = excerptInBook(docs, anchor);
  return paras?.length ? excerptBody(anchor, paras) : null;
}

/** A material's cached body, on the computer that ran the study; null anywhere else. */
export async function readMaterialBody(result: TopicSearchResult, material: string): Promise<MaterialBody | null> {
  for (const path of materialBodyPaths(result, material)) {
    const text = await readText(path);
    if (!text) continue;
    try {
      const body = JSON.parse(text) as MaterialBody;
      if (Array.isArray(body.sections)) return body;
    } catch {
      // A torn file: try the next directory.
    }
  }
  return null;
}

/** Make version `to` the brief's content again, from now. */
export async function rollBackStudy(searchId: string, to: number): Promise<void> {
  await addRollback(searchId, to, Date.now());
}

const CARRIED = "rp-study-carried:";

function carriedHere(bookId: string): boolean {
  try {
    return localStorage.getItem(CARRIED + bookId) === "1";
  } catch {
    return false;
  }
}

function markCarried(bookId: string): void {
  try {
    localStorage.setItem(CARRIED + bookId, "1");
  } catch {
    // Without storage the carry may run again; it finds marks there and stops.
  }
}

export interface CarryReport {
  from: number;
  moved: number;
  unmatched: number;
}

/**
 * Before a study's newest version is opened: carry the reader's highlights and
 * notes from the version it was made from (StudyVersion.base) onto it, each
 * into the same item (by key) where its words still are (docs/info/91 「版本」).
 * Once per book on a device, and never onto a book that already has marks; the
 * marks keep their ids, so two devices carrying the same marks write the same
 * records. Null when there was nothing to do.
 */
export async function prepareStudyBook(bookId: string): Promise<CarryReport | null> {
  if (carriedHere(bookId)) return null;
  const data = await loadStudyReader(bookId).catch(() => null);
  if (!data?.result) return null;
  const { ctx, result } = data;
  if (ctx.viewing.n !== ctx.newest) return null;
  const made = result.study?.versions.find((v) => v.n === ctx.viewing.n);
  const baseN = made?.base ?? (ctx.viewing.n > 1 ? ctx.viewing.n - 1 : null);
  const base = baseN !== null ? ctx.versions.find((v) => v.n === baseN) : undefined;
  if (!base) {
    markCarried(bookId);
    return null;
  }
  const [mine, theirs] = await Promise.all([loadAnnotations(bookId), loadAnnotations(base.bookId)]);
  const marks = theirs.filter(isPageMark);
  if (mine.some(isPageMark) || marks.length === 0) {
    markCarried(bookId);
    return null;
  }
  const [fromBytes, intoBytes] = await Promise.all([readLibraryBook(base.bookId), readLibraryBook(bookId)]);
  const carried = carryMarksByBlock(
    marks as unknown as MarkRecord[],
    parseEpub(fromBytes),
    parseEpub(intoBytes),
    ITEM_CLASS,
    (blockId) => {
      const item = itemOfAnchorId(blockId);
      const same = item ? sameItemIn(result, item, ctx.viewing.n) : null;
      return same ? itemAnchorId(same.id) : null;
    },
  );
  if (carried.moved.length) await saveAnnotations(bookId, [...mine, ...(carried.moved as unknown as Annotation[])]);
  markCarried(bookId);
  return { from: base.n, moved: carried.moved.length, unmatched: carried.unmatched.length };
}
