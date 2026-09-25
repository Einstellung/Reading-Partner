// Observation file formats, pure. One observation per markdown file with a flat
// "key: value" frontmatter (same YAML-lite dialect as prep notes), and an index
// file with one parseable line per observation. Parsing is tolerant: a malformed
// file or line reads as null and is skipped by the store.
//
// A frontmatter key this build does not know is carried through rather than
// dropped, because a build cannot upgrade the other device and cannot tell what
// it is running. Two devices sync the same file; if the older one rewrites an
// entry it read, every key it did not understand is written back out missing,
// and the loss is invisible to sync — the prose merge sees an ordinary
// line-level edit, takes the side that differs from base, and converges both
// devices on the shorter file with no conflict copy and no contested flag. That
// is the gate on every field this format may still grow, so the passthrough
// ships before any of them.

import { parseRecordIds } from "../../platform/app/record-lines";
import { oneLine } from "../../platform/std/text";
import {
  isObservationType,
  type Observation,
  type ObservationIndexEntry,
} from "./types";

export function isoDate(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

// The same YYYY-MM-DD on the device's own clock. Two date formatters rather than
// one because they date different things: isoDate stamps a file write, where any
// consistent clock will do, while localDate dates something the reader remembers
// happening. Re-exported from platform because the deleted-books file dates its
// own records the same way.
export { localDate } from "../../platform/std/day";

// The later of two "YYYY-MM-DD" days, for both memory stores: an observation's
// `updated` and a statement's `lastSupported` are each the last day the evidence
// behind them covers, and neither may move backwards. Evidence is folded in
// oldest-first as often as newest-first — a dream pass works through a backlog —
// so a pass reading an older conversation must not make either look staler than
// what it already carries.
export function laterDay(a: string, b: string): string {
  return a > b ? a : b;
}

// Append to a list of ids, keeping it unique and in order. Whitespace around an
// entry is not part of the id: a statement given " m-abc" after "m-abc" would
// otherwise cite the same observation twice. Only what is being appended is
// normalized — entries already on disk are passed through untouched, so no read
// of an old file rewrites it.
export function appendUnique(existing: readonly string[], added: readonly string[]): string[] {
  const out = [...existing];
  const seen = new Set(existing);
  for (const item of added) {
    const value = item.trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

// Summaries are one line by contract: collapse whitespace so neither the
// frontmatter nor the index format can be broken by a newline. Re-exported
// because the store states the same contract when it writes one.
export { oneLine };

function line(key: string, value: string): string | null {
  return value === "" ? null : `${key}: ${value}`;
}

// The keys this build owns. Everything else in the frontmatter is an unknown
// pair on `extra`, and a pair naming one of these is dropped rather than
// written twice: the known field is the one the app acts on, and a second line
// with the same key would win the reparse and silently replace it.
const KNOWN_KEYS = new Set([
  "id",
  "type",
  "created",
  "updated",
  "summary",
  "book",
  "topic",
  "annotations",
  "messages",
]);

// Unknown pairs, sorted by key and appended after the known lines. Two
// properties are load-bearing and both are about the three-way line merge in
// platform/sync/merge:
//
// Sorted, by code unit rather than by locale, so two devices holding the same
// pairs write the same bytes — otherwise each would rewrite the other's file on
// every pass, forever.
//
// Ordinary frontmatter lines in a fixed place, not a tail region or a nested
// block. A device that only rewrote the body leaves these lines byte-identical
// to base, so chunk3 puts them in a stable chunk and the merge never looks at
// them. A region whose position moved relative to the body would instead land
// in an unstable chunk against a side that edited nearby, and that is what gets
// marked contested.
//
// An empty value keeps its key (`layer:`) rather than being dropped the way an
// empty known field is: an absent known field reparses to "" either way, an
// absent unknown key is gone.
function extraLines(extra: Observation["extra"]): string[] {
  if (!extra) return [];
  return extra
    .filter(([key]) => !KNOWN_KEYS.has(key))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => (value === "" ? `${key}:` : `${key}: ${value}`));
}

export function serializeObservation(entry: Observation): string {
  const lines = [
    line("id", entry.id),
    line("type", entry.type),
    line("created", entry.created),
    line("updated", entry.updated),
    line("summary", oneLine(entry.summary)),
    line("book", entry.bookId ?? ""),
    line("topic", entry.topic ?? ""),
    line("annotations", entry.anchors.annotationIds.join(", ")),
    line("messages", entry.anchors.messageIds.join(", ")),
  ].filter((l): l is string => l !== null);
  lines.push(...extraLines(entry.extra));
  return `---\n${lines.join("\n")}\n---\n\n${entry.body.trim()}\n`;
}

function splitList(value: string): string[] {
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function parseObservation(text: string): Observation | null {
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(text);
  if (!m) return null;
  const fields = new Map<string, string>();
  for (const raw of m[1].split("\n")) {
    const idx = raw.indexOf(":");
    if (idx < 0) continue;
    fields.set(raw.slice(0, idx).trim(), raw.slice(idx + 1).trim());
  }
  const id = fields.get("id") ?? "";
  const type = fields.get("type") ?? "";
  if (!id || !isObservationType(type)) return null;
  const bookId = fields.get("book") ?? "";
  const topic = fields.get("topic") ?? "";
  // A key repeated in the file was already last-one-wins for the known fields
  // (Map.set), and stays that way here: the Map carries one entry per key, so a
  // duplicate unknown key comes back as one pair with the last value.
  const extra = [...fields].filter(([key]) => !KNOWN_KEYS.has(key));
  return {
    id,
    type,
    summary: fields.get("summary") ?? "",
    // Absent on every file written before the field existed, which is why it is
    // optional rather than "": a lecture asks "is this about the open book",
    // and "" would have to be special-cased at every asking.
    ...(bookId ? { bookId } : {}),
    ...(topic ? { topic } : {}),
    body: text.slice(m[0].length).trim(),
    created: fields.get("created") ?? "",
    updated: fields.get("updated") ?? "",
    anchors: {
      annotationIds: splitList(fields.get("annotations") ?? ""),
      messageIds: splitList(fields.get("messages") ?? ""),
    },
    // Omitted rather than [] when there is nothing to carry, so an entry
    // written by this build is deep-equal to the one it parsed back.
    ...(extra.length ? { extra } : {}),
  };
}

// --- index file: one line per observation, loaded into context as-is ---

// One index line as a prompt gets it, with no topic in it. Everything a prompt
// is built for is already one topic's worth (ObservationFileStore.readIndexText,
// reading/lecture/stuck.ts), so the id would be the same on every line and say
// nothing to a model.
export function serializeIndexLine(e: ObservationIndexEntry): string {
  return `- [${e.type}] ${oneLine(e.summary)} (updated ${e.updated}, id ${e.id})`;
}

// The same line as the index file holds it. The file is one flat list over every
// topic and has to say which one a line belongs to, or reading one topic's index
// would mean opening every entry file to find out.
function indexFileLine(e: ObservationIndexEntry): string {
  if (!e.topic) return serializeIndexLine(e);
  return `- [${e.type}] ${oneLine(e.summary)} (updated ${e.updated}, topic ${e.topic}, id ${e.id})`;
}

const INDEX_LINE =
  /^- \[([a-z-]+)\] (.*) \(updated (\d{4}-\d{2}-\d{2}), (?:topic ([^,]*), )?id ([\w-]+)\)$/;

export function parseIndexLine(lineText: string): ObservationIndexEntry | null {
  const m = INDEX_LINE.exec(lineText.trim());
  if (!m || !isObservationType(m[1])) return null;
  return {
    type: m[1],
    summary: m[2],
    updated: m[3],
    ...(m[4] ? { topic: m[4] } : {}),
    id: m[5],
  };
}

// Newest-updated first, ties broken by id for a stable file.
export function buildIndex(entries: ObservationIndexEntry[]): string {
  const sorted = [...entries].sort(
    (a, b) => b.updated.localeCompare(a.updated) || a.id.localeCompare(b.id),
  );
  return sorted.map(indexFileLine).join("\n") + (sorted.length ? "\n" : "");
}

export function parseIndex(text: string): ObservationIndexEntry[] {
  return text
    .split("\n")
    .map(parseIndexLine)
    .filter((e): e is ObservationIndexEntry => e !== null);
}

// --- tombstones: one deleted observation per line ---
//
// JSONL because the records merge identifies a line by the line (records.ts,
// "lines" kind): two devices deleting the same observation on the same day
// write the same bytes and the union holds one line, and no shape mismatch can
// make the file fall back to the opaque strategy. `at` is the day the deletion
// was made, kept because it is the only thing that makes the file readable to
// someone looking at it later; nothing reads it back.

export function serializeTombstone(id: string, at: string): string {
  return JSON.stringify({ id, at });
}

// Append-only: an existing line is never rewritten, because rewriting it would
// make it a different record to the merge and both versions would survive.
export function appendTombstone(text: string, id: string, at: string): string {
  const line = serializeTombstone(id, at);
  if (text === "") return `${line}\n`;
  return text.endsWith("\n") ? `${text}${line}\n` : `${text}\n${line}\n`;
}

// Tolerant like the rest of this file: a line that does not parse, or carries no
// id, is not a tombstone and is skipped rather than failing the read.
export function parseTombstones(text: string): Set<string> {
  return parseRecordIds(text, "id");
}
