// What translate_document is wired to in the app: the library, the topics, the
// marks, the delete path and the provider. Separate from tool.ts and replace.ts
// for the usual reason — everything here reaches the host, and none of it runs
// under bun.
//
// Both halves of the run live here (docs/55 step 11). The turn's half writes a
// task book and asks the runner for a run of kind `translate-book`; the
// worker's half is everything that used to happen behind a fire-and-forget
// promise — opening the document, cutting it up, the dozen model calls, the
// replacement — with one line of progress on the run as it goes. The pure parts
// of both are in book-run.ts, where they can be read back under bun.

import { appData } from "../../platform/app/appdata";
import { appRunner } from "../../legion/execute/runner";
import { OUTPUTS_DIR } from "../../legion/execute/outputs";
import { registerWorker, type WorkerContext, type WorkerHandle } from "../../legion/execute/worker";
import type { BoxOrigin } from "../../box";
import { contentHash } from "../../platform/app/content-hash";
import { loadAnnotations, saveAnnotations } from "../../platform/app/annotations";
import type { Annotation } from "../../platform/app/reader-contract";
import {
  formatOfBytes,
  getLibraryEntry,
  importBook,
  isArticleEntry,
  listLibraryEntries,
  readLibraryBook,
  type LibraryEntry,
} from "../../platform/app/library";
import { addSupplement, listSupplements, removeSupplement } from "../../platform/app/supplements";
import { ensureDocumentFulltext } from "../ingest/fulltext";
import { matchSupplement } from "../ingest/remove-tool";
import { peekPrepPipeline } from "../prep/papers/live";
import { addFileToTopic, listTopics } from "../../platform/app/topics";
import {
  adoptThreads,
  appendMessage,
  createBookThread,
  getBookThread,
  listThreads,
  loadThreads,
} from "../../platform/app/threads";
import { parseEpub } from "../epub/parse";
import { translateBatchLive, translateGlossaryLive, type TranslateModel } from "./live";
import {
  replaceWithTranslation,
  summaryLine,
  translatedTitle,
  type ReplaceResult,
  type TranslationHome,
} from "./replace";
import {
  TRANSLATE_BRIEFS_DIR,
  TRANSLATE_KIND,
  failedLine,
  openingLine,
  parseTranslateBrief,
  segmentedLine,
  translatedLine,
  type Replacement,
  type TranslateBrief,
} from "./book-run";
import { hasTranslations, segmentDocument } from "./segment";
import { translateArticleEpub } from "./translate-article";
import type { MarkRecord } from "./carry-marks";
import type { TranslateTarget, TranslateToolDeps } from "./tool";

/** The body of an article on the shelf, parsed the way the translator parses it. */
function bodyOf(bytes: Uint8Array): HTMLElement | null {
  const book = parseEpub(bytes);
  if (book.docs.length !== 1) return null;
  return new DOMParser().parseFromString(book.docs[0].html, "text/html").body;
}

/** The book id every entry on the shelf answers to by title, best match first. */
function matchByTitle(entries: Record<string, LibraryEntry>, query: string): LibraryEntry | null {
  const wanted = query.toLowerCase();
  let loose: LibraryEntry | null = null;
  for (const entry of Object.values(entries)) {
    const title = entry.title.toLowerCase();
    if (title === wanted) return entry;
    if (loose === null && title.includes(wanted)) loose = entry;
  }
  return loose;
}

async function topicOfBook(bookId: string): Promise<string | null> {
  const topics = await listTopics();
  for (const topic of topics) {
    for (const file of topic.files) {
      if (file.hash === bookId) return topic.id;
    }
  }
  return null;
}

/**
 * The closing line, in the conversation the reader asked in.
 *
 * That thread is under the new book id by the time this runs, because the
 * replacement moved it there (replace.ts). Creating one is the fallback for a
 * document nobody had talked to yet.
 */
async function tell(bookId: string, text: string): Promise<void> {
  try {
    await loadThreads(bookId);
    const thread = getBookThread(bookId) ?? createBookThread(bookId, crypto.randomUUID());
    appendMessage(bookId, thread.id, { role: "ai", text, ts: Date.now() });
  } catch (e) {
    console.warn("could not write the translation's closing line", e);
  }
}

/**
 * How the original is taken off the shelf, registered rather than imported.
 *
 * reading/delete reaches the retell and rehearsal units, and those reach back up
 * to reading/desk — so a file under reading/ that imports it puts a cycle in the
 * directory graph (tests/layering.test.ts). The shell is above all of them and
 * knows both, so it hands the function down at startup
 * (ui/components/common/useShellBootstrap.ts).
 */
type BookDeleter = (bookId: string) => Promise<void>;
let deleteBook: BookDeleter | null = null;

export function setBookDeleter(fn: BookDeleter): void {
  deleteBook = fn;
}

/**
 * The same function for everything else that takes a document off the shelf —
 * remove_supplement (reading/ingest/remove-tool.ts) deletes exactly what a
 * replaced original does. Registered once, read wherever it is needed; null
 * until the shell has handed it down.
 */
export function bookDeleter(): BookDeleter | null {
  return deleteBook;
}

export interface TranslateDeskRef {
  /** The book the session belongs to: its topic, its prep, its supplements. */
  bookId: string;
  /** The document on screen — the book itself, or one of its supplements. */
  docId: string;
  topicId: string | null;
  /** The conversation the reader asked in, for the run to name where it came from. */
  threadId: string;
  /** The conversation's model: the translation is made by whoever is talking. */
  model: TranslateModel;
}

/** Write the task book for a translation about to be delegated, answering its path. */
async function writeTranslateBrief(brief: TranslateBrief): Promise<string> {
  const path = `${TRANSLATE_BRIEFS_DIR}/translate-${crypto.randomUUID()}.json`;
  await appData.mkdirp(TRANSLATE_BRIEFS_DIR);
  await appData.writeAtomic(path, JSON.stringify(brief, null, 2));
  return path;
}

export function liveTranslateToolDeps(ref: TranslateDeskRef): TranslateToolDeps {
  return {
    // What "this one" means is the document on screen, which is a supplement
    // whenever the reader opened one (docs/67 「辅助资料」). A title is looked for
    // among this book's supplements first and on the shelf after: the reader is
    // talking about what is in front of them, and a supplement is filed under
    // the book rather than under a topic, which is where its translation goes
    // too.
    find: async (query) => {
      const supplements = await listSupplements(ref.bookId).catch(() => []);
      const named = query ? matchSupplement(query, supplements) : null;
      const hash = named ? named.hash : query ? null : ref.docId;
      const entry = hash
        ? await getLibraryEntry(hash)
        : matchByTitle(await listLibraryEntries(), query ?? "");
      if (!entry) return null;
      const supplement = supplements.find((one) => one.hash === entry.hash) ?? null;
      const home: TranslationHome = supplement
        ? { kind: "book", bookId: ref.bookId }
        : {
            kind: "topic",
            topicId: entry.hash === ref.bookId ? ref.topicId : await topicOfBook(entry.hash),
          };
      return {
        bookId: entry.hash,
        title: supplement?.title ?? entry.title,
        article: isArticleEntry(entry),
        home,
      };
    },
    // One at a time, app-wide. Not a resource limit — the runner already runs
    // one run of a kind at a time on a device — but a product one: two articles
    // translating at once is two lines of numbers about work the reader asked
    // for one sentence at a time, and the second request is better answered
    // with "one is already running".
    busy: async () => {
      const going = await appRunner()
        .list({ kind: TRANSLATE_KIND, state: ["pending", "running"] })
        .catch(() => []);
      return going.length > 0;
    },
    start: async (target) => {
      const origin: BoxOrigin = {
        place: "book",
        bookId: ref.bookId,
        threadId: ref.threadId,
      };
      const brief = await writeTranslateBrief({ target, ref });
      const result = await appRunner().delegate({
        kind: TRANSLATE_KIND,
        // Nobody's question: the reader is told by the worker, in the sentence
        // the replacement writes, so the bell about this run is acknowledged
        // and nothing more is said (soul/bell.ts). Only its failure reaches
        // them, as one card to decide about.
        delegator: { kind: "program", name: "translate" },
        brief,
        deliverTo: JSON.stringify(origin),
      });
      return result.ok
        ? { ok: true as const, runId: result.run.id }
        : { ok: false as const, reason: result.reason };
    },
  };
}

// --- the worker ---------------------------------------------------------------

export interface TranslateWorkerDeps {
  /** The task book, read back off its path. AppData unless injected. */
  readBrief?: (path: string) => Promise<string>;
}

/**
 * Run one translation: open the document, cut it into blocks, translate them,
 * and put the bilingual copy where the original was.
 *
 * A document that cannot be translated — gone from the shelf, bilingual
 * already, empty — is not a failed run. The worker says so in the conversation
 * and the run is done: a failure is retried, and retrying any of those three
 * would spend a dozen model calls to reach the same sentence.
 */
export function translateBookWorker(deps: TranslateWorkerDeps = {}) {
  const readBrief = deps.readBrief ?? ((path: string) => appData.readText(path));
  return (brief: string, ctx: WorkerContext): WorkerHandle => {
    const stop = new AbortController();
    const done = (async () => {
      const { target, ref } = parseTranslateBrief(await readBrief(brief));
      await ctx.report(openingLine(target.title));
      try {
        return await runTranslation(target, ref, ctx, stop.signal);
      } catch (e) {
        const reason = e instanceof Error ? e.message : String(e);
        // The last line the run carries, so the screen says what went wrong
        // rather than where it had got to. The reader is not told here: this
        // is one attempt of up to three, and a run that has spent them leaves
        // a card in the box with this same reason on it.
        await ctx.report(failedLine(target.title, reason));
        throw e;
      }
    })();
    return { cancel: () => stop.abort(), done };
  };
}

/** Hand legion the translation kind. Called once at startup; deps are for tests. */
export function registerTranslateBookWorker(deps: TranslateWorkerDeps = {}): void {
  registerWorker({
    kind: TRANSLATE_KIND,
    // In this process, on the reader's own device. The task book is machine-
    // local and so is the shelf the document is on; the cross-device half of
    // docs/55 step 11 is not done.
    tier: "local",
    requires: [],
    // Not `delegable`: the task book is JSON a program writes — which document,
    // which topic, which model — and a model asked to delegate this would write
    // prose the worker cannot read. The entrance is translate_document and
    // there is no other.
    run: translateBookWorker(deps),
  });
}

async function runTranslation(
  target: TranslateTarget,
  ref: TranslateBrief["ref"],
  ctx: WorkerContext,
  signal: AbortSignal,
): Promise<{ output?: string; progress?: string }> {
  const entry = await getLibraryEntry(target.bookId);
  if (!entry) {
    const line = `"${target.title}" is no longer on the shelf.`;
    await tell(target.bookId, line);
    return { progress: line };
  }
  const removeBook = deleteBook;
  if (!removeBook) throw new Error("the app is not ready to replace a document yet");

  // What the turn used to do before it answered: a megabyte of EPUB, a parse
  // and a walk of the body. It is the same two questions, asked where the
  // reader is not waiting on them.
  const body = bodyOf(await readLibraryBook(target.bookId));
  if (body && hasTranslations(body)) {
    const line = `"${target.title}" is already bilingual.`;
    await tell(target.bookId, line);
    return { progress: line };
  }
  const blocks = body ? segmentDocument(body).length : 0;
  if (blocks === 0) {
    const line = `"${target.title}" has nothing to translate.`;
    await tell(target.bookId, line);
    return { progress: line };
  }
  await ctx.report(segmentedLine(target.title, blocks));

  const result: ReplaceResult = await replaceWithTranslation(
      entry,
      target.home,
      {
        readBook: readLibraryBook,
        translate: (bytes, onProgress) =>
          translateArticleEpub(bytes, {
            translateGlossary: translateGlossaryLive(ref.model),
            translateBatch: translateBatchLive(ref.model),
            onProgress,
            signal,
          }),
        hash: contentHash,
        importBook,
        attach: (topicId, path, hash) => addFileToTopic(topicId, path, hash),
        // Listed before the original is taken off, so the book is never a book
        // with one supplement fewer than the reader put there.
        replaceSupplement: async (bookId, oldHash, supplement) => {
          await addSupplement(bookId, { ...supplement, addedAt: Date.now() });
          await removeSupplement(bookId, oldHash);
        },
        loadMarks: async (bookId) => (await loadAnnotations(bookId)) as unknown as MarkRecord[],
        saveMarks: async (bookId, marks) => {
          saveAnnotations(bookId, marks as unknown as Annotation[]);
        },
        loadThreads: async (bookId) => {
          await loadThreads(bookId);
          return listThreads(bookId);
        },
        adoptThreads: async (bookId, threads) => {
          await loadThreads(bookId);
          adoptThreads(bookId, threads);
        },
        targetOf: (bytes) => {
          const doc = parseEpub(bytes).docs[0];
          return { doc: doc.doc, text: doc.text, spineIndex: doc.index, idref: doc.idref };
        },
        deleteBook: removeBook,
      },
      // The counter, as one line the run carries. The runner writes it to disk
      // at most once every thirty seconds (docs/55), so this is a sentence that
      // reads the same whether the reader catches one of them or ten.
      (done, total) => void ctx.report(translatedLine(target.title, done, total)),
    );
  const line = summaryLine(target.title, result);
  await tell(result.entry.hash, line);
  if (target.home.kind === "book") {
    // The supplement is the same source read in another language: the prep list
    // keeps its paper and its note, and only the document it points at moves.
    // The new document's text is cut once, here, so the pages read_paper hands
    // over are the pages the reader gets (reading/ingest/fulltext.ts).
    await retargetSupplement(target.home.bookId, target.bookId, result.entry.hash);
  }
  // What the reader who had the original open is moved onto. A reference on
  // the run, like everything else a run produces: the screen reads it back off
  // the file when the run reaches `done` (watch.ts).
  const replaced: Replacement = {
    oldBookId: target.bookId,
    path: result.path,
    hash: result.entry.hash,
    topicId: target.home.kind === "topic" ? target.home.topicId : null,
    bookId: target.home.kind === "book" ? target.home.bookId : null,
    title: translatedTitle(entry.originalFilename),
  };
  const output = `${OUTPUTS_DIR}/${ctx.run.id}.json`;
  await appData.mkdirp(OUTPUTS_DIR);
  await appData.writeAtomic(output, JSON.stringify(replaced, null, 2));
  return { output, progress: line };
}

// The prep run's side of a replaced supplement, and the new document's text. A
// failure here costs the model its read of the piece, not the reader's copy: the
// translation is on the shelf either way.
async function retargetSupplement(bookId: string, oldHash: string, hash: string): Promise<void> {
  try {
    const bytes = await readLibraryBook(hash);
    await ensureDocumentFulltext(hash, bytes.slice().buffer as ArrayBuffer, formatOfBytes(bytes));
    peekPrepPipeline(bookId)?.retarget(oldHash, hash);
  } catch (e) {
    console.warn("could not hand the translation to this book's prep run", e);
  }
}
