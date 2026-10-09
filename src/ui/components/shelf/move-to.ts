// "Move to…" on a file, the phone's hold menu and the desk's card menu alike
// (docs/reading/01 §一). A file is on one topic and this is the one way it
// changes which: the topics it can go to, and the lines said after. Drawn by
// MoveToTopicDialog.tsx.

import { t } from "../../../i18n";
import type { FileRef, Topic } from "../../../platform/app/topics";
import { fileCountLabel, shelfOrder } from "./topic-shelf";

export interface MoveTarget {
  id: string;
  name: string;
  // "3 files". The topic the file is on says Here instead.
  count: string;
  here: boolean;
}

/**
 * Whether the file can be moved at all: there is another topic, and the file
 * has a book id, which is what the store moves by. A row written before the
 * doors wrote ids has none until it is opened (topics.ts FileRef).
 */
export function canMoveFile(file: Pick<FileRef, "hash">, topics: readonly Topic[]): boolean {
  return !!file.hash && topics.length > 1;
}

/** Every topic in shelf order, the one the file is on marked here. */
export function moveTargets(topics: readonly Topic[], currentTopicId: string): MoveTarget[] {
  return shelfOrder([...topics]).map((topic) => ({
    id: topic.id,
    name: topic.name,
    count: fileCountLabel(topic.files.length),
    here: topic.id === currentTopicId,
  }));
}

export function movedLine(topicName: string): string {
  return t("library.move.done", { topic: topicName });
}

export function moveFailedLine(): string {
  return t("library.move.failed");
}
