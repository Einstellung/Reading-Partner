// Observation file formats, pure. One observation per markdown file with a flat
// "key: value" frontmatter (same YAML-lite dialect as prep notes), and an index
// file with one parseable line per observation. Parsing is tolerant: a malformed
// file or line reads as null and is skipped by the store.

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
// consistent clock will do, while this one dates something the reader remembers
// happening. At UTC+8 an hour of late-night reading falls on the previous UTC
// day, so a conversation held after midnight would be written up as the day
// before — a small version of exactly the lie this is here to stop.
export function localDate(now: number): string {
  const d = new Date(now);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Summaries are one line by contract: collapse whitespace so neither the
// frontmatter nor the index format can be broken by a newline.
export function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function line(key: string, value: string): string | null {
  return value === "" ? null : `${key}: ${value}`;
}

export function serializeObservation(entry: Observation): string {
  const lines = [
    line("id", entry.id),
    line("type", entry.type),
    line("created", entry.created),
    line("updated", entry.updated),
    line("summary", oneLine(entry.summary)),
    line("book", entry.bookId ?? ""),
    line("annotations", entry.anchors.annotationIds.join(", ")),
    line("messages", entry.anchors.messageIds.join(", ")),
  ].filter((l): l is string => l !== null);
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
  return {
    id,
    type,
    summary: fields.get("summary") ?? "",
    // Absent on every file written before the field existed, which is why it is
    // optional rather than "": a lecture asks "is this about the open book",
    // and "" would have to be special-cased at every asking.
    ...(bookId ? { bookId } : {}),
    body: text.slice(m[0].length).trim(),
    created: fields.get("created") ?? "",
    updated: fields.get("updated") ?? "",
    anchors: {
      annotationIds: splitList(fields.get("annotations") ?? ""),
      messageIds: splitList(fields.get("messages") ?? ""),
    },
  };
}

// --- index file: one line per observation, loaded into context as-is ---

export function serializeIndexLine(e: ObservationIndexEntry): string {
  return `- [${e.type}] ${oneLine(e.summary)} (updated ${e.updated}, id ${e.id})`;
}

const INDEX_LINE = /^- \[([a-z-]+)\] (.*) \(updated (\d{4}-\d{2}-\d{2}), id ([\w-]+)\)$/;

export function parseIndexLine(lineText: string): ObservationIndexEntry | null {
  const m = INDEX_LINE.exec(lineText.trim());
  if (!m || !isObservationType(m[1])) return null;
  return { type: m[1], summary: m[2], updated: m[3], id: m[4] };
}

// Newest-updated first, ties broken by id for a stable file.
export function buildIndex(entries: ObservationIndexEntry[]): string {
  const sorted = [...entries].sort(
    (a, b) => b.updated.localeCompare(a.updated) || a.id.localeCompare(b.id),
  );
  return sorted.map(serializeIndexLine).join("\n") + (sorted.length ? "\n" : "");
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
  const ids = new Set<string>();
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line === "") continue;
    try {
      const value = JSON.parse(line) as { id?: unknown };
      if (typeof value?.id === "string" && value.id !== "") ids.add(value.id);
    } catch {
      continue;
    }
  }
  return ids;
}
