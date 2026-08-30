// The numbered transcript a distillation pass reads, and the table that turns
// what the model cites back into the anchor that lands on disk.
//
// Both halves exist because of one measured failure. A transcript used to be
// printed as `[<threadId>:<ts>] role: text` and the model was asked to copy
// those strings back as an observation's evidence. On one real store 76 of 298
// stored message anchors (25.5%) resolved against no message at all.
//
// SIXTY-SIX of those 76 were the renderer's fault, not the model's: a unit
// transcript is a lesson thread with its pageless asides folded into it
// (arrears.ts), and every line was printed with the unit's threadId — the
// parent's — so every line that came from a folded aside named a pair that
// exists nowhere. The remaining ten are what asking for a copied string costs:
// one thread id off by a single character, one anchor invented outright.
//
// So the id is neither shown nor asked for. The model cites a line number, the
// program holds the ids. On-disk format is unchanged: the anchors below are the
// same "<threadId>:<ts>" strings the frontmatter has always carried.

import { localDate } from "./files";
import type { EvidenceDates } from "./types";

// What this module needs of a message. Structural rather than imported so
// distill.ts can keep owning DistillMessage without a cycle.
export interface TranscriptMessage {
  role: "user" | "ai";
  text: string;
  ts: number;
  // The thread this message is actually stored in, stamped where a unit is
  // flattened (arrears.ts). The unit's own threadId is not this: a unit is a
  // parent thread plus the asides folded into it, so the parent's id is wrong
  // for every folded line — the 66. Absent on a single-thread transcript, where
  // the pass's threadId is the message's own.
  threadId?: string;
}

export interface TranscriptLine {
  // 1-based, the only handle the model is given on a message.
  index: number;
  // "<threadId>:<ts>" — what the observation's `messages:` field stores.
  anchor: string;
  // The calendar day this message happened on, on the reader's own clock. Null
  // when its ts is unusable (rows written before messages carried one).
  date: string | null;
  role: "user" | "ai";
  text: string;
}

export function buildTranscript(
  messages: readonly TranscriptMessage[],
  fallbackThreadId: string,
): TranscriptLine[] {
  return messages.map((m, i) => ({
    index: i + 1,
    anchor: `${m.threadId ?? fallbackThreadId}:${m.ts}`,
    date: Number.isFinite(m.ts) && m.ts > 0 ? localDate(m.ts) : null,
    role: m.role,
    text: m.text,
  }));
}

// One prompt line per message: the number to cite, the day it happened, who
// said it.
//
// The date is per line rather than only in the header because the header is one
// span for the whole transcript, and a model writing "on 08-21 he…" into an
// observation body was guessing which turn belonged to which day. Measured: one
// observation's body named 2026-08-06 and 2026-08-12 while its own evidence
// resolved to 08-02 and 08-03, and one identical message was dated 07-30 in one
// observation and 08-08 in another.
export function renderTranscript(lines: readonly TranscriptLine[]): string[] {
  return lines.map((l) => {
    const who = l.role === "user" ? "reader" : "you";
    return `[${l.index}]${l.date ? ` ${l.date}` : ""} ${who}: ${l.text}`;
  });
}

// The index → anchor table the observation tools are mounted with. Position
// i holds the anchor for the line the prompt printed as [i + 1].
export function transcriptAnchors(lines: readonly TranscriptLine[]): string[] {
  return lines.map((l) => l.anchor);
}

// The days a set of evidence covers, over days rather than timestamps. A line
// already carries the day it happened and a mark's day is formatted the same
// way, so the min and max of two ISO days is the same answer evidenceDates
// gives over stamps (distill.ts) — one grain finer, because an observation is
// dated by the lines it actually cited and not by the whole pass. Days that are
// not known are dropped; null when none is left.
export function coveredDays(
  days: readonly (string | null | undefined)[],
): EvidenceDates | null {
  let first: string | null = null;
  let last: string | null = null;
  for (const d of days) {
    if (!d) continue;
    if (first === null || d < first) first = d;
    if (last === null || d > last) last = d;
  }
  return first === null || last === null ? null : { first, last };
}
