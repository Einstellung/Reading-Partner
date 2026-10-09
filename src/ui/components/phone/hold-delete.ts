// What runs behind the phone's hold menu (hold-menu.ts): the delete a confirmed
// item does, and the move a picked topic does. Every delete is one of the
// reading domain's own (reading/delete/), and the move is the kept-document one
// (reading/saved/kept-document.ts); this file only picks which and says what
// happened.

import { t } from "../../../i18n";
import type { LibraryEntry } from "../../../platform/app/library";
import type { FileMove, FileRef, Topic } from "../../../platform/app/topics";
import { removeFromTopic } from "../../../reading/delete/delete-book";
import { deleteAside } from "../../../reading/delete/delete-thread";
import { deleteTopic } from "../../../reading/delete/delete-topic";
import { unkeepArticle } from "../../../reading/delete/unkeep";
import { moveDocumentToTopic } from "../../../reading/saved/kept-document";
import { moveFailedLine, movedLine } from "../shelf/move-to";
import { topicDeleteWords } from "../shelf/topic-delete";
import { holdDoneLine, type ConfirmedChoice, type HoldChoice, type HoldSubject } from "./hold-menu";

export interface HoldDeleteDeps {
  removeFromTopic: typeof removeFromTopic;
  removeSavedArticle: (id: string) => Promise<void>;
  deleteAside: typeof deleteAside;
  deleteTopic: (topicId: string, alsoDeleteFiles: readonly string[]) => Promise<string[]>;
  moveFile: (hash: string, toTopicId: string) => Promise<FileMove | null>;
}

export const liveHoldDeleteDeps: HoldDeleteDeps = {
  removeFromTopic: (topicId, file) => removeFromTopic(topicId, file),
  // The record, and the document a keep built from it (reading/delete/unkeep.ts).
  removeSavedArticle: (id) => unkeepArticle(id),
  deleteAside: (target, asideId) => deleteAside(target, asideId),
  deleteTopic: (topicId, alsoDeleteFiles) => deleteTopic(topicId, undefined, { alsoDeleteFiles }),
  moveFile: (hash, toTopicId) => moveDocumentToTopic(hash, toTopicId),
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

/** Run a confirmed choice. Answers the line to say; throws when it did not go. */
export async function runHoldChoice(
  choice: ConfirmedChoice,
  subject: HoldSubject,
  deps: HoldDeleteDeps = liveHoldDeleteDeps,
): Promise<string> {
  switch (choice) {
    case "delete-file": {
      const s = subject as Extract<HoldSubject, { kind: "file" }>;
      await deps.removeFromTopic(s.topicId, s.file);
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

/**
 * Move a held file to the picked topic. Answers the line to say; throws when
 * nothing moved, which is also what a file with no book id is.
 */
export async function runHoldMove(
  subject: Extract<HoldSubject, { kind: "file" }>,
  to: { id: string; name: string },
  deps: Pick<HoldDeleteDeps, "moveFile"> = liveHoldDeleteDeps,
): Promise<string> {
  const hash = subject.file.hash;
  if (!hash) throw new Error("hold-delete: a file moves by its book id");
  if (!(await deps.moveFile(hash, to.id))) throw new Error("hold-delete: nothing moved");
  return movedLine(to.name);
}

/** The line said when a choice failed. */
export function holdFailedLine(choice: HoldChoice): string {
  switch (choice) {
    case "delete-topic":
      return t("phone.holdMenu.failedTopic");
    case "move-file":
      return moveFailedLine();
    case "delete-file":
      return t("phone.holdMenu.failedFile");
    case "delete-aside":
      return t("phone.holdMenu.failedConversation");
    case "remove-saved":
      return t("phone.holdMenu.failedRemoveSaved");
  }
}
