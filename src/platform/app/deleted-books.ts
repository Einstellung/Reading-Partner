// The deletion log: what the reader deleted, one line per event, at the AppData
// root. Named for the books it began with; it carries every kind whose deletion
// has to reach the other devices (docs/50).
//
// A file-level delete does not travel over sync: the device that still holds
// annotations-<bookId>.json republishes it and the book comes back (docs/13,
// pitfall 208). So the deletion travels as a record instead, and every device
// that reads this file drops what the deleted thing owned. What "owns" means is
// platform/sync/dead-paths.ts; this module is only the file.
//
// JSONL because the records merge identifies a line by the line itself
// (platform/sync/merge/records.ts, "lines" kind): the union of two devices'
// copies is every event either of them saw, and no line is ever lost.
//
// Append-only, and a line is an event rather than a state: deleting a thing
// appends a delete, importing a book that was deleted appends a revive, and
// what the thing is right now is whichever event is latest. Two devices can
// disagree only about the order of two events, and both resolve it the same
// way from the same union, so they converge. A tie goes to the delete.
//
// Two line shapes. A book's delete is `{"bookId","at"}`, the shape the first
// build wrote and the only one an older client reads, so the deletion of a book
// still reaches a device that has not upgraded. Everything else is
// `{"kind","id","op","at"}`. `at` is the moment of the event: a full ISO time
// on lines written now, a bare day on the old ones, and the two compare as
// strings — a day sorts before any moment inside it.
//
// Never compacted. A line is under a hundred bytes and the count is bounded by
// how many deletions the reader ever made; dropping one would let a device that
// was offline at the time push the thing back.

import { appData } from "./appdata";
import { writeTextAtomic } from "./atomic-fs";

export const DELETED_BOOKS_FILE = "deleted-books.jsonl";

export const TOMBSTONE_KINDS = ["book", "retell", "outline", "rehearsal", "topic"] as const;
export type TombstoneKind = (typeof TOMBSTONE_KINDS)[number];
export type TombstoneOp = "delete" | "revive";

export interface Tombstone {
  kind: TombstoneKind;
  id: string;
  op: TombstoneOp;
  at: string;
}

/** What is deleted right now, by kind. */
export type Deletions = Readonly<Record<TombstoneKind, ReadonlySet<string>>>;

export function emptyDeletions(): Record<TombstoneKind, Set<string>> {
  return { book: new Set(), retell: new Set(), outline: new Set(), rehearsal: new Set(), topic: new Set() };
}

function isKind(value: unknown): value is TombstoneKind {
  return typeof value === "string" && (TOMBSTONE_KINDS as readonly string[]).includes(value);
}

// One line, or null for anything that is not an event. Tolerant on purpose: a
// line that does not parse is skipped rather than failing the read, because
// every caller is deciding what to delete and a file it could not read must not
// be read as "nothing was deleted" halfway through.
function parseLine(line: string): Tombstone | null {
  let value: Record<string, unknown> | null;
  try {
    value = JSON.parse(line) as Record<string, unknown> | null;
  } catch {
    return null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const at = typeof value.at === "string" ? value.at : "";
  if (typeof value.bookId === "string" && value.bookId !== "") {
    return { kind: "book", id: value.bookId, op: "delete", at };
  }
  if (!isKind(value.kind)) return null;
  if (typeof value.id !== "string" || value.id === "") return null;
  const op = value.op === "revive" ? "revive" : value.op === "delete" ? "delete" : null;
  if (op === null) return null;
  return { kind: value.kind, id: value.id, op, at };
}

/** Every event the lines carry, in file order. */
export function parseTombstones(text: string): Tombstone[] {
  const out: Tombstone[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line === "") continue;
    const t = parseLine(line);
    if (t) out.push(t);
  }
  return out;
}

// Whether `a` is the later of two events about one thing. A tie goes to the
// delete: the delete is the one the reader asked for by name, and a revive can
// be asked for again by importing again.
function later(a: Tombstone, b: Tombstone): boolean {
  if (a.at !== b.at) return a.at > b.at;
  return a.op === "delete" && b.op !== "delete";
}

/** The latest event per thing, keyed "kind id". */
function latest(text: string): Map<string, Tombstone> {
  const out = new Map<string, Tombstone>();
  for (const t of parseTombstones(text)) {
    const key = `${t.kind} ${t.id}`;
    const seen = out.get(key);
    if (!seen || later(t, seen)) out.set(key, t);
  }
  return out;
}

/** What the lines say is deleted right now. */
export function effectiveDeletions(text: string): Deletions {
  const out = emptyDeletions();
  for (const t of latest(text).values()) {
    if (t.op === "delete") out[t.kind].add(t.id);
  }
  return out;
}

export function isDeleted(deletions: Deletions, kind: TombstoneKind, id: string): boolean {
  return deletions[kind].has(id);
}

/** The book ids the lines say are deleted right now. */
export function parseDeletedBooks(text: string): Set<string> {
  return new Set(effectiveDeletions(text).book);
}

/** One line, keys in a fixed order so two devices recording the same event write the same bytes. */
export function tombstoneLine(t: Tombstone): string {
  if (t.kind === "book" && t.op === "delete") return JSON.stringify({ bookId: t.id, at: t.at });
  return JSON.stringify({ kind: t.kind, id: t.id, op: t.op, at: t.at });
}

/**
 * The file's text with one more event in it, or the text unchanged when the
 * thing is already in the state the event asks for. Append-only: an existing
 * line is never rewritten, because a rewritten line is a different record to
 * the merge and both versions would survive the union.
 *
 * Pure, so the idempotence can be pinned without a filesystem.
 */
export function appendTombstoneLine(text: string, t: Tombstone): string {
  const deleted = isDeleted(effectiveDeletions(text), t.kind, t.id);
  if (deleted === (t.op === "delete")) return text;
  const line = tombstoneLine(t);
  if (text === "") return `${line}\n`;
  return text.endsWith("\n") ? `${text}${line}\n` : `${text}\n${line}\n`;
}

export function appendDeletedBookLine(text: string, bookId: string, at: string): string {
  return appendTombstoneLine(text, { kind: "book", id: bookId, op: "delete", at });
}

/** The moment of an event, as the line carries it. */
export function tombstoneAt(now: number): string {
  return new Date(now).toISOString();
}

// Missing is an empty log. Anything else that stops the read is an error, and
// it is thrown: a caller about to append would otherwise rewrite the log as its
// one line, and the merge would carry that as the deletion of every other line
// on every device (pitfall 208).
async function readText(): Promise<string> {
  try {
    return await appData.readText(DELETED_BOOKS_FILE);
  } catch (e) {
    if (await appData.exists(DELETED_BOOKS_FILE)) throw e;
    return "";
  }
}

/** Everything this device knows to be deleted. Throws when the log is there and will not read. */
export async function readDeletions(): Promise<Deletions> {
  return effectiveDeletions(await readText());
}

/** Every book id this device knows to be deleted. */
export async function readDeletedBooks(): Promise<Set<string>> {
  return new Set((await readDeletions()).book);
}

// One append at a time. A cascade appends several lines in a row, and two
// appends that read the same text would each write their own line over the
// other's (pitfall 338).
let appends: Promise<unknown> = Promise.resolve();

async function append(t: Tombstone): Promise<void> {
  const run = async () => {
    const text = await readText();
    const next = appendTombstoneLine(text, t);
    if (next === text) return;
    await writeTextAtomic(DELETED_BOOKS_FILE, next);
  };
  const next = appends.then(run, run);
  appends = next.catch(() => {});
  return next;
}

/** Record that a thing is gone. Writes nothing when it already is. */
export function recordDeletion(kind: TombstoneKind, id: string, now: number): Promise<void> {
  return append({ kind, id, op: "delete", at: tombstoneAt(now) });
}

/** Record that a deleted thing is back. Writes nothing when it was not deleted. */
export function recordRevival(kind: TombstoneKind, id: string, now: number): Promise<void> {
  return append({ kind, id, op: "revive", at: tombstoneAt(now) });
}

/** Record that a book is gone; `at` is the moment as the line carries it. */
export async function appendDeletedBook(bookId: string, at: string): Promise<void> {
  await append({ kind: "book", id: bookId, op: "delete", at });
}
