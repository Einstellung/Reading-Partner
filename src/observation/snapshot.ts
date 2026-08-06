// Opening snapshot (docs/02 part 2, read side): a short per-topic digest
// injected at conversation start — reading position, open stuck-points, recent
// understandings. A snapshot, not a dump: hard caps per type and overall.

import { serializeIndexLine } from "./files";
import type { ObservationIndexEntry, ObservationType } from "./types";

const PER_TYPE_CAP: Record<ObservationType, number> = {
  "reading-position": 2,
  "stuck-point": 4,
  "understood-concept": 3,
  belief: 3,
  correction: 2,
};
const TOTAL_CAP = 12;

// Order in which the sections matter to a fresh conversation.
const TYPE_ORDER: ObservationType[] = [
  "reading-position",
  "stuck-point",
  "understood-concept",
  "belief",
  "correction",
];

// Index entries -> snapshot lines. Entries within a type keep newest-updated
// first. Empty input yields "" (the caller then skips the whole section).
export function buildObservationSnapshot(entries: ObservationIndexEntry[]): string {
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

// The observations paragraph appended to the conversation system prompt: the
// snapshot plus the tool guidance (active recall discipline, correction
// ownership).
export function observationPromptSection(snapshot: string, hasTools: boolean): string {
  const lines: string[] = [];
  if (snapshot) {
    lines.push(
      "Your observations of this reader in this topic (gathered in earlier",
      "sessions; dates are absolute):",
      snapshot,
    );
  }
  if (hasTools) {
    if (lines.length > 0) lines.push("");
    lines.push(
      "Observation tools:",
      "observation_search(query) keyword-searches your observations of this reader;",
      "observation_read(id) reads one observation in full (with its evidence anchors);",
      "observation_update(action, ...) creates, updates, or deletes an observation.",
      "",
      "Before answering a question about the reader's own history (what they read,",
      "asked, believed, or struggled with), first think about what to look for —",
      "which book, which concept, roughly when — then search your observations.",
      "Check whether what came back actually answers the question; if it doesn't,",
      "re-search with different terms before concluding you don't know.",
      "",
      "These observations are yours to maintain; the user never edits them directly.",
      "They are what you noticed, so the reader can disagree with one: if they say",
      "an observation is off, fix it with observation_update right away and",
      "acknowledge briefly.",
    );
  }
  return lines.join("\n");
}
