// Un-keeping an article (docs/21: a real removal, not an archive). Since a keep
// builds a document as well as the record (docs/85 step 4), un-keeping takes
// both: the record and its body file, and the document off the topic the
// record was filed in — deleted when nothing else lists it, the way taking any
// row off a topic is (delete-book.ts removeFromTopic). A document the reader
// also put in another topic stays there.

import { listTopics, type FileRef, type Topic } from "../../platform/app/topics";
import {
  loadSavedArticles,
  removeSavedArticle,
  savedArticleDocumentOf,
  type SavedArticle,
} from "../saved/saved-articles";
import { removeFromTopic } from "./delete-book";

export interface UnkeepDeps {
  loadSavedArticles(): Promise<SavedArticle[]>;
  removeSavedArticle(id: string): Promise<void>;
  listTopics(): Promise<Topic[]>;
  removeFromTopic(topicId: string, file: FileRef): Promise<unknown>;
}

export const liveUnkeepDeps: UnkeepDeps = {
  loadSavedArticles: () => loadSavedArticles(),
  removeSavedArticle: (id) => removeSavedArticle(id),
  listTopics,
  removeFromTopic: (topicId, file) => removeFromTopic(topicId, file),
};

/**
 * Un-keep one article. The record goes first: it is what the reader asked to
 * remove, and a document whose removal fails afterwards is a row they can take
 * off the shelf themselves.
 */
export async function unkeepArticle(id: string, deps: UnkeepDeps = liveUnkeepDeps): Promise<void> {
  const article = (await deps.loadSavedArticles()).find((a) => a.id === id);
  await deps.removeSavedArticle(id);
  if (!article) return;
  const hash = savedArticleDocumentOf(article);
  if (hash === "") return;
  const topic = (await deps.listTopics()).find((t) => t.id === article.topicId);
  if (!topic) return;
  for (const file of topic.files) {
    if (file.hash === hash) await deps.removeFromTopic(topic.id, file);
  }
}
