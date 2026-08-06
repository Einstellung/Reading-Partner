// Opening snapshot (docs/02 part 2, read side): a short per-topic digest
// injected at conversation start — reading position, open stuck-points, recent
// understandings. A snapshot, not a dump: hard caps per type and overall.

import { serializeIndexLine } from "./files";
import type { MemoryIndexEntry, MemoryType } from "./types";

const PER_TYPE_CAP: Record<MemoryType, number> = {
  "reading-position": 2,
  "stuck-point": 4,
  "understood-concept": 3,
  belief: 3,
  correction: 2,
};
const TOTAL_CAP = 12;

// Order in which the sections matter to a fresh conversation.
const TYPE_ORDER: MemoryType[] = [
  "reading-position",
  "stuck-point",
  "understood-concept",
  "belief",
  "correction",
];

// Index entries -> snapshot lines. Entries within a type keep newest-updated
// first. Empty input yields "" (the caller then skips the whole section).
export function buildMemorySnapshot(entries: MemoryIndexEntry[]): string {
  const lines: string[] = [];
  for (const type of TYPE_ORDER) {
    const ofType = entries
      .filter((e) => e.type === type)
      .sort((a, b) => b.updated.localeCompare(a.updated))
      .slice(0, PER_TYPE_CAP[type]);
    for (const e of ofType) {
      if (lines.length >= TOTAL_CAP) return lines.join("\n");
      lines.push(serializeIndexLine(e));
    }
  }
  return lines.join("\n");
}

// The memory paragraph appended to the conversation system prompt: the snapshot
// plus the tool guidance (active recall discipline, correction ownership).
export function memoryPromptSection(snapshot: string, hasTools: boolean): string {
  const lines: string[] = [];
  if (snapshot) {
    lines.push(
      "What you remember about this reader in this topic (from earlier sessions;",
      "dates are absolute):",
      snapshot,
    );
  }
  if (hasTools) {
    if (lines.length > 0) lines.push("");
    lines.push(
      "Memory tools:",
      "memory_search(query) keyword-searches your long-term memory of this reader;",
      "memory_read(id) reads one memory in full (with its evidence anchors);",
      "memory_update(action, ...) creates, updates, or deletes a memory.",
      "",
      "Before answering a question about the reader's own history (what they read,",
      "asked, believed, or struggled with), first think about what to look for —",
      "which book, which concept, roughly when — then search memory. Check whether",
      "what came back actually answers the question; if it doesn't, re-search with",
      "different terms before concluding you don't know.",
      "",
      "Memory is yours to maintain; the user never edits it directly. If the user",
      "says something you remember is wrong, fix that memory with memory_update",
      "right away and acknowledge briefly.",
    );
  }
  return lines.join("\n");
}
