// Old issues going (docs/info/88 「info 书架与专题册」, docs/80): the garbage
// marker that says which issues of the nightly brief are past their keep, and
// the flow that deletes one.
//
// An issue is a book, so it goes the way a book does — tombstone, threads,
// marks, supplements — through reading's deleteBook, which the shell hands in:
// info does not import reading. The marker's mark names info-shelf.json (the
// palace row that names this marker) with the issue's key as its subject; the
// flow deletes the book first, dismisses the issue's box item, and drops the
// row after, so a crash in between leaves the row, which the next night marks
// again and deleteBook and the dismissal, being idempotent, finish.
//
// Only the collector runs it: info-shelf.json has one writer, the device that
// assembles the issues, and the book's tombstone carries the deletion to the
// others. Topic volumes are never marked, and an issue nobody opened goes all
// the same.

import type { GarbageMarker, Mark } from "../../housekeeper";
import { INFO_SHELF_FILE, parseShelf, type InfoShelf, type IssueEntry } from "./types";

export const ISSUE_EXPIRY_MARKER = "info-issue-expiry";

/** How long an issue stays, in days after the date it is dated (initial value, docs/info/88). */
export const ISSUE_KEEP_DAYS = 30;

const DAY_MS = 86_400_000;

function dayNumber(date: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / DAY_MS : null;
}

/** The issues dated more than `days` days before `today` (YYYY-MM-DD), oldest first. */
export function expiredIssues(shelf: InfoShelf, today: string, days = ISSUE_KEEP_DAYS): IssueEntry[] {
  const now = dayNumber(today);
  if (now === null) return [];
  return shelf.issues
    .filter((issue) => {
      const at = dayNumber(issue.date);
      return at !== null && now - at > days;
    })
    .sort((a, b) => a.date.localeCompare(b.date) || a.number - b.number);
}

/** The shelf without the issues under these keys. */
export function withoutIssues(shelf: InfoShelf, keys: readonly string[]): InfoShelf {
  const gone = new Set(keys);
  return { ...shelf, issues: shelf.issues.filter((issue) => !gone.has(issue.key)) };
}

export interface IssueExpiryDeps {
  /** Whether this device is the collector, the shelf's one writer. */
  isCollector(): Promise<boolean>;
  /** Reading's deleteBook: the book and everything about it. */
  deleteBook(bookId: string): Promise<void>;
  /** The box item that hands the reader the issue, dismissed: its book is gone. */
  dismissBoxItem(boxItemId: string): Promise<void>;
  readShelf(): Promise<string | null>;
  writeShelf(text: string): Promise<void>;
  /** The local date at `now`, YYYY-MM-DD. */
  today(now: number): string;
  /** Runs the work in line with the issues' assembly, which writes the same file. */
  serial?<T>(work: () => Promise<T>): Promise<T>;
}

export function issueExpiryMarker(deps: IssueExpiryDeps): GarbageMarker {
  const inLine = deps.serial ?? (<T>(work: () => Promise<T>) => work());
  return {
    name: ISSUE_EXPIRY_MARKER,
    async mark({ io, now }) {
      if (!(await deps.isCollector().catch(() => false))) return [];
      const shelf = parseShelf(await io.readText(INFO_SHELF_FILE));
      return expiredIssues(shelf, deps.today(now)).map(
        (issue): Mark => ({
          path: INFO_SHELF_FILE,
          action: "flow",
          subject: issue.key,
          reason: `issue ${issue.number} of ${issue.date}, past ${ISSUE_KEEP_DAYS} days`,
        }),
      );
    },
    carryOut(mark) {
      return inLine(async () => {
        const shelf = parseShelf(await deps.readShelf());
        const issue = shelf.issues.find((one) => one.key === mark.subject);
        if (!issue) return;
        await deps.deleteBook(issue.bookId);
        await deps.dismissBoxItem(issue.boxItemId);
        const latest = parseShelf(await deps.readShelf());
        await deps.writeShelf(`${JSON.stringify(withoutIssues(latest, [issue.key]), null, 2)}\n`);
      });
    },
  };
}
