// The source records of links taken in (docs/86 「来源记录」): one per pasted
// link, keyed `<reader>:<id>` — an X post's id, a web page's normalized URL —
// with the documents it led to, the run's trail and the model's closing note.
// The record is the source information of those documents, kept beside them
// rather than in their bodies; a link that led to nothing is kept all the same.
//
// One file, a map by key, records-merged when synced: two devices taking in two
// links both keep theirs, and the same link taken in again replaces its own
// entry with what the newer run found, keeping the documents of the earlier one.

import { appGuardedFileIo, readGuardedFile, type GuardedFileIo } from "../../platform/app/guarded-file";
import { isObject } from "../../platform/std/json";
import type { TrailStep } from "./session";

export const LINK_RECORDS_FILE = "info-link-records.json";

export interface LinkRecordEntry {
  /** The reader's name: x, web. */
  source: string;
  /** The link as it was pasted. */
  url: string;
  /** The reader's own source data, plain: an X post's XPostRecord, a page's title. */
  record: unknown;
  /** Library hashes of the documents that came of it. */
  documents: string[];
  /** One step per tool call. */
  trail: TrailStep[];
  /** The model's closing note, when it left one. */
  note?: string;
  /** Epoch milliseconds of the run this entry is from. */
  takenAt: number;
}

export interface LinkRecordsFile {
  records: Record<string, LinkRecordEntry>;
}

export type LinkRecordsIo = GuardedFileIo<LinkRecordsFile>;

const linkRecordsIo: LinkRecordsIo = appGuardedFileIo();

export function parseLinkRecordsFile(raw: unknown): LinkRecordsFile | null {
  if (!isObject(raw)) return null;
  return { records: isObject(raw.records) ? (raw.records as Record<string, LinkRecordEntry>) : {} };
}

/** Every record kept so far, by key. */
export async function loadLinkRecords(io: LinkRecordsIo = linkRecordsIo): Promise<Record<string, LinkRecordEntry>> {
  return (await readGuardedFile(io, LINK_RECORDS_FILE, parseLinkRecordsFile))?.records ?? {};
}

/**
 * Keep one link's record. The documents of an earlier run on the same key stay
 * listed: taking it in again on another book does not unmake them.
 */
export async function saveLinkRecord(
  key: string,
  entry: LinkRecordEntry,
  io: LinkRecordsIo = linkRecordsIo,
): Promise<void> {
  const records = await loadLinkRecords(io);
  const before = records[key]?.documents ?? [];
  records[key] = { ...entry, documents: [...new Set([...before, ...entry.documents])] };
  await io.write(LINK_RECORDS_FILE, JSON.stringify({ records }, null, 2));
}
