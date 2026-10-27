// The info shelf over the real disk: what InfoShelf.tsx and the phone home read
// it through, and how either opens one of its books.

import { todayLocal } from "../../../info/collect/store";
import { appData } from "../../../platform/app/appdata";
import { listLibraryEntries } from "../../../platform/app/library";
import { getViewState } from "../../../platform/app/storage";
import { listTopics } from "../../../platform/app/topics";
import { lastReadingPosition } from "../../../reading/reading-position";
import { prepareStudyBook } from "../reader/study/study-live";
import { cardBookName, type InfoShelfIo, type IssueCard, type ShelfContext, type VolumeCard } from "./info-shelf";

export const liveInfoShelfIo: InfoShelfIo = {
  readText: async (path) => ((await appData.exists(path)) ? await appData.readText(path) : null),
  library: listLibraryEntries,
  topics: listTopics,
  // This session's own first: a book just closed may not be written yet.
  position: async (bookId) => lastReadingPosition(bookId) ?? (await getViewState(bookId)),
  today: () => todayLocal(),
};

/**
 * Open a card's book. A study's newest version takes the reader's marks from
 * the one before it first (docs/info/91 「版本」).
 */
export function openShelfCard(
  card: IssueCard | VolumeCard,
  library: ShelfContext["library"],
  onOpenBook: (bookId: string, name: string) => void,
): void {
  const go = () => onOpenBook(card.bookId, cardBookName(card, library));
  if ("study" in card && card.study) void prepareStudyBook(card.bookId).catch(() => null).finally(go);
  else go();
}
