// The reader registry (docs/86 「读法登记表」). A reader knows one kind of
// source and reads a link into "what it is and what it points at": a source
// record, a description, and candidates. It sits beside the bindery's site
// adapters, which read a link into one document (docs/85); a link no reader
// claims goes through the open tool's generic path.
//
// Registered at startup by the domain that knows the source (info/x registers
// X), by name, the last one winning, as for site adapters. info/links never
// imports a reader.

import type { Material, Rejection } from "../../workshop/bindery";
import type { LinkOrigin } from "./hints";

/** One link or piece of content a reading turned up, before it has a number. */
export interface CandidateSeed {
  /** The address it is numbered and deduplicated by. */
  url: string;
  /** Content the reader already holds (a post's whole text as HTML). Absent: the link itself. */
  material?: Material;
  /** The link's own words, where it had any. */
  anchor?: string;
  origin: LinkOrigin;
  /**
   * The opened link's own content. It belongs to the candidate that was opened
   * rather than taking a number of its own, whatever its address spells.
   */
  self?: true;
  /** A few words about it the reader knows and the URL does not say ("X Article, 28 071 characters"). */
  about?: string;
}

/** What is kept about the source, stored as it is: plain data. */
export interface SourceRecord {
  /** `<reader>:<id>`, the store's key. */
  key: string;
  /** The reader's name. */
  source: string;
  data: unknown;
}

export interface LinkReading {
  ok: true;
  /** One phrase for the receipt: "a long post by @a (2026-10-08)". */
  receipt: string;
  /** What the model is told the source is, a few lines. */
  lines: string[];
  record: SourceRecord;
  candidates: CandidateSeed[];
  /** What the reading did not give and why ("the long post's full text needs the desktop app"). */
  notes: string[];
  /** Why the source is not content of its own, when no candidate is `self`. */
  selfNote?: string;
}

export interface LinkReader {
  name: string;
  claims(url: string): boolean;
  read(url: string): Promise<LinkReading | Rejection>;
}

const READERS = new Map<string, LinkReader>();

/** Register a reader. Returns a function that removes it again. */
export function registerLinkReader(reader: LinkReader): () => void {
  READERS.set(reader.name, reader);
  return () => {
    if (READERS.get(reader.name) === reader) READERS.delete(reader.name);
  };
}

export function registeredLinkReaders(): readonly LinkReader[] {
  return [...READERS.values()];
}

/** The first reader in `readers` that claims the link, or null. */
export function readerFor(url: string, readers: readonly LinkReader[] = registeredLinkReaders()): LinkReader | null {
  return readers.find((r) => r.claims(url)) ?? null;
}
