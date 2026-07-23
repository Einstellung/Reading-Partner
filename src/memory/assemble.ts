// The memory module's single assembly exit. Two narrow reads over what the system
// knows about the user:
//
//   assembleIdentity()        — the full profile text (the cross-scenario identity
//                               document), a semantic wrapper over loadProfile.
//   assembleReadingContext()  — a short plain-text signal of what the user has been
//                               reading and stuck on lately, distilled from the
//                               per-topic memory indexes, recent first.
//
// The reading-signal builder is pure (assembleReadingSignal, over given index
// entries) so it unit-tests without a filesystem; the async wrapper wires it to
// the live store and topic list. Nothing here changes the memory storage format.

import { listTopics } from "../app/topics";
import { readMemoryIndex } from "./live";
import { loadProfile } from "./profile";
import type { MemoryIndexEntry, MemoryType } from "./types";

// The identity document, verbatim (empty string when the user has no profile yet).
export function assembleIdentity(): Promise<string> {
  return loadProfile();
}

// Default character budget for the reading-episode signal. A hint, not a hard
// cut mid-line: whole lines are added until the next one would exceed it.
export const READING_SIGNAL_BUDGET = 500;

// The two memory types that make up the signal: where the reader is, and what
// they are stuck on / asking. Each maps to a labeled section in the output.
const SIGNAL_SECTIONS: { type: MemoryType; heading: string }[] = [
  { type: "reading-position", heading: "Reading recently" },
  { type: "stuck-point", heading: "Open questions and stuck points" },
];

export interface TopicMemorySignal {
  topicName: string;
  entries: MemoryIndexEntry[];
}

interface SignalLine {
  type: MemoryType;
  text: string;
  updated: string;
}

// Build the reading-episode signal from each topic's memory index. Pure: no I/O.
// Lines are picked newest-updated first across all topics until the budget would
// be exceeded, then rendered grouped under their section headings (each group
// keeps newest-first order). Returns "" when nothing qualifies.
export function assembleReadingSignal(
  topics: TopicMemorySignal[],
  opts: { budget?: number } = {},
): string {
  const budget = opts.budget ?? READING_SIGNAL_BUDGET;
  const headingFor = new Map(SIGNAL_SECTIONS.map((s) => [s.type, s.heading]));

  const candidates: SignalLine[] = [];
  for (const topic of topics) {
    const name = topic.topicName.trim() || "Untitled";
    for (const e of topic.entries) {
      if (!headingFor.has(e.type)) continue;
      const summary = e.summary.trim();
      if (!summary) continue;
      candidates.push({ type: e.type, text: `- ${name}: ${summary}`, updated: e.updated });
    }
  }
  // Newest first; ties broken by text so the order is deterministic.
  candidates.sort((a, b) => b.updated.localeCompare(a.updated) || a.text.localeCompare(b.text));

  const picked: SignalLine[] = [];
  let used = 0;
  for (const c of candidates) {
    const cost = c.text.length + 1; // + newline
    if (picked.length > 0 && used + cost > budget) break;
    picked.push(c);
    used += cost;
  }
  if (picked.length === 0) return "";

  const out: string[] = [];
  for (const section of SIGNAL_SECTIONS) {
    const lines = picked.filter((p) => p.type === section.type);
    if (lines.length === 0) continue;
    if (out.length > 0) out.push("");
    out.push(`${section.heading}:`);
    for (const l of lines) out.push(l.text);
  }
  return out.join("\n");
}

// Live assembly: gather every topic's memory index and distill the signal. Never
// throws — a failed topic read contributes nothing rather than blocking a caller
// (a briefing must not depend on this). Returns "" when there is no signal.
export async function assembleReadingContext(
  opts: { budget?: number } = {},
): Promise<string> {
  try {
    const topics = await listTopics();
    const signals: TopicMemorySignal[] = [];
    for (const t of topics) {
      const entries = await readMemoryIndex(t.id).catch((): MemoryIndexEntry[] => []);
      if (entries.length) signals.push({ topicName: t.name, entries });
    }
    return assembleReadingSignal(signals, opts);
  } catch {
    return "";
  }
}
