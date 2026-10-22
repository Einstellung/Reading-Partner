// The info shelf's index (docs/info/88 「info 书架与专题册」): `info-shelf.json`,
// synced. One row per issue of the nightly brief — its date, number, topics and
// the library entry (book id) the EPUB was filed as — and one per topic volume
// (专题册). Issues are written by the collecting desktop when it assembles one;
// volumes are filled in by a later slice and only have their shape here.
//
// The books themselves are ordinary library entries of kind "issue", on no
// reading topic, so no reading shelf shows them.

import type { BoxItem } from "../../box/types";
import type { IssueOpeningRecord } from "./opening-record";

export const INFO_SHELF_FILE = "info-shelf.json";
export const INFO_SHELF_VERSION = 1;

/** A box item that hands the reader one issue; its body is the issue's book id. */
export const ISSUE_BOX_KIND = "brief-issue";

export interface IssueEntry {
  /** What the issue was assembled for: "night:<date>", or "first:<searchId>" for a first look's own issue. */
  key: string;
  /** 1, 2, 3 …, counting every issue ever made on this account. */
  number: number;
  /** Local date the issue is dated, YYYY-MM-DD. */
  date: string;
  topics: { searchId: string; name: string }[];
  /** The result files (ids, without ".json") it was made from. */
  results: string[];
  /** Entries in the body plus notes. */
  items: number;
  /** The library entry (content hash) of the EPUB. */
  bookId: string;
  boxItemId: string;
  createdAt: number;
  /** What the companion says when the issue is first opened (opening-record.ts); absent on issues made before it. */
  opening?: IssueOpeningRecord;
  /**
   * A study's brief (docs/info/91): every version made, oldest first. The row
   * is the study's first look's (`first:<searchId>`); its `bookId`, `items`
   * and `opening` are the newest version's. Absent on any other issue.
   */
  study?: IssueStudy;
}

export interface IssueStudy {
  /** The newest version made. Which one the shelf opens also heeds the study's rollbacks (topic-search/study.ts currentVersion). */
  current: number;
  versions: IssueStudyVersion[];
}

export interface IssueStudyVersion {
  /** The version's number in the study's result file (StudyVersion.n). */
  n: number;
  /** The library entry (content hash) of this version's book. */
  bookId: string;
  /** StudyVersion.at, epoch ms. */
  at: number;
  /** Local date the version's book is dated, YYYY-MM-DD. */
  date: string;
  /** The one line of what changed ("2 added · 1 rewritten"), in the locale it was made in. */
  line: string;
  /** Entries plus notes in this version. */
  items: number;
  /** The box item that handed this version over. */
  boxItemId: string;
}

/** The study row and version a book belongs to; null when the book is no study version. */
export function studyOfBook(shelf: InfoShelf, bookId: string): { issue: IssueEntry; version: IssueStudyVersion } | null {
  for (const issue of shelf.issues) {
    const version = issue.study?.versions.find((v) => v.bookId === bookId);
    if (version) return { issue, version };
  }
  return null;
}

/** A topic volume (合订本) on the info shelf. Filled by the volume slice. */
export interface VolumeEntry {
  id: string;
  title: string;
  bookId: string;
  searchId: string | null;
  createdAt: number;
}

/**
 * A topic search whose last run failed at a stage a model call could not do
 * (a rejected model, a lost sign-in, a provider error): its result file's
 * `unjudged.why`, kept on the shelf so the row says why rather than showing
 * nothing new (topic-search/stage-failure.ts). One per search, the latest;
 * gone once a later run of that search closes without failing.
 */
export interface ShelfStall {
  searchId: string;
  /** The topic's name when the run closed. */
  topic: string;
  runId: string | null;
  /** The model call's words (ResultUnjudged.why). */
  why: string;
  at: number;
  /** Whether the search is a study (docs/info/91). */
  study: boolean;
}

export interface InfoShelf {
  version: typeof INFO_SHELF_VERSION;
  issues: IssueEntry[];
  volumes: VolumeEntry[];
  /** Absent when no search has failed. */
  stalls?: ShelfStall[];
}

export function emptyShelf(): InfoShelf {
  return { version: INFO_SHELF_VERSION, issues: [], volumes: [] };
}

/** The shelf read back; an unreadable or foreign file reads as empty. */
export function parseShelf(text: string | null): InfoShelf {
  if (!text) return emptyShelf();
  try {
    const v = JSON.parse(text) as Partial<InfoShelf>;
    if (v.version !== INFO_SHELF_VERSION) return emptyShelf();
    return {
      version: INFO_SHELF_VERSION,
      issues: Array.isArray(v.issues) ? v.issues : [],
      volumes: Array.isArray(v.volumes) ? v.volumes : [],
      ...(Array.isArray(v.stalls) && v.stalls.length ? { stalls: v.stalls } : {}),
    };
  } catch {
    return emptyShelf();
  }
}

/** The number the next issue takes. */
export function nextIssueNumber(shelf: InfoShelf): number {
  return shelf.issues.reduce((most, i) => Math.max(most, i.number), 0) + 1;
}

/** The book a brief-issue box item opens; null for any other item. */
export function issueBookOfItem(item: Pick<BoxItem, "kind" | "body">): string | null {
  return item.kind === ISSUE_BOX_KIND && item.body ? item.body : null;
}
