// The info shelf (docs/info/88 「info 书架与专题册」), minus React: the issues
// of the nightly brief newest first, and the topic volumes in a row of their
// own. Drawn by InfoShelf.tsx in both shells.
//
// The index (info-shelf.json) has one writer, the collector, so nothing the
// reader does here writes it. What the reader does shows through the library
// and the topics instead: a book deleted is no longer in the library, and a
// volume moved into a reading topic is on that topic, and either way its row
// is left out here.

import { t } from "../../../i18n";
import { getLocale } from "../../../i18n/locale";
import { INFO_SHELF_FILE, parseShelf, type InfoShelf, type VolumeEntry } from "../../../info/issue/types";
import { documentPath, type LibraryEntry } from "../../../platform/app/library";
import type { FiledElsewhere, Topic } from "../../../platform/app/topics";
import { alreadyInLine, movedLine } from "../shelf/move-to";

export interface IssueCard {
  key: string;
  bookId: string;
  /** "Brief No. 12". */
  title: string;
  /** "Oct 15", in the UI's language. */
  dateLabel: string;
  /** The topics it covers, comma-separated. */
  topicsLine: string;
  /** "4 items". */
  itemsLine: string;
  /** Today's, or never opened on this device. */
  isNew: boolean;
}

export interface VolumeCard {
  id: string;
  bookId: string;
  title: string;
}

export interface InfoShelfView {
  issues: IssueCard[];
  volumes: VolumeCard[];
}

export interface ShelfContext {
  /** library.json's books by id. */
  library: Readonly<Record<string, LibraryEntry>>;
  /** Every book id on some reading topic. */
  filed: ReadonlySet<string>;
  /** The issues' books that have been opened on this device. */
  opened: ReadonlySet<string>;
  /** Local date, YYYY-MM-DD. */
  today: string;
}

/** Every book id on some reading topic. */
export function filedBookIds(topics: readonly Topic[]): Set<string> {
  const out = new Set<string>();
  for (const topic of topics) for (const file of topic.files) if (file.hash) out.add(file.hash);
  return out;
}

/** "Oct 15" for 2026-10-15, in the given locale; the raw string when it is not a date. */
export function issueDateLabel(date: string, locale: string = getLocale()): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return date;
  const at = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  try {
    return at.toLocaleDateString(locale, { month: "short", day: "numeric" });
  } catch {
    return date;
  }
}

export function infoShelfView(shelf: InfoShelf, ctx: ShelfContext): InfoShelfView {
  const issues = shelf.issues
    .filter((issue) => ctx.library[issue.bookId])
    .sort((a, b) => b.date.localeCompare(a.date) || b.number - a.number)
    .map(
      (issue): IssueCard => ({
        key: issue.key,
        bookId: issue.bookId,
        title: t("info.shelf.issueTitle", { number: issue.number }),
        dateLabel: issueDateLabel(issue.date),
        topicsLine: issue.topics.map((tp) => tp.name).join(", "),
        itemsLine: t("info.shelf.items", { count: issue.items }),
        isNew: issue.date === ctx.today || !ctx.opened.has(issue.bookId),
      }),
    );
  const volumes = shelf.volumes
    .filter((v) => ctx.library[v.bookId] && !ctx.filed.has(v.bookId))
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((v): VolumeCard => ({ id: v.id, bookId: v.bookId, title: v.title }));
  return { issues, volumes };
}

/** The book a card opens, under the name the reader shows. */
export function cardBookName(card: IssueCard | VolumeCard, library: ShelfContext["library"]): string {
  return library[card.bookId]?.title || card.title;
}

export interface FileVolumeIo {
  addFileToTopic(topicId: string, path: string, hash: string, name?: string): Promise<FiledElsewhere | null>;
}

/**
 * Move… a volume into a reading topic. A volume starts on no topic, so its first
 * move is an add (addFileToTopic), not a move between topics. Returns the line
 * the toast says.
 */
export async function fileVolume(
  volume: Pick<VolumeEntry | VolumeCard, "bookId" | "title">,
  entry: LibraryEntry | undefined,
  to: { id: string; name: string },
  io: FileVolumeIo,
): Promise<string> {
  const fileName = entry?.originalFilename || `${volume.title}.epub`;
  const elsewhere = await io.addFileToTopic(to.id, documentPath(volume.bookId, fileName), volume.bookId, volume.title);
  return elsewhere ? alreadyInLine(elsewhere.topic.name) : movedLine(to.name);
}

export interface InfoShelfIo {
  readText(path: string): Promise<string | null>;
  library(): Promise<Record<string, LibraryEntry>>;
  topics(): Promise<Topic[]>;
  /** Whether this device has a reading position for the book. */
  opened(bookId: string): Promise<boolean>;
  today(): string;
}

export interface InfoShelfData {
  shelf: InfoShelf;
  ctx: ShelfContext;
}

/** Everything the screen draws from, read once. */
export async function loadInfoShelf(io: InfoShelfIo): Promise<InfoShelfData> {
  const [text, library, topics] = await Promise.all([io.readText(INFO_SHELF_FILE), io.library(), io.topics()]);
  const shelf = parseShelf(text);
  const opened = new Set<string>();
  await Promise.all(
    shelf.issues.map(async (issue) => {
      if (await io.opened(issue.bookId).catch(() => false)) opened.add(issue.bookId);
    }),
  );
  return { shelf, ctx: { library, filed: filedBookIds(topics), opened, today: io.today() } };
}
