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
}

/** A topic volume (合订本) on the info shelf. Filled by the volume slice. */
export interface VolumeEntry {
  id: string;
  title: string;
  bookId: string;
  searchId: string | null;
  createdAt: number;
}

export interface InfoShelf {
  version: typeof INFO_SHELF_VERSION;
  issues: IssueEntry[];
  volumes: VolumeEntry[];
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
