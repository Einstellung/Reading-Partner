// What the model is allowed to send back, and the rules that decide which of it
// is kept.
//
// The model hands over numbers and one action each; every id, date and author
// is looked up here from the lists it was numbered against (docs/49, "模型只交
// 下标和动作"). It never copies a record back, so there is nothing for a changed
// character to invalidate — which is why a proposal that breaks a rule is
// dropped on its own and the rest of the batch is written. Rejecting a whole
// answer over one bad element is the posture OpenClaw needs because its model
// retypes the records; ours does not.
//
// Every rule is here rather than in the prompt. A prompt rule is a request; the
// only ones that hold are the ones a function enforces.

import type { DreamCandidates } from "./candidates";

// A new statement, more evidence on one that stands, or a replacement for one.
// Numbers are 1-based, matching the lists materialize.ts renders.
export type Proposal =
  | { action: "state"; kind: "profile"; text: string; evidence: number[] }
  | { action: "support"; statement: number; evidence: number[] }
  | { action: "supersede"; statement: number; text: string; evidence: number[] };

export interface ValidatedProposals {
  accepted: Proposal[];
  // Elements thrown away, and why. The count is what the run logs; the reasons
  // are what a test reads, and what makes a rule that has started firing on
  // every batch findable.
  dropped: number;
  reasons: string[];
}

// A statement needs this many observations behind it, from this many different
// days (docs/48, "每晚三问": what is distilled needs at least two independent
// pieces of evidence, and a one-off is not written down). Two observations
// written up out of the same afternoon are one occasion seen twice, which is
// why the days are counted rather than the observations.
const MIN_EVIDENCE = 2;
const MIN_DAYS = 2;

// An id anywhere in the text. The evidence list carries the ids; a text that
// names one is a claim that reads as a citation and cannot be resolved by
// anything downstream, since nothing renders statement text against a store.
const ID_IN_TEXT = /\bm-[0-9a-f]{8}(?:[0-9a-f]{8})?\b/;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// The evidence numbers, deduplicated and in the order given, or null when any
// of them is not a number naming an observation on the list.
function evidenceIndices(raw: unknown, count: number): number[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const out: number[] = [];
  for (const v of raw) {
    if (typeof v !== "number" || !Number.isInteger(v) || v < 1 || v > count) return null;
    if (!out.includes(v)) out.push(v);
  }
  return out;
}

function statementIndex(raw: unknown, count: number): number | null {
  if (typeof raw !== "number" || !Number.isInteger(raw)) return null;
  return raw >= 1 && raw <= count ? raw : null;
}

function textOf(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const text = raw.trim();
  if (!text) return null;
  if (ID_IN_TEXT.test(text)) return null;
  return text;
}

// Whether these observations are spread over enough different days. `created`
// rather than `updated`: an observation corrected months later still happened
// on the day it happened, and dating by the correction would let one occasion
// touched twice pass as two.
function spreadEnough(indices: readonly number[], candidates: DreamCandidates): boolean {
  if (indices.length < MIN_EVIDENCE) return false;
  const days = new Set(indices.map((i) => candidates.observations[i - 1].created));
  return days.size >= MIN_DAYS;
}

export function validateProposals(raw: unknown, candidates: DreamCandidates): ValidatedProposals {
  const accepted: Proposal[] = [];
  const reasons: string[] = [];
  if (!Array.isArray(raw)) return { accepted, dropped: 0, reasons: ["not an array"] };

  const observations = candidates.observations.length;
  const statements = candidates.statements.length;
  // Observations already spent by an accepted `state` in this same batch. One
  // observation supporting two new statements is one occasion written up twice,
  // which is the duplication the nightly pass exists to stop rather than cause
  // (docs/49: 61% of one system's nightly entries were restatements).
  const claimed = new Set<number>();

  for (const element of raw) {
    const drop = (why: string) => reasons.push(why);
    if (!isRecord(element)) {
      drop("not an object");
      continue;
    }
    const action = element.action;
    const evidence = evidenceIndices(element.evidence, observations);
    if (evidence === null) {
      drop(`evidence out of range: ${JSON.stringify(element.evidence)}`);
      continue;
    }

    if (action === "state") {
      if (element.kind !== "profile") {
        // concern is a statement about what the reader is watching now, and it
        // is written by the reader rather than concluded at night (docs/48).
        drop(`state takes kind "profile", not ${JSON.stringify(element.kind)}`);
        continue;
      }
      const text = textOf(element.text);
      if (text === null) {
        drop("state text is empty or names an observation id");
        continue;
      }
      if (!spreadEnough(evidence, candidates)) {
        drop(`state needs ${MIN_EVIDENCE} observations from ${MIN_DAYS} days`);
        continue;
      }
      if (evidence.some((i) => claimed.has(i))) {
        drop("state reuses an observation another state in this batch claimed");
        continue;
      }
      for (const i of evidence) claimed.add(i);
      accepted.push({ action: "state", kind: "profile", text, evidence });
      continue;
    }

    if (action === "support") {
      const statement = statementIndex(element.statement, statements);
      if (statement === null) {
        drop(`support names no statement: ${JSON.stringify(element.statement)}`);
        continue;
      }
      // No spread rule: support adds evidence to a claim that was already made
      // on evidence that passed one, and a single new occasion is exactly what
      // it is for.
      accepted.push({ action: "support", statement, evidence });
      continue;
    }

    if (action === "supersede") {
      const statement = statementIndex(element.statement, statements);
      if (statement === null) {
        drop(`supersede names no statement: ${JSON.stringify(element.statement)}`);
        continue;
      }
      // What the reader said about themselves is never replaced by a night
      // pass. It may be supported, and it may be contradicted, but the words
      // stay theirs (docs/48, "author 决定谁能改").
      if (candidates.statements[statement - 1].author !== "dream") {
        drop("supersede targets a statement the reader wrote");
        continue;
      }
      const text = textOf(element.text);
      if (text === null) {
        drop("supersede text is empty or names an observation id");
        continue;
      }
      if (!spreadEnough(evidence, candidates)) {
        drop(`supersede needs ${MIN_EVIDENCE} observations from ${MIN_DAYS} days`);
        continue;
      }
      accepted.push({ action: "supersede", statement, text, evidence });
      continue;
    }

    drop(`unknown action: ${JSON.stringify(action)}`);
  }

  return { accepted, dropped: reasons.length, reasons };
}

// The JSON array out of a reply, or null when there is none to be had. Fences
// and the sentence a model puts in front of its answer are both routine, and
// the array is the one span this looks for.
export function parseProposals(reply: string): unknown[] | null {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(reply);
  const body = (fenced ? fenced[1] : reply).trim();
  const start = body.indexOf("[");
  const end = body.lastIndexOf("]");
  if (start < 0 || end <= start) return null;
  try {
    const parsed: unknown = JSON.parse(body.slice(start, end + 1));
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

