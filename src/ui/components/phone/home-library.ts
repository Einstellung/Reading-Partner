// The Library section of the phone home (docs/ui/22), minus React: the book to
// continue first, then the topics as the shelf orders them, four covers in all.

import { t } from "../../../i18n";
import type { Topic } from "../../../platform/app/topics";
import { shelfHeaderLine, shelfOrder } from "../shelf/topic-shelf";
import type { ContinueBook } from "./shelf-list";

export const HOME_LIBRARY_COUNT = 4;

/** The topics drawn beside the book to continue, which takes the first cover when there is one. */
export function homeTopics(
  topics: readonly Topic[],
  continueBook: ContinueBook | null,
  count: number = HOME_LIBRARY_COUNT,
): Topic[] {
  return shelfOrder([...topics]).slice(0, Math.max(0, count - (continueBook ? 1 : 0)));
}

/** The line under the continued book's topic: how far in, when that is known. */
export function continueLine(progress: number | null): string {
  if (progress === null) return t("phone.home.continue");
  // Never 0%: a book that has been opened has been read some (shelf/file-title.ts).
  return t("phone.home.continuePercent", { percent: Math.max(1, Math.round(progress * 100)) });
}

/** The counts on the "All topics" row. */
export function libraryTotalsLine(topics: readonly Topic[]): string {
  return topics.length === 0 ? t("phone.home.noTopics") : shelfHeaderLine([...topics]);
}
