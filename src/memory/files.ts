// Memory file formats, pure. One memory per markdown file with a flat
// "key: value" frontmatter (same YAML-lite dialect as prep notes), and an index
// file with one parseable line per memory. Parsing is tolerant: a malformed
// file or line reads as null and is skipped by the store.

import {
  isMemoryType,
  type MemoryEntry,
  type MemoryIndexEntry,
} from "./types";

export function isoDate(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

// Summaries are one line by contract: collapse whitespace so neither the
// frontmatter nor the index format can be broken by a newline.
export function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function line(key: string, value: string): string | null {
  return value === "" ? null : `${key}: ${value}`;
}

export function serializeMemory(entry: MemoryEntry): string {
  const lines = [
    line("id", entry.id),
    line("type", entry.type),
    line("created", entry.created),
    line("updated", entry.updated),
    line("summary", oneLine(entry.summary)),
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

export function parseMemory(text: string): MemoryEntry | null {
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
  if (!id || !isMemoryType(type)) return null;
  return {
    id,
    type,
    summary: fields.get("summary") ?? "",
    body: text.slice(m[0].length).trim(),
    created: fields.get("created") ?? "",
    updated: fields.get("updated") ?? "",
    anchors: {
      annotationIds: splitList(fields.get("annotations") ?? ""),
      messageIds: splitList(fields.get("messages") ?? ""),
    },
  };
}

// --- index file: one line per memory, loaded into context as-is ---

export function serializeIndexLine(e: MemoryIndexEntry): string {
  return `- [${e.type}] ${oneLine(e.summary)} (updated ${e.updated}, id ${e.id})`;
}

const INDEX_LINE = /^- \[([a-z-]+)\] (.*) \(updated (\d{4}-\d{2}-\d{2}), id ([\w-]+)\)$/;

export function parseIndexLine(lineText: string): MemoryIndexEntry | null {
  const m = INDEX_LINE.exec(lineText.trim());
  if (!m || !isMemoryType(m[1])) return null;
  return { type: m[1], summary: m[2], updated: m[3], id: m[4] };
}

// Newest-updated first, ties broken by id for a stable file.
export function buildIndex(entries: MemoryIndexEntry[]): string {
  const sorted = [...entries].sort(
    (a, b) => b.updated.localeCompare(a.updated) || a.id.localeCompare(b.id),
  );
  return sorted.map(serializeIndexLine).join("\n") + (sorted.length ? "\n" : "");
}

export function parseIndex(text: string): MemoryIndexEntry[] {
  return text
    .split("\n")
    .map(parseIndexLine)
    .filter((e): e is MemoryIndexEntry => e !== null);
}
