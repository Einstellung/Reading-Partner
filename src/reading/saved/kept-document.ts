// A kept article and the document built from it, held together as one item
// (docs/85 step 4, docs/21). The record (saved-articles.json) carries the topic
// and the metadata; the document is an EPUB in the library, listed in that
// topic like a book. Whatever moves or removes one of them goes through here so
// the other follows.
//
// The pure half decides what the shelf shows and which rows go together; the
// rest is the move behind the article conversation's Apply and the topic
// cascade's reassign, with every store injected.

import { documentPath, getLibraryEntry, type LibraryEntry } from "../../platform/app/library";
import {
  addFileToTopic,
  BRIEF_TOPIC_ID,
  ensureBriefTopic,
  listTopics,
  removeFileFromTopic,
  type FileRef,
  type Topic,
} from "../../platform/app/topics";
import {
  loadSavedArticles,
  removeSavedArticle,
  savedArticleDocumentOf,
  setSavedArticleTopic,
  type SavedArticle,
} from "./saved-articles";

// --- pure -------------------------------------------------------------------

/**
 * Where this kept article's document is listed: in the record's own topic when
 * it is there, else the first topic that lists it. Null when the record has no
 * document or no topic lists it (topics.json and saved-articles.json sync
 * apart, so the row may not have arrived yet).
 */
export function keptDocumentFile(
  article: SavedArticle,
  topics: readonly Topic[],
): { topicId: string; file: FileRef } | null {
  const hash = savedArticleDocumentOf(article);
  if (hash === "") return null;
  const ordered = [
    ...topics.filter((t) => t.id === article.topicId),
    ...topics.filter((t) => t.id !== article.topicId),
  ];
  for (const topic of ordered) {
    const file = topic.files.find((f) => f.hash === hash);
    if (file) return { topicId: topic.id, file };
  }
  return null;
}

/** What opening a kept article's document needs: the document and the row it is listed under. */
export interface KeptDocumentOpen {
  bookId: string;
  name: string;
  topicId: string;
  path: string;
}

/**
 * Where a tap on a kept article goes: its document, when one is listed, or
 * null for the record's own view (no document, or its row has not synced in).
 * Whether the bytes are on this device is the caller's to check.
 */
export function keptArticleOpening(
  article: SavedArticle,
  topics: readonly Topic[],
): KeptDocumentOpen | null {
  const at = keptDocumentFile(article, topics);
  if (!at || !at.file.hash) return null;
  return { bookId: at.file.hash, name: article.title, topicId: at.topicId, path: at.file.path };
}

/**
 * The records a topic shows as rows of their own. A record whose document the
 * topic already lists is that document's row on the shelf, so listing the
 * record as well would show one article twice.
 */
export function recordsWithoutListedDocument(
  records: readonly SavedArticle[],
  topic: Pick<Topic, "files">,
): SavedArticle[] {
  const listed = new Set(topic.files.flatMap((f) => (f.hash ? [f.hash] : [])));
  return records.filter((a) => {
    const hash = savedArticleDocumentOf(a);
    return hash === "" || !listed.has(hash);
  });
}

/** The records kept in this topic that name this document. */
export function keptRecordsOfDocument(
  records: readonly SavedArticle[],
  topicId: string,
  hash: string,
): SavedArticle[] {
  return records.filter((a) => a.topicId === topicId && savedArticleDocumentOf(a) === hash);
}

/**
 * A deleted topic's files that leave with it, for the confirmation that offers
 * to delete them. A kept article's document does not: its record moves to Brief
 * (delete-topic.ts) and the document moves with the record. Deleting Brief moves
 * nothing, so there every file is offered.
 */
export function filesLeavingWithTopic(
  files: readonly FileRef[],
  records: readonly SavedArticle[],
  topicId: string,
): FileRef[] {
  if (topicId === BRIEF_TOPIC_ID) return [...files];
  const staying = new Set(
    records.filter((a) => a.topicId === topicId).map(savedArticleDocumentOf).filter((h) => h !== ""),
  );
  return files.filter((f) => !f.hash || !staying.has(f.hash));
}

// --- with the stores ---------------------------------------------------------

export interface KeptDocumentDeps {
  loadSavedArticles(): Promise<SavedArticle[]>;
  setSavedArticleTopic(id: string, topicId: string): Promise<boolean>;
  removeSavedArticle(id: string): Promise<void>;
  listTopics(): Promise<Topic[]>;
  ensureBriefTopic(): Promise<unknown>;
  getLibraryEntry(hash: string): Promise<LibraryEntry | null>;
  addFileToTopic(topicId: string, path: string, hash: string): Promise<void>;
  removeFileFromTopic(topicId: string, path: string): Promise<void>;
}

export const liveKeptDocumentDeps: KeptDocumentDeps = {
  loadSavedArticles: () => loadSavedArticles(),
  setSavedArticleTopic: (id, topicId) => setSavedArticleTopic(id, topicId),
  removeSavedArticle: (id) => removeSavedArticle(id),
  listTopics,
  ensureBriefTopic,
  getLibraryEntry,
  addFileToTopic: (topicId, path, hash) => addFileToTopic(topicId, path, hash),
  removeFileFromTopic,
};

/**
 * File a kept article under another topic, and its document with it: the write
 * behind the article conversation's Apply and behind a deleted topic handing its
 * articles to Brief. Answers whether the record moved; false when there is no
 * such record or it could not be rewritten, and then the document is left where
 * it is too.
 *
 * The document is listed in the new topic under the reference it already has,
 * so it is the same row, and taken out of the topic the record was in. A record
 * with no document is only the record moving, as it always was.
 */
export async function moveKeptArticle(
  id: string,
  topicId: string,
  deps: KeptDocumentDeps = liveKeptDocumentDeps,
): Promise<boolean> {
  const article = (await deps.loadSavedArticles()).find((a) => a.id === id);
  if (!article) return false;
  if (!(await deps.setSavedArticleTopic(id, topicId))) return false;
  const hash = savedArticleDocumentOf(article);
  if (hash === "") return true;

  // Brief is the one topic a move can name before it exists: a deleted topic's
  // articles go there, and Brief may have been deleted itself.
  if (topicId === BRIEF_TOPIC_ID) await deps.ensureBriefTopic();
  const topics = await deps.listTopics();
  const listed = keptDocumentFile(article, topics);
  let path = listed?.file.path;
  if (path === undefined) {
    const entry = await deps.getLibraryEntry(hash);
    // Not in the library either: there is no document left to file.
    if (!entry) return true;
    path = documentPath(hash, entry.originalFilename);
  }
  await deps.addFileToTopic(topicId, path, hash);
  if (article.topicId !== topicId) {
    const from = topics.find((t) => t.id === article.topicId);
    for (const file of from?.files ?? []) {
      if (file.hash === hash) await deps.removeFileFromTopic(article.topicId, file.path);
    }
  }
  return true;
}

/**
 * Un-keep the articles in this topic whose document was just taken off it: the
 * other half of removing a kept article's row from the shelf, so the record does
 * not come back as a row of its own pointing at a document that is gone.
 */
export async function forgetKeptArticlesOfDocument(
  topicId: string,
  hash: string,
  deps: Pick<KeptDocumentDeps, "loadSavedArticles" | "removeSavedArticle"> = liveKeptDocumentDeps,
): Promise<void> {
  for (const article of keptRecordsOfDocument(await deps.loadSavedArticles(), topicId, hash)) {
    await deps.removeSavedArticle(article.id);
  }
}
