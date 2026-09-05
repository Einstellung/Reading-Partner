// What the "About you" block of the observation panel shows: the statements
// that still stand, each as the few strings the row prints (docs/48 — the
// reader can see what is held to be true about them and what it rests on).
//
// Read-only, here as much as on screen. Changing one is a conversation ("I do
// want the pictures"), which writes a new statement that supersedes the old,
// and a superseded statement drops out of this list on its own.

import { isObservationId, type Statement, type StatementKind } from "../../../memory";

export interface StatementRow {
  id: string;
  text: string;
  kind: StatementKind;
  // Who wrote the claim, in the reader's terms rather than the store's.
  author: string;
  // The last day something supported it, "YYYY-MM-DD" as stored — a computed
  // date, never one a model wrote.
  lastSupported: string;
  // What it rests on, counted ("3 observations"). Empty when it rests on
  // nothing, which no statement the store minted can be.
  evidence: string;
}

function plural(n: number, one: string): string {
  return `${n} ${n === 1 ? one : `${one}s`}`;
}

// Observations and conversation turns are counted apart because they are not
// the same claim: an observation is something that was noticed over a day or
// more, a message anchor is one thing the reader said.
function evidenceLabel(evidence: readonly string[]): string {
  let observations = 0;
  let messages = 0;
  for (const item of evidence) {
    if (isObservationId(item)) observations += 1;
    else messages += 1;
  }
  const parts: string[] = [];
  if (observations > 0) parts.push(plural(observations, "observation"));
  if (messages > 0) parts.push(plural(messages, "message"));
  return parts.join(", ");
}

// Newest support first: what has been seen lately is what the reader will
// recognise, and a statement nothing has supported in months is the one they
// are most likely to want to argue with — so it sorts to the bottom rather than
// disappearing. Ties broken by id so the list does not reshuffle between reads.
export function statementRows(statements: readonly Statement[]): StatementRow[] {
  return statements
    .filter((s) => !s.supersededBy && s.text.trim() !== "")
    .sort((a, b) => b.lastSupported.localeCompare(a.lastSupported) || a.id.localeCompare(b.id))
    .map((s) => ({
      id: s.id,
      text: s.text.trim(),
      kind: s.kind,
      author: s.author === "reader" ? "You said" : "Concluded",
      lastSupported: s.lastSupported,
      evidence: evidenceLabel(s.evidence),
    }));
}
