// What translate_document is wired to in the app: the library, the topics, the
// marks, the delete path and the provider. Separate from tool.ts and replace.ts
// for the usual reason — everything here reaches the host, and none of it runs
// under bun.

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
import { addFileToTopic, listTopics, setFileHash } from "../../platform/app/topics";
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
import { translateRun } from "./run";
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
  /** The conversation's model: the translation is made by whoever is talking. */
  model: TranslateModel;
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
    inspect: async (target) => {
      const body = bodyOf(await readLibraryBook(target.bookId));
      if (!body) return { blocks: 0, translated: false };
      if (hasTranslations(body)) return { blocks: 0, translated: true };
      return { blocks: segmentDocument(body).length, translated: false };
    },
    start: (target, blocks) => {
      translateRun.begin(target.title, blocks);
      void runTranslation(target, ref);
    },
    busy: () => translateRun.busy(),
  };
}

async function runTranslation(target: TranslateTarget, ref: TranslateDeskRef): Promise<void> {
  const entry = await getLibraryEntry(target.bookId);
  if (!entry) {
    translateRun.fail(`"${target.title}" is no longer on the shelf.`);
    return;
  }
  const removeBook = deleteBook;
  if (!removeBook) {
    translateRun.fail("the app is not ready to replace a document yet");
    return;
  }
  let result: ReplaceResult;
  try {
    result = await replaceWithTranslation(
      entry,
      target.home,
      {
        readBook: readLibraryBook,
        translate: (bytes, onProgress) =>
          translateArticleEpub(bytes, {
            translateGlossary: translateGlossaryLive(ref.model),
            translateBatch: translateBatchLive(ref.model),
            onProgress,
          }),
        hash: contentHash,
        importBook,
        attach: async (topicId, path, hash) => {
          await addFileToTopic(topicId, path);
          await setFileHash(topicId, path, hash);
        },
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
      (done, total) => translateRun.progress(done, total),
    );
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    translateRun.fail(`"${target.title}" could not be translated: ${reason}`);
    await tell(target.bookId, `"${target.title}" could not be translated: ${reason}`);
    return;
  }
  const line = summaryLine(target.title, result);
  await tell(result.entry.hash, line);
  if (target.home.kind === "book") {
    // The supplement is the same source read in another language: the prep list
    // keeps its paper and its note, and only the document it points at moves.
    // The new document's text is cut once, here, so the pages read_paper hands
    // over are the pages the reader gets (reading/ingest/fulltext.ts).
    await retargetSupplement(target.home.bookId, target.bookId, result.entry.hash);
  }
  translateRun.finish(line, {
    oldBookId: target.bookId,
    path: result.path,
    hash: result.entry.hash,
    topicId: target.home.kind === "topic" ? target.home.topicId : null,
    bookId: target.home.kind === "book" ? target.home.bookId : null,
    title: translatedTitle(entry.originalFilename),
  });
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
