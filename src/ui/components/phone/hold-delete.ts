// What runs behind the phone's hold menu (hold-menu.ts): the reads that decide
// which items it shows, and the delete a confirmed item does. Every delete is
// one of the reading domain's own (reading/delete/); this file only picks which
// and says what happened.

import { getBookThread, loadThreads } from "../../../platform/app/threads";
import type { LibraryEntry } from "../../../platform/app/library";
import type { FileRef, Topic } from "../../../platform/app/topics";
import { isLastReference, removeFromTopic } from "../../../reading/delete/delete-book";
import {
  deleteAside,
  deleteBookConversation,
  deleteLesson,
} from "../../../reading/delete/delete-thread";
import { deleteTopic } from "../../../reading/delete/delete-topic";
import { removeSavedArticle } from "../../../reading/saved-articles";
import { topicDeleteWords } from "../shelf/topic-delete";
import {
  holdDoneLine,
  otherTopicNames,
  type HoldChoice,
  type HoldFacts,
  type HoldSubject,
} from "./hold-menu";

export interface HoldDeleteDeps {
  isLastReference: typeof isLastReference;
  hasBookConversation: (bookId: string) => Promise<boolean>;
  removeFromTopic: typeof removeFromTopic;
  deleteLesson: typeof deleteLesson;
  deleteBookConversation: typeof deleteBookConversation;
  removeSavedArticle: (id: string) => Promise<void>;
  deleteAside: typeof deleteAside;
  deleteTopic: (topicId: string, alsoDeleteFiles: readonly string[]) => Promise<string[]>;
}

export const liveHoldDeleteDeps: HoldDeleteDeps = {
  isLastReference: (topics, topicId, file) => isLastReference(topics, topicId, file),
  hasBookConversation: async (bookId) => {
    await loadThreads(bookId);
    return !!getBookThread(bookId);
  },
  removeFromTopic: (topicId, file) => removeFromTopic(topicId, file),
  deleteLesson: (target) => deleteLesson(target),
  deleteBookConversation: (target) => deleteBookConversation(target),
  removeSavedArticle: (id) => removeSavedArticle(id),
  deleteAside: (target, asideId) => deleteAside(target, asideId),
  deleteTopic: (topicId, alsoDeleteFiles) => deleteTopic(topicId, undefined, { alsoDeleteFiles }),
};

/**
 * Delete a topic, with the files the reader ticked (TopicDeleteDialog). Answers
 * the line to say, which names the files that actually went.
 */
export async function runTopicDelete(
  topic: Topic,
  topics: readonly Topic[],
  alsoDeleteFiles: readonly string[],
  entries: Record<string, LibraryEntry>,
  deps: Pick<HoldDeleteDeps, "deleteTopic"> = liveHoldDeleteDeps,
): Promise<string> {
  const deleted = new Set(await deps.deleteTopic(topic.id, alsoDeleteFiles));
  const seen = new Set<string>();
  const went: FileRef[] = topic.files.filter((f) => {
    if (!f.hash || !deleted.has(f.hash) || seen.has(f.hash)) return false;
    seen.add(f.hash);
    return true;
  });
  return topicDeleteWords({ topic, topics, only: went, entries }).done(went.length > 0);
}

/**
 * The facts the menu for this subject needs. A read that fails leaves its fact
 * unknown: the menu then offers the stronger delete and no conversation item.
 */
export async function lookupHoldFacts(
  subject: HoldSubject,
  topics: readonly Topic[],
  deps: HoldDeleteDeps = liveHoldDeleteDeps,
): Promise<HoldFacts> {
  if (subject.kind !== "file") return {};
  const [last, hasConversation] = await Promise.all([
    deps.isLastReference(topics, subject.topicId, subject.file).catch((e: unknown) => {
      console.warn("failed to count a file's references", e);
      return undefined;
    }),
    subject.bookId && !subject.article
      ? deps.hasBookConversation(subject.bookId).catch(() => false)
      : Promise.resolve(false),
  ]);
  return {
    ...(last === undefined ? {} : { last }),
    hasConversation,
    otherTopics: otherTopicNames(topics, subject.topicId, subject.file),
  };
}

/** Run a confirmed choice. Answers the line to say; throws when it did not go. */
export async function runHoldChoice(
  choice: Exclude<HoldChoice, "delete-topic">,
  subject: HoldSubject,
  deps: HoldDeleteDeps = liveHoldDeleteDeps,
): Promise<string> {
  switch (choice) {
    case "delete-file":
    case "remove-from-topic": {
      const s = subject as Extract<HoldSubject, { kind: "file" }>;
      await deps.removeFromTopic(s.topicId, s.file);
      break;
    }
    case "delete-lesson":
    case "delete-conversation": {
      const s = subject as Extract<HoldSubject, { kind: "file" }>;
      if (!s.bookId) throw new Error("hold-delete: a conversation needs a book id");
      const target = { bookId: s.bookId, topicId: s.topicId };
      await (choice === "delete-lesson" ? deps.deleteLesson(target) : deps.deleteBookConversation(target));
      break;
    }
    case "remove-saved":
      await deps.removeSavedArticle((subject as Extract<HoldSubject, { kind: "saved" }>).id);
      break;
    case "delete-aside": {
      const s = subject as Extract<HoldSubject, { kind: "aside" }>;
      await deps.deleteAside({ bookId: s.bookId, topicId: s.topicId }, s.asideId);
      break;
    }
  }
  return holdDoneLine(choice, subject);
}

/** The line said when a choice failed. */
export function holdFailedLine(choice: HoldChoice): string {
  switch (choice) {
    case "delete-topic":
      return "The topic could not be deleted.";
    case "delete-file":
      return "It could not be deleted.";
    case "remove-from-topic":
      return "It could not be removed from this topic.";
    case "delete-lesson":
    case "delete-conversation":
    case "delete-aside":
      return "The conversation could not be deleted.";
    case "remove-saved":
      return "It could not be removed from Saved.";
  }
}
