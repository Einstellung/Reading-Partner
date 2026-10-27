// The Intel section of the phone home (docs/ui/22), minus React: which of the
// info shelf's books it shows as covers, in what order, and what the label
// under each cover says. The shelf itself (info-shelf.ts) decides what is on
// it; this only picks and orders.
//
// Order is when each book was last read (ViewState.readAt). A book never read
// here goes by when it was made. Unread issues come first, up to half the grid:
// a new issue is the reason to open the app, and four books read after it
// arrived must not push it off the screen; capped, so a backlog nobody opens
// does not hide what is being read.

import { t } from "../../../i18n";
import { documentPath, type LibraryEntry } from "../../../platform/app/library";
import type { FileRef } from "../../../platform/app/topics";
import { volumeCover } from "../../../workshop/bindery/cover-svg";
import type { InfoShelfView, IssueCard, VolumeCard } from "../info/info-shelf";

export const HOME_INTEL_COUNT = 4;
// How many unread issues are held at the top whatever was read since.
export const UNREAD_ON_TOP = 2;

export type IntelItem =
  | { kind: "issue"; card: IssueCard }
  | { kind: "volume"; card: VolumeCard };

function madeAt(item: IntelItem): number {
  return item.kind === "issue" ? item.card.at : item.card.createdAt;
}

function unread(item: IntelItem): boolean {
  return item.kind === "issue" && item.card.isNew;
}

/** The covers the home shows, in the order it shows them. */
export function recentIntel(
  view: InfoShelfView,
  readAt: Readonly<Record<string, number>>,
  count: number = HOME_INTEL_COUNT,
): IntelItem[] {
  const all: IntelItem[] = [
    // A card with no book is a failed search: it opens nothing, so it is not a cover.
    ...view.issues.filter((card) => card.bookId).map((card): IntelItem => ({ kind: "issue", card })),
    ...view.volumes.map((card): IntelItem => ({ kind: "volume", card })),
  ];
  const lastRead = (item: IntelItem) => readAt[item.card.bookId] ?? madeAt(item);
  const newestMade = (a: IntelItem, b: IntelItem) => madeAt(b) - madeAt(a);
  const top = all.filter(unread).sort(newestMade).slice(0, Math.min(UNREAD_ON_TOP, count));
  const rest = all
    .filter((item) => !top.includes(item))
    .sort((a, b) => lastRead(b) - lastRead(a) || newestMade(a, b));
  return [...top, ...rest].slice(0, count);
}

/** The counts on the "All intel" row: studies count as issues. */
export function intelTotals(view: InfoShelfView): { issues: number; volumes: number } {
  return { issues: view.issues.filter((card) => card.bookId).length, volumes: view.volumes.length };
}

export function intelTotalsLine(totals: { issues: number; volumes: number }): string {
  return `${t("phone.home.intelIssues", { count: totals.issues })} · ${t("phone.home.intelVolumes", { count: totals.volumes })}`;
}

/** The label under a cover: three lines, the second in the accent colour on a study. */
export interface IntelLabel {
  title: string;
  line: string;
  meta: string;
  accent: boolean;
  isNew: boolean;
}

export function intelLabel(item: IntelItem): IntelLabel {
  if (item.kind === "volume") {
    const { card } = item;
    return {
      title: card.title,
      line: t("phone.home.volumeLine"),
      meta: card.items === null ? "" : t("info.shelf.items", { count: card.items }),
      accent: false,
      isNew: false,
    };
  }
  const { card } = item;
  if (card.study) {
    return {
      title: card.study.name,
      line: t("phone.home.studyLine", { n: card.study.version }),
      meta: t("info.shelf.items", { count: card.items }),
      accent: true,
      isNew: card.isNew,
    };
  }
  return { title: card.title, line: card.topicsLine, meta: card.itemsLine, accent: false, isNew: card.isNew };
}

/** The book as a shelf file, which is what the cover path (CoverBand, useCovers) takes. */
export function intelFile(item: IntelItem, library: Readonly<Record<string, LibraryEntry>>): FileRef {
  const { bookId } = item.card;
  const entry = library[bookId];
  const name = entry?.originalFilename || `${entry?.title || item.card.title}.epub`;
  return { path: documentPath(bookId, name), name, hash: bookId, addedAt: 0 };
}

/**
 * The cover a volume is drawn with when its book has none of its own: the
 * bindery's volume cover from what the card knows. Null without a count, which
 * the cover would print as nought.
 */
export function volumeFallbackCover(card: VolumeCard): string | null {
  if (card.items === null) return null;
  const svg = volumeCover({ series: t("phone.home.volumeLine"), title: card.title, count: card.items, dateRange: "" });
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
