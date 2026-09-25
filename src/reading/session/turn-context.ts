// Where the reader is, as a reading turn is told it (reading/desk.ts
// ReadingTurnContext): the topic the book is filed under, the book's name, the
// page on screen, and the topic's other materials. Both shells that run a
// reading lesson fill it from the same three things they hold (App.tsx, and the
// phone's EPUB reader, docs/77), so it is built in one place.

import type { ViewStats } from "../../platform/app/reader-contract";
import type { Topic } from "../../platform/app/topics";
import type { ReadingTurnContext } from "../desk";

export function readingTurnContext(
  topic: Pick<Topic, "id" | "name" | "files"> | null,
  fileName: string,
  stats: Pick<ViewStats, "pageIndex" | "pageLabel"> | null,
): ReadingTurnContext {
  return {
    topicId: topic?.id ?? null,
    topicName: topic?.name ?? "",
    fileName,
    pageLabel: stats?.pageLabel ?? null,
    pageIndex: stats?.pageIndex ?? null,
    files: topic?.files.map((f) => ({ path: f.path, name: f.name, hash: f.hash })) ?? [],
  };
}
