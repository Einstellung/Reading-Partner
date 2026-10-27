// The info shelf (docs/info/88 「info 书架与专题册」), minus React: the issues
// of the nightly brief newest first, and the topic volumes in a row of their
// own. Drawn by InfoShelf.tsx in both shells.
//
// The index (info-shelf.json) has one writer, the collector, so nothing the
// reader does here writes it. What the reader does shows through the library
// and the topics instead: a book deleted is no longer in the library, and a
// volume moved into a reading topic is on that topic, and either way its row
// is left out here.
//
// A study's brief (docs/info/91) is one card ahead of the issues, under its
// own cover, opening its current version: the newest, unless the reader went
// back to an earlier one (the study's record, topic-search/study.ts). Once any
// of its versions is filed into reading, the card is gone from here.
//
// A search whose last run failed at a model call (a rejected model, a lost
// sign-in, a provider error; the shelf's `stalls`) says why: on its study's
// card when it has one, else on a card of its own that opens nothing.

import { t } from "../../../i18n";
import { getLocale } from "../../../i18n/locale";
import { INFO_SHELF_FILE, parseShelf, type InfoShelf, type IssueEntry, type ShelfStall, type VolumeEntry } from "../../../info/issue/types";
import { stageFailure, stageFailureLine } from "../../../info/topic-search/stage-failure";
import { localDay } from "../../../info/topic-search/windows";
import { currentVersion, parseStudyFile, studyFileName, type StudyRollback } from "../../../info/topic-search/study";
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
  /** A study's brief: the topic, which the cover shows in place of the date; null on an issue of the nightly brief. */
  study: { name: string; version: number } | null;
  /** Why the search's last run failed, one line; null when it did not. A card with no book (`bookId` "") has only this to say. */
  failure: string | null;
  /** When the book was made, epoch ms: the issue's, the study version's, or the stall's. */
  at: number;
  /** Entries plus notes in the book; 0 on a card with no book. */
  items: number;
}

export interface VolumeCard {
  id: string;
  bookId: string;
  title: string;
  createdAt: number;
  /** Pieces bound into it; null on a row written before the count was kept. */
  items: number | null;
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
  /** The issues' and volumes' books that have been opened on this device. */
  opened: ReadonlySet<string>;
  /** When each opened book was last read (ViewState.readAt), where its position says. */
  readAt?: Readonly<Record<string, number>>;
  /** Local date, YYYY-MM-DD. */
  today: string;
  /** Each study's rollbacks by search id, from its record; absent for none. */
  rollbacks?: Readonly<Record<string, readonly StudyRollback[]>>;
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

function studySearchId(issue: Pick<IssueEntry, "key">): string {
  return issue.key.startsWith("first:") ? issue.key.slice("first:".length) : issue.key;
}

/** The line a stall says; null when its words name no failure (an older build's, or a stopped run's). */
function stallLine(stall: ShelfStall | undefined): string | null {
  const failure = stall ? stageFailure(stall.why) : null;
  return failure ? stageFailureLine(failure, getLocale()) : null;
}

/** A failed search with no card of its own to say it on: a card with no book. */
function stallCard(stall: ShelfStall, failure: string): IssueCard {
  return {
    key: `stall:${stall.searchId}`,
    bookId: "",
    title: t("info.shelf.stalled"),
    dateLabel: issueDateLabel(localDay(stall.at)),
    topicsLine: stall.topic,
    itemsLine: "",
    isNew: false,
    study: null,
    failure,
    at: stall.at,
    items: 0,
  };
}

/** A study's card: its current version's book; null once a version is in reading or no version's book is here. */
function studyCard(issue: IssueEntry, ctx: ShelfContext, stall?: ShelfStall): IssueCard | null {
  const versions = (issue.study?.versions ?? []).filter((v) => ctx.library[v.bookId]);
  if (versions.length === 0 || issue.study!.versions.some((v) => ctx.filed.has(v.bookId))) return null;
  const n = currentVersion(versions, ctx.rollbacks?.[studySearchId(issue)] ?? []);
  const v = versions.find((x) => x.n === n) ?? versions[versions.length - 1];
  const name = issue.topics[0]?.name ?? "";
  return {
    key: issue.key,
    bookId: v.bookId,
    title: t("info.issue.book.study.kicker"),
    dateLabel: issueDateLabel(v.date),
    topicsLine: name,
    itemsLine: t("info.shelf.studyLine", { n: v.n, count: v.items }),
    isNew: !ctx.opened.has(v.bookId),
    study: { name, version: v.n },
    failure: stallLine(stall),
    at: v.at,
    items: v.items,
  };
}

export function infoShelfView(shelf: InfoShelf, ctx: ShelfContext): InfoShelfView {
  const stallOf = new Map((shelf.stalls ?? []).map((x) => [x.searchId, x]));
  const studies = shelf.issues
    .filter((issue) => issue.study)
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((issue) => studyCard(issue, ctx, stallOf.get(studySearchId(issue))))
    .filter((card): card is IssueCard => card !== null);
  const told = new Set(studies.filter((c) => c.failure).map((c) => studySearchId(c)));
  const stalls = [...stallOf.values()]
    .filter((x) => !told.has(x.searchId))
    .sort((a, b) => b.at - a.at)
    .flatMap((x) => {
      const line = stallLine(x);
      return line ? [stallCard(x, line)] : [];
    });
  const issues = shelf.issues
    .filter((issue) => !issue.study && ctx.library[issue.bookId])
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
        study: null,
        failure: null,
        at: issue.createdAt,
        items: issue.items,
      }),
    );
  const volumes = shelf.volumes
    .filter((v) => ctx.library[v.bookId] && !ctx.filed.has(v.bookId))
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((v): VolumeCard => ({ id: v.id, bookId: v.bookId, title: v.title, createdAt: v.createdAt, items: v.items ?? null }));
  return { issues: [...stalls, ...studies, ...issues], volumes };
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
  /** This device's reading position for the book (getViewState), null when it was never opened here. */
  position(bookId: string): Promise<{ readAt?: number } | null>;
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
  const books = [
    ...shelf.issues.flatMap((issue) => [issue.bookId, ...(issue.study?.versions.map((v) => v.bookId) ?? [])]),
    ...shelf.volumes.map((v) => v.bookId),
  ];
  const opened = new Set<string>();
  const readAt: Record<string, number> = {};
  await Promise.all(
    [...new Set(books)].map(async (bookId) => {
      const position = await io.position(bookId).catch(() => null);
      if (!position) return;
      opened.add(bookId);
      if (typeof position.readAt === "number") readAt[bookId] = position.readAt;
    }),
  );
  const rollbacks: Record<string, readonly StudyRollback[]> = {};
  await Promise.all(
    shelf.issues
      .filter((issue) => issue.study)
      .map(async (issue) => {
        const searchId = studySearchId(issue);
        try {
          const text = await io.readText(studyFileName(searchId));
          const file = text ? parseStudyFile(JSON.parse(text)) : null;
          if (file?.rollbacks.length) rollbacks[searchId] = file.rollbacks;
        } catch {
          // No record, or one that does not read: the newest version.
        }
      }),
  );
  return { shelf, ctx: { library, filed: filedBookIds(topics), opened, readAt, today: io.today(), rollbacks } };
}
