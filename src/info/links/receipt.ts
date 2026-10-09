// The run's receipt (docs/86 「回执」), in English, every word of it the
// program's but the model's closing note, which is marked as the AI's. The
// documents' own lines are the caller's (reading's ingestOutputLine, which needs
// the cut pages), so this composes the sentence before them and the lines after.

import { shortAddress, type Candidate, type LinkSession, type TrailStep } from "./session";

/** How the run ended. `at` is the candidate it stopped on, when it stopped early. */
export type LinkStop =
  | { kind: "finished"; note: string | null }
  | { kind: "steps"; at: number | null }
  | { kind: "rounds"; at: number | null }
  | { kind: "broken"; at: number | null; message: string }
  | { kind: "stopped"; at: number | null; message: string };

/** Unopened first-layer candidates listed in the receipt. */
export const MAX_UNOPENED_LISTED = 6;

function reasonFor(c: Candidate): string {
  if (c.rejected) return c.rejected;
  const o = c.opened;
  if (o?.content && !o.content.ok) return o.content.message;
  if (o && o.content === null) return [o.why, ...(o.reading?.notes ?? [])].filter(Boolean).join("; ");
  return "the AI did not choose it";
}

function status(c: Candidate): string {
  if (c.filed) {
    const f = c.filed;
    if (f.format !== "article") return `${f.format.toUpperCase()}, filed`;
    return f.sections > 1 ? `book, ${f.sections} sections, filed` : `article, filed`;
  }
  if (c.rejected) return `rejected: ${c.rejected}`;
  if (c.opened?.content && !c.opened.content.ok) return `unreadable: ${c.opened.content.message}`;
  return "opened";
}

function at(session: LinkSession<unknown>, n: number | null): string {
  const c = n === null ? undefined : session.get(n);
  return c ? ` at #${c.n} ${shortAddress(c.url)}` : "";
}

function stopLine(session: LinkSession<unknown>, stop: LinkStop): string {
  switch (stop.kind) {
    case "finished":
      return stop.note ? `The AI finished. Its note (the AI's words): "${stop.note}"` : "The AI finished without a note.";
    case "steps":
      return `Stopped: the step limit was reached${at(session, stop.at)}.`;
    case "rounds":
      return `Stopped: the model ran out of rounds${at(session, stop.at)}.`;
    case "broken":
      return `Stopped: the model call broke off${at(session, stop.at)} (${stop.message}).`;
    case "stopped":
      return `Stopped${at(session, stop.at)}: ${stop.message}`;
  }
}

/** A candidate the run looked at and did not file, and why. */
export interface NotTaken {
  url: string;
  reason: string;
}

/**
 * What the run opened or tried to file and left out, with the reason, in the
 * order it met them. The receipt's "Not taken" lines are these, worded.
 */
export function notTakenOf(candidates: readonly Candidate[], trail: readonly TrailStep[]): NotTaken[] {
  const touched = new Set(trail.map((s) => s.n));
  return candidates.filter((c) => touched.has(c.n) && !c.filed).map((c) => ({ url: c.url, reason: reasonFor(c) }));
}

/** The sentence before the documents and the lines after them. */
export function composeReceipt(
  session: LinkSession<unknown>,
  source: string,
  stop: LinkStop,
): { lead: string; notes: string[] } {
  const filedCount = session.filed.length;
  const lead = `Read ${source}.${filedCount === 0 ? " Nothing became a document." : ""}`;
  const notes: string[] = [];

  for (const item of notTakenOf(session.candidates, session.trail)) {
    notes.push(`Not taken: ${shortAddress(item.url)}: ${item.reason}.`);
  }

  const touched = new Set(session.trail.map((s) => s.n));

  const unopened = session.candidates.filter((c) => c.from === 1 && !c.opened && !c.filed && !touched.has(c.n));
  if (unopened.length > 0) {
    const listed = unopened.slice(0, MAX_UNOPENED_LISTED).map((c) => session.line(c));
    const more = unopened.length - listed.length;
    notes.push(`Not opened: ${listed.join("; ")}${more > 0 ? `; and ${more} more` : ""}.`);
  }

  const order: number[] = [];
  for (const step of session.trail) if (!order.includes(step.n)) order.push(step.n);
  if (order.length > 0) {
    const path = order.map((n) => {
      const c = session.get(n)!;
      return `#${n} ${shortAddress(c.url)} (${status(c)})`;
    });
    notes.push(`Path: ${path.join(" → ")}.`);
  }
  notes.push(stopLine(session, stop));
  return { lead, notes };
}
