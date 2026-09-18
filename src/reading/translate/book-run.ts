// A translation as a legion run (docs/55 step 11, docs/67): what its task book
// says, what its one line of progress reads, and what the screen makes of the
// run record.
//
// Everything here is pure. The worker that does the work reaches the shelf, the
// provider and the disk (tool-live.ts); this is the part that can be read back
// under bun, and it is deliberately thin: the sentence a person sees is written
// by the worker and carried on the run, so the screen has nothing to compose.

import type { Run } from "../../legion/run";
import type { TranslateModel } from "./live";
import type { TranslateTarget } from "./tool";

/** The kind legion knows a book translation by. */
export const TRANSLATE_KIND = "translate-book";

/** Where a translation's task book is kept. The subtree is registered in palace. */
export const TRANSLATE_BRIEFS_DIR = "legion/briefs";

/** The session the request was made in: which model answers, and about what. */
export interface TranslateBriefRef {
  /** The book the session belongs to: its topic, its prep, its supplements. */
  bookId: string;
  /** The document that was on screen — the book itself, or one of its supplements. */
  docId: string;
  topicId: string | null;
  /** The conversation's model: the translation is made by whoever is talking. */
  model: TranslateModel;
}

/** What one translation run's task book says. Frozen when the run is created. */
export interface TranslateBrief {
  target: TranslateTarget;
  ref: TranslateBriefRef;
}

/** What took the original's place, for the reader who had it open. */
export interface Replacement {
  oldBookId: string;
  /** The new document's reference in the topic, and its book id. */
  path: string;
  hash: string;
  topicId: string | null;
  /**
   * The book this document is a supplement of, when it is one (docs/67). The
   * reader stays in that book's session and only the bytes on screen change;
   * null for a document that stands on the shelf in its own right.
   */
  bookId?: string | null;
  /** What the new document is called, for the title bar. */
  title?: string;
}

/** Read a task book back. A file that names no document is not one. */
export function parseTranslateBrief(text: string): TranslateBrief {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("the translation task book is not readable JSON");
  }
  const value = parsed as Partial<TranslateBrief> | null;
  const target = value?.target;
  const ref = value?.ref;
  if (!target || typeof target.bookId !== "string" || target.bookId === "") {
    throw new Error("the translation task book names no document");
  }
  if (!ref || typeof ref.bookId !== "string") {
    throw new Error("the translation task book names no session");
  }
  return { target, ref };
}

/** What a finished run left behind, read back off its output file. Null if unreadable. */
export function parseReplacement(text: string): Replacement | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  const value = parsed as Partial<Replacement> | null;
  if (!value || typeof value.oldBookId !== "string" || typeof value.hash !== "string") return null;
  if (typeof value.path !== "string") return null;
  return {
    oldBookId: value.oldBookId,
    path: value.path,
    hash: value.hash,
    topicId: typeof value.topicId === "string" ? value.topicId : null,
    ...(value.bookId === undefined ? {} : { bookId: value.bookId }),
    ...(value.title === undefined ? {} : { title: value.title }),
  };
}

// --- the line on the run ------------------------------------------------------
//
// One sentence, and it carries the title: a run record has no room for the
// document it is about, and the screen reads the sentence rather than composing
// one. The disk sees at most one of these every thirty seconds (docs/55), so
// they are written to read the same whether the reader catches one or ten.

/** Before anything has been read: the document has only just been picked up. */
export function openingLine(title: string): string {
  return `Translating "${title}" — reading the document`;
}

/** The document has been cut into blocks and the model has not been called yet. */
export function segmentedLine(title: string, total: number): string {
  return `Translating "${title}" — ${total} blocks to do`;
}

/** How far along. The counter the reader used to watch, one line per half minute. */
export function translatedLine(title: string, done: number, total: number): string {
  return `Translating "${title}" — translated ${done}/${total} segments`;
}

/** What went wrong, for the last line a failed run leaves on itself. */
export function failedLine(title: string, reason: string): string {
  return `"${title}" could not be translated: ${reason}`;
}

// --- what the screen shows ----------------------------------------------------

export type TranslateViewPhase = "running" | "done" | "failed";

/** One translation, as the line at the bottom of the reader reads it. */
export interface TranslateView {
  runId: string;
  phase: TranslateViewPhase;
  /** The sentence on screen: the run's own last line. */
  text: string;
  /** What the run put in the original's place, once its output has been read. */
  replaced: Replacement | null;
}

/**
 * The run a person is shown, out of every translation this device knows of: the
 * newest, because a translation is something the reader just asked for and an
 * older one is over. Null when there is none.
 */
export function latestTranslateRun(runs: readonly Run[]): Run | null {
  let latest: Run | null = null;
  for (const run of runs) {
    if (run.kind !== TRANSLATE_KIND) continue;
    if (!latest || run.createdAt > latest.createdAt) latest = run;
  }
  return latest;
}

/**
 * The run record as a line on screen. A cancelled run says nothing: somebody
 * stopped it and knows they did.
 */
export function translateView(run: Run | null, replaced: Replacement | null): TranslateView | null {
  if (!run) return null;
  if (run.state === "cancelled") return null;
  const phase: TranslateViewPhase =
    run.state === "done" ? "done" : run.state === "failed" ? "failed" : "running";
  const fallback = phase === "failed" ? "The translation failed." : "Starting the translation";
  return {
    runId: run.id,
    phase,
    text: run.progress ?? fallback,
    replaced: phase === "done" ? replaced : null,
  };
}

/**
 * Pure: the document to reopen, given what the reader has on screen. Null unless
 * a finished run took that very document away — a translation of something else
 * on the shelf, or of a supplement the reader is not looking at, must not move
 * them off the page they are on.
 *
 * It is the document on screen that is compared, not the session's book: a
 * supplement is a document of the session the reader is already in (docs/67).
 */
export function fileToReopen(
  view: TranslateView | null,
  openDocId: string | null,
): Replacement | null {
  if (!view || view.phase !== "done" || !view.replaced) return null;
  return view.replaced.oldBookId === openDocId ? view.replaced : null;
}
