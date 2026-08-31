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
